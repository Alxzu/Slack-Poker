import { describe, expect, test } from "bun:test";
import { calculatePots, distributePots } from "../../src/engine/pot";
import type { PlayerState, Pot } from "../../src/engine/types";
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

describe("pot edge cases", () => {
	describe("4-way all-in at 4 different stack sizes", () => {
		test("creates main pot + 3 side pots", () => {
			const players = [
				makePlayer({ seat: 0, bet: 100, allIn: true, stack: 0 }), // smallest
				makePlayer({ seat: 1, bet: 200, allIn: true, stack: 0 }),
				makePlayer({ seat: 2, bet: 300, allIn: true, stack: 0 }),
				makePlayer({ seat: 3, bet: 400, allIn: true, stack: 0 }), // biggest
			];

			const pots = calculatePots(players);
			expect(pots).toHaveLength(4);

			// Main pot: 100 * 4 = 400 (all 4 eligible)
			expect(pots[0].amount).toBe(chips(400));
			expect(pots[0].eligiblePlayers).toHaveLength(4);

			// Side pot 1: 100 * 3 = 300 (seats 1, 2, 3)
			expect(pots[1].amount).toBe(chips(300));
			expect(pots[1].eligiblePlayers).toHaveLength(3);
			expect(pots[1].eligiblePlayers).not.toContainEqual(seatIndex(0));

			// Side pot 2: 100 * 2 = 200 (seats 2, 3)
			expect(pots[2].amount).toBe(chips(200));
			expect(pots[2].eligiblePlayers).toHaveLength(2);
			expect(pots[2].eligiblePlayers).toContainEqual(seatIndex(2));
			expect(pots[2].eligiblePlayers).toContainEqual(seatIndex(3));

			// Side pot 3: 100 * 1 = 100 (seat 3 only)
			expect(pots[3].amount).toBe(chips(100));
			expect(pots[3].eligiblePlayers).toHaveLength(1);
			expect(pots[3].eligiblePlayers).toContainEqual(seatIndex(3));

			// Total chips conserved
			const totalPot = pots.reduce((sum, p) => sum + (p.amount as number), 0);
			expect(totalPot).toBe(1000);
		});
	});

	describe("all-in for less than the blind", () => {
		test("partial blind all-in creates correct pot", () => {
			// SB posts 3 (all-in, had only 3), BB posts 10, UTG calls 10
			const players = [
				makePlayer({ seat: 0, bet: 3, allIn: true, stack: 0 }), // SB all-in short
				makePlayer({ seat: 1, bet: 10, stack: 990 }), // BB
				makePlayer({ seat: 2, bet: 10, stack: 990 }), // UTG called
			];

			const pots = calculatePots(players);
			expect(pots).toHaveLength(2);

			// Main pot: 3 * 3 = 9
			expect(pots[0].amount).toBe(chips(9));
			expect(pots[0].eligiblePlayers).toHaveLength(3);

			// Side pot: 7 * 2 = 14
			expect(pots[1].amount).toBe(chips(14));
			expect(pots[1].eligiblePlayers).toHaveLength(2);
			expect(pots[1].eligiblePlayers).not.toContainEqual(seatIndex(0));
		});
	});

	describe("big blind all-in for less", () => {
		test("BB all-in for less than blind creates proper pot", () => {
			// BB has only 6 chips, blind is 10. BB all-in for 6.
			// SB posts 5, another player calls 10
			const players = [
				makePlayer({ seat: 0, bet: 5, stack: 995 }), // SB
				makePlayer({ seat: 1, bet: 6, allIn: true, stack: 0 }), // BB all-in short
				makePlayer({ seat: 2, bet: 10, stack: 990 }), // caller
			];

			const pots = calculatePots(players);

			// All-in at 6: main pot = 5 + 6 + 6 = 17 (everyone contributes up to 6)
			// Wait: SB only bet 5, so at the 6 layer: min(5, 6)=5 from SB, 6 from BB, min(10,6)=6 from seat2 = 17
			expect(pots[0].amount).toBe(chips(17));
			expect(pots[0].eligiblePlayers).toHaveLength(3);

			// Remaining: seat 2 has 4 more (10-6=4)
			// But SB also has negative? No: SB bet 5, peeled=6, so 5-6<0, SB doesn't contribute to remaining
			// Only seat 2 contributes 4 to the side pot
			expect(pots[1].amount).toBe(chips(4));
			expect(pots[1].eligiblePlayers).toHaveLength(1);
			expect(pots[1].eligiblePlayers).toContainEqual(seatIndex(2));
		});
	});

	describe("raise then short all-in", () => {
		test("player raises, next player all-in for less than the raise", () => {
			// Player A raises to 50, Player B all-in for 30 (less than the raise)
			const players = [
				makePlayer({ seat: 0, bet: 50, stack: 950 }), // raiser
				makePlayer({ seat: 1, bet: 30, allIn: true, stack: 0 }), // short all-in
			];

			const pots = calculatePots(players);
			expect(pots).toHaveLength(2);

			// Main pot: 30 * 2 = 60
			expect(pots[0].amount).toBe(chips(60));
			expect(pots[0].eligiblePlayers).toHaveLength(2);

			// Side pot: 20 (seat 0's excess)
			expect(pots[1].amount).toBe(chips(20));
			expect(pots[1].eligiblePlayers).toHaveLength(1);
		});
	});

	describe("pot distribution with 3-way tie", () => {
		test("three players tie, pot splits 3 ways", () => {
			const pots: Pot[] = [
				{
					amount: chips(300),
					eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
				},
			];

			// All three have equal hand scores
			const winners = new Map<ReturnType<typeof seatIndex>, number>([
				[seatIndex(0), 50],
				[seatIndex(1), 50],
				[seatIndex(2), 50],
			]);

			const payouts = distributePots(pots, winners);
			expect(payouts.get(seatIndex(0))).toBe(chips(100));
			expect(payouts.get(seatIndex(1))).toBe(chips(100));
			expect(payouts.get(seatIndex(2))).toBe(chips(100));
		});
	});

	describe("odd chip with 3-way split", () => {
		test("100 chips split 3 ways: 34, 33, 33 (extra to first eligible)", () => {
			const pots: Pot[] = [
				{
					amount: chips(100),
					eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
				},
			];

			const winners = new Map<ReturnType<typeof seatIndex>, number>([
				[seatIndex(0), 50],
				[seatIndex(1), 50],
				[seatIndex(2), 50],
			]);

			const payouts = distributePots(pots, winners);
			// 100 / 3 = 33 each, remainder 1 goes to first
			expect(payouts.get(seatIndex(0))).toBe(chips(34));
			expect(payouts.get(seatIndex(1))).toBe(chips(33));
			expect(payouts.get(seatIndex(2))).toBe(chips(33));
		});

		test("remainder of 2 with 3-way split", () => {
			const pots: Pot[] = [
				{
					amount: chips(101),
					eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
				},
			];

			const winners = new Map<ReturnType<typeof seatIndex>, number>([
				[seatIndex(0), 50],
				[seatIndex(1), 50],
				[seatIndex(2), 50],
			]);

			const payouts = distributePots(pots, winners);
			// 101 / 3 = 33 each, remainder 2 goes to first
			expect(payouts.get(seatIndex(0))).toBe(chips(35));
			expect(payouts.get(seatIndex(1))).toBe(chips(33));
			expect(payouts.get(seatIndex(2))).toBe(chips(33));
		});
	});

	describe("side pot with single eligible player", () => {
		test("only one player eligible for side pot, auto-wins it", () => {
			// Three players: seat 0 all-in for 50, seat 1 all-in for 100, seat 2 folds after betting 100
			const players = [
				makePlayer({ seat: 0, bet: 50, allIn: true, stack: 0 }),
				makePlayer({ seat: 1, bet: 100, allIn: true, stack: 0 }),
				makePlayer({ seat: 2, bet: 100, folded: true, stack: 900 }),
			];

			const pots = calculatePots(players);

			// Main pot: 50 * 3 = 150 (seats 0, 1 eligible -- seat 2 folded)
			expect(pots[0].eligiblePlayers).toHaveLength(2);
			expect(pots[0].amount).toBe(chips(150));

			// Side pot: 50 * 2 = 100 (only seat 1 eligible -- seat 2 folded)
			expect(pots[1].eligiblePlayers).toHaveLength(1);
			expect(pots[1].eligiblePlayers).toContainEqual(seatIndex(1));
			expect(pots[1].amount).toBe(chips(100));
		});

		test("single eligible player in side pot gets it regardless of hand strength", () => {
			const pots: Pot[] = [
				{
					amount: chips(150),
					eligiblePlayers: [seatIndex(0), seatIndex(1)],
				},
				{
					amount: chips(100),
					eligiblePlayers: [seatIndex(1)],
				},
			];

			// Seat 0 has the better hand
			const winners = new Map<ReturnType<typeof seatIndex>, number>([
				[seatIndex(0), 100],
				[seatIndex(1), 50],
			]);

			const payouts = distributePots(pots, winners);
			// Seat 0 wins main pot
			expect(payouts.get(seatIndex(0))).toBe(chips(150));
			// Seat 1 wins side pot (only eligible player)
			expect(payouts.get(seatIndex(1))).toBe(chips(100));
		});
	});

	describe("chip conservation in complex scenarios", () => {
		test("total pot amounts equal total bets in 4-way all-in", () => {
			const players = [
				makePlayer({ seat: 0, bet: 25, allIn: true, stack: 0 }),
				makePlayer({ seat: 1, bet: 75, allIn: true, stack: 0 }),
				makePlayer({ seat: 2, bet: 150, allIn: true, stack: 0 }),
				makePlayer({ seat: 3, bet: 200, allIn: true, stack: 0 }),
			];

			const pots = calculatePots(players);
			const totalPot = pots.reduce((sum, p) => sum + (p.amount as number), 0);
			const totalBets = players.reduce((sum, p) => sum + (p.bet as number), 0);
			expect(totalPot).toBe(totalBets);
		});
	});
});
