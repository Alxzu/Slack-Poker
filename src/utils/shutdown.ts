import type { Worker } from "groupmq";
import type Redis from "ioredis";
import { logger } from "./logger";

const log = logger.child({ module: "shutdown" });

export function setupGracefulShutdown(deps: {
	redis: Redis;
	// biome-ignore lint/suspicious/noExplicitAny: Worker generic type is not relevant for shutdown
	worker: Worker<any>;
}): void {
	const { redis, worker } = deps;
	let shuttingDown = false;

	const shutdown = async (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;

		log.info({ signal }, "Received shutdown signal, cleaning up...");

		try {
			await worker.stop();
			log.info("Action queue worker stopped");
		} catch (err) {
			log.error({ err }, "Error stopping action queue worker");
		}

		try {
			await redis.quit();
			log.info("Redis connection closed");
		} catch (err) {
			log.error({ err }, "Error closing Redis connection");
		}

		log.info("Shutdown complete");
		process.exit(0);
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
}
