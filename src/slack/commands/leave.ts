import type { Database } from "../../db/connection";
import { settleGame } from "../../db/games";
import { credit } from "../../db/ledger";
import { removePlayer } from "../../engine/table";
import { logger } from "../../utils/logger";
import type { GameManager } from "../../workers/game-manager";
import {
	buildGameOverMessage,
	buildWaitingMessage,
} from "../blocks/game-message";
import type { SlackClient } from "../client";

const log = logger.child({ module: "cmd-leave" });

interface LeaveDeps {
	db: Database;
	gameManager: GameManager;
	slackClient: SlackClient;
}

export async function handleLeave(
	deps: LeaveDeps,
	workspaceId: string,
	_channelId: string,
	userId: string,
): Promise<object[]> {
	// Check player is in a game
	const gameId = await deps.gameManager.getPlayerGame(workspaceId, userId);
	if (!gameId) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: You are not in any game.",
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

	// Check if game is still in waiting state (no engine state)
	const engineState = await deps.gameManager.getGameState(gameId);

	if (!engineState) {
		// Waiting state — just remove from waiting list
		await deps.gameManager.removeWaitingPlayer(gameId, userId);
		await deps.gameManager.clearPlayerGame(workspaceId, userId);

		const remainingPlayers = await deps.gameManager.getWaitingPlayers(gameId);

		// If creator left and no one remains, clean up
		if (remainingPlayers.length === 0) {
			await deps.gameManager.cleanupGame(
				gameId,
				workspaceId,
				[userId],
				meta.channelId,
			);
		} else {
			// Update waiting message
			const messageTs = await deps.gameManager.getChannelMessageTs(gameId);
			if (messageTs) {
				try {
					const blocks = buildWaitingMessage({
						id: gameId,
						buyIn: meta.buyIn,
						creatorId: meta.creatorId,
						players: remainingPlayers.map((id) => ({ userId: id })),
					});
					await deps.slackClient.updateMessage(
						meta.channelId,
						messageTs,
						blocks,
					);
				} catch (err) {
					log.error({ err, gameId }, "Failed to update waiting message");
				}
			}
		}

		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":white_check_mark: You left the game.",
				},
			},
		];
	}

	// Game is in progress — remove player from engine state
	const player = engineState.players.find((p) => p.userId === userId);
	if (!player) {
		await deps.gameManager.clearPlayerGame(workspaceId, userId);
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: You are not in the active game.",
				},
			},
		];
	}

	// Cash out remaining chips
	const cashOutAmount = player.stack as number;
	if (cashOutAmount > 0) {
		try {
			await credit(
				deps.db,
				workspaceId,
				userId,
				cashOutAmount,
				"cash_out",
				`leave:${gameId}:${userId}`,
				gameId,
			);
		} catch (err) {
			log.error({ err, gameId, userId }, "Failed to credit on leave");
		}
	}

	// Remove from engine
	const newState = removePlayer(engineState, userId);
	await deps.gameManager.clearPlayerGame(workspaceId, userId);

	// If game is now complete (< 2 players)
	if (newState.phase === "complete") {
		// Settle remaining player
		const playerResults = [];
		for (const p of newState.players) {
			const chipsEnd = p.stack as number;
			if (chipsEnd > 0) {
				try {
					await credit(
						deps.db,
						workspaceId,
						p.userId,
						chipsEnd,
						"cash_out",
						`cashout:${gameId}:${p.userId}`,
						gameId,
					);
				} catch (err) {
					log.error(
						{ err, gameId, userId: p.userId },
						"Failed to credit on game end after leave",
					);
				}
			}
			playerResults.push({
				userId: p.userId,
				chipsEnd,
				result:
					chipsEnd > meta.buyIn
						? "win"
						: chipsEnd < meta.buyIn
							? "loss"
							: "break_even",
			});
		}

		// Include the leaving player in results
		playerResults.push({
			userId,
			chipsEnd: cashOutAmount,
			result:
				cashOutAmount > meta.buyIn
					? "win"
					: cashOutAmount < meta.buyIn
						? "loss"
						: "break_even",
		});

		try {
			await settleGame(deps.db, gameId, playerResults);
		} catch (err) {
			log.error({ err, gameId }, "Failed to settle game after leave");
		}

		// Post game over message
		const messageTs = await deps.gameManager.getChannelMessageTs(gameId);
		if (messageTs) {
			try {
				const blocks = buildGameOverMessage({
					handsPlayed: newState.handNumber,
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

		// Cleanup
		const allPlayerIds = [...newState.players.map((p) => p.userId), userId];
		await deps.gameManager.cleanupGame(
			gameId,
			workspaceId,
			allPlayerIds,
			meta.channelId,
		);
	} else {
		// Game continues
		await deps.gameManager.setGameState(gameId, newState);
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:white_check_mark: You left the game and cashed out ${cashOutAmount} chips.`,
			},
		},
	];
}
