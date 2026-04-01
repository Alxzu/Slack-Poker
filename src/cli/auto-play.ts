#!/usr/bin/env bun
/**
 * Auto-play simulation: 4 players, 5 hands, strategic play.
 * Each player has a different strategy. Outputs a detailed game log.
 */

import {
	applyAction,
	createGame,
	endHand,
	legalActions,
	resolveShowdown,
	startHand,
} from "../engine/table";
import type {
	Card,
	EvaluatedHand,
	GameState,
	PlayerState,
	PokerAction,
} from "../engine/types";
import { chips } from "../engine/types";
import { evaluateHand } from "../engine/hand-evaluator";

// ── Types ─────────────────────────────────────────────────────────

type Strategy = (
	player: PlayerState,
	state: GameState,
	holeCards: readonly Card[],
	legal: PokerAction[],
) => PokerAction;

// ── Card display ──────────────────────────────────────────────────

const SUIT_SYM: Record<string, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };

function cardStr(c: Card): string {
	return `${SUIT_SYM[c.suit]} ${c.rank}`;
}

function cardsStr(cards: readonly Card[]): string {
	return cards.map(cardStr).join(" ");
}

function handStrength(holeCards: readonly Card[], community: readonly Card[]): EvaluatedHand | null {
	const all = [...holeCards, ...community];
	if (all.length < 5) return null;
	return evaluateHand(all);
}

// ── Player Strategies ─────────────────────────────────────────────

/** Alice: Tight-aggressive. Only plays strong hands, raises with premium. */
const aliceStrategy: Strategy = (player, state, holeCards, legal) => {
	const legalTypes = new Set(legal.map((a) => a.type));
	const hand = handStrength(holeCards, state.communityCards);
	const rankVal = (r: string) => "23456789".indexOf(r[0]) + 2 || { T: 10, J: 11, Q: 12, K: 13, A: 14 }[r[0]] || 0;
	const r1 = rankVal(holeCards[0].rank);
	const r2 = rankVal(holeCards[1].rank);
	const paired = holeCards[0].rank === holeCards[1].rank;
	const suited = holeCards[0].suit === holeCards[1].suit;
	const highCard = Math.max(r1, r2);

	// Post-flop: play based on hand strength
	if (hand) {
		if (hand.rank >= 3) { // two pair+
			if (legalTypes.has("raise")) return legal.find((a) => a.type === "raise")!;
			if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
		}
		if (hand.rank >= 2) { // pair
			if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
			if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
		}
		if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
		return legal.find((a) => a.type === "fold")!;
	}

	// Preflop: play premium hands
	if (paired && highCard >= 10) {
		if (legalTypes.has("raise")) return legal.find((a) => a.type === "raise")!;
	}
	if (highCard >= 13 || (paired && highCard >= 7) || (suited && highCard >= 11)) {
		if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
		if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
	}
	if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
	return legal.find((a) => a.type === "fold")!;
};

/** Bob: Loose-aggressive. Plays many hands, bluffs often. */
const bobStrategy: Strategy = (player, state, holeCards, legal) => {
	const legalTypes = new Set(legal.map((a) => a.type));
	const hand = handStrength(holeCards, state.communityCards);

	// Post-flop: raise with anything decent, bluff sometimes
	if (hand) {
		if (hand.rank >= 2) {
			if (legalTypes.has("raise")) return legal.find((a) => a.type === "raise")!;
			if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
		}
		// Bluff 30% of the time
		if (Math.random() < 0.3 && legalTypes.has("raise")) return legal.find((a) => a.type === "raise")!;
		if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
		if (legalTypes.has("call") && (state.betting.currentBet as number) <= 40) return legal.find((a) => a.type === "call")!;
		return legal.find((a) => a.type === "fold")!;
	}

	// Preflop: play almost anything
	if (legalTypes.has("raise") && Math.random() < 0.4) return legal.find((a) => a.type === "raise")!;
	if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
	if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
	return legal.find((a) => a.type === "fold")!;
};

/** Charlie: Passive-calling station. Rarely raises, calls a lot. */
const charlieStrategy: Strategy = (player, state, holeCards, legal) => {
	const legalTypes = new Set(legal.map((a) => a.type));
	const hand = handStrength(holeCards, state.communityCards);

	if (hand && hand.rank >= 4) { // trips+, finally raise
		if (legalTypes.has("raise")) return legal.find((a) => a.type === "raise")!;
	}
	if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
	if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
	return legal.find((a) => a.type === "fold")!;
};

