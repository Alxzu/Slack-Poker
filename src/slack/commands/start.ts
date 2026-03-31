import type { Database } from "../../db/connection";
import { updateGameStatus } from "../../db/games";
import { debit } from "../../db/ledger";
import { createGame, startHand } from "../../engine/table";
import { chips } from "../../engine/types";
import { logger } from "../../utils/logger";
import type { GameManager } from "../../workers/game-manager";
import { buildPlayingMessage } from "../blocks/game-message";
import { buildHoleCardsMessage } from "../blocks/hole-cards";
import type { SlackClient } from "../client";

const log = logger.child({ module: "cmd-start" });

interface StartDeps {
	db: Database;
	gameManager: GameManager;
	slackClient: SlackClient;
}

export async function handleStart(
	deps: StartDeps,
	workspaceId: string,
	channelId: string,
	userId: string,
): Promise<object[]> {
	// Check game exists in channel
	const gameId = await deps.gameManager.getChannelGame(workspaceId, channelId);
	if (!gameId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: No game to start. Use `/poker new` to create one.",
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

	// Only creator can start
	if (meta.creatorId !== userId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Only the game creator can start the game.",
				},
			},
		];
	}

	// Check game isn't already started
	const existingState = await deps.gameManager.getGameState(gameId);
	if (existingState) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: The game is already in progress.",
				},
			},
		];
	}

	// Need at least 2 players
	const players = await deps.gameManager.getWaitingPlayers(gameId);
	if (players.length < 2) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Need at least 2 players to start. Waiting for more players to `/poker join`.",
				},
			},
		];
	}

	// Debit buy-in from all players
	for (const playerId of players) {
		try {
			await debit(
				deps.db,
				workspaceId,
				playerId,
				meta.buyIn,
				"buy_in",
				`buyin:${gameId}:${playerId}`,
				gameId,
			);
		} catch (err) {
			log.error({ err, gameId, userId: playerId }, "Failed to debit buy-in");
			return [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:x: Failed to process buy-in for <@${playerId}>. They may have insufficient balance.`,
					},
				},
			];
		}
	}

	// Update game status in DB
	await updateGameStatus(deps.db, gameId, "active");

	// Create engine game state
	const engineState = createGame(
		players,
		{ small: chips(meta.smallBlind), big: chips(meta.bigBlind) },
		chips(meta.buyIn),
	);

	// Start first hand
	const { state: handState, dealtCards } = startHand(engineState);

	// Store state and dealt cards in Redis
	await deps.gameManager.setGameState(gameId, handState);
	await deps.gameManager.setDealtCards(gameId, handState.handId, dealtCards);

	// Send hole cards via DM to each player
	for (const [playerId, cards] of dealtCards) {
		try {
			const blocks = buildHoleCardsMessage(cards);
			const ts = await deps.slackClient.postDM(playerId, blocks);
			await deps.gameManager.setDmTs(gameId, playerId, ts);
		} catch (err) {
			log.error(
				{ err, gameId, userId: playerId },
				"Failed to send hole card DM",
			);
		}
	}

	// Update channel message to playing state
	const messageTs = await deps.gameManager.getChannelMessageTs(gameId);
	if (messageTs) {
		try {
			const blocks = buildPlayingMessage(handState);
			await deps.slackClient.updateMessage(meta.channelId, messageTs, blocks);
		} catch (err) {
			log.error({ err, gameId }, "Failed to update message to playing state");
		}
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:white_check_mark: Game started with ${players.length} players! Check your DMs for your cards.`,
			},
		},
	];
}
