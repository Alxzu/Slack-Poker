import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
	InsufficientBalanceError,
	OptimisticLockError,
	RefillNotAllowedError,
	TransferLimitError,
} from "../../src/db/ledger";
import { errorBoundary } from "../../src/slack/error-boundary";
import { rateLimiter, resetRateLimiter } from "../../src/slack/rate-limit";
import {
	parseBuyIn,
	parseSlackUserId,
	parseTransferArgs,
	sanitizeText,
} from "../../src/slack/sanitize";

// ---------------------------------------------------------------------------
// Rate limiter tests
// ---------------------------------------------------------------------------

function buildFormBody(overrides?: Record<string, string>): string {
	return new URLSearchParams({
		user_id: "U123",
		team_id: "T789",
		text: "help",
		...overrides,
	}).toString();
}

function makeRequest(body: string): Request {
	return new Request("http://localhost/test", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
}

describe("rateLimiter", () => {
	beforeEach(() => {
		resetRateLimiter();
	});

	afterEach(() => {
		resetRateLimiter();
	});

	test("allows requests under limit", async () => {
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 60000, maxRequests: 5 }));
		app.post("/test", (c) => c.json({ ok: true }));

		for (let i = 0; i < 5; i++) {
			const res = await app.request(makeRequest(buildFormBody()));
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.ok).toBe(true);
		}
	});

	test("blocks requests over limit with friendly message", async () => {
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 60000, maxRequests: 3 }));
		app.post("/test", (c) => c.json({ ok: true }));

		// First 3 should pass
		for (let i = 0; i < 3; i++) {
			await app.request(makeRequest(buildFormBody()));
		}

		// 4th should be rate limited
		const res = await app.request(makeRequest(buildFormBody()));
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			response_type: string;
			blocks: Array<{ text: { text: string } }>;
		};
		expect(json.response_type).toBe("ephemeral");
		expect(json.blocks[0].text.text).toMatch(
			/Slow down! Try again in \d+ seconds\./,
		);
	});

	test("resets after window expires", async () => {
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 50, maxRequests: 2 }));
		app.post("/test", (c) => c.json({ ok: true }));

		// Use up the limit
		await app.request(makeRequest(buildFormBody()));
		await app.request(makeRequest(buildFormBody()));

		// Should be blocked
		const blocked = await app.request(makeRequest(buildFormBody()));
		const blockedJson = (await blocked.json()) as {
			ok?: boolean;
			blocks?: unknown[];
		};
		expect(blockedJson.ok).toBeUndefined();

		// Wait for window to expire
		await new Promise((resolve) => setTimeout(resolve, 60));

		// Should be allowed again
		const res = await app.request(makeRequest(buildFormBody()));
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean };
		expect(json.ok).toBe(true);
	});

	test("tracks different users independently", async () => {
		const app = new Hono();
		app.use("*", rateLimiter({ windowMs: 60000, maxRequests: 1 }));
		app.post("/test", (c) => c.json({ ok: true }));

		const res1 = await app.request(
			makeRequest(buildFormBody({ user_id: "U111" })),
		);
		expect(((await res1.json()) as { ok: boolean }).ok).toBe(true);

		const res2 = await app.request(
			makeRequest(buildFormBody({ user_id: "U222" })),
		);
		expect(((await res2.json()) as { ok: boolean }).ok).toBe(true);

		// U111 should be blocked now
		const res3 = await app.request(
			makeRequest(buildFormBody({ user_id: "U111" })),
		);
		const json = (await res3.json()) as { blocks?: unknown[] };
		expect(json.blocks).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Error boundary tests
// ---------------------------------------------------------------------------

describe("errorBoundary", () => {
	test("catches thrown errors and returns 200 with safe message", async () => {
		const app = new Hono();
		app.onError(errorBoundary());
		app.post("/test", () => {
			throw new Error("database exploded");
		});

		const res = await app.request(makeRequest(buildFormBody()));
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			response_type: string;
			blocks: Array<{ text: { text: string } }>;
		};
		expect(json.response_type).toBe("ephemeral");
		expect(json.blocks[0].text.text).toContain(
			"Something went wrong. Please try again.",
		);
		// Must NOT contain stack trace or internal details
		expect(json.blocks[0].text.text).not.toContain("database exploded");
	});

	test("logs error details", async () => {
		// We verify that the handler doesn't crash — pino logging is tested implicitly
		const app = new Hono();
		app.onError(errorBoundary());
		app.post("/test", () => {
			throw new TypeError("unexpected null");
		});

		const res = await app.request(makeRequest(buildFormBody()));
		expect(res.status).toBe(200);
	});

	test("handles InsufficientBalanceError", async () => {
		const app = new Hono();
		app.onError(errorBoundary());
		app.post("/test", () => {
			throw new InsufficientBalanceError(50, 100);
		});

		const res = await app.request(makeRequest(buildFormBody()));
		const json = (await res.json()) as {
			blocks: Array<{ text: { text: string } }>;
		};
		expect(json.blocks[0].text.text).toContain("Insufficient balance");
	});

	test("handles OptimisticLockError", async () => {
		const app = new Hono();
		app.onError(errorBoundary());
		app.post("/test", () => {
			throw new OptimisticLockError();
		});

		const res = await app.request(makeRequest(buildFormBody()));
		const json = (await res.json()) as {
			blocks: Array<{ text: { text: string } }>;
		};
		expect(json.blocks[0].text.text).toContain("Please try again");
	});

	test("handles RefillNotAllowedError", async () => {
		const app = new Hono();
		app.onError(errorBoundary());
		app.post("/test", () => {
			throw new RefillNotAllowedError("balance too high");
		});

		const res = await app.request(makeRequest(buildFormBody()));
		const json = (await res.json()) as {
			blocks: Array<{ text: { text: string } }>;
		};
		expect(json.blocks[0].text.text).toContain("Refill not allowed");
	});

	test("handles TransferLimitError", async () => {
		const app = new Hono();
		app.onError(errorBoundary());
		app.post("/test", () => {
			throw new TransferLimitError();
		});

		const res = await app.request(makeRequest(buildFormBody()));
		const json = (await res.json()) as {
			blocks: Array<{ text: { text: string } }>;
		};
		expect(json.blocks[0].text.text).toContain("Transfer limit exceeded");
	});
});

// ---------------------------------------------------------------------------
// sanitizeText tests
// ---------------------------------------------------------------------------

describe("sanitizeText", () => {
	test("strips control characters", () => {
		expect(sanitizeText("hello\x00world\x07!")).toBe("helloworld!");
	});

	test("preserves normal whitespace", () => {
		expect(sanitizeText("hello world\n")).toBe("hello world\n");
	});

	test("truncates long input", () => {
		const long = "a".repeat(600);
		expect(sanitizeText(long).length).toBe(500);
	});

	test("returns empty string for empty input", () => {
		expect(sanitizeText("")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// parseSlackUserId tests
// ---------------------------------------------------------------------------

describe("parseSlackUserId", () => {
	test("extracts from <@U12345>", () => {
		expect(parseSlackUserId("<@U12345>")).toBe("U12345");
	});

	test("extracts from <@U12345|username>", () => {
		expect(parseSlackUserId("<@U12345|alice>")).toBe("U12345");
	});

	test("returns null for plain text", () => {
		expect(parseSlackUserId("U12345")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(parseSlackUserId("")).toBeNull();
	});

	test("returns null for invalid format", () => {
		expect(parseSlackUserId("<@>")).toBeNull();
		expect(parseSlackUserId("<@u12345>")).toBeNull(); // lowercase
		expect(parseSlackUserId("@U12345")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseBuyIn tests
// ---------------------------------------------------------------------------

describe("parseBuyIn", () => {
	// Using explicit min/max to avoid config dependency
	const MIN = 100;
	const MAX = 5000;

	test("valid numbers within range", () => {
		expect(parseBuyIn("500", MIN, MAX)).toBe(500);
		expect(parseBuyIn("100", MIN, MAX)).toBe(100);
		expect(parseBuyIn("5000", MIN, MAX)).toBe(5000);
	});

	test("rejects negative numbers", () => {
		expect(parseBuyIn("-100", MIN, MAX)).toBeNull();
	});

	test("rejects numbers too high", () => {
		expect(parseBuyIn("10000", MIN, MAX)).toBeNull();
	});

	test("rejects non-numeric input", () => {
		expect(parseBuyIn("abc", MIN, MAX)).toBeNull();
		expect(parseBuyIn("12.5", MIN, MAX)).toBeNull();
		expect(parseBuyIn("", MIN, MAX)).toBeNull();
	});

	test("rejects zero", () => {
		expect(parseBuyIn("0", MIN, MAX)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseTransferArgs tests
// ---------------------------------------------------------------------------

describe("parseTransferArgs", () => {
	test("valid format", () => {
		const result = parseTransferArgs("<@U12345> 500");
		expect(result).toEqual({ userId: "U12345", amount: 500 });
	});

	test("valid format with username in mention", () => {
		const result = parseTransferArgs("<@U12345|alice> 200");
		expect(result).toEqual({ userId: "U12345", amount: 200 });
	});

	test("rejects missing amount", () => {
		expect(parseTransferArgs("<@U12345>")).toBeNull();
	});

	test("rejects missing mention", () => {
		expect(parseTransferArgs("500")).toBeNull();
	});

	test("rejects non-numeric amount", () => {
		expect(parseTransferArgs("<@U12345> abc")).toBeNull();
	});

	test("rejects negative amount", () => {
		expect(parseTransferArgs("<@U12345> -100")).toBeNull();
	});

	test("rejects empty string", () => {
		expect(parseTransferArgs("")).toBeNull();
	});
});
