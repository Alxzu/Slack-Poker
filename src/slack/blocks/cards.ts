import type { Card } from "../../engine/types";

export function cardToEmoji(card: Card): string {
	return `:${card.suit}: ${card.rank}`;
}

export function cardsToString(cards: readonly Card[]): string {
	return cards.map(cardToEmoji).join("  ");
}

export function faceDownCards(count: number): string {
	return Array.from({ length: count }, () => ":black_square:").join(" ");
}
