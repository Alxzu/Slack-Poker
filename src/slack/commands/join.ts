import type { Database } from "../../db/connection";
import { addPlayer } from "../../db/games";
import { getOrCreateAccount } from "../../db/ledger";
import { logger } from "../../utils/logger";
import type { GameManager } from "../../workers/game-manager";
import { buildWaitingMessage } from "../blocks/game-message";
import type { SlackClient } from "../client";

const log = logger.child({ module: "cmd-join" });

interface JoinDeps {
	db: Database;
	gameManager: GameManager;
	slackClient: SlackClient;
}

export async function handleJoin(
	deps: JoinDeps,
	workspaceId: string,
	channelId: string,
	userId: string,
): Promise<object[]> {
	// Check player not already in a game
	const playerGame = await deps.gameManager.getPlayerGame(workspaceId, userId);
	if (playerGame) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: You are already in a game. Use `/poker leave` to leave it first.",
				},
			},
		];
	}

	// Check game exists in channel
	const gameId = await deps.gameManager.getChannelGame(workspaceId, channelId);
	if (!gameId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: No active game in this channel. Use `/poker new` to start one.",
				},
			},
		];
	}

	// Check game is in waiting state (no engine state means still waiting)
	const engineState = await deps.gameManager.getGameState(gameId);
	if (engineState) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: This game is already in progress. Wait for the next game.",
				},
			},
		];
	}

	const meta = await deps.gameManager.getGameMeta(gameId);
	if (!meta) {
		return [
			{
				type: "section",
				text: { type: "mrkdwn", text: ":x: Game data not found." },
			},
		];
	}

	// Check current player count
	const waitingPlayers = await deps.gameManager.getWaitingPlayers(gameId);
	if (waitingPlayers.includes(userId)) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: You have already joined this game.",
				},
			},
		];
	}

	if (waitingPlayers.length >= 8) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: This game is full (max 8 players).",
				},
			},
		];
	}

	// Check balance
	const account = await getOrCreateAccount(deps.db, workspaceId, userId);
	if (account.balance < meta.buyIn) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `:x: Insufficient balance. You have ${account.balance} chips but need ${meta.buyIn}. Try \`/poker refill\`.`,
				},
			},
		];
	}

	// Test DM-ability
	try {
		await deps.slackClient.openDM(userId);
	} catch (_err) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: I can't send you DMs. Please allow direct messages from apps in your Slack settings.",
				},
			},
		];
	}

	// Add player
	await deps.gameManager.addWaitingPlayer(gameId, userId);
	await deps.gameManager.setPlayerGame(workspaceId, userId, gameId);

	// Add to DB
	const allPlayers = await deps.gameManager.getWaitingPlayers(gameId);
	const seat = allPlayers.indexOf(userId);
	try {
		await addPlayer(deps.db, gameId, userId, seat, meta.buyIn);
	} catch (err) {
		log.error({ err, gameId, userId }, "Failed to add player to DB");
	}

	// Update waiting message
	const messageTs = await deps.gameManager.getChannelMessageTs(gameId);
	if (messageTs) {
		try {
			const blocks = buildWaitingMessage({
				id: gameId,
				buyIn: meta.buyIn,
				creatorId: meta.creatorId,
				players: allPlayers.map((id) => ({ userId: id })),
			});
			await deps.slackClient.updateMessage(meta.channelId, messageTs, blocks);
		} catch (err) {
			log.error({ err, gameId }, "Failed to update waiting message");
		}
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:white_check_mark: You joined the game! Buy-in: ${meta.buyIn} chips.`,
			},
		},
	];
}
