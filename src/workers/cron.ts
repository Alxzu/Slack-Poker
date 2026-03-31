import { Cron } from "croner";
import type { Database } from "../db/connection";
import type { SlackClient } from "../slack/client";
import { logger } from "../utils/logger";
import type { GameManager } from "./game-manager";

const log = logger.child({ module: "cron" });

interface CronDeps {
	db: Database;
	slackClient: SlackClient;
	gameManager: GameManager;
}

export function setupCronJobs(_deps: CronDeps) {
	// Weekly leaderboard: Monday 00:00 UTC
	const weeklyLeaderboard = new Cron("0 0 * * 1", async () => {
		log.info("Running weekly leaderboard cron");
		try {
			// This is a placeholder — the actual leaderboard query
			// would go through the DB stats tables.
			// For now, we just log that the cron fired.
			log.info("Weekly leaderboard cron completed");
		} catch (err) {
			log.error({ err }, "Weekly leaderboard cron failed");
		}
	});

	// Idle game cleanup: every 5 minutes
	const idleCleanup = new Cron("*/5 * * * *", async () => {
		log.debug("Running idle game cleanup cron");
		try {
			// Scan for games with no recent activity.
			// In practice this would scan Redis keys or query the DB
			// for active games and check last-action timestamps.
			// This is a structural placeholder for the cleanup logic.
			log.debug("Idle game cleanup cron completed");
		} catch (err) {
			log.error({ err }, "Idle game cleanup cron failed");
		}
	});

	return { weeklyLeaderboard, idleCleanup };
}
