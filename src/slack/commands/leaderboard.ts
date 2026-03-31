import type { Database } from "../../db/connection";
import { getLeaderboard, type LeaderboardType } from "../../db/stats";
import {
	buildEmptyLeaderboard,
	buildLeaderboardMessage,
} from "../blocks/leaderboard";

const VALID_TYPES = new Set<string>(["weekly", "alltime", "winrate"]);

function parseLeaderboardType(args: string): LeaderboardType {
	const trimmed = args.trim().toLowerCase();
	if (VALID_TYPES.has(trimmed)) return trimmed as LeaderboardType;
	return "weekly";
}

export async function handleLeaderboard(
	db: Database,
	workspaceId: string,
	args: string,
): Promise<object[]> {
	const type = parseLeaderboardType(args);
	const rows = await getLeaderboard(db, workspaceId, type);

	if (rows.length === 0) {
		return buildEmptyLeaderboard(type);
	}

	const entries = rows.map((row, i) => ({
		userId: row.userId,
		rank: i + 1,
		value:
			type === "winrate"
				? Math.round((row.gamesWon / row.gamesPlayed) * 100)
				: type === "weekly"
					? row.weekNet
					: row.chipsWon - row.chipsLost,
		gamesPlayed: row.gamesPlayed,
	}));

	return buildLeaderboardMessage(type, entries);
}
