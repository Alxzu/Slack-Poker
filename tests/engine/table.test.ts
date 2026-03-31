import { describe, expect, test } from "bun:test";
import {
	applyAction,
	createGame,
	endHand,
	legalActions,
	removePlayer,
	resolveShowdown,
	startHand,
} from "../../src/engine/table";
import type {
	BettingRoundState,
	Card,
	GameState,
	PlayerState,
} from "../../src/engine/types";
import { chips, HandRank, handId, seatIndex } from "../../src/engine/types";

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

function card(rank: Card["rank"], suit: Card["suit"]): Card {
	return { rank, suit };
}

/** Find helper that throws instead of returning undefined, avoiding non-null assertions. */
function findOrThrow<T>(arr: readonly T[], pred: (item: T) => boolean): T {
	const found = arr.find(pred);
	if (found === undefined) throw new Error("Item not found in array");
	return found;
}

/** Build a deterministic game state for testing. */
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

/** Create a deck with specific cards on top followed by filler. */
function makeDeck(topCards: Card[]): Card[] {
	const allRanks: Card["rank"][] = [
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
	];
	const allSuits: Card["suit"][] = ["spades", "hearts", "diamonds", "clubs"];
	const full: Card[] = [];
	for (const suit of allSuits) {
		for (const rank of allRanks) {
			const isTop = topCards.some((c) => c.rank === rank && c.suit === suit);
			if (!isTop) {
				full.push({ rank, suit });
			}
		}
	}
	return [...topCards, ...full];
}

// ── createGame ─────────────────────────────────────────────────────

describe("createGame", () => {
	test("creates game with correct number of players", () => {
		const state = createGame(
			["alice", "bob", "charlie"],
			{ small: chips(5), big: chips(10) },
			chips(1000),
		);

		expect(state.players.length).toBe(3);
		expect(state.phase).toBe("waiting");
		expect(state.smallBlind).toBe(chips(5));
		expect(state.bigBlind).toBe(chips(10));
	});

	test("assigns unique seats to all players", () => {
		const state = createGame(
			["a", "b", "c", "d"],
			{ small: chips(5), big: chips(10) },
			chips(1000),
		);

		const seats = state.players.map((p) => p.seat as number);
		const uniqueSeats = new Set(seats);
		expect(uniqueSeats.size).toBe(4);
		for (const s of seats) {
			expect(s).toBeGreaterThanOrEqual(0);
			expect(s).toBeLessThanOrEqual(7);
		}
	});

	test("sets stacks to buyIn amount", () => {
		const state = createGame(
			["a", "b"],
			{ small: chips(5), big: chips(10) },
			chips(500),
		);

		for (const p of state.players) {
			expect(p.stack).toBe(chips(500));
		}
	});

	test("dealer seat is one of the player seats", () => {
		const state = createGame(
			["a", "b", "c"],
			{ small: chips(5), big: chips(10) },
			chips(1000),
		);

		const seats = state.players.map((p) => p.seat);
		expect(seats).toContain(state.dealerSeat);
	});

	test("throws for less than 2 players", () => {
		expect(() =>
			createGame(["a"], { small: chips(5), big: chips(10) }, chips(1000)),
		).toThrow("Need at least 2 players");
	});
});

// ── startHand ──────────────────────────────────────────────────────

describe("startHand", () => {
	test("posts blinds and deals cards", () => {
		const state = makeGameState({
			phase: "waiting",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(1000) }),
				makePlayer({ userId: "charlie", seat: 2, stack: chips(1000) }),
			],
			dealerSeat: seatIndex(0),
			smallBlind: chips(5),
			bigBlind: chips(10),
		});

		const result = startHand(state);
		const { state: newState, dealtCards } = result;

		expect(newState.phase).toBe("preflop");
		expect(newState.handNumber).toBe(1);

		// Each player gets 2 cards
		expect(dealtCards.size).toBe(3);
		for (const [, cards] of dealtCards) {
			expect(cards.length).toBe(2);
		}

		// Blinds posted: dealer=0, SB=1, BB=2
		const sb = findOrThrow(newState.players, (p) => (p.seat as number) === 1);
		const bb = findOrThrow(newState.players, (p) => (p.seat as number) === 2);
		expect(sb.bet).toBe(chips(5));
		expect(sb.stack).toBe(chips(995));
		expect(bb.bet).toBe(chips(10));
		expect(bb.stack).toBe(chips(990));

		// UTG is seat 0 (first after BB in 3-player game with dealer at seat 0)
		expect(newState.activeSeat).toBe(seatIndex(0));
	});

	test("heads-up: dealer = SB, dealer acts first preflop", () => {
		const state = makeGameState({
			phase: "waiting",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(1000) }),
			],
			dealerSeat: seatIndex(0),
			smallBlind: chips(5),
			bigBlind: chips(10),
		});

		const { state: newState } = startHand(state);

		// Dealer (seat 0) = SB
		const dealer = findOrThrow(
			newState.players,
			(p) => (p.seat as number) === 0,
		);
		expect(dealer.bet).toBe(chips(5)); // posted SB

		const opponent = findOrThrow(
			newState.players,
			(p) => (p.seat as number) === 1,
		);
		expect(opponent.bet).toBe(chips(10)); // posted BB

		// Dealer/SB acts first preflop in heads-up
		expect(newState.activeSeat).toBe(seatIndex(0));
	});
});

