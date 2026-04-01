import { eq, inArray } from "drizzle-orm";
import type Redis from "ioredis";
import type { Database } from "../db/connection";
import { games } from "../db/schema";
import type { SlackClient } from "../slack/client";
import { logger } from "../utils/logger";
import type { GameManager } from "./game-manager";

const log = logger.child({ module: "startup-recovery" });

export async function performStartupRecovery(deps: {
	db: Database;
	redis: Redis;
	gameManager: GameManager;
	slackClient: SlackClient;
}): Promise<void> {
	const { db, redis, gameManager } = deps;

	log.info("Starting startup recovery");

	// 1. Scan Redis for active game keys
	const redisGameIds = new Set<string>();
	let cursor = "0";
	do {
		const [nextCursor, keys] = await redis.scan(
			cursor,
			"MATCH",
			"game:*:state",
			"COUNT",
			100,
		);
		cursor = nextCursor;
		for (const key of keys) {
			const match = key.match(/^game:(.+):state$/);
			if (match) {
				redisGameIds.add(match[1]);
			}
		}
	} while (cursor !== "0");

	// 2. Query Postgres for active games
	const activeDbGames = await db
		.select({
			id: games.id,
			workspaceId: games.workspaceId,
			channelId: games.channelId,
		})
		.from(games)
		.where(inArray(games.status, ["active", "waiting"]));

	const dbGameIds = new Set(activeDbGames.map((g) => g.id));

	// 3. Games in Redis but NOT active in Postgres — stale, clean up Redis
	for (const gameId of redisGameIds) {
		if (!dbGameIds.has(gameId)) {
			log.warn(
				{ gameId },
				"Stale game in Redis (not active in Postgres), cleaning up",
			);
			try {
				await redis.del(`game:${gameId}:state`);
				await redis.del(`game:${gameId}:meta`);
				await redis.del(`game:${gameId}:messageTs`);
				await redis.del(`game:${gameId}:waitingPlayers`);
			} catch (err) {
				log.error({ err, gameId }, "Failed to clean up stale Redis game");
			}
		}
	}

	// 4. Games active in Postgres but NOT in Redis — state was lost, mark complete
	for (const game of activeDbGames) {
		if (!redisGameIds.has(game.id)) {
			log.warn(
				{ gameId: game.id },
				"Active game in Postgres but missing from Redis, marking as complete",
			);
			try {
				await db
					.update(games)
					.set({ status: "complete", completedAt: new Date() })
					.where(eq(games.id, game.id));
			} catch (err) {
				log.error(
					{ err, gameId: game.id },
					"Failed to mark orphaned game as complete",
				);
			}
		}
	}

	// 5. Resume valid active games (in both Redis and Postgres)
	let resumedCount = 0;
	for (const gameId of redisGameIds) {
		if (dbGameIds.has(gameId)) {
			const state = await gameManager.getGameState(gameId);
			if (state) {
				log.info({ gameId, phase: state.phase }, "Resuming active game");
				resumedCount++;
			}
		}
	}

	log.info(
		{
			redisGames: redisGameIds.size,
			dbActiveGames: activeDbGames.length,
			resumed: resumedCount,
		},
		"Startup recovery complete",
	);
}
