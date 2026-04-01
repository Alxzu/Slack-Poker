import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/index";

describe("bootstrap", () => {
	test("createApp returns a Hono app with expected routes", async () => {
		const mockDeps = {
			db: {
				execute: async () => [{ "?column?": 1 }],
			} as never,
			redis: {
				ping: async () => "PONG",
				scan: async () => ["0", []],
			} as never,
			gameManager: {} as never,
			slackClient: {} as never,
		};

		const app = createApp(mockDeps);

		// Verify it's a Hono app with a fetch method
		expect(typeof app.fetch).toBe("function");
		expect(typeof app.request).toBe("function");
	});

	test("health endpoint returns correct shape", async () => {
		const mockDeps = {
			db: {
				execute: async () => [{ "?column?": 1 }],
			} as never,
			redis: {
				ping: async () => "PONG",
				scan: async () => ["0", []],
			} as never,
			gameManager: {} as never,
			slackClient: {} as never,
		};

		const app = createApp(mockDeps);
		const res = await app.request("/health");

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toHaveProperty("status");
		expect(body).toHaveProperty("postgres");
		expect(body).toHaveProperty("redis");
		expect(body).toHaveProperty("activeGames");
		expect(body).toHaveProperty("uptime");
		expect(typeof body.status).toBe("string");
		expect(typeof body.uptime).toBe("number");
	});

	test("default export is a Hono app when not main module", async () => {
		const mod = await import("../../src/index");
		// When imported by tests (not main module), default export is a plain Hono app
		expect(mod.default).toBeDefined();
		expect(typeof mod.createApp).toBe("function");
	});

	test("health endpoint reports all services up correctly", async () => {
		const mockDeps = {
			db: {
				execute: async () => [{ "?column?": 1 }],
			} as never,
			redis: {
				ping: async () => "PONG",
				scan: async () => ["0", ["game:abc:state"]],
			} as never,
			gameManager: {} as never,
			slackClient: {} as never,
		};

		const app = createApp(mockDeps);
		const res = await app.request("/health");
		const body = await res.json();

		expect(body.status).toBe("ok");
		expect(body.postgres).toBe(true);
		expect(body.redis).toBe(true);
		expect(body.activeGames).toBe(1);
	});
});
