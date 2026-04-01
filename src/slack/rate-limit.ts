import type { MiddlewareHandler } from "hono";

interface RateLimitEntry {
	timestamps: number[];
}

let store = new Map<string, RateLimitEntry>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function resetRateLimiter(): void {
	store = new Map();
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
}

export function rateLimiter(opts: {
	windowMs: number;
	maxRequests: number;
}): MiddlewareHandler {
	// Periodic cleanup of expired entries
	if (!cleanupTimer) {
		cleanupTimer = setInterval(() => {
			const now = Date.now();
			for (const [key, entry] of store) {
				entry.timestamps = entry.timestamps.filter(
					(t) => now - t < opts.windowMs,
				);
				if (entry.timestamps.length === 0) {
					store.delete(key);
				}
			}
		}, opts.windowMs);
		// Allow process to exit without waiting for cleanup
		if (
			cleanupTimer &&
			typeof cleanupTimer === "object" &&
			"unref" in cleanupTimer
		) {
			cleanupTimer.unref();
		}
	}

	return async (c, next) => {
		const body = await c.req.parseBody();
		const teamId = (body.team_id as string) ?? "unknown";
		const userId = (body.user_id as string) ?? "unknown";
		const key = `${teamId}:${userId}`;

		const now = Date.now();
		let entry = store.get(key);

		if (!entry) {
			entry = { timestamps: [] };
			store.set(key, entry);
		}

		// Remove timestamps outside the window
		entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);

		if (entry.timestamps.length >= opts.maxRequests) {
			const oldestInWindow = entry.timestamps[0];
			const retryAfterMs = opts.windowMs - (now - oldestInWindow);
			const retryAfterSecs = Math.ceil(retryAfterMs / 1000);

			return c.json({
				response_type: "ephemeral",
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `Slow down! Try again in ${retryAfterSecs} seconds.`,
						},
					},
				],
			});
		}

		entry.timestamps.push(now);
		await next();
	};
}
