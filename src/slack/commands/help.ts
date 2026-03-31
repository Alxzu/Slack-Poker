export function handleHelp(): object[] {
	return [
		{
			type: "header",
			text: {
				type: "plain_text",
				text: ":spades: Slack Poker — Command Reference",
				emoji: true,
			},
		},
		{ type: "divider" },
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: [
					"*Game Commands*",
					"`/poker new [buy-in]` — Start a new game (default 500 chips)",
					"`/poker join` — Join the current game",
					"`/poker start` — Start the game (creator only, 2+ players)",
					"`/poker leave` — Leave a game in the waiting phase",
					"`/poker cancel` — Cancel a game in the waiting phase",
					"`/poker end` — End the current game",
					"`/poker status` — Show current game state",
					"`/poker cards` — Re-send your hole cards via DM",
				].join("\n"),
			},
		},
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: [
					"*Economy Commands*",
					"`/poker balance` — Check your chip balance",
					"`/poker refill` — Claim a free refill (balance must be below 100)",
					"`/poker transfer @user amount` — Send chips to another player",
				].join("\n"),
			},
		},
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: [
					"*Stats Commands*",
					"`/poker leaderboard [weekly|alltime|winrate]` — View leaderboard",
					"`/poker stats [@user]` — View player statistics",
				].join("\n"),
			},
		},
		{
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: "During a hand, use the buttons in the channel message to fold, check, call, or raise.",
				},
			],
		},
	];
}

export function handleUnknownCommand(text: string): object[] {
	const knownCommands = [
		"new",
		"join",
		"start",
		"leave",
		"cancel",
		"end",
		"status",
		"cards",
		"balance",
		"refill",
		"transfer",
		"leaderboard",
		"stats",
		"help",
	];

	const suggestion = knownCommands.find((cmd) => {
		// Simple similarity: starts with same letter or is a substring
		return (
			cmd.startsWith(text.slice(0, 2)) ||
			text.startsWith(cmd.slice(0, 2)) ||
			cmd.includes(text) ||
			text.includes(cmd)
		);
	});

	const suggestionText = suggestion
		? ` Did you mean \`/poker ${suggestion}\`?`
		: " Type `/poker help` for a list of commands.";

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:x: Unknown command: \`${text}\`.${suggestionText}`,
			},
		},
	];
}
