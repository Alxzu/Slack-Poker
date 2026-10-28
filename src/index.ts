import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type Redis from "ioredis";
import { createDb, type Database } from "./db/connection";
import { SlackClient } from "./slack/client";
import { requestLogger } from "./slack/middleware/request-logger";
import { createSlackRouter } from "./slack/routes";
import { startSocketMode } from "./slack/socket";
import { logger } from "./utils/logger";
import { setupGracefulShutdown } from "./utils/shutdown";
import { createActionQueue } from "./workers/action-queue";
import { setupCronJobs } from "./workers/cron";
import { GameManager } from "./workers/game-manager";
import { performStartupRecovery } from "./workers/startup";
import { TurnTimer } from "./workers/turn-timer";

const log = logger.child({ module: "app" });
const startedAt = Date.now();

export interface AppDeps {
	db: Database;
	redis: Redis;
	gameManager: GameManager;
	slackClient: SlackClient;
	actionQueue?: import("groupmq").Queue;
}

export function createApp(deps: AppDeps) {
	const { db, redis, gameManager, slackClient } = deps;

	const app = new Hono();

	// Middleware
	app.use("*", requestLogger());

	// Health endpoint
	app.get("/health", async (c) => {
		let postgresOk = false;
		let redisOk = false;
		let activeGames = 0;

		try {
			await db.execute(sql`SELECT 1`);
			postgresOk = true;
		} catch (_err) {
			log.warn("Health check: Postgres unreachable");
		}

		try {
			await redis.ping();
			redisOk = true;
		} catch (_err) {
			log.warn("Health check: Redis unreachable");
		}

		if (redisOk) {
			try {
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
					activeGames += keys.length;
				} while (cursor !== "0");
			} catch (_err) {
				log.warn("Health check: Failed to count active games");
			}
		}

		const status =
			postgresOk && redisOk
				? "ok"
				: postgresOk || redisOk
					? "degraded"
					: "down";

		return c.json({
			status,
			postgres: postgresOk,
			redis: redisOk,
			activeGames,
			uptime: Math.floor((Date.now() - startedAt) / 1000),
		});
	});

	// Slack routes (error boundary and rate limiter are inside createSlackRouter)
	const slack = createSlackRouter({
		db,
		gameManager,
		slackClient,
		actionQueue: deps.actionQueue,
	});
	app.route("/slack", slack);

	return app;
}

// ---------------------------------------------------------------------------
// Bootstrap (only when run directly, not imported)
// ---------------------------------------------------------------------------

async function bootstrap() {
	const { getConfig } = await import("./config");
	const config = getConfig();

	const db = createDb(config.DATABASE_URL);
	const { default: IORedis } = await import("ioredis");
	const redis = new IORedis(config.REDIS_URL);
	const gameManager = new GameManager(redis);
	const slackClient = new SlackClient(config.SLACK_BOT_TOKEN);

	// Action queue and turn timer
	const { queue, worker } = createActionQueue(redis, {
		gameManager,
		slackClient,
		db,
	});
	const _turnTimer = new TurnTimer(queue);

	// Graceful shutdown
	setupGracefulShutdown({ redis, worker });

	// Startup recovery
	try {
		await performStartupRecovery({ db, redis, gameManager, slackClient });
	} catch (err) {
		log.error({ err }, "Startup recovery failed");
	}

	// Cron jobs
	setupCronJobs({ db, slackClient, gameManager });

	// Create the Hono app
	const app = createApp({ db, redis, gameManager, slackClient, actionQueue: queue });

	// Socket Mode for local development
	if (config.SLACK_MODE === "socket") {
		if (!config.SLACK_APP_TOKEN) {
			log.error("SLACK_APP_TOKEN is required for Socket Mode");
			process.exit(1);
		}

		await startSocketMode({
			appToken: config.SLACK_APP_TOKEN,
			botToken: config.SLACK_BOT_TOKEN,
			handleCommand: async (body) => {
				// Build a synthetic request to reuse the Hono router
				const formData = new URLSearchParams({
					text: (body.text as string | undefined)?.trim() ?? "",
					user_id: body.user_id ?? "",
					channel_id: body.channel_id ?? "",
					team_id: body.team_id ?? "",
					command: body.command ?? "/poker",
				});

				const req = new Request("http://localhost/slack/commands", {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: formData.toString(),
				});

				const res = await app.fetch(req);
				return res.json();
			},
			handleAction: async (body) => {
				// Build a synthetic request with the payload as form-encoded
				const formData = new URLSearchParams({
					payload: JSON.stringify(body),
				});

				const req = new Request("http://localhost/slack/actions", {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: formData.toString(),
				});

				const res = await app.fetch(req);
				return res.json();
			},
		});

		log.info("Socket Mode connected");
	}

	log.info(
		{ port: config.PORT, mode: config.SLACK_MODE },
		"SlackPoker server starting",
	);

	return {
		port: config.PORT,
		fetch: app.fetch,
	};
}

// Default export: when run as main, bootstrap the full server.
// When imported by tests, export an empty Hono app (tests use createApp directly).
const isMainModule =
	typeof Bun !== "undefined" && Bun.main === import.meta.path;

const defaultExport = isMainModule ? await bootstrap() : new Hono();

export default defaultExport;
