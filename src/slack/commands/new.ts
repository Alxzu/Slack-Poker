import { getConfig } from "../../config";
import type { Database } from "../../db/connection";
import { createGame } from "../../db/games";
import { getOrCreateAccount } from "../../db/ledger";
import { logger } from "../../utils/logger";
import type { GameManager } from "../../workers/game-manager";
import { buildWaitingMessage } from "../blocks/game-message";
import type { SlackClient } from "../client";

const log = logger.child({ module: "cmd-new" });

interface NewDeps {
	db: Database;
	gameManager: GameManager;
	slackClient: SlackClient;
}

export async function handleNew(
	deps: NewDeps,
	workspaceId: string,
	channelId: string,
	userId: string,
	buyIn?: number,
): Promise<object[]> {
	const config = getConfig();
	const amount = buyIn ?? config.DEFAULT_BUY_IN;

	// Validate buy-in bounds
	if (amount < config.MIN_BUY_IN || amount > config.MAX_BUY_IN) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `:x: Buy-in must be between ${config.MIN_BUY_IN} and ${config.MAX_BUY_IN} chips.`,
				},
			},
		];
	}

	// Check no active game in channel
	const existingGameId = await deps.gameManager.getChannelGame(
		workspaceId,
		channelId,
	);
	if (existingGameId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: There is already an active game in this channel. Use `/poker join` to join it.",
				},
			},
		];
	}

	// Check player not in another game
	const playerGame = await deps.gameManager.getPlayerGame(workspaceId, userId);
	if (playerGame) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: You are already in another game. Use `/poker leave` to leave it first.",
				},
			},
		];
	}

	// Check balance
	const account = await getOrCreateAccount(deps.db, workspaceId, userId);
	if (account.balance < amount) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `:x: Insufficient balance. You have ${account.balance} chips but need ${amount}. Try \`/poker refill\`.`,
				},
			},
		];
	}

	// Create game in DB
	const smallBlind = Math.max(1, Math.floor(amount / 100));
	const bigBlind = smallBlind * 2;
	const game = await createGame(
		deps.db,
		workspaceId,
		channelId,
		amount,
		smallBlind,
		bigBlind,
	);

	// Store in Redis
	await deps.gameManager.setChannelGame(workspaceId, channelId, game.id);
	await deps.gameManager.setPlayerGame(workspaceId, userId, game.id);
	await deps.gameManager.addWaitingPlayer(game.id, userId);
	await deps.gameManager.setGameMeta(game.id, {
		channelId,
		workspaceId,
		buyIn: amount,
		creatorId: userId,
		smallBlind,
		bigBlind,
	});

	// Post waiting message to channel
	const blocks = buildWaitingMessage({
		id: game.id,
		buyIn: amount,
		creatorId: userId,
		players: [{ userId }],
	});

	try {
		const ts = await deps.slackClient.postMessage(channelId, blocks);
		await deps.gameManager.setChannelMessageTs(game.id, ts);
	} catch (err) {
		log.error({ err, gameId: game.id }, "Failed to post waiting message");
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:white_check_mark: Game created! Buy-in: ${amount} chips. Waiting for players to join.`,
			},
		},
	];
}
