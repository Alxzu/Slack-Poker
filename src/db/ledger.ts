import { eq, and, sql, gte } from "drizzle-orm";
import { ledgerAccounts, ledgerEvents } from "./schema";
import type { Database } from "./connection";

export class OptimisticLockError extends Error {
	constructor() {
		super("Optimistic lock conflict: account was modified concurrently");
		this.name = "OptimisticLockError";
	}
}

export class InsufficientBalanceError extends Error {
	constructor(balance: number, amount: number) {
		super(
			`Insufficient balance: have ${balance}, need ${amount}`,
		);
		this.name = "InsufficientBalanceError";
	}
}

export class RefillNotAllowedError extends Error {
	constructor(reason: string) {
		super(`Refill not allowed: ${reason}`);
		this.name = "RefillNotAllowedError";
	}
}

export class TransferLimitError extends Error {
	constructor() {
		super("Transfer limit exceeded: 1000 chips per day maximum");
		this.name = "TransferLimitError";
	}
}

export async function getOrCreateAccount(
	db: Database,
	workspaceId: string,
	userId: string,
) {
	const [account] = await db
		.insert(ledgerAccounts)
		.values({ workspaceId, userId, balance: 1000, lockVersion: 0 })
		.onConflictDoNothing()
		.returning();

	if (account) return account;

	const [existing] = await db
		.select()
		.from(ledgerAccounts)
		.where(
			and(
				eq(ledgerAccounts.workspaceId, workspaceId),
				eq(ledgerAccounts.userId, userId),
			),
		);

	return existing;
}

export async function getBalance(
	db: Database,
	workspaceId: string,
	userId: string,
): Promise<number> {
	const account = await getOrCreateAccount(db, workspaceId, userId);
	return account.balance;
}

export async function debit(
	db: Database,
	workspaceId: string,
	userId: string,
	amount: number,
	type: "buy_in" | "cash_out" | "refill" | "transfer_in" | "transfer_out",
	idempotencyKey: string,
	gameId?: string,
) {
	return db.transaction(async (tx) => {
		// Check idempotency
		const [existingEvent] = await tx
			.select()
			.from(ledgerEvents)
			.where(eq(ledgerEvents.idempotencyKey, idempotencyKey));

		if (existingEvent) return existingEvent;

		const account = await getOrCreateAccount(
			tx as unknown as Database,
			workspaceId,
			userId,
		);

		if (account.balance < amount) {
			throw new InsufficientBalanceError(account.balance, amount);
		}

		const newBalance = account.balance - amount;
		const newVersion = account.lockVersion + 1;

		const [updated] = await tx
			.update(ledgerAccounts)
			.set({ balance: newBalance, lockVersion: newVersion })
			.where(
				and(
					eq(ledgerAccounts.workspaceId, workspaceId),
					eq(ledgerAccounts.userId, userId),
					eq(ledgerAccounts.lockVersion, account.lockVersion),
				),
			)
			.returning();

		if (!updated) throw new OptimisticLockError();

		const [event] = await tx
			.insert(ledgerEvents)
			.values({
				workspaceId,
				userId,
				type,
				amount,
				balanceBefore: account.balance,
				balanceAfter: newBalance,
				lockVersionBefore: account.lockVersion,
				lockVersionAfter: newVersion,
				gameId: gameId ?? null,
				idempotencyKey,
			})
			.returning();

		return event;
	});
}

export async function credit(
	db: Database,
	workspaceId: string,
	userId: string,
	amount: number,
	type: "buy_in" | "cash_out" | "refill" | "transfer_in" | "transfer_out",
	idempotencyKey: string,
	gameId?: string,
) {
	return db.transaction(async (tx) => {
		const [existingEvent] = await tx
			.select()
			.from(ledgerEvents)
			.where(eq(ledgerEvents.idempotencyKey, idempotencyKey));

		if (existingEvent) return existingEvent;

		const account = await getOrCreateAccount(
			tx as unknown as Database,
			workspaceId,
			userId,
		);

		const newBalance = account.balance + amount;
		const newVersion = account.lockVersion + 1;

		const [updated] = await tx
			.update(ledgerAccounts)
			.set({ balance: newBalance, lockVersion: newVersion })
			.where(
				and(
					eq(ledgerAccounts.workspaceId, workspaceId),
					eq(ledgerAccounts.userId, userId),
					eq(ledgerAccounts.lockVersion, account.lockVersion),
				),
			)
			.returning();

		if (!updated) throw new OptimisticLockError();

		const [event] = await tx
			.insert(ledgerEvents)
			.values({
				workspaceId,
				userId,
				type,
				amount,
				balanceBefore: account.balance,
				balanceAfter: newBalance,
				lockVersionBefore: account.lockVersion,
				lockVersionAfter: newVersion,
				gameId: gameId ?? null,
				idempotencyKey,
			})
			.returning();

		return event;
	});
}

