import { describe, expect, test } from "bun:test";
import type {
	BettingRoundState,
	Card,
	GameState,
	PlayerState,
	SeatIndex,
} from "../../src/engine/types";
import { chips, handId, seatIndex } from "../../src/engine/types";

// ── Replicate serialization logic from game-manager.ts ───────────

function serializeState(state: GameState): string {
	const plain = {
		...state,
		betting: {
			...state.betting,
			actedThisRound: [...state.betting.actedThisRound],
		},
	};
	return JSON.stringify(plain);
}

function deserializeState(raw: string): GameState {
	const parsed = JSON.parse(raw);
	return {
		...parsed,
		betting: {
			...parsed.betting,
			actedThisRound: new Set<SeatIndex>(parsed.betting.actedThisRound),
		},
	} as GameState;
}

/** Roundtrip: serialize then deserialize. */
function roundtrip(state: GameState): GameState {
	return deserializeState(serializeState(state));
}

// ── Helpers ────────────────────────────────────────────────────────

function makePlayer(
	overrides: Partial<PlayerState> & { seat: number; userId: string },
): PlayerState {
	return {
		userId: overrides.userId,
		seat: seatIndex(overrides.seat),
		stack: chips(
			overrides.stack !== undefined ? (overrides.stack as number) : 1000,
		),
		bet: chips(overrides.bet !== undefined ? (overrides.bet as number) : 0),
		folded: overrides.folded ?? false,
		allIn: overrides.allIn ?? false,
		sittingOut: overrides.sittingOut ?? false,
		consecutiveTimeouts: overrides.consecutiveTimeouts ?? 0,
	};
}

function card(rank: Card["rank"], suit: Card["suit"]): Card {
	return { rank, suit };
}

function makeRound(
	overrides: Partial<BettingRoundState> = {},
): BettingRoundState {
	return {
		currentBet: overrides.currentBet ?? chips(0),
		minRaise: overrides.minRaise ?? chips(10),
		lastRaiserSeat: overrides.lastRaiserSeat ?? null,
		actedThisRound: overrides.actedThisRound ?? new Set(),
	};
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
	return {
		id: overrides.id ?? "test-game",
		phase: overrides.phase ?? "waiting",
		players: overrides.players ?? [],
		deck: overrides.deck ?? [],
		communityCards: overrides.communityCards ?? [],
		pots: overrides.pots ?? [],
		dealerSeat: overrides.dealerSeat ?? seatIndex(0),
		activeSeat: overrides.activeSeat ?? seatIndex(0),
		smallBlind: overrides.smallBlind ?? chips(5),
		bigBlind: overrides.bigBlind ?? chips(10),
		handId: overrides.handId ?? handId("test-hand"),
		handNumber: overrides.handNumber ?? 0,
		betting: overrides.betting ?? makeRound(),
	};
}

// ── Tests ─────────────────────────────────────────────────────────