// ── applyAction ────────────────────────────────────────────────────

describe("applyAction", () => {
	test("fold marks player as folded and advances active seat", () => {
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(995),
					bet: chips(5),
				}),
				makePlayer({
					userId: "charlie",
					seat: 2,
					stack: chips(990),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
			deck: makeDeck([]),
		});

		const newState = applyAction(state, {
			type: "fold",
			playerId: "alice",
		});

		const alice = findOrThrow(newState.players, (p) => p.userId === "alice");
		expect(alice.folded).toBe(true);
		// Active seat advances to bob (seat 1)
		expect(newState.activeSeat).toBe(seatIndex(1));
	});

	test("call deducts correct amount", () => {
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(995),
					bet: chips(5),
				}),
				makePlayer({
					userId: "charlie",
					seat: 2,
					stack: chips(990),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
			deck: makeDeck([]),
		});

		const newState = applyAction(state, {
			type: "call",
			playerId: "alice",
		});

		const alice = findOrThrow(newState.players, (p) => p.userId === "alice");
		expect(alice.stack).toBe(chips(990));
		expect(alice.bet).toBe(chips(10));
	});

	test("raise updates currentBet and minRaise", () => {
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(995),
					bet: chips(5),
				}),
				makePlayer({
					userId: "charlie",
					seat: 2,
					stack: chips(990),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
			deck: makeDeck([]),
		});

		// Raise to 30 (put in 30 chips total: currentBet 10 + raise of 20)
		const newState = applyAction(state, {
			type: "raise",
			playerId: "alice",
			amount: chips(30),
		});

		expect(newState.betting.currentBet).toBe(chips(30));
		const alice = findOrThrow(newState.players, (p) => p.userId === "alice");
		expect(alice.stack).toBe(chips(970));
		expect(alice.bet).toBe(chips(30));
	});

	test("all fold to BB - BB wins pot", () => {
		// 3 players, preflop. UTG and SB fold, BB wins.
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(995),
					bet: chips(5),
				}),
				makePlayer({
					userId: "charlie",
					seat: 2,
					stack: chips(990),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
			deck: makeDeck([]),
		});

		// UTG folds
		let s = applyAction(state, { type: "fold", playerId: "alice" });
		// SB folds
		s = applyAction(s, { type: "fold", playerId: "bob" });

		// Charlie wins
		expect(s.phase).toBe("showdown");
		const charlie = findOrThrow(s.players, (p) => p.userId === "charlie");
		// Charlie gets the pot (5 + 10 = 15) added to stack
		expect(charlie.stack).toBe(chips(990 + 15));
	});
});

// ── Phase transitions ──────────────────────────────────────────────

