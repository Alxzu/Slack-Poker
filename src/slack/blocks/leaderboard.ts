const TYPE_TITLES: Record<string, string> = {
	weekly: ":calendar: Weekly Leaderboard",
	alltime: ":trophy: All-Time Leaderboard",
	winrate: ":chart_with_upwards_trend: Win Rate Leaderboard",
};

const MOVEMENT_EMOJI: Record<string, string> = {
	up: ":arrow_up:",
	down: ":arrow_down:",
	same: ":heavy_minus_sign:",
};

function medal(rank: number): string {
	if (rank === 1) return ":first_place_medal:";
	if (rank === 2) return ":second_place_medal:";
	if (rank === 3) return ":third_place_medal:";
	return `*#${rank}*`;
}

export function buildLeaderboardMessage(
	type: "weekly" | "alltime" | "winrate",
	entries: {
		userId: string;
		rank: number;
		value: number;
		gamesPlayed: number;
		movement?: "up" | "down" | "same";
	}[],
): object[] {
	const blocks: object[] = [];

	blocks.push({
		type: "header",
		text: { type: "plain_text", text: TYPE_TITLES[type] ?? type, emoji: true },
	});

	blocks.push({ type: "divider" });

	for (const entry of entries) {
		const mov = entry.movement ? `  ${MOVEMENT_EMOJI[entry.movement]}` : "";
		const valueText =
			type === "winrate"
				? `${entry.value}%`
				: `${entry.value >= 0 ? "+" : ""}${entry.value} chips`;
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: `${medal(entry.rank)}  <@${entry.userId}>  —  ${valueText}  (${entry.gamesPlayed} games)${mov}`,
			},
		});
	}

	return blocks;
}

export function buildEmptyLeaderboard(type: string): object[] {
	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `No ${type} data yet. Play some hands to appear on the leaderboard!`,
			},
		},
	];
}