describe("GameState serialization roundtrip", () => {
	test("Sets (actedThisRound) survive serialize/deserialize", () => {
		const acted = new Set<SeatIndex>([
			seatIndex(0),
			seatIndex(3),
			seatIndex(7),
		]);
		const state = makeGameState({
			betting: makeRound({ actedThisRound: acted }),
		});

		const result = roundtrip(state);

		expect(result.betting.actedThisRound).toBeInstanceOf(Set);
		expect(result.betting.actedThisRound.size).toBe(3);
		expect(result.betting.actedThisRound.has(seatIndex(0))).toBe(true);
		expect(result.betting.actedThisRound.has(seatIndex(3))).toBe(true);
		expect(result.betting.actedThisRound.has(seatIndex(7))).toBe(true);
	});

	test("branded types (Chips, SeatIndex) survive roundtrip", () => {
		const state = makeGameState({
			smallBlind: chips(5),
			bigBlind: chips(10),
			dealerSeat: seatIndex(3),
			activeSeat: seatIndex(5),
			players: [makePlayer({ userId: "alice", seat: 3, stack: chips(750) })],
		});

		const result = roundtrip(state);

		// Values preserved (branded types are just numbers at runtime)
		expect(result.smallBlind).toBe(5);
		expect(result.bigBlind).toBe(10);
		expect(result.dealerSeat).toBe(3);
		expect(result.activeSeat).toBe(5);
		expect(result.players[0].stack).toBe(750);
		expect(result.players[0].seat).toBe(3);
	});

	test("card arrays survive roundtrip", () => {
		const communityCards = [
			card("A", "spades"),
			card("K", "hearts"),
			card("10", "diamonds"),
			card("7", "clubs"),
			card("2", "spades"),
		];

		const deck = [
			card("3", "hearts"),
			card("4", "diamonds"),
			card("5", "clubs"),
		];

		const state = makeGameState({ communityCards, deck });
		const result = roundtrip(state);

		expect(result.communityCards).toEqual(communityCards);
		expect(result.deck).toEqual(deck);
		expect(result.communityCards.length).toBe(5);
		expect(result.deck.length).toBe(3);
	});

	test("empty game state works", () => {
		const state = makeGameState({
			players: [],
			deck: [],
			communityCards: [],
			pots: [],
			betting: makeRound({ actedThisRound: new Set() }),
		});

		const result = roundtrip(state);

		expect(result.players).toEqual([]);
		expect(result.deck).toEqual([]);
		expect(result.communityCards).toEqual([]);
		expect(result.pots).toEqual([]);
		expect(result.betting.actedThisRound).toBeInstanceOf(Set);
		expect(result.betting.actedThisRound.size).toBe(0);
	});

	test("full game state with all fields populated works", () => {
		const state = makeGameState({
			id: "game-abc123",
			phase: "flop",
			players: [
				makePlayer({
					userId: "alice",
					seat: 0,
					stack: chips(800),
					bet: chips(100),
					folded: false,
					allIn: false,
				}),
				makePlayer({
					userId: "bob",
					seat: 2,
					stack: chips(0),
					bet: chips(500),
					folded: false,
					allIn: true,
				}),
				makePlayer({
					userId: "charlie",
					seat: 5,
					stack: chips(700),
					bet: chips(100),
					folded: false,
					allIn: false,
				}),
				makePlayer({
					userId: "dave",
					seat: 7,
					stack: chips(900),
					bet: chips(0),
					folded: true,
					allIn: false,
				}),
			],
			deck: [card("J", "clubs"), card("Q", "spades"), card("3", "hearts")],
			communityCards: [
				card("A", "spades"),
				card("K", "hearts"),
				card("10", "diamonds"),
			],
			pots: [
				{
					amount: chips(1500),
					eligiblePlayers: [seatIndex(0), seatIndex(2), seatIndex(5)],
				},
				{
					amount: chips(800),
					eligiblePlayers: [seatIndex(0), seatIndex(5)],
				},
			],
			dealerSeat: seatIndex(0),
			activeSeat: seatIndex(5),
			smallBlind: chips(25),
			bigBlind: chips(50),
			handId: handId("hand-xyz789"),
			handNumber: 7,
			betting: makeRound({
				currentBet: chips(100),
				minRaise: chips(50),
				lastRaiserSeat: seatIndex(0),
				actedThisRound: new Set<SeatIndex>([seatIndex(0), seatIndex(2)]),
			}),
		});

		const result = roundtrip(state);

		// Core fields
		expect(result.id).toBe("game-abc123");
		expect(result.phase).toBe("flop");
		expect(result.handNumber).toBe(7);
		expect(result.handId).toBe("hand-xyz789");

		// Players
		expect(result.players.length).toBe(4);
		const bob = result.players.find((p) => p.userId === "bob");
		expect(bob).toBeDefined();
		expect(bob?.allIn).toBe(true);
		expect(bob?.stack).toBe(0);

		const dave = result.players.find((p) => p.userId === "dave");
		expect(dave).toBeDefined();
		expect(dave?.folded).toBe(true);

		// Pots
		expect(result.pots.length).toBe(2);
		expect(result.pots[0].amount).toBe(1500);
		expect(result.pots[1].eligiblePlayers.length).toBe(2);

		// Betting round
		expect(result.betting.currentBet).toBe(100);
		expect(result.betting.minRaise).toBe(50);
		expect(result.betting.lastRaiserSeat).toBe(0);
		expect(result.betting.actedThisRound).toBeInstanceOf(Set);
		expect(result.betting.actedThisRound.size).toBe(2);
	});

	test("serialized JSON is valid and parseable", () => {
		const state = makeGameState({
			betting: makeRound({
				actedThisRound: new Set<SeatIndex>([seatIndex(1), seatIndex(4)]),
			}),
		});

		const json = serializeState(state);

		// Should be valid JSON
		expect(() => JSON.parse(json)).not.toThrow();

		// actedThisRound should be an array in JSON (not a Set)
		const parsed = JSON.parse(json);
		expect(Array.isArray(parsed.betting.actedThisRound)).toBe(true);
		expect(parsed.betting.actedThisRound).toEqual([1, 4]);
	});
});
