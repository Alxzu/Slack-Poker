import type { Database } from "../../db/connection";
import { updateGameStatus } from "../../db/games";
import { logger } from "../../utils/logger";
import type { GameManager } from "../../workers/game-manager";
import type { SlackClient } from "../client";

const log = logger.child({ module: "cmd-cancel" });

interface CancelDeps {
	db: Database;
	gameManager: GameManager;
	slackClient: SlackClient;
}

export async function handleCancel(
	deps: CancelDeps,
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
					text: ":x: No active game in this channel.",
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

	// Only creator can cancel
	if (meta.creatorId !== userId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Only the game creator can cancel the game.",
				},
			},
		];
	}

	// Can only cancel if game hasn't started (waiting state)
	const engineState = await deps.gameManager.getGameState(gameId);
	if (engineState) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Cannot cancel a game in progress. Use `/poker end` to end it.",
				},
			},
		];
	}

	// No buy-ins to refund since debit only happens on /poker start
	const players = await deps.gameManager.getWaitingPlayers(gameId);

	// Update DB
	try {
		await updateGameStatus(deps.db, gameId, "cancelled");
	} catch (err) {
		log.error({ err, gameId }, "Failed to update game status to cancelled");
	}

	// Update channel message
	const messageTs = await deps.gameManager.getChannelMessageTs(gameId);
	if (messageTs) {
		try {
			await deps.slackClient.updateMessage(meta.channelId, messageTs, [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: ":no_entry_sign: Game was cancelled by the creator.",
					},
				},
			]);
		} catch (err) {
			log.error({ err, gameId }, "Failed to update cancelled message");
		}
	}

	// Cleanup Redis
	await deps.gameManager.cleanupGame(
		gameId,
		workspaceId,
		players,
		meta.channelId,
	);

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: ":white_check_mark: Game cancelled.",
			},
		},
	];
}
