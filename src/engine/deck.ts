import type { Card } from "./types";
import { RANKS, SUITS } from "./types";

/**
 * Returns a standard 52-card deck.
 */
export function createDeck(): Card[] {
	const deck: Card[] = [];
	for (const suit of SUITS) {
		for (const rank of RANKS) {
			deck.push({ rank, suit });
		}
	}
	return deck;
}

/**
 * Fisher-Yates shuffle using crypto.getRandomValues() with rejection sampling.
 * Returns a NEW array — does not mutate the input.
 */
export function shuffle(deck: Card[]): Card[] {
	const result = [...deck];
	const n = result.length;
	if (n <= 1) return result;

	// Batch all random values in one call
	const randomValues = new Uint32Array(n);
	crypto.getRandomValues(randomValues);

	for (let i = n - 1; i > 0; i--) {
		// Rejection sampling to avoid modulo bias
		// We need a uniform random integer in [0, i]
		const range = i + 1;
		const limit = Math.floor(0x100000000 / range) * range; // largest multiple of range that fits in uint32

		let rand = randomValues[i];
		// If biased, resample (very rare)
		while (rand >= limit) {
			const extra = new Uint32Array(1);
			crypto.getRandomValues(extra);
			rand = extra[0];
		}

		const j = rand % range;
		// Swap
		const temp = result[i];
		result[i] = result[j];
		result[j] = temp;
	}

	return result;
}

/**
 * Deal `count` cards from the top of the deck.
 * Returns the dealt cards and the remaining deck.
 */
export function deal(
	deck: Card[],
	count: number,
): { dealt: Card[]; remaining: Card[] } {
	if (count > deck.length) {
		throw new RangeError(
			`Cannot deal ${count} cards from a deck of ${deck.length}`,
		);
	}
	return {
		dealt: deck.slice(0, count),
		remaining: deck.slice(count),
	};
}