describe("phase transitions", () => {
	function preflopCalledAround(): GameState {
		// Set up a state where preflop betting is about to complete
		// 2 players, heads-up. Dealer=SB=seat0, BB=seat1.
		// We'll manually construct the state right at preflop with proper deck.
		const topCards = [
			// Hole cards: alice gets Ah, Kh; bob gets Qd, Jd
			card("A", "hearts"),
			card("K", "hearts"),
			card("Q", "diamonds"),
			card("J", "diamonds"),
			// Flop: 10s, 9s, 8s
			card("10", "spades"),
			card("9", "spades"),
			card("8", "spades"),
			// Turn: 7c
			card("7", "clubs"),
			// River: 2c
			card("2", "clubs"),
		];

		return makeGameState({
			phase: "preflop",
			players: [
				makePlayer({
					userId: "alice",
					seat: 0,
					stack: chips(995),
					bet: chips(5),
				}),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(990),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0), // dealer/SB acts first heads-up
			dealerSeat: seatIndex(0),
			smallBlind: chips(5),
			bigBlind: chips(10),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
			deck: makeDeck(topCards).slice(4), // Remove dealt hole cards
		});
	}

	test("preflop → flop deals 3 community cards", () => {
		const state = preflopCalledAround();

		// SB calls (puts in 5 more to match BB of 10)
		let s = applyAction(state, { type: "call", playerId: "alice" });
		// BB checks
		s = applyAction(s, { type: "check", playerId: "bob" });

		expect(s.phase).toBe("flop");
		expect(s.communityCards.length).toBe(3);
	});

	test("flop → turn deals 1 card", () => {
		const state = makeGameState({
			phase: "flop",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(990) }),
			],
			activeSeat: seatIndex(1), // post-flop, first after dealer
			dealerSeat: seatIndex(0),
			communityCards: [
				card("10", "spades"),
				card("9", "spades"),
				card("8", "spades"),
			],
			betting: makeRound(),
			deck: makeDeck([card("7", "clubs"), card("2", "clubs")]),
		});

		// Both check
		let s = applyAction(state, { type: "check", playerId: "bob" });
		s = applyAction(s, { type: "check", playerId: "alice" });

		expect(s.phase).toBe("turn");
		expect(s.communityCards.length).toBe(4);
	});

	test("turn → river deals 1 card", () => {
		const state = makeGameState({
			phase: "turn",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(990) }),
			],
			activeSeat: seatIndex(1),
			dealerSeat: seatIndex(0),
			communityCards: [
				card("10", "spades"),
				card("9", "spades"),
				card("8", "spades"),
				card("7", "clubs"),
			],
			betting: makeRound(),
			deck: makeDeck([card("2", "clubs")]),
		});

		let s = applyAction(state, { type: "check", playerId: "bob" });
		s = applyAction(s, { type: "check", playerId: "alice" });

		expect(s.phase).toBe("river");
		expect(s.communityCards.length).toBe(5);
	});

	test("river → showdown after betting complete", () => {
		const state = makeGameState({
			phase: "river",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(990) }),
			],
			activeSeat: seatIndex(1),
			dealerSeat: seatIndex(0),
			communityCards: [
				card("10", "spades"),
				card("9", "spades"),
				card("8", "spades"),
				card("7", "clubs"),
				card("2", "clubs"),
			],
			betting: makeRound(),
			deck: makeDeck([]),
		});

		let s = applyAction(state, { type: "check", playerId: "bob" });
		s = applyAction(s, { type: "check", playerId: "alice" });

		expect(s.phase).toBe("showdown");
	});
});

// ── All-in auto-deal ───────────────────────────────────────────────

describe("all-in auto-deal", () => {
	test("both players all-in preflop → all 5 community cards dealt", () => {
		const topCards = [
			card("10", "spades"),
			card("9", "spades"),
			card("8", "spades"),
			card("7", "clubs"),
			card("2", "clubs"),
		];

		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({
					userId: "alice",
					seat: 0,
					stack: chips(990),
					bet: chips(10),
				}),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(990),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			betting: makeRound({
				currentBet: chips(10),
				minRaise: chips(10),
				actedThisRound: new Set([seatIndex(1)]),
			}),
			deck: makeDeck(topCards),
		});

		// Alice goes all-in
		let s = applyAction(state, { type: "allIn", playerId: "alice" });
		// Bob calls all-in
		s = applyAction(s, { type: "allIn", playerId: "bob" });

		expect(s.phase).toBe("showdown");
		expect(s.communityCards.length).toBe(5);
	});
});

// ── Showdown ───────────────────────────────────────────────────────

describe("resolveShowdown", () => {
	test("correct hand evaluation and pot distribution", () => {
		const dealtCards = new Map<string, readonly Card[]>();
		// Alice: Ah, Kh (will make a pair of Aces)
		dealtCards.set("alice", [card("A", "hearts"), card("K", "hearts")]);
		// Bob: 2d, 3d (weak hand)
		dealtCards.set("bob", [card("2", "diamonds"), card("3", "diamonds")]);

		const state = makeGameState({
			phase: "showdown",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(0) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(0) }),
			],
			communityCards: [
				card("A", "spades"),
				card("7", "clubs"),
				card("9", "hearts"),
				card("J", "spades"),
				card("4", "clubs"),
			],
			pots: [
				{
					amount: chips(200),
					eligiblePlayers: [seatIndex(0), seatIndex(1)],
				},
			],
		});

		const { state: finalState, results } = resolveShowdown(state, dealtCards);

		// Alice should win with pair of Aces
		const aliceResult = findOrThrow(results, (r) => r.userId === "alice");
		expect(aliceResult.hand.rank).toBe(HandRank.PAIR);
		expect(aliceResult.payout).toBe(chips(200));

		const bobResult = findOrThrow(results, (r) => r.userId === "bob");
		expect(bobResult.payout).toBe(chips(0));

		// Alice's stack should be updated
		const alice = findOrThrow(finalState.players, (p) => p.userId === "alice");
		expect(alice.stack).toBe(chips(200));
	});
});

