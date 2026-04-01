import { describe, expect, test } from "bun:test";
import {
	applyAction,
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

// ── Tests ──────────────────────────────────────────────────────────

describe("table edge cases", () => {
	describe("3-player game, one busts each hand", () => {
		test("game ends after 2 hands when one player busts each time", () => {
			// Set up: 3 players, one with very low stack
			const state = makeGameState({
				phase: "showdown",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(1500) }),
					makePlayer({ userId: "bob", seat: 1, stack: chips(500) }),
					makePlayer({ userId: "charlie", seat: 2, stack: chips(0) }),
				],
				dealerSeat: seatIndex(0),
			});

			// Charlie busts (0 chips)
			const afterHand1 = endHand(state);
			expect(afterHand1.phase).toBe("waiting");
			expect(afterHand1.players).toHaveLength(2);
			expect(
				afterHand1.players.find((p) => p.userId === "charlie"),
			).toBeUndefined();

			// Simulate hand 2: bob busts
			const state2 = makeGameState({
				...afterHand1,
				phase: "showdown",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(2000) }),
					makePlayer({
						userId: "bob",
						seat: findOrThrow(afterHand1.players, (p) => p.userId === "bob")
							.seat as number,
						stack: chips(0),
					}),
				],
			});

			const afterHand2 = endHand(state2);
			expect(afterHand2.phase).toBe("complete");
			expect(afterHand2.players).toHaveLength(1);
			expect(afterHand2.players[0].userId).toBe("alice");
		});
	});

	describe("dealer rotation skips empty seats", () => {
		test("dealer goes from seat 1 to seat 5 when seats 2-4 are empty", () => {
			const state = makeGameState({
				phase: "showdown",
				players: [
					makePlayer({ userId: "alice", seat: 1, stack: chips(1000) }),
					makePlayer({ userId: "bob", seat: 5, stack: chips(1000) }),
					makePlayer({ userId: "charlie", seat: 7, stack: chips(1000) }),
				],
				dealerSeat: seatIndex(1),
			});

			const after = endHand(state);
			expect(after.dealerSeat).toBe(seatIndex(5));
		});

		test("dealer wraps around from seat 7 to seat 1", () => {
			const state = makeGameState({
				phase: "showdown",
				players: [
					makePlayer({ userId: "alice", seat: 1, stack: chips(1000) }),
					makePlayer({ userId: "bob", seat: 5, stack: chips(1000) }),
					makePlayer({ userId: "charlie", seat: 7, stack: chips(1000) }),
				],
				dealerSeat: seatIndex(7),
			});

			const after = endHand(state);
			expect(after.dealerSeat).toBe(seatIndex(1));
		});

		test("dealer skips busted player's seat", () => {
			const state = makeGameState({
				phase: "showdown",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(1500) }),
					makePlayer({ userId: "bob", seat: 1, stack: chips(0) }), // busts
					makePlayer({ userId: "charlie", seat: 2, stack: chips(500) }),
				],
				dealerSeat: seatIndex(0),
			});

			const after = endHand(state);
			// Bob is removed; dealer moves from seat 0 to next occupied = seat 2
			expect(after.dealerSeat).toBe(seatIndex(2));
			expect(after.players).toHaveLength(2);
		});
	});

	describe("multiple all-ins in one hand", () => {
		test("correct pot distribution with showdown after multiple all-ins", () => {
			const dealtCards = new Map<string, readonly Card[]>();
			dealtCards.set("alice", [card("A", "hearts"), card("A", "diamonds")]);
			dealtCards.set("bob", [card("K", "hearts"), card("K", "diamonds")]);
			dealtCards.set("charlie", [card("Q", "hearts"), card("Q", "diamonds")]);

			// Charlie all-in for 100, Bob all-in for 200, Alice covers
			const state = makeGameState({
				phase: "showdown",
				players: [
					makePlayer({
						userId: "alice",
						seat: 0,
						stack: chips(0),
						bet: chips(300),
					}),
					makePlayer({
						userId: "bob",
						seat: 1,
						stack: chips(0),
						bet: chips(200),
						allIn: true,
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
					card("9", "spades"),
					card("J", "clubs"),
					card("2", "diamonds"),
				],
				pots: [
					{
						amount: chips(300),
						eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
					},
					{
						amount: chips(200),
						eligiblePlayers: [seatIndex(0), seatIndex(1)],
					},
					{
						amount: chips(100),
						eligiblePlayers: [seatIndex(0)],
					},
				],
			});

			const { results } = resolveShowdown(state, dealtCards);

			// Alice (AA) wins everything
			const aliceResult = findOrThrow(results, (r) => r.userId === "alice");
			expect(aliceResult.payout).toBe(chips(600));
		});
	});

	describe("hand transition", () => {
		test("after endHand, startHand works correctly with rotated dealer", () => {
			const state = makeGameState({
				phase: "showdown",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(1200) }),
					makePlayer({ userId: "bob", seat: 2, stack: chips(800) }),
				],
				dealerSeat: seatIndex(0),
				smallBlind: chips(5),
				bigBlind: chips(10),
				handNumber: 1,
			});

			const afterEnd = endHand(state);
			expect(afterEnd.phase).toBe("waiting");
			expect(afterEnd.dealerSeat).toBe(seatIndex(2)); // rotated

			const { state: newHand } = startHand(afterEnd);
			expect(newHand.phase).toBe("preflop");
			expect(newHand.handNumber).toBe(2);

			// Heads-up: dealer = SB = seat 2, BB = seat 0
			const dealer = findOrThrow(
				newHand.players,
				(p) => (p.seat as number) === 2,
			);
			expect(dealer.bet).toBe(chips(5)); // SB

			const bb = findOrThrow(newHand.players, (p) => (p.seat as number) === 0);
			expect(bb.bet).toBe(chips(10)); // BB
		});
	});

	describe("player removal during waiting phase", () => {
		test("removePlayer before game starts", () => {
			const state = makeGameState({
				phase: "waiting",
				players: [
					makePlayer({ userId: "alice", seat: 0 }),
					makePlayer({ userId: "bob", seat: 1 }),
					makePlayer({ userId: "charlie", seat: 2 }),
				],
			});

			const after = removePlayer(state, "charlie");
			expect(after.players).toHaveLength(2);
			expect(after.players.find((p) => p.userId === "charlie")).toBeUndefined();
			// Game still in waiting since 2 players remain
			expect(after.phase).toBe("waiting");
		});

		test("removePlayer in waiting with only 2 ends the game", () => {
			const state = makeGameState({
				phase: "waiting",
				players: [
					makePlayer({ userId: "alice", seat: 0 }),
					makePlayer({ userId: "bob", seat: 1 }),
				],
			});

			const after = removePlayer(state, "bob");
			expect(after.phase).toBe("complete");
			expect(after.players).toHaveLength(1);
		});
	});

	describe("chip conservation", () => {
		test("total chips equals total buy-ins throughout multi-hand game", () => {
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

			const totalBuyIn = 2000;

			// Hand 1
			const { state: h1, dealtCards: dc1 } = startHand(game);

			// Verify chips during preflop (stacks + bets = total)
			let chipSum = h1.players.reduce(
				(sum, p) => sum + (p.stack as number) + (p.bet as number),
				0,
			);
			expect(chipSum).toBe(totalBuyIn);

			// SB calls, BB checks
			let s = applyAction(h1, { type: "call", playerId: "alice" });
			chipSum = s.players.reduce(
				(sum, p) => sum + (p.stack as number) + (p.bet as number),
				0,
			);
			expect(chipSum).toBe(totalBuyIn);

			s = applyAction(s, { type: "check", playerId: "bob" });

			// Flop: check-check
			s = applyAction(s, { type: "check", playerId: "bob" });
			s = applyAction(s, { type: "check", playerId: "alice" });

			// Turn: check-check
			s = applyAction(s, { type: "check", playerId: "bob" });
			s = applyAction(s, { type: "check", playerId: "alice" });

			// River: check-check
			s = applyAction(s, { type: "check", playerId: "bob" });
			s = applyAction(s, { type: "check", playerId: "alice" });

			expect(s.phase).toBe("showdown");

			const { state: afterShowdown } = resolveShowdown(s, dc1);
			chipSum = afterShowdown.players.reduce(
				(sum, p) => sum + (p.stack as number) + (p.bet as number),
				0,
			);
			expect(chipSum).toBe(totalBuyIn);

			// End hand
			const afterEnd = endHand(afterShowdown);
			chipSum = afterEnd.players.reduce(
				(sum, p) => sum + (p.stack as number) + (p.bet as number),
				0,
			);
			expect(chipSum).toBe(totalBuyIn);
		});
	});

	describe("legal actions change during betting round", () => {
		test("fold is always legal when it is your turn", () => {
			// With a bet to match
			const stateWithBet = makeGameState({
				phase: "preflop",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(1000) }),
					makePlayer({
						userId: "bob",
						seat: 1,
						stack: chips(990),
						bet: chips(10),
					}),
				],
				activeSeat: seatIndex(0),
				betting: makeRound({ currentBet: chips(10), minRaise: chips(10) }),
			});

			let actions = legalActions(stateWithBet, "alice");
			expect(actions.map((a) => a.type)).toContain("fold");

			// Without a bet to match
			const stateNoBet = makeGameState({
				phase: "flop",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
					makePlayer({ userId: "bob", seat: 1, stack: chips(990) }),
				],
				activeSeat: seatIndex(0),
				betting: makeRound({ currentBet: chips(0) }),
			});

			actions = legalActions(stateNoBet, "alice");
			expect(actions.map((a) => a.type)).toContain("fold");
		});

		test("check only when no bet", () => {
			const stateNoBet = makeGameState({
				phase: "flop",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
					makePlayer({ userId: "bob", seat: 1, stack: chips(990) }),
				],
				activeSeat: seatIndex(0),
				betting: makeRound({ currentBet: chips(0) }),
			});

			let actions = legalActions(stateNoBet, "alice");
			expect(actions.map((a) => a.type)).toContain("check");

			const stateWithBet = makeGameState({
				phase: "flop",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
					makePlayer({
						userId: "bob",
						seat: 1,
						stack: chips(940),
						bet: chips(50),
					}),
				],
				activeSeat: seatIndex(0),
				betting: makeRound({ currentBet: chips(50), minRaise: chips(10) }),
			});

			actions = legalActions(stateWithBet, "alice");
			expect(actions.map((a) => a.type)).not.toContain("check");
		});

		test("call only when there is a bet", () => {
			const stateNoBet = makeGameState({
				phase: "flop",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
					makePlayer({ userId: "bob", seat: 1, stack: chips(990) }),
				],
				activeSeat: seatIndex(0),
				betting: makeRound({ currentBet: chips(0) }),
			});

			let actions = legalActions(stateNoBet, "alice");
			expect(actions.map((a) => a.type)).not.toContain("call");

			const stateWithBet = makeGameState({
				phase: "flop",
				players: [
					makePlayer({ userId: "alice", seat: 0, stack: chips(990) }),
					makePlayer({
						userId: "bob",
						seat: 1,
						stack: chips(940),
						bet: chips(50),
					}),
				],
				activeSeat: seatIndex(0),
				betting: makeRound({ currentBet: chips(50), minRaise: chips(10) }),
			});

			actions = legalActions(stateWithBet, "alice");
			expect(actions.map((a) => a.type)).toContain("call");
		});
	});

	describe("showdown with tied hands and side pots", () => {
		test("two players tie for main pot, third wins side pot", () => {
			const dealtCards = new Map<string, readonly Card[]>();
			// Alice and Charlie tie with same straight
			dealtCards.set("alice", [card("6", "hearts"), card("7", "hearts")]);
			dealtCards.set("charlie", [card("6", "diamonds"), card("7", "diamonds")]);
			// Bob has worse hand
			dealtCards.set("bob", [card("2", "hearts"), card("3", "hearts")]);

			const state = makeGameState({
				phase: "showdown",
				players: [
					makePlayer({
						userId: "alice",
						seat: 0,
						stack: chips(0),
						bet: chips(100),
						allIn: true,
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
						bet: chips(200),
					}),
				],
				communityCards: [
					card("8", "spades"),
					card("9", "clubs"),
					card("10", "spades"),
					card("K", "clubs"),
					card("2", "diamonds"),
				],
				pots: [
					{
						amount: chips(300),
						eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
					},
					{
						amount: chips(200),
						eligiblePlayers: [seatIndex(1), seatIndex(2)],
					},
				],
			});

			const { results } = resolveShowdown(state, dealtCards);

			// Alice and Charlie tie for main pot (300 / 2 = 150 each)
			const aliceResult = findOrThrow(results, (r) => r.userId === "alice");
			const charlieResult = findOrThrow(results, (r) => r.userId === "charlie");
			expect(aliceResult.payout).toBe(chips(150));
			// Charlie also wins the side pot (200) since Bob has worse hand
			expect(charlieResult.payout).toBe(chips(350)); // 150 + 200
		});
	});
});
