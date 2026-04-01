import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { parseActionPayload, routeAction } from "../../src/slack/actions";
import { createSlackRouter } from "../../src/slack/routes";

// ---------------------------------------------------------------------------
// Mock database — command handlers that need db will just get a stub.
// We test routing logic here, not actual db calls.
// ---------------------------------------------------------------------------

const mockDb = {} as never;

function createApp() {
	const app = new Hono();
	const slack = createSlackRouter({ db: mockDb });
	app.route("/slack", slack);
	return app;
}

function slashCommand(text: string, overrides?: Record<string, string>) {
	const params = new URLSearchParams({
		command: "/poker",
		text,
		user_id: "U123",
		channel_id: "C456",
		team_id: "T789",
		response_url: "https://hooks.slack.com/commands/T789/xxx",
		...overrides,
	});

	return new Request("http://localhost/slack/commands", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: params.toString(),
	});
}

// ---------------------------------------------------------------------------
// Command routing tests
// ---------------------------------------------------------------------------

describe("slash command routing", () => {
	const app = createApp();

	test("bare /poker routes to help", async () => {
		const res = await app.request(slashCommand(""));
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.response_type).toBe("ephemeral");
		expect(json.blocks).toBeArray();
		// Help message has a header with "Command Reference"
		const headerBlock = json.blocks.find(
			(b: { type: string }) => b.type === "header",
		);
		expect(headerBlock.text.text).toContain("Command Reference");
	});

	test("/poker help routes to help", async () => {
		const res = await app.request(slashCommand("help"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const headerBlock = json.blocks.find(
			(b: { type: string }) => b.type === "header",
		);
		expect(headerBlock.text.text).toContain("Command Reference");
	});

	test("/poker new 500 routes to new with buy-in", async () => {
		const res = await app.request(slashCommand("new 500"));
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.blocks).toBeArray();
		// Stub returns "Coming soon"
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Coming soon");
		expect(text).toContain("new");
	});

	test("/poker join routes to join", async () => {
		const res = await app.request(slashCommand("join"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Coming soon");
		expect(text).toContain("join");
	});

	test("/poker start routes to start", async () => {
		const res = await app.request(slashCommand("start"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Coming soon");
	});

	test("/poker leave routes to leave", async () => {
		const res = await app.request(slashCommand("leave"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Coming soon");
	});

	test("/poker cancel routes to cancel", async () => {
		const res = await app.request(slashCommand("cancel"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Coming soon");
	});

	test("/poker end routes to end", async () => {
		const res = await app.request(slashCommand("end"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Coming soon");
	});

	test("/poker cards routes to cards", async () => {
		const res = await app.request(slashCommand("cards"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Coming soon");
	});

	test("/poker status routes to status", async () => {
		const res = await app.request(slashCommand("status"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("No active game");
	});

	test("/poker invalid returns unknown command error", async () => {
		const res = await app.request(slashCommand("invalid"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Unknown command");
		expect(text).toContain("invalid");
	});

	test("/poker balance routes to balance (stub db throws)", async () => {
		// With a mock db this will throw, but error boundary catches it
		const res = await app.request(slashCommand("balance"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Something went wrong");
	});

	test("/poker transfer @user 100 routes to transfer", async () => {
		// Without a valid mention format, the parser returns usage error
		const res = await app.request(slashCommand("transfer notauser 100"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Usage");
	});

	test("/poker transfer <@U999> 100 parses user and amount", async () => {
		// Will fail at db level but we test that the parser works by checking
		// it doesn't return the "Usage" error (error boundary catches db error)
		const res = await app.request(slashCommand("transfer <@U999> 100"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).not.toContain("Usage");
	});

	test("/poker leaderboard winrate parses type correctly", async () => {
		// Will fail at db level but error boundary catches it
		const res = await app.request(slashCommand("leaderboard winrate"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const text = JSON.stringify(json.blocks);
		expect(text).toContain("Something went wrong");
	});

	test("subcommand is case-insensitive", async () => {
		const res = await app.request(slashCommand("HELP"));
		expect(res.status).toBe(200);
		const json = await res.json();
		const headerBlock = json.blocks.find(
			(b: { type: string }) => b.type === "header",
		);
		expect(headerBlock.text.text).toContain("Command Reference");
	});
});

// ---------------------------------------------------------------------------
// Action payload parsing
// ---------------------------------------------------------------------------

describe("parseActionPayload", () => {
	test("extracts correct fields from action payload", () => {
		const raw = JSON.stringify({
			type: "block_actions",
			user: { id: "U123", name: "testuser" },
			channel: { id: "C456" },
			message: { ts: "1234567890.123456" },
			trigger_id: "trigger123",
			response_url: "https://hooks.slack.com/actions/T789/xxx",
			actions: [
				{
					action_id: "poker_fold",
					type: "button",
					block_id: "block1",
				},
			],
		});

		const result = parseActionPayload(raw);
		expect(result.actionId).toBe("poker_fold");
		expect(result.userId).toBe("U123");
		expect(result.channelId).toBe("C456");
		expect(result.messageTs).toBe("1234567890.123456");
		expect(result.triggerId).toBe("trigger123");
		expect(result.responseUrl).toBe("https://hooks.slack.com/actions/T789/xxx");
	});

	test("handles missing optional fields", () => {
		const raw = JSON.stringify({
			type: "block_actions",
			user: { id: "U123" },
			channel: { id: "C456" },
			message: { ts: "123.456" },
			response_url: "https://hooks.slack.com/actions/xxx",
			actions: [{ action_id: "poker_check" }],
		});

		const result = parseActionPayload(raw);
		expect(result.actionId).toBe("poker_check");
		expect(result.triggerId).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// routeAction
// ---------------------------------------------------------------------------

describe("routeAction", () => {
	test("maps poker_fold to fold", () => {
		expect(routeAction("poker_fold")).toBe("fold");
	});

	test("maps poker_check to check", () => {
		expect(routeAction("poker_check")).toBe("check");
	});

	test("maps poker_call to call", () => {
		expect(routeAction("poker_call")).toBe("call");
	});

	test("maps poker_raise to raise", () => {
		expect(routeAction("poker_raise")).toBe("raise");
	});

	test("maps poker_join to join", () => {
		expect(routeAction("poker_join")).toBe("join");
	});

	test("maps poker_start to start", () => {
		expect(routeAction("poker_start")).toBe("start");
	});

	test("maps poker_leave to leave", () => {
		expect(routeAction("poker_leave")).toBe("leave");
	});

	test("returns unknown for unrecognized action_id", () => {
		expect(routeAction("something_else")).toBe("unknown");
	});
});

// ---------------------------------------------------------------------------
// Actions endpoint
// ---------------------------------------------------------------------------

describe("actions endpoint", () => {
	const app = createApp();

	test("POST /slack/actions returns 200 with valid payload", async () => {
		const payload = JSON.stringify({
			type: "block_actions",
			user: { id: "U123" },
			channel: { id: "C456" },
			message: { ts: "123.456" },
			response_url: "https://hooks.slack.com/actions/xxx",
			actions: [{ action_id: "poker_fold" }],
		});

		const params = new URLSearchParams({ payload });
		const res = await app.request(
			new Request("http://localhost/slack/actions", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: params.toString(),
			}),
		);

		expect(res.status).toBe(200);
	});

	test("POST /slack/actions returns 400 without payload", async () => {
		const res = await app.request(
			new Request("http://localhost/slack/actions", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: "",
			}),
		);

		expect(res.status).toBe(400);
	});
});
