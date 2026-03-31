import type { Database } from "../../db/connection";
import { getOrCreateAccount } from "../../db/ledger";

export async function handleBalance(
	db: Database,
	workspaceId: string,
	userId: string,
): Promise<object[]> {
	const account = await getOrCreateAccount(db, workspaceId, userId);

	const isNew = account.balance === 1000 && account.lockVersion === 0;

	const blocks: object[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:bank: *Your Balance:* ${account.balance} chips`,
			},
		},
	];

	if (isNew) {
		blocks.push({
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: ":wave: Welcome to Slack Poker! You've been credited 1,000 chips to get started. Use `/poker new` to start a game!",
				},
			],
		});
	}

	return blocks;
}
