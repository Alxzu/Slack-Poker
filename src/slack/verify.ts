import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const FIVE_MINUTES = 5 * 60;

export function slackVerification(signingSecret: string): MiddlewareHandler {
	return async (c, next) => {
		const timestamp = c.req.header("X-Slack-Request-Timestamp");
		const slackSignature = c.req.header("X-Slack-Signature");

		if (!timestamp || !slackSignature) {
			return c.text("Missing Slack signature headers", 401);
		}

		// Replay protection
		const now = Math.floor(Date.now() / 1000);
		if (Math.abs(now - Number(timestamp)) > FIVE_MINUTES) {
			return c.text("Request timestamp too old", 401);
		}

		const rawBody = await c.req.text();

		const sigBasestring = `v0:${timestamp}:${rawBody}`;
		const mySignature = `v0=${createHmac("sha256", signingSecret).update(sigBasestring).digest("hex")}`;

		const sigBuffer = Buffer.from(mySignature, "utf-8");
		const slackSigBuffer = Buffer.from(slackSignature, "utf-8");

		if (sigBuffer.length !== slackSigBuffer.length || !timingSafeEqual(sigBuffer, slackSigBuffer)) {
			return c.text("Invalid signature", 401);
		}

		// Store raw body so downstream handlers can re-parse
		c.set("rawBody" as never, rawBody as never);

		await next();
	};
}
