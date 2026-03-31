import { describe, expect, test } from "bun:test";
import { compareHands, evaluateHand } from "../../src/engine/hand-evaluator";
import type { Card, Suit } from "../../src/engine/types";
import { HandRank } from "../../src/engine/types";

// ── Helper ──────────────────────────────────────────────────────────

const SUIT_MAP: Record<string, Suit> = {
	s: "spades",
	h: "hearts",
	d: "diamonds",
	c: "clubs",
};

/** Shorthand card constructor: c("As") → Ace of spades, c("10h") → 10 of hearts */
function c(s: string): Card {
	const suitChar = s[s.length - 1];
	const rankStr = s.slice(0, -1);
	return { rank: rankStr as Card["rank"], suit: SUIT_MAP[suitChar] };
}

/** Create multiple cards at once */
function cards(...strs: string[]): Card[] {
	return strs.map(c);
}

// ── Hand ranking tests ──────────────────────────────────────────────

describe("evaluateHand", () => {
	describe("Royal Flush", () => {
		test("detects royal flush", () => {
			const hand = evaluateHand(cards("10s", "Js", "Qs", "Ks", "As"));
			expect(hand.rank).toBe(HandRank.ROYAL_FLUSH);
			expect(hand.name).toBe("Royal Flush");
			expect(hand.tiebreakers).toEqual([]);
		});

		test("all royal flushes tie", () => {
			const a = evaluateHand(cards("10s", "Js", "Qs", "Ks", "As"));
			const b = evaluateHand(cards("10h", "Jh", "Qh", "Kh", "Ah"));
			expect(compareHands(a, b)).toBe(0);
		});
	});

	describe("Straight Flush", () => {
		test("detects straight flush", () => {
			const hand = evaluateHand(cards("5h", "6h", "7h", "8h", "9h"));
			expect(hand.rank).toBe(HandRank.STRAIGHT_FLUSH);
			expect(hand.tiebreakers).toEqual([9]);
		});

		test("wheel straight flush (A-2-3-4-5)", () => {
			const hand = evaluateHand(cards("Ah", "2h", "3h", "4h", "5h"));
			expect(hand.rank).toBe(HandRank.STRAIGHT_FLUSH);
			expect(hand.tiebreakers).toEqual([5]);
		});

		test("higher straight flush beats lower", () => {
			const a = evaluateHand(cards("6h", "7h", "8h", "9h", "10h"));
			const b = evaluateHand(cards("5h", "6h", "7h", "8h", "9h"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("Four of a Kind", () => {
		test("detects four of a kind", () => {
			const hand = evaluateHand(cards("9s", "9h", "9d", "9c", "Ks"));
			expect(hand.rank).toBe(HandRank.FOUR_OF_A_KIND);
			expect(hand.tiebreakers).toEqual([9, 13]);
		});

		test("higher quads beat lower quads", () => {
			const a = evaluateHand(cards("Ks", "Kh", "Kd", "Kc", "2s"));
			const b = evaluateHand(cards("Qs", "Qh", "Qd", "Qc", "As"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("same quads, higher kicker wins", () => {
			const a = evaluateHand(cards("9s", "9h", "9d", "9c", "As"));
			const b = evaluateHand(cards("9s", "9h", "9d", "9c", "Ks"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("Full House", () => {
		test("detects full house", () => {
			const hand = evaluateHand(cards("Ks", "Kh", "Kd", "7c", "7s"));
			expect(hand.rank).toBe(HandRank.FULL_HOUSE);
			expect(hand.tiebreakers).toEqual([13, 7]);
		});

		test("higher trips wins", () => {
			const a = evaluateHand(cards("As", "Ah", "Ad", "2c", "2s"));
			const b = evaluateHand(cards("Ks", "Kh", "Kd", "Qc", "Qs"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("same trips, higher pair wins", () => {
			const a = evaluateHand(cards("Ks", "Kh", "Kd", "Qc", "Qs"));
			const b = evaluateHand(cards("Ks", "Kh", "Kd", "Jc", "Js"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("Flush", () => {
		test("detects flush", () => {
			const hand = evaluateHand(cards("2s", "5s", "8s", "Js", "As"));
			expect(hand.rank).toBe(HandRank.FLUSH);
			expect(hand.tiebreakers).toEqual([14, 11, 8, 5, 2]);
		});

		test("higher flush kicker wins", () => {
			const a = evaluateHand(cards("2s", "5s", "8s", "Js", "As"));
			const b = evaluateHand(cards("2h", "5h", "8h", "Jh", "Kh"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("flush comparison goes to 2nd kicker", () => {
			const a = evaluateHand(cards("2s", "5s", "8s", "Qs", "As"));
			const b = evaluateHand(cards("2h", "5h", "8h", "Jh", "Ah"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("Straight", () => {
		test("detects straight", () => {
			const hand = evaluateHand(cards("5s", "6h", "7d", "8c", "9s"));
			expect(hand.rank).toBe(HandRank.STRAIGHT);
			expect(hand.tiebreakers).toEqual([9]);
		});

		test("wheel straight (A-2-3-4-5)", () => {
			const hand = evaluateHand(cards("As", "2h", "3d", "4c", "5s"));
			expect(hand.rank).toBe(HandRank.STRAIGHT);
			expect(hand.tiebreakers).toEqual([5]);
		});

		test("broadway straight (10-J-Q-K-A)", () => {
			const hand = evaluateHand(cards("10s", "Jh", "Qd", "Kc", "As"));
			expect(hand.rank).toBe(HandRank.STRAIGHT);
			expect(hand.tiebreakers).toEqual([14]);
		});

		test("higher straight wins", () => {
			const a = evaluateHand(cards("6s", "7h", "8d", "9c", "10s"));
			const b = evaluateHand(cards("5s", "6h", "7d", "8c", "9s"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("wheel loses to 2-3-4-5-6", () => {
			const a = evaluateHand(cards("2s", "3h", "4d", "5c", "6s"));
			const b = evaluateHand(cards("As", "2h", "3d", "4c", "5s"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("Three of a Kind", () => {
		test("detects three of a kind", () => {
			const hand = evaluateHand(cards("7s", "7h", "7d", "Kc", "2s"));
			expect(hand.rank).toBe(HandRank.THREE_OF_A_KIND);
			expect(hand.tiebreakers).toEqual([7, 13, 2]);
		});

		test("higher trips wins", () => {
			const a = evaluateHand(cards("Qs", "Qh", "Qd", "3c", "2s"));
			const b = evaluateHand(cards("Js", "Jh", "Jd", "Ac", "Ks"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("same trips, higher kicker wins", () => {
			const a = evaluateHand(cards("7s", "7h", "7d", "Ac", "2s"));
			const b = evaluateHand(cards("7s", "7h", "7d", "Kc", "2s"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("Two Pair", () => {
		test("detects two pair", () => {
			const hand = evaluateHand(cards("Ks", "Kh", "5d", "5c", "As"));
			expect(hand.rank).toBe(HandRank.TWO_PAIR);
			expect(hand.tiebreakers).toEqual([13, 5, 14]);
		});

		test("higher top pair wins", () => {
			const a = evaluateHand(cards("As", "Ah", "3d", "3c", "2s"));
			const b = evaluateHand(cards("Ks", "Kh", "Qd", "Qc", "As"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("same top pair, higher bottom pair wins", () => {
			const a = evaluateHand(cards("As", "Ah", "Qd", "Qc", "2s"));
			const b = evaluateHand(cards("As", "Ah", "Jd", "Jc", "Ks"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("same pairs, higher kicker wins", () => {
			const a = evaluateHand(cards("As", "Ah", "Qd", "Qc", "Ks"));
			const b = evaluateHand(cards("As", "Ah", "Qd", "Qc", "Js"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("Pair", () => {
		test("detects pair", () => {
			const hand = evaluateHand(cards("Js", "Jh", "Ad", "Kc", "2s"));
			expect(hand.rank).toBe(HandRank.PAIR);
			expect(hand.tiebreakers).toEqual([11, 14, 13, 2]);
		});

		test("higher pair wins", () => {
			const a = evaluateHand(cards("As", "Ah", "2d", "3c", "4s"));
			const b = evaluateHand(cards("Ks", "Kh", "Qd", "Jc", "10s"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("same pair, higher kicker wins", () => {
			const a = evaluateHand(cards("Js", "Jh", "Ad", "3c", "2s"));
			const b = evaluateHand(cards("Js", "Jh", "Kd", "Qc", "10s"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("High Card", () => {
		test("detects high card", () => {
			const hand = evaluateHand(cards("2s", "5h", "8d", "Jc", "As"));
			expect(hand.rank).toBe(HandRank.HIGH_CARD);
			expect(hand.tiebreakers).toEqual([14, 11, 8, 5, 2]);
		});

		test("higher card wins", () => {
			const a = evaluateHand(cards("2s", "5h", "8d", "Jc", "As"));
			const b = evaluateHand(cards("2h", "5d", "8c", "Js", "Kh"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("comparison cascades to lower kickers", () => {
			const a = evaluateHand(cards("3s", "5h", "8d", "Jc", "As"));
			const b = evaluateHand(cards("2h", "5d", "8c", "Js", "Ah"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	// ── 7-card evaluation ─────────────────────────────────────────────

	describe("7-card evaluation", () => {
		test("picks best 5 from 7 cards", () => {
			// Has a flush in spades: 2s 5s 8s Js As + two off-suit cards
			const hand = evaluateHand(
				cards("2s", "5s", "8s", "Js", "As", "3h", "Kd"),
			);
			expect(hand.rank).toBe(HandRank.FLUSH);
			expect(hand.bestFive.length).toBe(5);
		});

		test("picks royal flush from 7 cards", () => {
			const hand = evaluateHand(
				cards("2c", "3d", "10s", "Js", "Qs", "Ks", "As"),
			);
			expect(hand.rank).toBe(HandRank.ROYAL_FLUSH);
		});

		test("picks full house over two pair from 7 cards", () => {
			const hand = evaluateHand(
				cards("Ks", "Kh", "Kd", "7c", "7s", "2d", "3c"),
			);
			expect(hand.rank).toBe(HandRank.FULL_HOUSE);
			expect(hand.tiebreakers).toEqual([13, 7]);
		});

		test("picks straight from 7 cards", () => {
			const hand = evaluateHand(
				cards("3s", "4h", "5d", "6c", "7s", "Jd", "Kc"),
			);
			expect(hand.rank).toBe(HandRank.STRAIGHT);
			expect(hand.tiebreakers).toEqual([7]);
		});

		test("picks best pair kickers from 7", () => {
			const hand = evaluateHand(
				cards("As", "Ah", "Kd", "Qc", "Js", "3d", "2c"),
			);
			expect(hand.rank).toBe(HandRank.PAIR);
			expect(hand.tiebreakers).toEqual([14, 13, 12, 11]);
		});
	});

	// ── 6-card evaluation ─────────────────────────────────────────────

	describe("6-card evaluation", () => {
		test("picks best 5 from 6 cards", () => {
			const hand = evaluateHand(cards("9s", "9h", "9d", "9c", "As", "Kh"));
			expect(hand.rank).toBe(HandRank.FOUR_OF_A_KIND);
			expect(hand.tiebreakers).toEqual([9, 14]);
		});
	});

	// ── compareHands ────────────────────────────────────────────────

	describe("compareHands", () => {
		test("higher rank always wins", () => {
			const pair = evaluateHand(cards("As", "Ah", "Kd", "Qc", "Js"));
			const trips = evaluateHand(cards("2s", "2h", "2d", "3c", "4s"));
			expect(compareHands(trips, pair)).toBe(1);
			expect(compareHands(pair, trips)).toBe(-1);
		});

		test("flush beats straight", () => {
			const flush = evaluateHand(cards("2s", "4s", "6s", "8s", "10s"));
			const straight = evaluateHand(cards("5s", "6h", "7d", "8c", "9s"));
			expect(compareHands(flush, straight)).toBe(1);
		});

		test("identical hands return 0 (split pot)", () => {
			const a = evaluateHand(cards("5s", "6h", "7d", "8c", "9s"));
			const b = evaluateHand(cards("5d", "6c", "7s", "8h", "9d"));
			expect(compareHands(a, b)).toBe(0);
		});

		test("all hand ranks in correct order", () => {
			const hands = [
				evaluateHand(cards("2s", "5h", "8d", "Jc", "As")), // high card
				evaluateHand(cards("As", "Ah", "2d", "3c", "5s")), // pair
				evaluateHand(cards("As", "Ah", "Kd", "Kc", "2s")), // two pair
				evaluateHand(cards("7s", "7h", "7d", "Kc", "2s")), // trips
				evaluateHand(cards("5s", "6h", "7d", "8c", "9s")), // straight
				evaluateHand(cards("2s", "4s", "6s", "8s", "As")), // flush
				evaluateHand(cards("Ks", "Kh", "Kd", "7c", "7s")), // full house
				evaluateHand(cards("9s", "9h", "9d", "9c", "Ks")), // quads
				evaluateHand(cards("5h", "6h", "7h", "8h", "9h")), // straight flush
				evaluateHand(cards("10s", "Js", "Qs", "Ks", "As")), // royal flush
			];

			for (let i = 0; i < hands.length - 1; i++) {
				expect(compareHands(hands[i], hands[i + 1])).toBe(-1);
				expect(compareHands(hands[i + 1], hands[i])).toBe(1);
			}
		});
	});

	// ── Edge cases ──────────────────────────────────────────────────

	describe("edge cases", () => {
		test("throws on fewer than 5 cards", () => {
			expect(() => evaluateHand(cards("As", "Ah", "Kd", "Qc"))).toThrow(
				RangeError,
			);
		});

		test("throws on more than 7 cards", () => {
			expect(() =>
				evaluateHand(cards("As", "Ah", "Kd", "Qc", "Js", "10s", "9s", "8s")),
			).toThrow(RangeError);
		});

		test("broadway straight is not a flush", () => {
			const hand = evaluateHand(cards("10s", "Jh", "Qd", "Kc", "As"));
			expect(hand.rank).toBe(HandRank.STRAIGHT);
		});

		test("non-consecutive same-suit is flush not straight flush", () => {
			const hand = evaluateHand(cards("2h", "4h", "6h", "8h", "10h"));
			expect(hand.rank).toBe(HandRank.FLUSH);
		});
	});
});
