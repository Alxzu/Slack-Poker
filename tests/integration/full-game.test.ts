import { describe, expect, test } from "bun:test";
import {
	applyAction,
	endHand,
	legalActions,
	resolveShowdown,
	startHand,
} from "../../src/engine/table";
import type {
	BettingRoundState,
	Card,
	GameState,
	PlayerState,
} from "../../src/engine/types";
import { chips, handId, seatIndex } from "../../src/engine/types";

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

function findOrThrow<T>(arr: readonly T[], pred: (item: T) => boolean): T {
	const found = arr.find(pred);
	if (found === undefined) throw new Error("Item not found in array");
	return found;
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

/** Total chips across all players. */
function totalChips(players: readonly PlayerState[]): number {
	return players.reduce(
		(sum, p) => sum + (p.stack as number) + (p.bet as number),
		0,
	);
}

// ── Complete 2-player heads-up game ──────────────────────────────

describe("Complete 2-player heads-up game", () => {
	test("full hand: blinds, calls, check through all streets, showdown, chip conservation", () => {
		const game = makeGameState({
			phase: "waiting",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(500) }),
				makePlayer({ userId: "bob", seat: 1, stack: chips(500) }),
			],
			dealerSeat: seatIndex(0),
			smallBlind: chips(5),
			bigBlind: chips(10),
		});

		// Start hand
		const { state: preflop, dealtCards } = startHand(game);
		expect(preflop.phase).toBe("preflop");
		expect(dealtCards.size).toBe(2);

		// Verify blinds posted
		const sbPlayer = findOrThrow(
			preflop.players,
			(p) => p.seat === preflop.dealerSeat,
		);
		expect(sbPlayer.bet).toBe(chips(5)); // dealer is SB in heads-up

		// Each player got 2 cards
		for (const [, cards] of dealtCards) {
			expect(cards.length).toBe(2);
		}

		// Chips conserved after blinds
		expect(totalChips(preflop.players)).toBe(1000);

		// SB calls (heads-up: dealer/SB acts first preflop)
		let s = applyAction(preflop, { type: "call", playerId: "alice" });
		// BB checks
		s = applyAction(s, { type: "check", playerId: "bob" });
		expect(s.phase).toBe("flop");
		expect(s.communityCards.length).toBe(3);

		// Flop: both check
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

		// Showdown
		const { state: afterShowdown, results } = resolveShowdown(s, dealtCards);
		expect(results.length).toBe(2);

		// Total payout equals pot
		const pot = results.reduce((sum, r) => sum + (r.payout as number), 0);
		expect(pot).toBe(20); // 10 + 10

		// Chip conservation
		const afterTotal = afterShowdown.players.reduce(
			(sum, p) => sum + (p.stack as number),
			0,
		);
		expect(afterTotal).toBe(1000);

		// End hand, verify dealer rotates
		const afterEnd = endHand(afterShowdown);
		expect(afterEnd.phase).toBe("waiting");
		expect(afterEnd.dealerSeat).not.toBe(game.dealerSeat);

		// Chip conservation after endHand
		const endTotal = afterEnd.players.reduce(
			(sum, p) => sum + (p.stack as number),
			0,
		);
		expect(endTotal).toBe(1000);
	});
});

// ── All-in preflop showdown ──────────────────────────────────────

