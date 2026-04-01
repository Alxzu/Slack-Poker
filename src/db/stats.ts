import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./connection";
import { playerStats } from "./schema";

export interface PlayerResult {
	userId: string;
	chipsNet: number;
	won: boolean;
	biggestPot: number;
}

export async function updateStatsAfterGame(
	db: Database,
	workspaceId: string,
	playerResults: PlayerResult[],
) {
	const now = new Date();
	const weekStart = getWeekStart(now);

	for (const result of playerResults) {
		const chipsWonInc = result.chipsNet > 0 ? result.chipsNet : 0;
		const chipsLostInc = result.chipsNet < 0 ? Math.abs(result.chipsNet) : 0;

		await db
			.insert(playerStats)
			.values({
				workspaceId,
				userId: result.userId,
				gamesPlayed: 1,
				gamesWon: result.won ? 1 : 0,
				chipsWon: chipsWonInc,
				chipsLost: chipsLostInc,
				biggestPot: result.biggestPot,
				weekNet: result.chipsNet,
				weekStart: weekStart.toISOString().slice(0, 10),
			})
			.onConflictDoUpdate({
				target: [playerStats.workspaceId, playerStats.userId],
				set: {
					gamesPlayed: sql`${playerStats.gamesPlayed} + 1`,
					gamesWon: sql`${playerStats.gamesWon} + ${result.won ? 1 : 0}`,
					chipsWon: sql`${playerStats.chipsWon} + ${chipsWonInc}`,
					chipsLost: sql`${playerStats.chipsLost} + ${chipsLostInc}`,
					biggestPot: sql`GREATEST(${playerStats.biggestPot}, ${result.biggestPot})`,
					weekNet: sql`${playerStats.weekNet} + ${result.chipsNet}`,
					weekStart: weekStart.toISOString().slice(0, 10),
				},
			});
	}
}

export type LeaderboardType = "weekly" | "alltime" | "winrate";

export async function getLeaderboard(
	db: Database,
	workspaceId: string,
	type: LeaderboardType,
) {
	switch (type) {
		case "weekly":
			return db
				.select()
				.from(playerStats)
				.where(eq(playerStats.workspaceId, workspaceId))
				.orderBy(desc(playerStats.weekNet))
				.limit(10);

		case "alltime":
			return db
				.select()
				.from(playerStats)
				.where(eq(playerStats.workspaceId, workspaceId))
				.orderBy(desc(sql`${playerStats.chipsWon} - ${playerStats.chipsLost}`))
				.limit(10);

		case "winrate": {
			return db
				.select()
				.from(playerStats)
				.where(
					and(
						eq(playerStats.workspaceId, workspaceId),
						sql`${playerStats.gamesPlayed} >= 5`,
					),
				)
				.orderBy(
					desc(
						sql`CAST(${playerStats.gamesWon} AS FLOAT) / ${playerStats.gamesPlayed}`,
					),
				)
				.limit(10);
		}
	}
}

export async function getPlayerStats(
	db: Database,
	workspaceId: string,
	userId: string,
) {
	const [stats] = await db
		.select()
		.from(playerStats)
		.where(
			and(
				eq(playerStats.workspaceId, workspaceId),
				eq(playerStats.userId, userId),
			),
		);

	return stats ?? null;
}

export async function resetWeeklyStats(db: Database, workspaceId: string) {
	const weekStart = getWeekStart(new Date());

	await db
		.update(playerStats)
		.set({
			weekNet: 0,
			weekStart: weekStart.toISOString().slice(0, 10),
		})
		.where(eq(playerStats.workspaceId, workspaceId));
}

function getWeekStart(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
	d.setDate(diff);
	d.setHours(0, 0, 0, 0);
	return d;
}
