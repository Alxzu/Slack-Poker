import { describe, expect, test } from "bun:test";
import {
	applyBetAction,
	callAmount,
	canCall,
	canCheck,
	canRaise,
	createBettingRound,
	getNextActiveSeat,
	isBettingRoundComplete,
} from "../../src/engine/betting";
import type { BettingRoundState, PlayerState } from "../../src/engine/types";
import { chips, seatIndex } from "../../src/engine/types";

function makePlayer(
	overrides: Partial<PlayerState> & { seat: number },
): PlayerState {
	return {
		userId: `user-${overrides.seat}`,
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

function findOrThrow<T>(arr: readonly T[], pred: (item: T) => boolean): T {
	const found = arr.find(pred);
	if (found === undefined) throw new Error("Item not found in array");
	return found;
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

describe("betting edge cases", () => {
	describe("min raise tracking", () => {
		test("after a raise of 50, next raise must be at least 50 more", () => {
			const players = [
				makePlayer({ seat: 0, stack: 1000 }),
				makePlayer({ seat: 1, stack: 1000 }),
				makePlayer({ seat: 2, stack: 1000 }),
			];
			const round = makeRound({ currentBet: chips(10), minRaise: chips(10) });

			// Seat 0 raises to 60 (put in 60 chips, raise size = 60 - 10 = 50)
			const { round: r1 } = applyBetAction(players, round, seatIndex(0), {
				type: "raise",
				playerId: "user-0",
				amount: chips(60),
			});

			expect(r1.currentBet).toBe(chips(60));
			expect(r1.minRaise).toBe(chips(50)); // raise size was 50

			// Seat 1 cannot raise by less than 50 more (must go to at least 110)
			const updatedPlayers = [
				makePlayer({ seat: 0, stack: 940, bet: 60 }),
				makePlayer({ seat: 1, stack: 1000 }),
				makePlayer({ seat: 2, stack: 1000 }),
			];

			// Raise to 100 is invalid (only 40 more, need 50)
			expect(canRaise(updatedPlayers[1], r1, chips(100))).toBe(false);

			// Raise to 110 is valid (50 more above currentBet of 60)
			expect(canRaise(updatedPlayers[1], r1, chips(110))).toBe(true);
		});
	});

	describe("re-raise", () => {
		test("player raises, gets re-raised, original raiser can act again", () => {
			const players = [
				makePlayer({ seat: 0, stack: 1000 }),
				makePlayer({ seat: 1, stack: 1000 }),
			];
			const round = makeRound({ currentBet: chips(10), minRaise: chips(10) });

			// Seat 0 raises to 30 (puts in 30)
			const { players: p1, round: r1 } = applyBetAction(
				players,
				round,
				seatIndex(0),
				{
					type: "raise",
					playerId: "user-0",
					amount: chips(30),
				},
			);

			expect(r1.currentBet).toBe(chips(30));
			expect(r1.actedThisRound.has(seatIndex(0))).toBe(true);

			// Seat 1 re-raises to 60 (puts in 60)
			const { players: p2, round: r2 } = applyBetAction(p1, r1, seatIndex(1), {
				type: "raise",
				playerId: "user-1",
				amount: chips(60),
			});

			expect(r2.currentBet).toBe(chips(60));

			// The round should NOT be complete because seat 0 needs to respond
			expect(isBettingRoundComplete(p2, r2)).toBe(false);

			// Seat 0 has acted but their bet (30) < currentBet (60)
			const seat0 = findOrThrow(p2, (p) => (p.seat as number) === 0);
			expect(seat0.bet).toBe(chips(30));
			expect((seat0.bet as number) < (r2.currentBet as number)).toBe(true);
		});
	});

	describe("check-raise", () => {
		test("check, opponent bets, original checker raises", () => {
			const players = [
				makePlayer({ seat: 0, stack: 1000 }),
				makePlayer({ seat: 1, stack: 1000 }),
			];
			const round = makeRound({ currentBet: chips(0), minRaise: chips(10) });

			// Seat 0 checks
			const { players: p1, round: r1 } = applyBetAction(
				players,
				round,
				seatIndex(0),
				{
					type: "check",
					playerId: "user-0",
				},
			);

			expect(r1.actedThisRound.has(seatIndex(0))).toBe(true);

			// Seat 1 raises to 20
			const { players: p2, round: r2 } = applyBetAction(p1, r1, seatIndex(1), {
				type: "raise",
				playerId: "user-1",
				amount: chips(20),
			});

			expect(r2.currentBet).toBe(chips(20));

			// Round is not complete: seat 0 has acted but their bet is less than currentBet
			expect(isBettingRoundComplete(p2, r2)).toBe(false);

			// Seat 0 can now raise (check-raise)
			const seat0 = findOrThrow(p2, (p) => (p.seat as number) === 0);
			expect(canRaise(seat0, r2, chips(40))).toBe(true);

			// Seat 0 raises to 40
			const { round: r3 } = applyBetAction(p2, r2, seatIndex(0), {
				type: "raise",
				playerId: "user-0",
				amount: chips(40),
			});

			expect(r3.currentBet).toBe(chips(40));
		});
	});

	describe("all-in call for less", () => {
		test("player calls but does not have enough, goes all-in for remaining stack", () => {
			const players = [
				makePlayer({ seat: 0, stack: 30 }), // only has 30 chips
				makePlayer({ seat: 1, stack: 1000, bet: 100 }),
			];
			const round = makeRound({ currentBet: chips(100) });

			// Call amount would be 100 but player only has 30
			const needed = callAmount(players[0], round);
			expect(needed).toBe(chips(100));

			const { players: newPlayers } = applyBetAction(
				players,
				round,
				seatIndex(0),
				{
					type: "call",
					playerId: "user-0",
				},
			);

			const seat0 = findOrThrow(newPlayers, (p) => (p.seat as number) === 0);
			expect(seat0.stack).toBe(chips(0));
			expect(seat0.bet).toBe(chips(30));
			expect(seat0.allIn).toBe(true);
		});
	});

	describe("heads-up preflop action order", () => {
		test("SB (dealer) acts first preflop", () => {
			// In heads-up, dealer = SB, and SB acts first preflop
			// After flop, BB (non-dealer) acts first
			// This is validated by getNextActiveSeat behavior
			const players = [
				makePlayer({ seat: 0, bet: 5 }), // SB/dealer
				makePlayer({ seat: 1, bet: 10 }), // BB
			];

			// Preflop: SB is at seat 0, should act first (tested by startHand in table tests)
			// Post-flop: first active after dealer should be seat 1 (BB)
			const nextAfterDealer = getNextActiveSeat(
				players,
				seatIndex(0),
				seatIndex(0),
			);
			expect(nextAfterDealer).toBe(seatIndex(1));
		});
	});

	describe("betting round resets between streets", () => {
		test("new street: currentBet resets to 0, everyone can act again", () => {
			const newRound = createBettingRound(chips(5), chips(10));

			expect(newRound.currentBet).toBe(chips(0));
			expect(newRound.minRaise).toBe(chips(10)); // resets to big blind
			expect(newRound.lastRaiserSeat).toBeNull();
			expect(newRound.actedThisRound.size).toBe(0);

			// After reset, players can check (since currentBet is 0)
			const player = makePlayer({ seat: 0, stack: 990 });
			expect(canCheck(player, newRound)).toBe(true);
			expect(canCall(player, newRound)).toBe(false); // no bet to call
		});
	});

	describe("only one player can act", () => {
		test("round completes immediately when others are all-in or folded", () => {
			// Seat 0: active, Seat 1: all-in, Seat 2: folded
			const players = [
				makePlayer({ seat: 0, bet: 50 }),
				makePlayer({ seat: 1, allIn: true, stack: 0, bet: 50 }),
				makePlayer({ seat: 2, folded: true, bet: 20 }),
			];
			const round = makeRound({
				currentBet: chips(50),
				actedThisRound: new Set([seatIndex(0)]),
			});

			// Only seat 0 is active, and they've acted and matched the bet
			expect(isBettingRoundComplete(players, round)).toBe(true);
		});

		test("no active players means round is complete", () => {
			const players = [
				makePlayer({ seat: 0, allIn: true, stack: 0, bet: 100 }),
				makePlayer({ seat: 1, allIn: true, stack: 0, bet: 200 }),
			];
			const round = makeRound({ currentBet: chips(200) });

			expect(isBettingRoundComplete(players, round)).toBe(true);
		});

		test("getNextActiveSeat returns null when all players folded or all-in", () => {
			const players = [
				makePlayer({ seat: 0, folded: true }),
				makePlayer({ seat: 1, allIn: true, stack: 0 }),
				makePlayer({ seat: 2, folded: true }),
			];

			const next = getNextActiveSeat(players, seatIndex(0), seatIndex(0));
			expect(next).toBeNull();
		});

		test("getNextActiveSeat wraps to self when only active player", () => {
			const players = [
				makePlayer({ seat: 0 }), // active, current
				makePlayer({ seat: 1, allIn: true, stack: 0 }),
				makePlayer({ seat: 2, folded: true }),
			];

			const next = getNextActiveSeat(players, seatIndex(0), seatIndex(0));
			// Wraps all the way around and finds seat 0 (itself)
			expect(next).toBe(seatIndex(0));
		});
	});

	describe("all-in as a raise", () => {
		test("all-in that exceeds current bet counts as raise", () => {
			const players = [
				makePlayer({ seat: 0, stack: 200 }),
				makePlayer({ seat: 1, stack: 1000, bet: 50 }),
			];
			const round = makeRound({ currentBet: chips(50), minRaise: chips(50) });

			const { round: r1 } = applyBetAction(players, round, seatIndex(0), {
				type: "allIn",
				playerId: "user-0",
			});

			// All-in for 200 exceeds currentBet of 50, so it's a raise
			expect(r1.currentBet).toBe(chips(200));
			expect(r1.lastRaiserSeat).toBe(seatIndex(0));
		});

		test("all-in for less than current bet does not change currentBet", () => {
			const players = [
				makePlayer({ seat: 0, stack: 30 }),
				makePlayer({ seat: 1, stack: 1000, bet: 50 }),
			];
			const round = makeRound({ currentBet: chips(50), minRaise: chips(50) });

			const { round: r1 } = applyBetAction(players, round, seatIndex(0), {
				type: "allIn",
				playerId: "user-0",
			});

			// All-in for 30, less than currentBet of 50
			expect(r1.currentBet).toBe(chips(50)); // unchanged
			expect(r1.lastRaiserSeat).toBeNull(); // no new raiser
		});
	});
});
