import type { MiddlewareHandler } from "hono";
import { logger } from "../../utils/logger";

const log = logger.child({ module: "request-logger" });

export function requestLogger(): MiddlewareHandler {
	return async (c, next) => {
		const requestId = crypto.randomUUID();
		const method = c.req.method;
		const path = c.req.path;
		const start = Date.now();

		c.header("X-Request-Id", requestId);

		await next();

		const durationMs = Date.now() - start;
		const status = c.res.status;

		log.info(
			{ requestId, method, path, status, durationMs },
			"Request handled",
		);
	};
}
