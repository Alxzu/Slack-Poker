import { describe, expect, it } from "bun:test";
import { createDeck, deal, shuffle } from "../../src/engine/deck";

describe("createDeck", () => {
	it("returns exactly 52 cards", () => {
		const deck = createDeck();
		expect(deck).toHaveLength(52);
	});

	it("has no duplicate cards", () => {
		const deck = createDeck();
		const keys = deck.map((c) => `${c.rank}:${c.suit}`);
		const unique = new Set(keys);
		expect(unique.size).toBe(52);
	});

	it("has 13 cards per suit", () => {
		const deck = createDeck();
		const suitCounts = new Map<string, number>();
		for (const card of deck) {
			suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
		}
		expect(suitCounts.get("spades")).toBe(13);
		expect(suitCounts.get("hearts")).toBe(13);
		expect(suitCounts.get("diamonds")).toBe(13);
		expect(suitCounts.get("clubs")).toBe(13);
	});

	it("has 4 cards per rank", () => {
		const deck = createDeck();
		const rankCounts = new Map<string, number>();
		for (const card of deck) {
			rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
		}
		for (const [, count] of rankCounts) {
			expect(count).toBe(4);
		}
		expect(rankCounts.size).toBe(13);
	});
});

describe("shuffle", () => {
	it("returns 52 cards with no duplicates", () => {
		const deck = createDeck();
		const shuffled = shuffle(deck);
		expect(shuffled).toHaveLength(52);
		const keys = shuffled.map((c) => `${c.rank}:${c.suit}`);
		expect(new Set(keys).size).toBe(52);
	});

	it("does not mutate the original deck", () => {
		const deck = createDeck();
		const original = [...deck];
		shuffle(deck);
		expect(deck).toEqual(original);
	});

	it("produces different orderings (at least 9 of 10 shuffles differ from original)", () => {
		const deck = createDeck();
		const originalKey = deck.map((c) => `${c.rank}:${c.suit}`).join(",");
		let differentCount = 0;
		for (let i = 0; i < 10; i++) {
			const shuffled = shuffle(deck);
			const shuffledKey = shuffled.map((c) => `${c.rank}:${c.suit}`).join(",");
			if (shuffledKey !== originalKey) {
				differentCount++;
			}
		}
		expect(differentCount).toBeGreaterThanOrEqual(9);
	});
});

describe("deal", () => {
	it("deal(deck, 2) returns 2 dealt cards and 50 remaining", () => {
		const deck = createDeck();
		const { dealt, remaining } = deal(deck, 2);
		expect(dealt).toHaveLength(2);
		expect(remaining).toHaveLength(50);
	});

	it("deal(deck, 5) returns 5 dealt cards and 47 remaining", () => {
		const deck = createDeck();
		const { dealt, remaining } = deal(deck, 5);
		expect(dealt).toHaveLength(5);
		expect(remaining).toHaveLength(47);
	});

	it("dealt cards are removed from remaining", () => {
		const deck = createDeck();
		const { dealt, remaining } = deal(deck, 5);
		const dealtKeys = new Set(dealt.map((c) => `${c.rank}:${c.suit}`));
		for (const card of remaining) {
			expect(dealtKeys.has(`${card.rank}:${card.suit}`)).toBe(false);
		}
	});

	it("throws if count > deck length", () => {
		const deck = createDeck();
		expect(() => deal(deck, 53)).toThrow(RangeError);
	});
});