describe("All-in preflop showdown", () => {
	test("both all-in preflop, 5 community cards dealt, winner gets all chips, game ends", () => {
		// Deterministic setup: alice has AA, bob has KK
		const topCards = [
			// Alice hole cards
			card("A", "hearts"),
			card("A", "diamonds"),
			// Bob hole cards
			card("K", "hearts"),
			card("K", "diamonds"),
			// Community: safe board for AA
			card("2", "spades"),
			card("5", "clubs"),
			card("8", "hearts"),
			card("J", "clubs"),
			card("3", "spades"),
		];

		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({
					userId: "alice",
					seat: 0,
					stack: chips(495),
					bet: chips(5),
				}),
				makePlayer({
					userId: "bob",
					seat: 1,
					stack: chips(490),
					bet: chips(10),
				}),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			smallBlind: chips(5),
			bigBlind: chips(10),
			betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
			deck: makeDeck(topCards).slice(4), // Remove dealt hole cards
		});

		const dealtCards = new Map<string, readonly Card[]>();
		dealtCards.set("alice", [card("A", "hearts"), card("A", "diamonds")]);
		dealtCards.set("bob", [card("K", "hearts"), card("K", "diamonds")]);

		// Alice all-in
		let s = applyAction(state, { type: "allIn", playerId: "alice" });
		// Bob all-in
		s = applyAction(s, { type: "allIn", playerId: "bob" });

		// Both all-in → auto-deal all 5 community cards
		expect(s.phase).toBe("showdown");
		expect(s.communityCards.length).toBe(5);

		// Resolve showdown
		const { state: afterShowdown, results } = resolveShowdown(s, dealtCards);

		// Alice should win with pair of aces vs pair of kings
		const aliceResult = findOrThrow(results, (r) => r.userId === "alice");
		expect(aliceResult.payout).toBeGreaterThan(0);

		// Winner gets all chips
		const alice = findOrThrow(
			afterShowdown.players,
			(p) => p.userId === "alice",
		);
		const bob = findOrThrow(afterShowdown.players, (p) => p.userId === "bob");
		expect((alice.stack as number) + (bob.stack as number)).toBe(1000);

		// End hand → game ends because loser busted
		const afterEnd = endHand(afterShowdown);
		expect(afterEnd.phase).toBe("complete");
		expect(afterEnd.players.length).toBe(1);
	});
});

// ── 4-player game with side pots ─────────────────────────────────

describe("4-player game with side pots", () => {
	test("different stack sizes create correct main pot and side pots", () => {
		// Player stacks: 200, 400, 600, 800
		// Smallest all-in for 200, next two call, largest folds
		// Then 400-stack all-in, 600-stack calls

		const dealtCards = new Map<string, readonly Card[]>();
		// p1 (200): best hand - pair of aces
		dealtCards.set("p1", [card("A", "hearts"), card("A", "diamonds")]);
		// p2 (400): second best - pair of kings
		dealtCards.set("p2", [card("K", "hearts"), card("K", "diamonds")]);
		// p3 (600): third - pair of queens
		dealtCards.set("p3", [card("Q", "hearts"), card("Q", "diamonds")]);
		// p4 (800): folds
		dealtCards.set("p4", [card("2", "hearts"), card("3", "hearts")]);

		const communityCards = [
			card("5", "spades"),
			card("7", "clubs"),
			card("9", "hearts"),
			card("J", "spades"),
			card("4", "clubs"),
		];

		// Simulate after all betting:
		// p4 folded, p1 all-in 200, p2 all-in 400, p3 called 400
		const state = makeGameState({
			phase: "showdown",
			players: [
				makePlayer({
					userId: "p1",
					seat: 0,
					stack: chips(0),
					bet: chips(200),
					allIn: true,
				}),
				makePlayer({
					userId: "p2",
					seat: 1,
					stack: chips(0),
					bet: chips(400),
					allIn: true,
				}),
				makePlayer({
					userId: "p3",
					seat: 2,
					stack: chips(200),
					bet: chips(400),
				}),
				makePlayer({
					userId: "p4",
					seat: 3,
					stack: chips(800),
					bet: chips(0),
					folded: true,
				}),
			],
			communityCards,
			pots: [
				{
					// Main pot: 200 * 3 = 600 (p1, p2, p3 eligible — p4 folded)
					amount: chips(600),
					eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
				},
				{
					// Side pot: 200 * 2 = 400 (p2, p3 eligible)
					amount: chips(400),
					eligiblePlayers: [seatIndex(1), seatIndex(2)],
				},
			],
		});

		const { results } = resolveShowdown(state, dealtCards);

		// p1 (aces) wins main pot of 600
		const p1Result = findOrThrow(results, (r) => r.userId === "p1");
		expect(p1Result.payout).toBe(chips(600));

		// p2 (kings) wins side pot of 400
		const p2Result = findOrThrow(results, (r) => r.userId === "p2");
		expect(p2Result.payout).toBe(chips(400));

		// p3 gets nothing
		const p3Result = findOrThrow(results, (r) => r.userId === "p3");
		expect(p3Result.payout).toBe(chips(0));
	});
});

