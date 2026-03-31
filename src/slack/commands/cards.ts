import { logger } from "../../utils/logger";
import type { GameManager } from "../../workers/game-manager";
import { buildHoleCardsMessage } from "../blocks/hole-cards";
import type { SlackClient } from "../client";

const log = logger.child({ module: "cmd-cards" });

interface CardsDeps {
	gameManager: GameManager;
	slackClient: SlackClient;
}

export async function handleCards(
	deps: CardsDeps,
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

	// Check game is in progress
	const state = await deps.gameManager.getGameState(gameId);
	if (!state) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: The game hasn't started yet.",
				},
			},
		];
	}

	// Get dealt cards
	const cards = await deps.gameManager.getDealtCards(
		gameId,
		state.handId,
		userId,
	);
	if (!cards) {
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: No cards found for you in the current hand.",
				},
			},
		];
	}

	// Send hole cards DM
	try {
		const totalPot = state.pots.reduce(
			(sum, p) => sum + (p.amount as number),
			0,
		);
		const toCall = state.betting.currentBet as number;
		const blocks = buildHoleCardsMessage(cards, undefined, {
			pot: totalPot,
			toCall,
		});
		const ts = await deps.slackClient.postDM(userId, blocks);
		await deps.gameManager.setDmTs(gameId, userId, ts);
	} catch (err) {
		log.error({ err, gameId, userId }, "Failed to send cards DM");
		return [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: ":x: Failed to send you a DM. Please check your DM settings.",
				},
			},
		];
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: ":white_check_mark: Your cards have been sent to your DMs.",
			},
		},
	];
}
