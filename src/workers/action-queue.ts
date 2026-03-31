import { Queue, Worker } from "groupmq";
import type Redis from "ioredis";
import type { Database } from "../db/connection";
import { recordHand, recordPayout, settleGame } from "../db/games";
import { credit } from "../db/ledger";
import {
	applyAction,
	endHand,
	resolveShowdown,
	startHand,
} from "../engine/table";
import type { Card, GameState, PokerAction } from "../engine/types";
import {
	buildGameOverMessage,
	buildPlayingMessage,
	buildShowdownMessage,
} from "../slack/blocks/game-message";
import { buildHoleCardsMessage } from "../slack/blocks/hole-cards";
import type { SlackClient } from "../slack/client";
import { encrypt } from "../utils/crypto";
import { logger } from "../utils/logger";
import type { GameManager } from "./game-manager";
import type { TurnTimer } from "./turn-timer";

const log = logger.child({ module: "action-queue" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionJobData {
	gameId: string;
	action: PokerAction;
}

interface ActionQueueDeps {
	gameManager: GameManager;
	slackClient: SlackClient;
	db: Database;
	turnTimer?: TurnTimer;
}

// ---------------------------------------------------------------------------
// Queue setup
// ---------------------------------------------------------------------------

export function createActionQueue(redis: Redis, deps: ActionQueueDeps) {
	const queue = new Queue<ActionJobData>({
		redis,
		namespace: "poker-actions",
		jobTimeoutMs: 10_000,
	});

	const worker = new Worker<ActionJobData>({
		queue,
		concurrency: 8,
		handler: async (job) => {
			const { gameId, action } = job.data;
			try {
				await processAction(gameId, action, deps);
			} catch (err) {
				log.error({ err, gameId, action }, "Failed to process action");
				throw err;
			}
		},
		onError: (err, job) => {
			log.error(
				{ err, jobId: job?.id, groupId: job?.groupId },
				"Action worker error",
			);
		},
	});

	return { queue, worker };
}

// ---------------------------------------------------------------------------
// Enqueue helper
// ---------------------------------------------------------------------------

export async function enqueueAction(
	queue: Queue<ActionJobData>,
	gameId: string,
	action: PokerAction,
): Promise<void> {
	await queue.add({
		groupId: `game:${gameId}`,
		data: { gameId, action },
	});
}

// ---------------------------------------------------------------------------
// Core action processor
// ---------------------------------------------------------------------------

async function processAction(
	gameId: string,
	action: PokerAction,
	deps: ActionQueueDeps,
): Promise<void> {
	const { gameManager, slackClient, turnTimer } = deps;

	const state = await gameManager.getGameState(gameId);
	if (!state) {
		log.warn({ gameId }, "Game state not found, skipping action");
		return;
	}

	const meta = await gameManager.getGameMeta(gameId);
	if (!meta) {
		log.warn({ gameId }, "Game meta not found, skipping action");
		return;
	}

	// Validate action is applicable
	const player = state.players.find((p) => p.userId === action.playerId);
	if (!player) {
		log.warn({ gameId, action }, "Player not in game");
		return;
	}
	if (player.seat !== state.activeSeat) {
		log.warn({ gameId, action }, "Not player's turn");
		return;
	}

	// Cancel existing turn timer
	if (turnTimer) {
		await turnTimer.cancelTimer(gameId, state.handId, action.playerId);
	}

	const previousPhase = state.phase;

	// Apply the action
	let newState: GameState;
	try {
		newState = applyAction(state, action);
	} catch (err) {
		log.error({ err, gameId, action }, "Failed to apply action");
		return;
	}

	const messageTs = await gameManager.getChannelMessageTs(gameId);

	// Check if we reached showdown
	if (newState.phase === "showdown") {
		await handleShowdown(gameId, newState, meta, messageTs, deps);
		return;
	}

	// Phase changed (new community cards dealt)
	const phaseChanged = newState.phase !== previousPhase;

	// Save state
	await gameManager.setGameState(gameId, newState);

	// Update channel message
	if (messageTs) {
		try {
			const blocks = buildPlayingMessage(newState);
			await slackClient.updateMessage(meta.channelId, messageTs, blocks);
		} catch (err) {
			log.error({ err, gameId }, "Failed to update channel message");
		}
	}

	// If phase changed, update hole card DMs with new info
	if (phaseChanged) {
		await updateHoleCardDMs(gameId, newState, deps);
	}

	// Start turn timer for next active player
	if (turnTimer) {
		const nextPlayer = newState.players.find(
			(p) => p.seat === newState.activeSeat && !p.folded && !p.allIn,
		);
		if (nextPlayer) {
			await turnTimer.startTimer(gameId, newState.handId, nextPlayer.userId);
		}
	}
}

// ---------------------------------------------------------------------------
// Showdown handling
// ---------------------------------------------------------------------------

async function handleShowdown(
	gameId: string,
	state: GameState,
	meta: {
		channelId: string;
		workspaceId: string;
		buyIn: number;
		creatorId: string;
		smallBlind: number;
		bigBlind: number;
	},
	messageTs: string | null,
	deps: ActionQueueDeps,
): Promise<void> {
	const { gameManager, slackClient, db } = deps;

	// Get dealt cards for all non-folded players
	const nonFolded = state.players.filter((p) => !p.folded);
	const dealtCards = await gameManager.getAllDealtCards(
		gameId,
		state.handId,
		nonFolded.map((p) => p.userId),
	);

	// Resolve showdown
	const { state: resolvedState, results } = resolveShowdown(state, dealtCards);

	// Record hand in DB
	try {
		const holeCardsJson = JSON.stringify(Object.fromEntries(dealtCards));
		const encrypted = await encrypt(holeCardsJson);
		const encryptedHex = Array.from(encrypted)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		const handRecord = await recordHand(
			db,
			gameId,
			resolvedState.handNumber,
			resolvedState.dealerSeat as number,
			resolvedState.communityCards,
			encryptedHex,
		);

		// Record payouts
		for (const result of results) {
			if ((result.payout as number) > 0) {
				await recordPayout(
					db,
					handRecord.id,
					result.userId,
					0,
					result.payout as number,
				);
			}
		}
	} catch (err) {
		log.error({ err, gameId }, "Failed to record hand in DB");
	}

	// Post showdown message
	if (messageTs) {
		try {
			const showdownBlocks = buildShowdownMessage(
				resolvedState,
				results.map((r) => ({
					userId: r.userId,
					cards: r.cards,
					handName: r.hand.name,
					payout: r.payout as number,
				})),
			);
			await slackClient.updateMessage(
				meta.channelId,
				messageTs,
				showdownBlocks,
			);
		} catch (err) {
			log.error({ err, gameId }, "Failed to post showdown message");
		}
	}

	// End hand and check game state
	const afterEnd = endHand(resolvedState);

	if (afterEnd.phase === "complete") {
		await handleGameOver(gameId, afterEnd, meta, messageTs, deps);
		return;
	}

	// Start next hand after a brief pause
	await startNextHand(gameId, afterEnd, meta, messageTs, deps);
}

// ---------------------------------------------------------------------------
// Start next hand
// ---------------------------------------------------------------------------

async function startNextHand(
	gameId: string,
	state: GameState,
	meta: {
		channelId: string;
		workspaceId: string;
		buyIn: number;
		creatorId: string;
		smallBlind: number;
		bigBlind: number;
	},
	messageTs: string | null,
	deps: ActionQueueDeps,
): Promise<void> {
	const { gameManager, slackClient, turnTimer } = deps;

	const { state: handState, dealtCards } = startHand(state);

	// Store state and dealt cards
	await gameManager.setGameState(gameId, handState);
	await gameManager.setDealtCards(gameId, handState.handId, dealtCards);

	// Send hole cards via DM
	await sendHoleCardDMs(gameId, handState, dealtCards, deps);

	// Update channel message
	if (messageTs) {
		try {
			const blocks = buildPlayingMessage(handState);
			await slackClient.updateMessage(meta.channelId, messageTs, blocks);
		} catch (err) {
			log.error(
				{ err, gameId },
				"Failed to update channel message for new hand",
			);
		}
	}

	// Start turn timer
	if (turnTimer) {
		const activePlayer = handState.players.find(
			(p) => p.seat === handState.activeSeat && !p.folded && !p.allIn,
		);
		if (activePlayer) {
			await turnTimer.startTimer(gameId, handState.handId, activePlayer.userId);
		}
	}
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

async function handleGameOver(
	gameId: string,
	state: GameState,
	meta: {
		channelId: string;
		workspaceId: string;
		buyIn: number;
		creatorId: string;
		smallBlind: number;
		bigBlind: number;
	},
	messageTs: string | null,
	deps: ActionQueueDeps,
): Promise<void> {
	const { gameManager, slackClient, db } = deps;

	// Settle: credit chips back to ledger accounts
	const playerResults = [];
	for (const player of state.players) {
		const chipsEnd = player.stack as number;
		const chipsDelta = chipsEnd - meta.buyIn;
		const result =
			chipsDelta > 0 ? "win" : chipsDelta < 0 ? "loss" : "break_even";

		if (chipsEnd > 0) {
			try {
				await credit(
					db,
					meta.workspaceId,
					player.userId,
					chipsEnd,
					"cash_out",
					`cashout:${gameId}:${player.userId}`,
					gameId,
				);
			} catch (err) {
				log.error(
					{ err, gameId, userId: player.userId },
					"Failed to credit player on game over",
				);
			}
		}

		playerResults.push({
			userId: player.userId,
			chipsEnd,
			result,
		});
	}

	// Update DB
	try {
		await settleGame(db, gameId, playerResults);
	} catch (err) {
		log.error({ err, gameId }, "Failed to settle game in DB");
	}

	// Post game over message
	if (messageTs) {
		try {
			const blocks = buildGameOverMessage({
				handsPlayed: state.handNumber,
				players: playerResults.map((r) => ({
					userId: r.userId,
					chipsDelta: r.chipsEnd - meta.buyIn,
				})),
			});
			await slackClient.updateMessage(meta.channelId, messageTs, blocks);
		} catch (err) {
			log.error({ err, gameId }, "Failed to post game over message");
		}
	}

	// Cleanup Redis
	const playerIds = state.players.map((p) => p.userId);
	await gameManager.cleanupGame(
		gameId,
		meta.workspaceId,
		playerIds,
		meta.channelId,
	);
}

// ---------------------------------------------------------------------------
// Hole card DMs
// ---------------------------------------------------------------------------

async function sendHoleCardDMs(
	gameId: string,
	_state: GameState,
	dealtCards: Map<string, readonly Card[]>,
	deps: ActionQueueDeps,
): Promise<void> {
	const { gameManager, slackClient } = deps;

	for (const [userId, cards] of dealtCards) {
		try {
			const blocks = buildHoleCardsMessage(cards);
			const ts = await slackClient.postDM(userId, blocks);
			await gameManager.setDmTs(gameId, userId, ts);
		} catch (err) {
			log.error({ err, gameId, userId }, "Failed to send hole card DM");
		}
	}
}

async function updateHoleCardDMs(
	gameId: string,
	state: GameState,
	deps: ActionQueueDeps,
): Promise<void> {
	const { gameManager, slackClient } = deps;

	const activePlayers = state.players.filter((p) => !p.folded && !p.sittingOut);

	const totalPot = state.pots.reduce((sum, p) => sum + (p.amount as number), 0);
	const toCall = state.betting.currentBet as number;

	for (const player of activePlayers) {
		try {
			const dmTs = await gameManager.getDmTs(gameId, player.userId);
			if (!dmTs) continue;

			const cards = await gameManager.getDealtCards(
				gameId,
				state.handId,
				player.userId,
			);
			if (!cards) continue;

			const blocks = buildHoleCardsMessage(cards, undefined, {
				pot: totalPot,
				toCall,
			});
			await slackClient.updateDM(player.userId, dmTs, blocks);
		} catch (err) {
			log.error(
				{ err, gameId, userId: player.userId },
				"Failed to update hole card DM",
			);
		}
	}
}
