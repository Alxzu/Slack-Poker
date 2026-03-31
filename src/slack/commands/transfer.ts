import { z } from "zod";
import type { Database } from "../../db/connection";
import {
	InsufficientBalanceError,
	TransferLimitError,
	transfer,
} from "../../db/ledger";

const transferArgsSchema = z.object({
	targetUserId: z
		.string()
		.min(1, "Please mention a user: `/poker transfer @user amount`"),
	amount: z
		.number()
		.int()
		.positive("Amount must be a positive integer")
		.max(1000, "Maximum transfer is 1,000 chips per transaction"),
});

function parseTransferArgs(args: string): {
	targetUserId: string;
	amount: number;
} | null {
	// Slack formats user mentions as <@U12345> or <@U12345|username>
	const mentionMatch = args.match(/<@([A-Z0-9]+)(?:\|[^>]*)?>/);
	if (!mentionMatch) return null;

	const targetUserId = mentionMatch[1];
	const remaining = args.replace(/<@[A-Z0-9]+(?:\|[^>]*)?>/, "").trim();
	const amount = Number.parseInt(remaining, 10);

	if (Number.isNaN(amount)) return null;

	return { targetUserId, amount };
}

export async function handleTransfer(
	db: Database,
	workspaceId: string,
	userId: string,
	args: string,
): Promise<object[]> {
	const parsed = parseTransferArgs(args);

	if (!parsed) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Usage: `/poker transfer @user amount`\nExample: `/poker transfer @alice 100`",
				},
			},
		];
	}

	const validation = transferArgsSchema.safeParse(parsed);
	if (!validation.success) {
		const message = validation.error.issues.map((i) => i.message).join(". ");
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `:x: ${message}`,
				},
			},
		];
	}

	const { targetUserId, amount } = validation.data;

	if (targetUserId === userId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: You can't transfer chips to yourself.",
				},
			},
		];
	}

	try {
		await transfer(db, workspaceId, userId, targetUserId, amount);

		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `:white_check_mark: Transferred *${amount}* chips to <@${targetUserId}>.`,
				},
			},
		];
	} catch (err) {
		if (err instanceof InsufficientBalanceError) {
			return [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:x: ${err.message}`,
					},
				},
			];
		}
		if (err instanceof TransferLimitError) {
			return [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:x: ${err.message}`,
					},
				},
			];
		}
		throw err;
	}
}