export async function transfer(
	db: Database,
	workspaceId: string,
	fromUserId: string,
	toUserId: string,
	amount: number,
) {
	return db.transaction(async (tx) => {
		// Enforce 1000/day cap for sender
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);

		const transferredToday = await tx
			.select({ total: sql<number>`COALESCE(SUM(${ledgerEvents.amount}), 0)` })
			.from(ledgerEvents)
			.where(
				and(
					eq(ledgerEvents.workspaceId, workspaceId),
					eq(ledgerEvents.userId, fromUserId),
					eq(ledgerEvents.type, "transfer_out"),
					gte(ledgerEvents.createdAt, todayStart),
				),
			);

		const totalToday = Number(transferredToday[0]?.total ?? 0);
		if (totalToday + amount > 1000) {
			throw new TransferLimitError();
		}

		const timestamp = Date.now();
		const debitKey = `transfer:${fromUserId}:${toUserId}:${timestamp}:out`;
		const creditKey = `transfer:${fromUserId}:${toUserId}:${timestamp}:in`;

		// Debit sender
		const fromAccount = await getOrCreateAccount(
			tx as unknown as Database,
			workspaceId,
			fromUserId,
		);

		if (fromAccount.balance < amount) {
			throw new InsufficientBalanceError(fromAccount.balance, amount);
		}

		const fromNewBalance = fromAccount.balance - amount;
		const fromNewVersion = fromAccount.lockVersion + 1;

		const [fromUpdated] = await tx
			.update(ledgerAccounts)
			.set({ balance: fromNewBalance, lockVersion: fromNewVersion })
			.where(
				and(
					eq(ledgerAccounts.workspaceId, workspaceId),
					eq(ledgerAccounts.userId, fromUserId),
					eq(ledgerAccounts.lockVersion, fromAccount.lockVersion),
				),
			)
			.returning();

		if (!fromUpdated) throw new OptimisticLockError();

		await tx.insert(ledgerEvents).values({
			workspaceId,
			userId: fromUserId,
			type: "transfer_out",
			amount,
			balanceBefore: fromAccount.balance,
			balanceAfter: fromNewBalance,
			lockVersionBefore: fromAccount.lockVersion,
			lockVersionAfter: fromNewVersion,
			idempotencyKey: debitKey,
		});

		// Credit receiver
		const toAccount = await getOrCreateAccount(
			tx as unknown as Database,
			workspaceId,
			toUserId,
		);

		const toNewBalance = toAccount.balance + amount;
		const toNewVersion = toAccount.lockVersion + 1;

		const [toUpdated] = await tx
			.update(ledgerAccounts)
			.set({ balance: toNewBalance, lockVersion: toNewVersion })
			.where(
				and(
					eq(ledgerAccounts.workspaceId, workspaceId),
					eq(ledgerAccounts.userId, toUserId),
					eq(ledgerAccounts.lockVersion, toAccount.lockVersion),
				),
			)
			.returning();

		if (!toUpdated) throw new OptimisticLockError();

		await tx.insert(ledgerEvents).values({
			workspaceId,
			userId: toUserId,
			type: "transfer_in",
			amount,
			balanceBefore: toAccount.balance,
			balanceAfter: toNewBalance,
			lockVersionBefore: toAccount.lockVersion,
			lockVersionAfter: toNewVersion,
			idempotencyKey: creditKey,
		});
	});
}

export async function claimRefill(
	db: Database,
	workspaceId: string,
	userId: string,
) {
	return db.transaction(async (tx) => {
		const account = await getOrCreateAccount(
			tx as unknown as Database,
			workspaceId,
			userId,
		);

		if (account.balance >= 100) {
			throw new RefillNotAllowedError(
				`balance is ${account.balance} (must be below 100)`,
			);
		}

		// Check no refill today
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);

		const [refillToday] = await tx
			.select()
			.from(ledgerEvents)
			.where(
				and(
					eq(ledgerEvents.workspaceId, workspaceId),
					eq(ledgerEvents.userId, userId),
					eq(ledgerEvents.type, "refill"),
					gte(ledgerEvents.createdAt, todayStart),
				),
			)
			.limit(1);

		if (refillToday) {
			throw new RefillNotAllowedError("already claimed a refill today");
		}

		const refillAmount = 1000 - account.balance;
		const newBalance = 1000;
		const newVersion = account.lockVersion + 1;
		const idempotencyKey = `refill:${workspaceId}:${userId}:${todayStart.toISOString()}`;

		const [updated] = await tx
			.update(ledgerAccounts)
			.set({ balance: newBalance, lockVersion: newVersion })
			.where(
				and(
					eq(ledgerAccounts.workspaceId, workspaceId),
					eq(ledgerAccounts.userId, userId),
					eq(ledgerAccounts.lockVersion, account.lockVersion),
				),
			)
			.returning();

		if (!updated) throw new OptimisticLockError();

		const [event] = await tx
			.insert(ledgerEvents)
			.values({
				workspaceId,
				userId,
				type: "refill",
				amount: refillAmount,
				balanceBefore: account.balance,
				balanceAfter: newBalance,
				lockVersionBefore: account.lockVersion,
				lockVersionAfter: newVersion,
				idempotencyKey,
			})
			.returning();

		return event;
	});
}