// ── Side pots ──────────────────────────────────────────────────────

describe("side pots", () => {
	test("3 players, short stack all-in → correct pot distribution", () => {
		const dealtCards = new Map<string, readonly Card[]>();
		// Charlie (short stack) has best hand
		dealtCards.set("charlie", [card("A", "hearts"), card("A", "diamonds")]);
		// Alice has second best
		dealtCards.set("alice", [card("K", "hearts"), card("K", "diamonds")]);
		// Bob has worst
		dealtCards.set("bob", [card("2", "hearts"), card("3", "hearts")]);

		// Charlie all-in for 100, Alice and Bob bet 200 each
		const state = makeGameState({
			phase: "showdown",
			players: [
				makePlayer({
					userId: "alice",
					seat: 0,
					stack: chips(0),
					bet: chips(200),
				}),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(0),
					bet: chips(200),
				}),
				makePlayer({
					userId: "charlie",
					seat: 2,
					stack: chips(0),
					bet: chips(100),
					allIn: true,
				}),
			],
			communityCards: [
				card("5", "spades"),
				card("7", "clubs"),
				card("9", "hearts"),
				card("J", "spades"),
				card("4", "clubs"),
			],
			// pots calculated from bets
			pots: [
				{
					// Main pot: 100 * 3 = 300 (charlie eligible)
					amount: chips(300),
					eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
				},
				{
					// Side pot: 100 * 2 = 200 (only alice and bob)
					amount: chips(200),
					eligiblePlayers: [seatIndex(0), seatIndex(1)],
				},
			],
		});

		const { results } = resolveShowdown(state, dealtCards);

		// Charlie wins main pot (300) with pair of Aces
		const charlieResult = findOrThrow(results, (r) => r.userId === "charlie");
		expect(charlieResult.payout).toBe(chips(300));

		// Alice wins side pot (200) with pair of Kings
		const aliceResult = findOrThrow(results, (r) => r.userId === "alice");
		expect(aliceResult.payout).toBe(chips(200));

		// Bob gets nothing
		const bobResult = findOrThrow(results, (r) => r.userId === "bob");
		expect(bobResult.payout).toBe(chips(0));
	});
});

// ── endHand ────────────────────────────────────────────────────────

describe("endHand", () => {
	test("removes busted players (0 chips)", () => {
		const state = makeGameState({
			phase: "showdown",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(2000) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(0) }),
				makePlayer({ userId: "charlie", seat: 2, stack: chips(500) }),
			],
			dealerSeat: seatIndex(0),
		});

		const newState = endHand(state);
		expect(newState.players.length).toBe(2);
		expect(newState.players.find((p) => p.userId === "bob")).toBeUndefined();
		expect(newState.phase).toBe("waiting");
	});

	test("game ends when only 1 player remains", () => {
		const state = makeGameState({
			phase: "showdown",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(2000) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(0) }),
			],
			dealerSeat: seatIndex(0),
		});

		const newState = endHand(state);
		expect(newState.phase).toBe("complete");
		expect(newState.players.length).toBe(1);
		expect(newState.players[0].userId).toBe("alice");
	});

	test("rotates dealer after hand", () => {
		const state = makeGameState({
			phase: "showdown",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({ userId: "bob", seat: 2, stack: chips(1000) }),
				makePlayer({ userId: "charlie", seat: 5, stack: chips(1000) }),
			],
			dealerSeat: seatIndex(0),
		});

		const newState = endHand(state);
		expect(newState.dealerSeat).toBe(seatIndex(2));
	});
});

// ── removePlayer ───────────────────────────────────────────────────