// ── Multi-hand session ───────────────────────────────────────────

describe("Multi-hand session", () => {
	test("3 players, play multiple hands, dealer rotates, busted player removed, game ends", () => {
		const game = makeGameState({
			phase: "waiting",
			players: [
				makePlayer({ userId: "alice", seat: 0, stack: chips(500) }),
				makePlayer({ userId: "bob", seat: 2, stack: chips(500) }),
				makePlayer({ userId: "charlie", seat: 5, stack: chips(500) }),
			],
			dealerSeat: seatIndex(0),
			smallBlind: chips(5),
			bigBlind: chips(10),
		});

		let currentState = game;
		const dealers: number[] = [];
		let handCount = 0;

		// Play hands until game ends or we hit 20 (safety limit)
		while (currentState.phase !== "complete" && handCount < 20) {
			const { state: preflop, dealtCards } = startHand(currentState);
			dealers.push(currentState.dealerSeat as number);
			handCount++;

			// Simple strategy: SB calls, BB checks, then check through all streets
			let s = preflop;

			// Play through a simple hand: everyone calls/checks to showdown
			let iterations = 0;
			while (
				s.phase !== "showdown" &&
				s.phase !== "complete" &&
				iterations < 30
			) {
				iterations++;
				const activePlayer = s.players.find(
					(p) =>
						p.seat === s.activeSeat && !p.folded && !p.allIn && !p.sittingOut,
				);
				if (!activePlayer) break;

				const actions = legalActions(s, activePlayer.userId);
				if (actions.length === 0) break;

				// Prefer check, then call, then fold
				const checkAction = actions.find((a) => a.type === "check");
				const callAction = actions.find((a) => a.type === "call");
				if (checkAction) {
					s = applyAction(s, checkAction);
				} else if (callAction) {
					s = applyAction(s, callAction);
				} else {
					// Fold as last resort
					const foldAction = actions.find((a) => a.type === "fold");
					if (foldAction) {
						s = applyAction(s, foldAction);
					} else {
						break;
					}
				}
			}

			// If we reach showdown with multiple players, resolve it
			const nonFolded = s.players.filter((p) => !p.folded);
			if (s.phase === "showdown" && nonFolded.length > 1) {
				const { state: afterShowdown } = resolveShowdown(s, dealtCards);
				s = afterShowdown;
			}

			// End hand
			currentState = endHand(s);

			// Verify stacks are consistent
			const total = currentState.players.reduce(
				(sum, p) => sum + (p.stack as number),
				0,
			);
			expect(total).toBe(1500);
		}

		// Verify dealer rotated (not all the same)
		if (dealers.length >= 2) {
			const uniqueDealers = new Set(dealers);
			expect(uniqueDealers.size).toBeGreaterThanOrEqual(2);
		}

		expect(handCount).toBeGreaterThan(0);
	});
});

// ── Fold to win ──────────────────────────────────────────────────

describe("Fold to win", () => {
	test("everyone folds to one player, winner gets pot without showdown reveal", () => {
		const state = makeGameState({
			phase: "preflop",
			players: [
				makePlayer({
					userId: "alice",
					seat: 0,
					stack: chips(1000),
				}),
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

		// Charlie wins with fold — phase goes to showdown
		expect(s.phase).toBe("showdown");

		// Charlie's stack includes the pot (awarded during applyAction)
		const charlie = findOrThrow(s.players, (p) => p.userId === "charlie");
		expect(charlie.stack).toBe(chips(990 + 15)); // 5 + 10

		// Verify no community cards were dealt (fold happened preflop)
		expect(s.communityCards.length).toBe(0);

		// Since the pot was already awarded in applyAction for fold-wins,
		// we do NOT call resolveShowdown (it would try to evaluate hands
		// with only 2 cards). This is the correct flow: fold-win skips showdown.
		// Only 1 non-folded player remains
		const nonFolded = s.players.filter((p) => !p.folded);
		expect(nonFolded.length).toBe(1);
		expect(nonFolded[0].userId).toBe("charlie");

		// Verify winner's cards are NOT revealed (no showdown needed)
		// The absence of resolveShowdown means no cards are exposed.
	});
});