/** Diana: Calculated. Uses pot odds and hand strength precisely. */
const dianaStrategy: Strategy = (player, state, holeCards, legal) => {
	const legalTypes = new Set(legal.map((a) => a.type));
	const hand = handStrength(holeCards, state.communityCards);
	const potSize = state.pots.reduce((s, p) => s + (p.amount as number), 0) +
		state.players.reduce((s, p) => s + (p.bet as number), 0);
	const callAmt = (state.betting.currentBet as number) - (player.bet as number);
	const potOdds = callAmt > 0 ? callAmt / (potSize + callAmt) : 0;

	if (hand) {
		if (hand.rank >= 5) { // flush+: go aggressive
			if (legalTypes.has("allIn") && (player.stack as number) < potSize) return legal.find((a) => a.type === "allIn")!;
			if (legalTypes.has("raise")) return legal.find((a) => a.type === "raise")!;
		}
		if (hand.rank >= 3) { // two pair+
			if (legalTypes.has("raise") && potOdds < 0.3) return legal.find((a) => a.type === "raise")!;
			if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
		}
		if (hand.rank >= 2 && potOdds < 0.25) {
			if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
		}
		if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
		return legal.find((a) => a.type === "fold")!;
	}

	// Preflop
	const rankVal = (r: string) => "23456789".indexOf(r[0]) + 2 || { T: 10, J: 11, Q: 12, K: 13, A: 14 }[r[0]] || 0;
	const highCard = Math.max(rankVal(holeCards[0].rank), rankVal(holeCards[1].rank));
	if (highCard >= 12 || holeCards[0].rank === holeCards[1].rank) {
		if (legalTypes.has("raise") && Math.random() < 0.5) return legal.find((a) => a.type === "raise")!;
		if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
	}
	if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
	if (legalTypes.has("call") && potOdds < 0.15) return legal.find((a) => a.type === "call")!;
	return legal.find((a) => a.type === "fold")!;
};

