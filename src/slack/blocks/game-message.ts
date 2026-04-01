import type { Card, GameState } from "../../engine/types";
import { cardsToString, faceDownCards } from "./cards";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function section(text: string, accessory?: object): object {
	const block: Record<string, unknown> = {
		type: "section",
		text: { type: "mrkdwn", text },
	};
	if (accessory) block.accessory = accessory;
	return block;
}

function divider(): object {
	return { type: "divider" };
}

function actions(elements: object[]): object {
	return { type: "actions", elements };
}

function button(
	text: string,
	actionId: string,
	style?: "primary" | "danger",
): object {
	const btn: Record<string, unknown> = {
		type: "button",
		text: { type: "plain_text", text, emoji: true },
		action_id: actionId,
	};
	if (style) btn.style = style;
	return btn;
}

function header(text: string): object {
	return {
		type: "header",
		text: { type: "plain_text", text, emoji: true },
	};
}

function phaseName(phase: string): string {
	switch (phase) {
		case "preflop":
			return "Pre-Flop";
		case "flop":
			return "Flop";
		case "turn":
			return "Turn";
		case "river":
			return "River";
		case "showdown":
			return "Showdown";
		default:
			return phase;
	}
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

export function buildWaitingMessage(game: {
	id: string;
	buyIn: number;
	creatorId: string;
	players: { userId: string }[];
}): object[] {
	const playerList =
		game.players.length > 0
			? game.players.map((p) => `<@${p.userId}>`).join(", ")
			: "_No players yet_";

	return [
		header(`:spades: Poker Game — Buy-in: ${game.buyIn} chips`),
		section(`*Players (${game.players.length}):* ${playerList}`),
		section(
			"Click *Join* below. Creator can start when 2+ players have joined.",
		),
		actions([
			button("Join Game", "poker_join", "primary"),
			button("Start Game", "poker_start"),
		]),
	];
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

export function buildPlayingMessage(
	state: GameState,
	lastHandResult?: string,
): object[] {
	const totalPot = state.pots.reduce((sum, p) => sum + p.amount, 0);
	const blocks: object[] = [];

	// Header
	blocks.push(
		header(
			`Hand #${state.handNumber} | ${phaseName(state.phase)} | Pot: ${totalPot}`,
		),
	);

	// Last hand result
	if (lastHandResult) {
		blocks.push(section(lastHandResult));
	}

	// Community cards
	const communityCount = state.communityCards.length;
	let communityText: string;
	if (communityCount === 0) {
		communityText = faceDownCards(5);
	} else {
		const shown = cardsToString(state.communityCards);
		const remaining = 5 - communityCount;
		communityText =
			remaining > 0 ? `${shown}  ${faceDownCards(remaining)}` : shown;
	}
	blocks.push(section(`*Board:*  ${communityText}`));

	// Pots
	if (state.pots.length > 1) {
		const potParts = state.pots.map((p, i) =>
			i === 0 ? `Main Pot: ${p.amount}` : `Side Pot: ${p.amount}`,
		);
		blocks.push(section(potParts.join(" | ")));
	}

	blocks.push(divider());

	// Player rows
	const activePlayers = state.players.filter((p) => !p.sittingOut);
	for (const player of activePlayers) {
		const isActive =
			player.seat === state.activeSeat && !player.folded && !player.allIn;
		const turnIndicator = isActive ? ":point_right: " : "";

		let status = "";
		if (player.folded) status = " — _Folded_";
		else if (player.allIn) status = " — *ALL IN*";
		else if (player.bet > 0) status = ` — Bet ${player.bet}`;

		// Badge
		let badge = "";
		if (player.seat === state.dealerSeat) badge = " :black_circle:D";
		// Determine SB/BB by seat offset from dealer
		const seatOrder = activePlayers.map((p) => p.seat);
		const dealerIdx = seatOrder.indexOf(state.dealerSeat);
		if (dealerIdx >= 0) {
			const sbIdx =
				(dealerIdx + (activePlayers.length === 2 ? 0 : 1)) %
				activePlayers.length;
			const bbIdx =
				(dealerIdx + (activePlayers.length === 2 ? 1 : 2)) %
				activePlayers.length;
			const playerIdx = seatOrder.indexOf(player.seat);
			if (playerIdx === sbIdx && activePlayers.length > 2) badge += " SB";
			if (playerIdx === bbIdx) badge += " BB";
			if (activePlayers.length === 2 && playerIdx === sbIdx) badge += " SB";
		}

		blocks.push(
			section(
				`${turnIndicator}<@${player.userId}>  |  Stack: ${player.stack}${badge}${status}`,
			),
		);
	}

	blocks.push(divider());

	// Waiting text
	const activePlayer = state.players.find(
		(p) => p.seat === state.activeSeat && !p.folded && !p.allIn,
	);
	if (activePlayer) {
		blocks.push(section(`Waiting for <@${activePlayer.userId}>...`));
	}

	// Action buttons
	const toCall = state.betting.currentBet > 0 ? state.betting.currentBet : 0;
	const actionButtons: object[] = [button("Fold", "poker_fold", "danger")];

	if (toCall === 0) {
		actionButtons.push(button("Check", "poker_check"));
	} else {
		actionButtons.push(button(`Call ${toCall}`, "poker_call"));
	}

	actionButtons.push(button("Raise", "poker_raise", "primary"));

	blocks.push(actions(actionButtons));

	return blocks;
}

// ---------------------------------------------------------------------------
// Showdown
// ---------------------------------------------------------------------------

export function buildShowdownMessage(
	state: GameState,
	results: {
		userId: string;
		cards: Card[];
		handName: string;
		payout: number;
	}[],
): object[] {
	const blocks: object[] = [];

	blocks.push(header(`:trophy: Hand #${state.handNumber} — Showdown`));

	// Community cards
	if (state.communityCards.length > 0) {
		blocks.push(section(`*Board:*  ${cardsToString(state.communityCards)}`));
	}

	blocks.push(divider());

	for (const result of results) {
		const cardsText = cardsToString(result.cards);
		const payoutText =
			result.payout > 0 ? `  :moneybag: +${result.payout}` : "";
		blocks.push(
			section(
				`<@${result.userId}>  ${cardsText}  —  *${result.handName}*${payoutText}`,
			),
		);
	}

	return blocks;
}

// ---------------------------------------------------------------------------
// Game Over
// ---------------------------------------------------------------------------

export function buildGameOverMessage(game: {
	handsPlayed: number;
	players: { userId: string; chipsDelta: number }[];
}): object[] {
	const blocks: object[] = [];

	blocks.push(header(":checkered_flag: Game Over"));
	blocks.push(section(`*Hands played:* ${game.handsPlayed}`));
	blocks.push(divider());

	const sorted = [...game.players].sort((a, b) => b.chipsDelta - a.chipsDelta);
	for (const player of sorted) {
		const sign = player.chipsDelta >= 0 ? "+" : "";
		const emoji =
			player.chipsDelta > 0
				? ":chart_with_upwards_trend:"
				: player.chipsDelta < 0
					? ":chart_with_downwards_trend:"
					: ":heavy_minus_sign:";
		blocks.push(
			section(
				`${emoji} <@${player.userId}>  ${sign}${player.chipsDelta} chips`,
			),
		);
	}

	return blocks;
}
