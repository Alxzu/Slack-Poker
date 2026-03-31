import type { Database } from "../../db/connection";
import { getPlayerStats } from "../../db/stats";

function parseTargetUser(args: string, defaultUserId: string): string {
	const mentionMatch = args.match(/<@([A-Z0-9]+)(?:\|[^>]*)?>/);
	return mentionMatch ? mentionMatch[1] : defaultUserId;
}

export async function handleStats(
	db: Database,
	workspaceId: string,
	userId: string,
	args: string,
): Promise<object[]> {
	const targetUserId = parseTargetUser(args, userId);
	const stats = await getPlayerStats(db, workspaceId, targetUserId);

	if (!stats) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text:
						targetUserId === userId
							? ":bar_chart: You haven't played any games yet. Use `/poker new` to get started!"
							: `:bar_chart: <@${targetUserId}> hasn't played any games yet.`,
				},
			},
		];
	}

	const netChips = stats.chipsWon - stats.chipsLost;
	const winRate =
		stats.gamesPlayed > 0
			? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
			: 0;

	return [
		{
			type: "header",
			text: {
				type: "plain_text",
				text: ":bar_chart: Player Stats",
				emoji: true,
			},
		},
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*Player:* <@${targetUserId}>`,
			},
		},
		{ type: "divider" },
		{
			type: "section",
			fields: [
				{
					type: "mrkdwn",
					text: `*Games Played:*\n${stats.gamesPlayed}`,
				},
				{
					type: "mrkdwn",
					text: `*Games Won:*\n${stats.gamesWon}`,
				},
				{
					type: "mrkdwn",
					text: `*Win Rate:*\n${winRate}%`,
				},
				{
					type: "mrkdwn",
					text: `*Net Chips:*\n${netChips >= 0 ? "+" : ""}${netChips}`,
				},
				{
					type: "mrkdwn",
					text: `*Biggest Pot:*\n${stats.biggestPot}`,
				},
				{
					type: "mrkdwn",
					text: `*Weekly Net:*\n${stats.weekNet >= 0 ? "+" : ""}${stats.weekNet}`,
				},
			],
		},
	];
}
