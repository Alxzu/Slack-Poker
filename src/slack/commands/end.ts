import type { Database } from "../../db/connection";
import { settleGame } from "../../db/games";
import { credit } from "../../db/ledger";
import { logger } from "../../utils/logger";
import type { GameManager } from "../../workers/game-manager";
import { buildGameOverMessage } from "../blocks/game-message";
import type { SlackClient } from "../client";

const log = logger.child({ module: "cmd-end" });

interface EndDeps {
	db: Database;
	gameManager: GameManager;
	slackClient: SlackClient;
}

export async function handleEnd(
	deps: EndDeps,
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

	// Only creator can end
	if (meta.creatorId !== userId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Only the game creator can end the game.",
				},
			},
		];
	}

	const engineState = await deps.gameManager.getGameState(gameId);

	// If game hasn't started, treat like cancel
	if (!engineState) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Game hasn't started yet. Use `/poker cancel` instead.",
				},
			},
		];
	}

	// Settle all chips — credit remaining stacks back to ledger
	const playerResults = [];
	for (const player of engineState.players) {
		const chipsEnd = player.stack as number;
		if (chipsEnd > 0) {
			try {
				await credit(
					deps.db,
					workspaceId,
					player.userId,
					chipsEnd,
					"cash_out",
					`end:${gameId}:${player.userId}`,
					gameId,
				);
			} catch (err) {
				log.error(
					{ err, gameId, userId: player.userId },
					"Failed to credit player on game end",
				);
			}
		}
		playerResults.push({
			userId: player.userId,
			chipsEnd,
			result:
				chipsEnd > meta.buyIn
					? "win"
					: chipsEnd < meta.buyIn
						? "loss"
						: "break_even",
		});
	}

	// Update DB
	try {
		await settleGame(deps.db, gameId, playerResults);
	} catch (err) {
		log.error({ err, gameId }, "Failed to settle game in DB");
	}

	// Post game over message
	const messageTs = await deps.gameManager.getChannelMessageTs(gameId);
	if (messageTs) {
		try {
			const blocks = buildGameOverMessage({
				handsPlayed: engineState.handNumber,
				players: playerResults.map((r) => ({
					userId: r.userId,
					chipsDelta: r.chipsEnd - meta.buyIn,
				})),
			});
			await deps.slackClient.updateMessage(meta.channelId, messageTs, blocks);
		} catch (err) {
			log.error({ err, gameId }, "Failed to post game over message");
		}
	}

	// Cleanup Redis
	const playerIds = engineState.players.map((p) => p.userId);
	await deps.gameManager.cleanupGame(
		gameId,
		workspaceId,
		playerIds,
		meta.channelId,
	);

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: ":white_check_mark: Game ended. All chips have been settled.",
			},
		},
	];
}
