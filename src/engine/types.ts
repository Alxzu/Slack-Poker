// Branded types — prevent mixing different numeric domains at compile time

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type Chips = Brand<number, "Chips">;
export type SeatIndex = Brand<number, "SeatIndex">;
export type HandId = Brand<string, "HandId">;

export const chips = (n: number): Chips => n as Chips;
export const seatIndex = (n: number): SeatIndex => {
	if (n < 0 || n > 7) throw new RangeError(`SeatIndex must be 0-7, got ${n}`);
	return n as SeatIndex;
};
export const handId = (s: string): HandId => s as HandId;

// Card types

export const RANKS = [
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"10",
	"J",
	"Q",
	"K",
	"A",
] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
	readonly rank: Rank;
	readonly suit: Suit;
}

// Hand evaluation

export enum HandRank {
	HIGH_CARD = 1,
	PAIR = 2,
	TWO_PAIR = 3,
	THREE_OF_A_KIND = 4,
	STRAIGHT = 5,
	FLUSH = 6,
	FULL_HOUSE = 7,
	FOUR_OF_A_KIND = 8,
	STRAIGHT_FLUSH = 9,
	ROYAL_FLUSH = 10,
}

export interface EvaluatedHand {
	readonly rank: HandRank;
	readonly name: string;
	readonly bestFive: readonly Card[];
	/** Comparable values for breaking ties within the same rank (descending priority) */
	readonly tiebreakers: readonly number[];
}

// Player actions

export type PokerAction =
	| { readonly type: "fold"; readonly playerId: string }
	| { readonly type: "check"; readonly playerId: string }
	| { readonly type: "call"; readonly playerId: string }
	| {
			readonly type: "raise";
			readonly playerId: string;
			readonly amount: Chips;
	  }
	| { readonly type: "allIn"; readonly playerId: string };

// Game phase

export type GamePhase =
	| "waiting"
	| "preflop"
	| "flop"
	| "turn"
	| "river"
	| "showdown"
	| "complete";

// Player state at the table

export interface PlayerState {
	readonly userId: string;
	readonly seat: SeatIndex;
	readonly stack: Chips;
	readonly bet: Chips;
	readonly folded: boolean;
	readonly allIn: boolean;
	readonly sittingOut: boolean;
	readonly consecutiveTimeouts: number;
}

// Pot

export interface Pot {
	readonly amount: Chips;
	readonly eligiblePlayers: readonly SeatIndex[];
}

// Betting round

export interface BettingRoundState {
	readonly currentBet: Chips;
	readonly minRaise: Chips;
	readonly lastRaiserSeat: SeatIndex | null;
	readonly actedThisRound: ReadonlySet<SeatIndex>;
	readonly raiseCount: number;
}

// Full game state

export interface GameState {
	readonly id: string;
	readonly phase: GamePhase;
	readonly players: readonly PlayerState[];
	readonly deck: readonly Card[];
	readonly communityCards: readonly Card[];
	readonly pots: readonly Pot[];
	readonly dealerSeat: SeatIndex;
	readonly activeSeat: SeatIndex;
	readonly smallBlind: Chips;
	readonly bigBlind: Chips;
	readonly handId: HandId;
	readonly handNumber: number;
	readonly betting: BettingRoundState;
}