describe("removePlayer", () => {
	test("removes player and ends game if < 2 remain", () => {
		const state = makeGameState({
			phase: "waiting",
			players: [
				makePlayer({ userId: "alice", seat: 0 }),
				makePlayer({ userId: "bob", seat: 1 }),
			],
		});

		const newState = removePlayer(state, "bob");
		expect(newState.players.length).toBe(1);
		expect(newState.phase).toBe("complete");
	});

	test("folds player mid-hand before removing", () => {
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({ userId: "alice", seat: 0 }),
				makePlayer({ userId: "bob", seat: 1 }),
				makePlayer({ userId: "charlie", seat: 2 }),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
		});

		const newState = removePlayer(state, "alice");
		expect(newState.players.length).toBe(2);
		// Alice should not be in the players list
		expect(newState.players.find((p) => p.userId === "alice")).toBeUndefined();
	});
});

// ── legalActions ───────────────────────────────────────────────────

describe("legalActions", () => {
	test("returns fold and call when there is a bet to match", () => {
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(995),
					bet: chips(5),
				}),
				makePlayer({
					userId: "charlie",
					seat: 2,
					stack: chips(990),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
		});

		const actions = legalActions(state, "alice");
		const types = actions.map((a) => a.type);

		expect(types).toContain("fold");
		expect(types).toContain("call");
		expect(types).toContain("allIn");
		expect(types).toContain("raise");
		expect(types).not.toContain("check");
	});

	test("returns fold and check when no bet to match", () => {
		const state = makeGameState({
			phase: "flop",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(990) }),
			],
			activeSeat: seatIndex(0),
			betting: makeRound({ currentBet: chips(0), minRaise: chips(10) }),
		});

		const actions = legalActions(state, "alice");
		const types = actions.map((a) => a.type);

		expect(types).toContain("fold");
		expect(types).toContain("check");
		expect(types).not.toContain("call");
	});

	test("returns empty for player not at active seat", () => {
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({ userId: "alice", seat: 0 }),
				makePlayer({ userId: "bob", seat: 1 }),
			],
			activeSeat: seatIndex(0),
		});

		const actions = legalActions(state, "bob");
		expect(actions.length).toBe(0);
	});

	test("returns empty in non-betting phase", () => {
		const state = makeGameState({
			phase: "showdown",
			players: [makePlayer({ userId: "alice", seat: 0 })],
			activeSeat: seatIndex(0),
		});

		const actions = legalActions(state, "alice");
		expect(actions.length).toBe(0);
	});
});

// ── Full hand integration ──────────────────────────────────────────

describe("full hand integration", () => {
	test("complete hand from start to showdown", () => {
		// Create game
		const game = makeGameState({
			phase: "waiting",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(1000) }),
			],
			dealerSeat: seatIndex(0),
			smallBlind: chips(5),
			bigBlind: chips(10),
		});

		// Start hand
		const { state: preflop, dealtCards } = startHand(game);
		expect(preflop.phase).toBe("preflop");
		expect(dealtCards.size).toBe(2);

		// Heads-up: SB/dealer (seat 0) acts first
		expect(preflop.activeSeat).toBe(seatIndex(0));

		// SB calls
		let s = applyAction(preflop, { type: "call", playerId: "alice" });
		// BB checks
		s = applyAction(s, { type: "check", playerId: "bob" });
		expect(s.phase).toBe("flop");
		expect(s.communityCards.length).toBe(3);

		// Flop: both check (post-flop: first after dealer acts first)
		s = applyAction(s, { type: "check", playerId: "bob" });
		s = applyAction(s, { type: "check", playerId: "alice" });
		expect(s.phase).toBe("turn");
		expect(s.communityCards.length).toBe(4);

		// Turn: both check
		s = applyAction(s, { type: "check", playerId: "bob" });
		s = applyAction(s, { type: "check", playerId: "alice" });
		expect(s.phase).toBe("river");
		expect(s.communityCards.length).toBe(5);

		// River: both check
		s = applyAction(s, { type: "check", playerId: "bob" });
		s = applyAction(s, { type: "check", playerId: "alice" });
		expect(s.phase).toBe("showdown");

		// Resolve showdown
		const { state: afterShowdown, results } = resolveShowdown(s, dealtCards);
		expect(results.length).toBe(2);

		// One player should have won something
		const totalPayout = results.reduce(
			(sum, r) => sum + (r.payout as number),
			0,
		);
		expect(totalPayout).toBe(20); // 5 + 5 (SB called to 10, BB already had 10) = pot of 20

		// End hand
		const afterEnd = endHand(afterShowdown);
		expect(afterEnd.phase).toBe("waiting");
		// Total chips should be conserved
		const totalChips = afterEnd.players.reduce(
			(sum, p) => sum + (p.stack as number),
			0,
		);
		expect(totalChips).toBe(2000);
	});
});