/** Eve: Tight-passive. Only plays strong hands, rarely raises. */
const eveStrategy: Strategy = (player, state, holeCards, legal) => {
	const legalTypes = new Set(legal.map((a) => a.type));
	const hand = handStrength(holeCards, state.communityCards);
	const rankVal = (r: string) =>
		"23456789".indexOf(r[0]) + 2 ||
		({ T: 10, J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[
			r[0]
		] ||
		0;
	const highCard = Math.max(
		rankVal(holeCards[0].rank),
		rankVal(holeCards[1].rank),
	);
	const paired = holeCards[0].rank === holeCards[1].rank;

	if (hand) {
		if (hand.rank >= 5) {
			if (legalTypes.has("raise"))
				return legal.find((a) => a.type === "raise")!;
		}
		if (hand.rank >= 2) {
			if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
			if (legalTypes.has("check"))
				return legal.find((a) => a.type === "check")!;
		}
		if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
		return legal.find((a) => a.type === "fold")!;
	}

	// Preflop: only play big pairs and high aces
	if (paired && highCard >= 9) {
		if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
	}
	if (highCard >= 14) {
		if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
	}
	if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
	return legal.find((a) => a.type === "fold")!;
};

/** Frank: Maniac. Raises everything, all-in with any pair. */
const frankStrategy: Strategy = (player, state, holeCards, legal) => {
	const legalTypes = new Set(legal.map((a) => a.type));
	const hand = handStrength(holeCards, state.communityCards);

	if (hand) {
		if (hand.rank >= 2 && legalTypes.has("allIn"))
			return legal.find((a) => a.type === "allIn")!;
		if (legalTypes.has("raise"))
			return legal.find((a) => a.type === "raise")!;
		if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
		if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
		return legal.find((a) => a.type === "fold")!;
	}

	// Preflop: raise or call everything
	if (legalTypes.has("raise") && Math.random() < 0.6)
		return legal.find((a) => a.type === "raise")!;
	if (legalTypes.has("call")) return legal.find((a) => a.type === "call")!;
	if (legalTypes.has("check")) return legal.find((a) => a.type === "check")!;
	return legal.find((a) => a.type === "fold")!;
};

// ── Game Configuration ────────────────────────────────────────────

const PLAYERS = [
	{ id: "alice", name: "Alice", strategy: aliceStrategy },
	{ id: "bob", name: "Bob", strategy: bobStrategy },
	{ id: "charlie", name: "Charlie", strategy: charlieStrategy },
	{ id: "diana", name: "Diana", strategy: dianaStrategy },
	{ id: "eve", name: "Eve", strategy: eveStrategy },
	{ id: "frank", name: "Frank", strategy: frankStrategy },
];

const HANDS_TO_PLAY = 10;
const BUY_IN = 500;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

function log(msg: string) {
	console.log(msg);
}

function logSeparator() {
	log("═".repeat(70));
}

function main() {
	log("");
	logSeparator();
	log(`  AUTO-PLAY: ${PLAYERS.length} Players × ${HANDS_TO_PLAY} Hands`);
	log(`  Players: ${PLAYERS.map((p) => p.name).join(", ")}`);
	log(`  Buy-in: ${BUY_IN} | Blinds: ${SMALL_BLIND}/${BIG_BLIND}`);
	logSeparator();

	let state = createGame(
		PLAYERS.map((p) => p.id),
		{ small: chips(SMALL_BLIND), big: chips(BIG_BLIND) },
		chips(BUY_IN),
	);

	const playerName = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? id;
	const playerStrategy = (id: string) => PLAYERS.find((p) => p.id === id)?.strategy ?? aliceStrategy;

	for (let hand = 1; hand <= HANDS_TO_PLAY; hand++) {
		const activePlayers = state.players.filter((p) => (p.stack as number) > 0);
		if (activePlayers.length < 2) {
			log(`\n  Game over early — only ${activePlayers.length} player(s) left.`);
			break;
		}

		log("");
		logSeparator();
		log(`  HAND #${hand}`);
		logSeparator();

		// Log stacks before hand
		log("\n  Starting stacks:");
		const preStacks = new Map<string, number>();
		for (const p of state.players) {
			preStacks.set(p.userId, p.stack as number);
			log(`    ${playerName(p.userId).padEnd(10)} ${p.stack as number} chips`);
		}
		const totalChipsBefore = state.players.reduce((s, p) => s + (p.stack as number), 0);
		log(`    ${"TOTAL".padEnd(10)} ${totalChipsBefore} chips`);

		// Start hand
		const { state: handState, dealtCards } = startHand(state);
		state = handState;

		// Log dealer and blinds
		const dealer = state.players.find((p) => p.seat === state.dealerSeat);
		log(`\n  Dealer: ${playerName(dealer?.userId ?? "?")}`);

		// Log hole cards
		log("\n  Hole cards dealt:");
		for (const [userId, cards] of dealtCards) {
			log(`    ${playerName(userId).padEnd(10)} ${cardsStr(cards)}`);
		}

		// Play through betting rounds
		let actionCount = 0;
		let foldWinner: string | null = null;

		while (state.phase !== "showdown" && state.phase !== "complete") {
			const prevPhase = state.phase;

			// Find active player
			const activePlayer = state.players.find(
				(p) => p.seat === state.activeSeat && !p.folded && !p.allIn,
			);

			if (!activePlayer) break;

			const legal = legalActions(state, activePlayer.userId);
			if (legal.length === 0) break;

			// Get strategy decision
			const strategy = playerStrategy(activePlayer.userId);
			const holeCards = dealtCards.get(activePlayer.userId) ?? [];
			const action = strategy(activePlayer, state, holeCards, legal);

			// Log the action
			const actionDesc = action.type === "raise"
				? `raises to ${(action as any).amount}`
				: action.type === "call"
					? `calls ${(state.betting.currentBet as number) - (activePlayer.bet as number)}`
					: action.type;
			log(`  ${prevPhase.toUpperCase().padEnd(8)} ${playerName(activePlayer.userId).padEnd(10)} ${actionDesc}`);

			// Apply action
			const newState = applyAction(state, action);
			actionCount++;

			// Check for fold-to-win
			const nonFolded = newState.players.filter((p) => !p.folded);
			if (newState.phase === "showdown" && nonFolded.length === 1) {
				foldWinner = nonFolded[0].userId;
			}

			// Log phase transitions
			if (newState.phase !== prevPhase && newState.phase !== "showdown") {
				log(`\n  ── ${newState.phase.toUpperCase()} ── Community: ${cardsStr(newState.communityCards)}`);
			}

			state = newState;
		}

		// Resolve
		if (foldWinner) {
			const pot = state.pots.reduce((s, p) => s + (p.amount as number), 0);
			log(`\n  RESULT: ${playerName(foldWinner)} wins ${pot} chips (everyone folded)`);
		} else if (state.phase === "showdown") {
			log(`\n  ── SHOWDOWN ── Community: ${cardsStr(state.communityCards)}`);
			const { state: showdownState, results } = resolveShowdown(state, dealtCards);
			state = showdownState;

			log("");
			for (const r of results.sort((a, b) => (b.payout as number) - (a.payout as number))) {
				const status = (r.payout as number) > 0
					? `WON ${r.payout as number} chips`
					: "lost";
				log(`    ${playerName(r.userId).padEnd(10)} ${cardsStr(r.cards).padEnd(12)} ${r.hand.name.padEnd(25)} ${status}`);
			}
		}

		// End hand
		state = endHand(state);

		// Log chip changes
		log("\n  Chip changes:");
		const totalChipsAfter = state.players.reduce((s, p) => s + (p.stack as number), 0);
		for (const p of state.players) {
			const pre = preStacks.get(p.userId) ?? 0;
			const post = p.stack as number;
			const diff = post - pre;
			const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
			log(`    ${playerName(p.userId).padEnd(10)} ${String(post).padStart(4)} chips (${diffStr})`);
		}
		log(`    ${"TOTAL".padEnd(10)} ${String(totalChipsAfter).padStart(4)} chips ${totalChipsAfter === totalChipsBefore ? "✓ CONSERVED" : `✗ MISMATCH (was ${totalChipsBefore})`}`);

		// Check for eliminated players
		const eliminated = state.players.filter((p) => (p.stack as number) === 0);
		if (eliminated.length > 0) {
			for (const p of eliminated) {
				log(`\n  ☠ ${playerName(p.userId)} eliminated!`);
			}
		}
	}

	// Final summary
	log("");
	logSeparator();
	log("  FINAL STANDINGS");
	logSeparator();
	const sorted = [...state.players].sort((a, b) => (b.stack as number) - (a.stack as number));
	for (let i = 0; i < sorted.length; i++) {
		const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
		log(`  ${medal} ${playerName(sorted[i].userId).padEnd(10)} ${sorted[i].stack as number} chips`);
	}
	logSeparator();
	log("");
}

main();
