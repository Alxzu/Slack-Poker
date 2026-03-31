import type { Database } from "../../db/connection";
import { claimRefill, RefillNotAllowedError } from "../../db/ledger";

export async function handleRefill(
	db: Database,
	workspaceId: string,
	userId: string,
): Promise<object[]> {
	try {
		const event = await claimRefill(db, workspaceId, userId);

		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `:white_check_mark: Refill claimed! You received *${event.amount}* chips. New balance: *${event.balanceAfter}* chips.`,
				},
			},
		];
	} catch (err) {
		if (err instanceof RefillNotAllowedError) {
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
