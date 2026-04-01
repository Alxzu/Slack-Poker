import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { slackVerification } from "../../src/slack/verify";

// ── Helpers ────────────────────────────────────────────────────────

const SIGNING_SECRET = "test-signing-secret-abc123";

function createApp(): Hono {
	const app = new Hono();
	app.use("/slack/*", slackVerification(SIGNING_SECRET));
	app.post("/slack/events", (c) => c.text("ok"));
	return app;
}

function generateSignature(
	secret: string,
	timestamp: string,
	body: string,
): string {
	const sigBasestring = `v0:${timestamp}:${body}`;
	const hash = createHmac("sha256", secret).update(sigBasestring).digest("hex");
	return `v0=${hash}`;
}

function currentTimestamp(): string {
	return Math.floor(Date.now() / 1000).toString();
}

// ── Tests ─────────────────────────────────────────────────────────

describe("Slack signature verification", () => {
	test("valid signature passes verification", async () => {
		const app = createApp();
		const body = "token=test&type=url_verification";
		const ts = currentTimestamp();
		const sig = generateSignature(SIGNING_SECRET, ts, body);

		const res = await app.request("/slack/events", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"X-Slack-Request-Timestamp": ts,
				"X-Slack-Signature": sig,
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	test("invalid signature returns 401", async () => {
		const app = createApp();
		const body = "token=test&type=event_callback";
		const ts = currentTimestamp();
		const badSig =
			"v0=0000000000000000000000000000000000000000000000000000000000000000";

		const res = await app.request("/slack/events", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"X-Slack-Request-Timestamp": ts,
				"X-Slack-Signature": badSig,
			},
			body,
		});

		expect(res.status).toBe(401);
		expect(await res.text()).toContain("Invalid signature");
	});

	test("expired timestamp (> 5 min old) returns 401", async () => {
		const app = createApp();
		const body = "token=test";
		// 6 minutes ago
		const ts = (Math.floor(Date.now() / 1000) - 360).toString();
		const sig = generateSignature(SIGNING_SECRET, ts, body);

		const res = await app.request("/slack/events", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"X-Slack-Request-Timestamp": ts,
				"X-Slack-Signature": sig,
			},
			body,
		});

		expect(res.status).toBe(401);
		expect(await res.text()).toContain("timestamp too old");
	});

	test("missing X-Slack-Request-Timestamp header returns 401", async () => {
		const app = createApp();
		const body = "token=test";

		const res = await app.request("/slack/events", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"X-Slack-Signature": "v0=fake",
			},
			body,
		});

		expect(res.status).toBe(401);
		expect(await res.text()).toContain("Missing Slack signature headers");
	});

	test("missing X-Slack-Signature header returns 401", async () => {
		const app = createApp();
		const body = "token=test";
		const ts = currentTimestamp();

		const res = await app.request("/slack/events", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"X-Slack-Request-Timestamp": ts,
			},
			body,
		});

		expect(res.status).toBe(401);
		expect(await res.text()).toContain("Missing Slack signature headers");
	});

	test("wrong signing secret rejects request", async () => {
		const app = createApp();
		const body = "payload=test";
		const ts = currentTimestamp();
		const sig = generateSignature("wrong-secret", ts, body);

		const res = await app.request("/slack/events", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"X-Slack-Request-Timestamp": ts,
				"X-Slack-Signature": sig,
			},
			body,
		});

		expect(res.status).toBe(401);
	});
});
