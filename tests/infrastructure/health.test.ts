import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/index";

// ---------------------------------------------------------------------------
// Mock deps
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: {
	postgresOk?: boolean;
	redisOk?: boolean;
	redisKeys?: string[];
}) {
	const opts = {
		postgresOk: true,
		redisOk: true,
		redisKeys: [] as string[],
		...overrides,
	};

	const mockDb = {
		execute: async () => {
			if (!opts.postgresOk) throw new Error("Connection refused");
			return [{ "?column?": 1 }];
		},
	} as never;

	const mockRedis = {
		ping: async () => {
			if (!opts.redisOk) throw new Error("Connection refused");
			return "PONG";
		},
		scan: async () => {
			if (!opts.redisOk) throw new Error("Connection refused");
			return ["0", opts.redisKeys];
		},
	} as never;

	const mockGameManager = {} as never;
	const mockSlackClient = {} as never;

	return {
		db: mockDb,
		redis: mockRedis,
		gameManager: mockGameManager,
		slackClient: mockSlackClient,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("health endpoint", () => {
	test("returns correct structure when all services are up", async () => {
		const deps = createMockDeps();
		const app = createApp(deps);

		const res = await app.request("/health");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(body.postgres).toBe(true);
		expect(body.redis).toBe(true);
		expect(typeof body.activeGames).toBe("number");
		expect(typeof body.uptime).toBe("number");
	});

	test("reports degraded when postgres is down", async () => {
		const deps = createMockDeps({ postgresOk: false });
		const app = createApp(deps);

		const res = await app.request("/health");
		const body = await res.json();

		expect(body.status).toBe("degraded");
		expect(body.postgres).toBe(false);
		expect(body.redis).toBe(true);
	});

	test("reports degraded when redis is down", async () => {
		const deps = createMockDeps({ redisOk: false });
		const app = createApp(deps);

		const res = await app.request("/health");
		const body = await res.json();

		expect(body.status).toBe("degraded");
		expect(body.postgres).toBe(true);
		expect(body.redis).toBe(false);
	});

	test("reports down when both services are down", async () => {
		const deps = createMockDeps({ postgresOk: false, redisOk: false });
		const app = createApp(deps);

		const res = await app.request("/health");
		const body = await res.json();

		expect(body.status).toBe("down");
		expect(body.postgres).toBe(false);
		expect(body.redis).toBe(false);
	});

	test("counts active games from redis", async () => {
		const deps = createMockDeps({
			redisKeys: ["game:abc:state", "game:def:state"],
		});
		const app = createApp(deps);

		const res = await app.request("/health");
		const body = await res.json();

		expect(body.activeGames).toBe(2);
	});
});
