import type { Card, EvaluatedHand } from "./types";
import { HandRank } from "./types";

// ── Rank utilities ──────────────────────────────────────────────────

const RANK_VALUE: Record<Rank, number> = {
	"2": 2,
	"3": 3,
	"4": 4,
	"5": 5,
	"6": 6,
	"7": 7,
	"8": 8,
	"9": 9,
	"10": 10,
	J: 11,
	Q: 12,
	K: 13,
	A: 14,
};

function rankValue(r: Rank): number {
	return RANK_VALUE[r];
}

// ── Internal helpers ────────────────────────────────────────────────

/** Group cards by rank, returning [rankValue, cards[]] sorted by group size desc, then rank desc */
function groupByRank(cards: Card[]): [number, Card[]][] {
	const map = new Map<number, Card[]>();
	for (const c of cards) {
		const v = rankValue(c.rank);
		const arr = map.get(v);
		if (arr) arr.push(c);
		else map.set(v, [c]);
	}
	return [...map.entries()].sort(
		(a, b) => b[1].length - a[1].length || b[0] - a[0],
	);
}

/** Check if 5 cards form a flush */
function isFlush(cards: Card[]): boolean {
	const s = cards[0].suit;
	return cards.every((c) => c.suit === s);
}

/**
 * Check if 5 sorted-by-rank cards form a straight.
 * Returns the high card value, or 0 if not a straight.
 * Handles the wheel (A-2-3-4-5) where high card is 5.
 */
function straightHighCard(cards: Card[]): number {
	const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);

	// Normal straight check
	if (values[0] - values[4] === 4 && new Set(values).size === 5) {
		return values[0];
	}

	// Wheel: A-2-3-4-5
	if (
		values[0] === 14 &&
		values[1] === 5 &&
		values[2] === 4 &&
		values[3] === 3 &&
		values[4] === 2
	) {
		return 5;
	}

	return 0;
}

// ── Five-card evaluation ────────────────────────────────────────────

function evaluateFive(cards: Card[]): EvaluatedHand {
	const flush = isFlush(cards);
	const sHigh = straightHighCard(cards);
	const straight = sHigh > 0;
	const groups = groupByRank(cards);

	// Straight flush / Royal flush
	if (flush && straight) {
		if (sHigh === 14) {
			return {
				rank: HandRank.ROYAL_FLUSH,
				name: "Royal Flush",
				bestFive: sortByRankDesc(cards),
				tiebreakers: [],
			};
		}
		return {
			rank: HandRank.STRAIGHT_FLUSH,
			name: "Straight Flush",
			bestFive: sortStraight(cards, sHigh),
			tiebreakers: [sHigh],
		};
	}

	// Four of a kind
	if (groups[0][1].length === 4) {
		const quadsRank = groups[0][0];
		const kicker = groups[1][0];
		return {
			rank: HandRank.FOUR_OF_A_KIND,
			name: "Four of a Kind",
			bestFive: [...groups[0][1], groups[1][1][0]],
			tiebreakers: [quadsRank, kicker],
		};
	}

	// Full house
	if (groups[0][1].length === 3 && groups[1][1].length === 2) {
		return {
			rank: HandRank.FULL_HOUSE,
			name: "Full House",
			bestFive: [...groups[0][1], ...groups[1][1]],
			tiebreakers: [groups[0][0], groups[1][0]],
		};
	}

	// Flush
	if (flush) {
		const sorted = sortByRankDesc(cards);
		return {
			rank: HandRank.FLUSH,
			name: "Flush",
			bestFive: sorted,
			tiebreakers: sorted.map((c) => rankValue(c.rank)),
		};
	}

	// Straight
	if (straight) {
		return {
			rank: HandRank.STRAIGHT,
			name: "Straight",
			bestFive: sortStraight(cards, sHigh),
			tiebreakers: [sHigh],
		};
	}

	// Three of a kind
	if (groups[0][1].length === 3) {
		const kickerGroups = groups.slice(1).sort((a, b) => b[0] - a[0]);
		const kickers = kickerGroups.map((g) => g[0]);
		return {
			rank: HandRank.THREE_OF_A_KIND,
			name: "Three of a Kind",
			bestFive: [...groups[0][1], ...kickerGroups.map((g) => g[1][0])],
			tiebreakers: [groups[0][0], ...kickers],
		};
	}

	// Two pair
	if (groups[0][1].length === 2 && groups[1][1].length === 2) {
		const highPair = Math.max(groups[0][0], groups[1][0]);
		const lowPair = Math.min(groups[0][0], groups[1][0]);
		const kicker = groups[2][0];
		const highPairCards =
			groups[0][0] === highPair ? groups[0][1] : groups[1][1];
		const lowPairCards = groups[0][0] === lowPair ? groups[0][1] : groups[1][1];
		return {
			rank: HandRank.TWO_PAIR,
			name: "Two Pair",
			bestFive: [...highPairCards, ...lowPairCards, groups[2][1][0]],
			tiebreakers: [highPair, lowPair, kicker],
		};
	}

	// Pair
	if (groups[0][1].length === 2) {
		const pairRank = groups[0][0];
		const kickerGroups = groups.slice(1).sort((a, b) => b[0] - a[0]);
		const kickers = kickerGroups.map((g) => g[0]);
		return {
			rank: HandRank.PAIR,
			name: "Pair",
			bestFive: [...groups[0][1], ...kickerGroups.map((g) => g[1][0])],
			tiebreakers: [pairRank, ...kickers],
		};
	}

	// High card
	const sorted = sortByRankDesc(cards);
	return {
		rank: HandRank.HIGH_CARD,
		name: "High Card",
		bestFive: sorted,
		tiebreakers: sorted.map((c) => rankValue(c.rank)),
	};
}

