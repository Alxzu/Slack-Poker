import { Hono } from "hono";
import type { Database } from "../db/connection";
import { logger } from "../utils/logger";
import { parseActionPayload, routeAction } from "./actions";
import { handleBalance } from "./commands/balance";
import {
	handleCancel,
	handleCards,
	handleEnd,
	handleJoin,
	handleLeave,
	handleNew,
	handleStart,
} from "./commands/game-stubs";
import { handleHelp, handleUnknownCommand } from "./commands/help";
import { handleLeaderboard } from "./commands/leaderboard";
import { handleRefill } from "./commands/refill";
import { handleStats } from "./commands/stats";
import { handleStatus } from "./commands/status";
import { handleTransfer } from "./commands/transfer";

const log = logger.child({ module: "slack-routes" });

export interface SlackDeps {
	db: Database;
}

export function createSlackRouter(deps: SlackDeps) {
	const slack = new Hono();

	slack.post("/commands", async (c) => {
		const body = await c.req.parseBody();

		const text = (body.text as string | undefined)?.trim() ?? "";
		const userId = body.user_id as string;
		const channelId = body.channel_id as string;
		const teamId = body.team_id as string;

		const [subcommand, ...rest] = text.split(/\s+/);
		const args = rest.join(" ");

		log.info(
			{ subcommand, userId, channelId, teamId },
			"Slash command received",
		);

		let blocks: object[];

		switch (subcommand.toLowerCase()) {
			case "":
			case "help":
				blocks = handleHelp();
				break;

			case "new": {
				const buyIn = args ? Number.parseInt(args, 10) : undefined;
				blocks = handleNew(buyIn);
				break;
			}

			case "join":
				blocks = handleJoin();
				break;

			case "start":
				blocks = handleStart();
				break;

			case "leave":
				blocks = handleLeave();
				break;

			case "cancel":
				blocks = handleCancel();
				break;

			case "end":
				blocks = handleEnd();
				break;

			case "status":
				blocks = await handleStatus(teamId, channelId);
				break;

			case "cards":
				blocks = handleCards();
				break;

			case "balance":
				blocks = await handleBalance(deps.db, teamId, userId);
				break;

			case "refill":
				blocks = await handleRefill(deps.db, teamId, userId);
				break;

			case "transfer":
				blocks = await handleTransfer(deps.db, teamId, userId, args);
				break;

			case "leaderboard":
				blocks = await handleLeaderboard(deps.db, teamId, args);
				break;

			case "stats":
				blocks = await handleStats(deps.db, teamId, userId, args);
				break;

			default:
				blocks = handleUnknownCommand(subcommand);
				break;
		}

		return c.json({
			response_type: "ephemeral",
			blocks,
		});
	});

	slack.post("/actions", async (c) => {
		const body = await c.req.parseBody();
		const rawPayload = body.payload as string;

		if (!rawPayload) {
			return c.json({ error: "Missing payload" }, 400);
		}

		const payload = parseActionPayload(rawPayload);
		const handler = routeAction(payload.actionId);

		log.info(
			{
				actionId: payload.actionId,
				handler,
				userId: payload.userId,
				channelId: payload.channelId,
			},
			"Action received",
		);

		// All game actions will be routed to the game loop via Redis once implemented.
		// For now, acknowledge immediately.
		return c.json({});
	});

	return slack;
}
