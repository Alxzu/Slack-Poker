import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./connection";
import { gameHands, gamePlayers, games, handPayouts } from "./schema";

export async function createGame(
	db: Database,
	workspaceId: string,
	channelId: string,
	buyIn: number,
	smallBlind: number,
	bigBlind: number,
) {
	const [game] = await db
		.insert(games)
		.values({
			workspaceId,
			channelId,
			buyIn,
			smallBlind,
			bigBlind,
			status: "waiting",
		})
		.returning();

	return game;
}

export async function addPlayer(
	db: Database,
	gameId: string,
	userId: string,
	seat: number,
	chipsStart: number,
) {
	const [player] = await db
		.insert(gamePlayers)
		.values({ gameId, userId, seat, chipsStart })
		.returning();

	return player;
}

export async function updateGameStatus(
	db: Database,
	gameId: string,
	status: "waiting" | "active" | "complete" | "cancelled",
) {
	const updates: Record<string, unknown> = { status };
	if (status === "complete" || status === "cancelled") {
		updates.completedAt = new Date();
	}

	const [updated] = await db
		.update(games)
		.set(updates)
		.where(eq(games.id, gameId))
		.returning();

	return updated;
}

export async function getActiveGameInChannel(
	db: Database,
	workspaceId: string,
	channelId: string,
) {
	const [game] = await db
		.select()
		.from(games)
		.where(
			and(
				eq(games.workspaceId, workspaceId),
				eq(games.channelId, channelId),
				inArray(games.status, ["waiting", "active"]),
			),
		)
		.limit(1);

	return game ?? null;
}

export async function recordHand(
	db: Database,
	gameId: string,
	handNumber: number,
	dealerSeat: number,
	communityCards: unknown,
	holeCardsEncrypted: string,
) {
	const [hand] = await db
		.insert(gameHands)
		.values({
			gameId,
			handNumber,
			dealerSeat,
			communityCards,
			holeCardsEncrypted,
		})
		.returning();

	return hand;
}

export async function recordPayout(
	db: Database,
	handId: string,
	userId: string,
	potIndex: number,
	amount: number,
) {
	const [payout] = await db
		.insert(handPayouts)
		.values({ handId, userId, potIndex, amount })
		.returning();

	return payout;
}

export interface SettlePlayerResult {
	userId: string;
	chipsEnd: number;
	result: string;
}

export async function settleGame(
	db: Database,
	gameId: string,
	playerResults: SettlePlayerResult[],
) {
	return db.transaction(async (tx) => {
		for (const result of playerResults) {
			await tx
				.update(gamePlayers)
				.set({ chipsEnd: result.chipsEnd, result: result.result })
				.where(
					and(
						eq(gamePlayers.gameId, gameId),
						eq(gamePlayers.userId, result.userId),
					),
				);
		}

		const [updated] = await tx
			.update(games)
			.set({ status: "complete", completedAt: new Date() })
			.where(eq(games.id, gameId))
			.returning();

		return updated;
	});
}