// ── Sorting helpers ─────────────────────────────────────────────────

function sortByRankDesc(cards: Card[]): Card[] {
	return [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
}

/** Sort cards for display in a straight, with the high card first.
 *  For a wheel, Ace goes last (plays as 1). */
function sortStraight(cards: Card[], highCard: number): Card[] {
	if (highCard === 5) {
		// Wheel: 5-4-3-2-A
		const ace = cards.find((c) => c.rank === "A") as Card;
		const rest = cards.filter((c) => c.rank !== "A");
		return [...sortByRankDesc(rest), ace];
	}
	return sortByRankDesc(cards);
}

// ── Combinations ────────────────────────────────────────────────────

function combinations5(cards: Card[]): Card[][] {
	const result: Card[][] = [];
	const n = cards.length;
	for (let i = 0; i < n - 4; i++) {
		for (let j = i + 1; j < n - 3; j++) {
			for (let k = j + 1; k < n - 2; k++) {
				for (let l = k + 1; l < n - 1; l++) {
					for (let m = l + 1; m < n; m++) {
						result.push([cards[i], cards[j], cards[k], cards[l], cards[m]]);
					}
				}
			}
		}
	}
	return result;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Evaluate the best 5-card poker hand from 5, 6, or 7 cards.
 */
export function evaluateHand(cards: Card[]): EvaluatedHand {
	if (cards.length < 5 || cards.length > 7) {
		throw new RangeError(`evaluateHand expects 5-7 cards, got ${cards.length}`);
	}

	if (cards.length === 5) {
		return evaluateFive(cards);
	}

	const combos = combinations5(cards);
	let best = evaluateFive(combos[0]);

	for (let i = 1; i < combos.length; i++) {
		const candidate = evaluateFive(combos[i]);
		if (compareHands(candidate, best) > 0) {
			best = candidate;
		}
	}

	return best;
}

/**
 * Compare two evaluated hands.
 * Returns 1 if a wins, -1 if b wins, 0 if tie.
 */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): -1 | 0 | 1 {
	if (a.rank !== b.rank) {
		return a.rank > b.rank ? 1 : -1;
	}

	const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
	for (let i = 0; i < len; i++) {
		const av = a.tiebreakers[i] ?? 0;
		const bv = b.tiebreakers[i] ?? 0;
		if (av !== bv) return av > bv ? 1 : -1;
	}

	return 0;
}
