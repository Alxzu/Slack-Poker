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

/** Shorthand card constructor: c("As") -> Ace of spades, c("10h") -> 10 of hearts */
function c(s: string): Card {
	const suitChar = s[s.length - 1];
	const rankStr = s.slice(0, -1);
	return { rank: rankStr as Card["rank"], suit: SUIT_MAP[suitChar] };
}

function cards(...strs: string[]): Card[] {
	return strs.map(c);
}

// ── High card edge cases ───────────────────────────────────────────

describe("hand evaluator edge cases", () => {
	describe("high card tiebreakers", () => {
		test("Ace-high beats King-high", () => {
			const aceHigh = evaluateHand(cards("As", "Kh", "Qd", "Jc", "9s"));
			const kingHigh = evaluateHand(cards("Kd", "Qc", "Js", "10h", "8d"));
			expect(aceHigh.rank).toBe(HandRank.HIGH_CARD);
			expect(kingHigh.rank).toBe(HandRank.HIGH_CARD);
			expect(compareHands(aceHigh, kingHigh)).toBe(1);
		});

		test("A-K-Q-J-9 beats A-K-Q-J-8 (5th kicker decides)", () => {
			const a = evaluateHand(cards("As", "Kh", "Qd", "Jc", "9s"));
			const b = evaluateHand(cards("Ad", "Kc", "Qs", "Jh", "8d"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("pair tiebreakers", () => {
		test("same pair, different kickers: pair of Aces with K beats pair of Aces with Q", () => {
			const aWithK = evaluateHand(cards("As", "Ah", "Kd", "5c", "3s"));
			const aWithQ = evaluateHand(cards("Ad", "Ac", "Qs", "5h", "3d"));
			expect(aWithK.rank).toBe(HandRank.PAIR);
			expect(aWithQ.rank).toBe(HandRank.PAIR);
			expect(compareHands(aWithK, aWithQ)).toBe(1);
		});

		test("same pair, same first kicker, second kicker decides", () => {
			const a = evaluateHand(cards("As", "Ah", "Kd", "Qc", "3s"));
			const b = evaluateHand(cards("Ad", "Ac", "Ks", "Jh", "3d"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("two pair tiebreakers", () => {
		test("Aces and Kings beats Aces and Queens", () => {
			const akk = evaluateHand(cards("As", "Ah", "Kd", "Kc", "2s"));
			const aqq = evaluateHand(cards("Ad", "Ac", "Qs", "Qh", "2d"));
			expect(akk.rank).toBe(HandRank.TWO_PAIR);
			expect(aqq.rank).toBe(HandRank.TWO_PAIR);
			expect(compareHands(akk, aqq)).toBe(1);
		});

		test("same two pairs, kicker decides", () => {
			const a = evaluateHand(cards("As", "Ah", "Kd", "Kc", "Qs"));
			const b = evaluateHand(cards("Ad", "Ac", "Ks", "Kh", "Jd"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("full house tiebreakers", () => {
		test("higher trips wins: KKK-22 beats QQQ-AA", () => {
			const kkk22 = evaluateHand(cards("Ks", "Kh", "Kd", "2c", "2s"));
			const qqqAA = evaluateHand(cards("Qs", "Qh", "Qd", "Ac", "Ah"));
			expect(kkk22.rank).toBe(HandRank.FULL_HOUSE);
			expect(qqqAA.rank).toBe(HandRank.FULL_HOUSE);
			expect(compareHands(kkk22, qqqAA)).toBe(1);
		});

		test("same trips, higher pair wins: AAA-KK beats AAA-QQ", () => {
			const aaakk = evaluateHand(cards("As", "Ah", "Ad", "Kc", "Ks"));
			const aaaqq = evaluateHand(cards("As", "Ah", "Ad", "Qc", "Qs"));
			expect(compareHands(aaakk, aaaqq)).toBe(1);
		});
	});

	describe("flush tiebreakers", () => {
		test("both flush, higher top card wins", () => {
			const a = evaluateHand(cards("As", "Js", "9s", "7s", "2s"));
			const b = evaluateHand(cards("Kh", "Jh", "9h", "7h", "2h"));
			expect(a.rank).toBe(HandRank.FLUSH);
			expect(b.rank).toBe(HandRank.FLUSH);
			expect(compareHands(a, b)).toBe(1);
		});

		test("both flush, same top card, second card decides", () => {
			const a = evaluateHand(cards("As", "Qs", "9s", "7s", "2s"));
			const b = evaluateHand(cards("Ah", "Jh", "9h", "7h", "2h"));
			expect(compareHands(a, b)).toBe(1);
		});

		test("identical flush values tie", () => {
			const a = evaluateHand(cards("As", "Qs", "9s", "7s", "2s"));
			const b = evaluateHand(cards("Ah", "Qh", "9h", "7h", "2h"));
			expect(compareHands(a, b)).toBe(0);
		});
	});

	describe("straight tiebreakers", () => {
		test("higher straight wins: 9-high beats 8-high", () => {
			const a = evaluateHand(cards("5s", "6h", "7d", "8c", "9s"));
			const b = evaluateHand(cards("4d", "5c", "6s", "7h", "8d"));
			expect(a.rank).toBe(HandRank.STRAIGHT);
			expect(b.rank).toBe(HandRank.STRAIGHT);
			expect(compareHands(a, b)).toBe(1);
		});

		test("same straight values tie", () => {
			const a = evaluateHand(cards("5s", "6h", "7d", "8c", "9s"));
			const b = evaluateHand(cards("5d", "6c", "7s", "8h", "9d"));
			expect(compareHands(a, b)).toBe(0);
		});

		test("broadway beats 9-high straight", () => {
			const broadway = evaluateHand(cards("10s", "Jh", "Qd", "Kc", "As"));
			const nineHigh = evaluateHand(cards("5d", "6c", "7s", "8h", "9d"));
			expect(compareHands(broadway, nineHigh)).toBe(1);
		});
	});

	describe("four of a kind tiebreakers", () => {
		test("higher quads win: KKKK beats QQQQ", () => {
			const a = evaluateHand(cards("Ks", "Kh", "Kd", "Kc", "2s"));
			const b = evaluateHand(cards("Qs", "Qh", "Qd", "Qc", "As"));
			expect(a.rank).toBe(HandRank.FOUR_OF_A_KIND);
			expect(b.rank).toBe(HandRank.FOUR_OF_A_KIND);
			expect(compareHands(a, b)).toBe(1);
		});

		test("same quads, kicker decides", () => {
			const a = evaluateHand(cards("9s", "9h", "9d", "9c", "As"));
			const b = evaluateHand(cards("9s", "9h", "9d", "9c", "Kh"));
			expect(compareHands(a, b)).toBe(1);
		});
	});

	describe("board plays (split pot scenario)", () => {
		test("when community cards are the best hand for both players", () => {
			// Board: A-K-Q-J-10 all different suits (broadway straight)
			// Player 1: 2h, 3h
			// Player 2: 4d, 5d
			// Both play the board straight
			const board = cards("10s", "Jh", "Qd", "Kc", "As");
			const p1Hand = evaluateHand([...cards("2h", "3h"), ...board]);
			const p2Hand = evaluateHand([...cards("4d", "5d"), ...board]);
			expect(p1Hand.rank).toBe(HandRank.STRAIGHT);
			expect(p2Hand.rank).toBe(HandRank.STRAIGHT);
			expect(compareHands(p1Hand, p2Hand)).toBe(0);
		});

		test("board has a flush, but player with same-suit card can beat it", () => {
			// Board: 2s, 5s, 8s, Js, 3h
			// Player 1: As, 4d (has flush with A high)
			// Player 2: Kd, Qd (plays board flush J-high)
			const board = cards("2s", "5s", "8s", "Js", "3h");
			const p1Hand = evaluateHand([...cards("As", "4d"), ...board]);
			const p2Hand = evaluateHand([...cards("Kd", "Qd"), ...board]);
			// P1 has a spade flush with Ace high, P2 has a spade flush with J high
			expect(p1Hand.rank).toBe(HandRank.FLUSH);
			expect(compareHands(p1Hand, p2Hand)).toBe(1);
		});
	});

	describe("7-card edge cases", () => {
		test("best 5 from 7 is not obvious: two pairs on board, player has a better pair", () => {
			// Board: KK-QQ-3
			// Player hole: AA
			// Best hand: AA-KK-Q (two pair Aces and Kings with Q kicker)
			// NOT KK-QQ-A (board two pair with A kicker)
			const board = cards("Ks", "Kh", "Qs", "Qh", "3d");
			const hole = cards("As", "Ah");
			const hand = evaluateHand([...hole, ...board]);
			expect(hand.rank).toBe(HandRank.TWO_PAIR);
			// Best two pair should be AA and KK, not KK and QQ
			expect(hand.tiebreakers[0]).toBe(14); // Aces as high pair
			expect(hand.tiebreakers[1]).toBe(13); // Kings as low pair
		});

		test("counterfeited two pair: player low two pair, board makes higher two pair", () => {
			// Player hole: 4s, 4h (pair of 4s)
			// Board: As, Ah, Ks, Kh, 2d
			// Board already has AA-KK. Player's 4s are irrelevant.
			// Best hand: AA-KK-4 (board two pair, 4 as kicker)
			const board = cards("As", "Ah", "Ks", "Kh", "2d");
			const hole = cards("4s", "4h");
			const hand = evaluateHand([...hole, ...board]);
			expect(hand.rank).toBe(HandRank.TWO_PAIR);
			expect(hand.tiebreakers[0]).toBe(14); // Aces
			expect(hand.tiebreakers[1]).toBe(13); // Kings
			// Kicker should be 4, not 2
			expect(hand.tiebreakers[2]).toBe(4);
		});

		test("multiple possible straights in 7 cards: picks the highest", () => {
			// Cards: 5, 6, 7, 8, 9, 10, K
			// Could make 5-6-7-8-9 (9 high) or 6-7-8-9-10 (10 high)
			// Should pick 6-7-8-9-10
			const hand = evaluateHand(
				cards("5s", "6h", "7d", "8c", "9s", "10h", "Kd"),
			);
			expect(hand.rank).toBe(HandRank.STRAIGHT);
			expect(hand.tiebreakers).toEqual([10]);
		});

		test("three pairs in 7 cards: picks best two pairs with best kicker", () => {
			// Hole: QQ, Board: JJ-88-A
			// Best hand: QQ-JJ-A (not JJ-88 or QQ-88)
			const board = cards("Js", "Jh", "8s", "8h", "Ad");
			const hole = cards("Qs", "Qh");
			const hand = evaluateHand([...hole, ...board]);
			expect(hand.rank).toBe(HandRank.TWO_PAIR);
			expect(hand.tiebreakers[0]).toBe(12); // Queens
			expect(hand.tiebreakers[1]).toBe(11); // Jacks
			expect(hand.tiebreakers[2]).toBe(14); // Ace kicker
		});
	});

	describe("steel wheel", () => {
		test("A-2-3-4-5 of same suit is straight flush, not royal flush", () => {
			const hand = evaluateHand(cards("Ah", "2h", "3h", "4h", "5h"));
			expect(hand.rank).toBe(HandRank.STRAIGHT_FLUSH);
			expect(hand.tiebreakers).toEqual([5]); // 5-high, not 14-high
			expect(hand.name).toBe("Straight Flush");
		});

		test("steel wheel beats regular straight", () => {
			const steelWheel = evaluateHand(cards("Ah", "2h", "3h", "4h", "5h"));
			const straight = evaluateHand(cards("As", "2d", "3c", "4h", "5s"));
			expect(compareHands(steelWheel, straight)).toBe(1);
		});

		test("steel wheel loses to higher straight flush", () => {
			const steelWheel = evaluateHand(cards("Ah", "2h", "3h", "4h", "5h"));
			const higherSF = evaluateHand(cards("6s", "7s", "8s", "9s", "10s"));
			expect(compareHands(steelWheel, higherSF)).toBe(-1);
		});
	});

	describe("7-card steel wheel", () => {
		test("finds steel wheel from 7 cards", () => {
			const hand = evaluateHand(
				cards("Ah", "2h", "3h", "4h", "5h", "Kd", "Qc"),
			);
			expect(hand.rank).toBe(HandRank.STRAIGHT_FLUSH);
			expect(hand.tiebreakers).toEqual([5]);
		});
	});

	describe("multiple possible straights in 7 cards", () => {
		test("with ace-high straight available, picks it over lower straight", () => {
			// 9, 10, J, Q, K, A, 2 -- picks 10-J-Q-K-A
			const hand = evaluateHand(
				cards("9s", "10h", "Jd", "Qc", "Ks", "Ah", "2d"),
			);
			expect(hand.rank).toBe(HandRank.STRAIGHT);
			expect(hand.tiebreakers).toEqual([14]);
		});

		test("wheel is only straight when high straight not possible", () => {
			// A, 2, 3, 4, 5, 8, K -- only A-2-3-4-5 forms a straight
			const hand = evaluateHand(
				cards("As", "2h", "3d", "4c", "5s", "8h", "Kd"),
			);
			expect(hand.rank).toBe(HandRank.STRAIGHT);
			expect(hand.tiebreakers).toEqual([5]);
		});
	});
});
