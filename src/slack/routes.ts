import type { Queue } from "groupmq";
import { Hono } from "hono";
import type { Database } from "../db/connection";
import type { PokerAction } from "../engine/types";
import { chips } from "../engine/types";
import { logger } from "../utils/logger";
import { enqueueAction } from "../workers/action-queue";
import type { GameManager } from "../workers/game-manager";
import { parseActionPayload, routeAction } from "./actions";
import type { SlackClient } from "./client";
import { handleBalance } from "./commands/balance";
import { handleCancel } from "./commands/cancel";
import { handleCards } from "./commands/cards";
import { handleEnd } from "./commands/end";
import { handleHelp, handleUnknownCommand } from "./commands/help";
import { handleJoin } from "./commands/join";
import { handleLeaderboard } from "./commands/leaderboard";
import { handleLeave } from "./commands/leave";
import { handleNew } from "./commands/new";
import { handleRefill } from "./commands/refill";
import { handleStart } from "./commands/start";
import { handleStats } from "./commands/stats";
import { handleStatus } from "./commands/status";
import { handleTransfer } from "./commands/transfer";

const log = logger.child({ module: "slack-routes" });

export interface SlackDeps {
	db: Database;
	gameManager?: GameManager;
	slackClient?: SlackClient;
	actionQueue?: Queue;
}

function comingSoon(command: string): object[] {
	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:construction: \`/poker ${command}\` — Coming soon.`,
			},
		},
	];
}

function _needsWorkers(): object[] {
	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: ":x: Game features are not available (workers not configured).",
			},
		},
	];
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
				if (!deps.gameManager || !deps.slackClient) {
					blocks = comingSoon("new");
					break;
				}
				const buyIn = args ? Number.parseInt(args, 10) : undefined;
				blocks = await handleNew(
					{
						db: deps.db,
						gameManager: deps.gameManager,
						slackClient: deps.slackClient,
					},
					teamId,
					channelId,
					userId,
					buyIn,
				);
				break;
			}

			case "join":
				if (!deps.gameManager || !deps.slackClient) {
					blocks = comingSoon("join");
					break;
				}
				blocks = await handleJoin(
					{
						db: deps.db,
						gameManager: deps.gameManager,
						slackClient: deps.slackClient,
					},
					teamId,
					channelId,
					userId,
				);
				break;

			case "start":
				if (!deps.gameManager || !deps.slackClient) {
					blocks = comingSoon("start");
					break;
				}
				blocks = await handleStart(
					{
						db: deps.db,
						gameManager: deps.gameManager,
						slackClient: deps.slackClient,
					},
					teamId,
					channelId,
					userId,
				);
				break;

			case "leave":
				if (!deps.gameManager || !deps.slackClient) {
					blocks = comingSoon("leave");
					break;
				}
				blocks = await handleLeave(
					{
						db: deps.db,
						gameManager: deps.gameManager,
						slackClient: deps.slackClient,
					},
					teamId,
					channelId,
					userId,
				);
				break;

			case "cancel":
				if (!deps.gameManager || !deps.slackClient) {
					blocks = comingSoon("cancel");
					break;
				}
				blocks = await handleCancel(
					{
						db: deps.db,
						gameManager: deps.gameManager,
						slackClient: deps.slackClient,
					},
					teamId,
					channelId,
					userId,
				);
				break;

			case "end":
				if (!deps.gameManager || !deps.slackClient) {
					blocks = comingSoon("end");
					break;
				}
				blocks = await handleEnd(
					{
						db: deps.db,
						gameManager: deps.gameManager,
						slackClient: deps.slackClient,
					},
					teamId,
					channelId,
					userId,
				);
				break;

			case "status":
				blocks = await handleStatus(teamId, channelId);
				break;

			case "cards":
				if (!deps.gameManager || !deps.slackClient) {
					blocks = comingSoon("cards");
					break;
				}
				blocks = await handleCards(
					{
						gameManager: deps.gameManager,
						slackClient: deps.slackClient,
					},
					teamId,
					channelId,
					userId,
				);
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
		const actionType = routeAction(payload.actionId);

		log.info(
			{
				actionId: payload.actionId,
				actionType,
				userId: payload.userId,
				channelId: payload.channelId,
			},
			"Action received",
		);

		// Handle game actions via queue if available
		if (deps.actionQueue && deps.gameManager) {
			const teamId = ""; // Actions don't carry team_id directly; look up from game
			const gameId = await deps.gameManager.getChannelGame(
				teamId,
				payload.channelId,
			);

			if (
				gameId &&
				["fold", "check", "call", "raise", "allIn"].includes(actionType)
			) {
				const action: PokerAction =
					actionType === "raise"
						? {
								type: "raise",
								playerId: payload.userId,
								amount: chips(0), // Will be validated by engine
							}
						: ({
								type: actionType as "fold" | "check" | "call" | "allIn",
								playerId: payload.userId,
							} as PokerAction);

				await enqueueAction(deps.actionQueue, gameId, action);
			}
		}

		// Acknowledge immediately per Slack's 3-second requirement
		return c.json({});
	});

	return slack;
}
