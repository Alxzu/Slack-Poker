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

describe("calculatePots", () => {
	test("2-player pot: simple main pot", () => {
		const players = [
			makePlayer({ seat: 0, bet: 50 }),
			makePlayer({ seat: 1, bet: 50 }),
		];
		const pots = calculatePots(players);
		expect(pots).toHaveLength(1);
		expect(pots[0].amount).toBe(chips(100));
		expect(pots[0].eligiblePlayers).toEqual([seatIndex(0), seatIndex(1)]);
	});

	test("3-player, all equal bets: one main pot", () => {
		const players = [
			makePlayer({ seat: 0, bet: 50 }),
			makePlayer({ seat: 1, bet: 50 }),
			makePlayer({ seat: 2, bet: 50 }),
		];
		const pots = calculatePots(players);
		expect(pots).toHaveLength(1);
		expect(pots[0].amount).toBe(chips(150));
		expect(pots[0].eligiblePlayers).toHaveLength(3);
	});

	test("2-player all-in at different stacks: main pot + side pot", () => {
		const players = [
			makePlayer({ seat: 0, bet: 50, allIn: true, stack: 0 }),
			makePlayer({ seat: 1, bet: 100, allIn: true, stack: 0 }),
		];
		const pots = calculatePots(players);
		expect(pots).toHaveLength(2);
		// Main pot: 50 x 2 = 100 (both eligible)
		expect(pots[0].amount).toBe(chips(100));
		expect(pots[0].eligiblePlayers).toEqual([seatIndex(0), seatIndex(1)]);
		// Side pot: remaining 50 from seat 1
		expect(pots[1].amount).toBe(chips(50));
		expect(pots[1].eligiblePlayers).toEqual([seatIndex(1)]);
	});

	test("3-player, one short all-in: main pot (3 eligible) + side pot (2 eligible)", () => {
		const players = [
			makePlayer({ seat: 0, bet: 30, allIn: true, stack: 0 }),
			makePlayer({ seat: 1, bet: 100 }),
			makePlayer({ seat: 2, bet: 100 }),
		];
		const pots = calculatePots(players);
		expect(pots).toHaveLength(2);
		// Main pot: 30 x 3 = 90
		expect(pots[0].amount).toBe(chips(90));
		expect(pots[0].eligiblePlayers).toHaveLength(3);
		// Side pot: 70 x 2 = 140
		expect(pots[1].amount).toBe(chips(140));
		expect(pots[1].eligiblePlayers).toHaveLength(2);
		expect(pots[1].eligiblePlayers).toContainEqual(seatIndex(1));
		expect(pots[1].eligiblePlayers).toContainEqual(seatIndex(2));
	});

	test("player folds after partial bet: chips stay but not eligible", () => {
		const players = [
			makePlayer({ seat: 0, bet: 20, folded: true }),
			makePlayer({ seat: 1, bet: 50 }),
			makePlayer({ seat: 2, bet: 50 }),
		];
		const pots = calculatePots(players);
		expect(pots).toHaveLength(1);
		expect(pots[0].amount).toBe(chips(120));
		// Folded player is NOT eligible
		expect(pots[0].eligiblePlayers).toEqual([seatIndex(1), seatIndex(2)]);
	});

	test("multiple all-ins at same amount: same pot", () => {
		const players = [
			makePlayer({ seat: 0, bet: 50, allIn: true, stack: 0 }),
			makePlayer({ seat: 1, bet: 50, allIn: true, stack: 0 }),
			makePlayer({ seat: 2, bet: 100 }),
		];
		const pots = calculatePots(players);
		expect(pots).toHaveLength(2);
		// Main pot: 50 x 3 = 150 (all three eligible)
		expect(pots[0].amount).toBe(chips(150));
		expect(pots[0].eligiblePlayers).toHaveLength(3);
		// Side pot: 50 from seat 2
		expect(pots[1].amount).toBe(chips(50));
		expect(pots[1].eligiblePlayers).toEqual([seatIndex(2)]);
	});
});

describe("distributePots", () => {
	test("single winner takes all", () => {
		const pots: Pot[] = [
			{ amount: chips(100), eligiblePlayers: [seatIndex(0), seatIndex(1)] },
		];
		const winners = new Map<ReturnType<typeof seatIndex>, number>([
			[seatIndex(0), 100],
			[seatIndex(1), 50],
		]);
		const payouts = distributePots(pots, winners);
		expect(payouts.get(seatIndex(0))).toBe(chips(100));
		expect(payouts.has(seatIndex(1))).toBe(false);
	});

	test("tied hands split pot", () => {
		const pots: Pot[] = [
			{ amount: chips(100), eligiblePlayers: [seatIndex(0), seatIndex(1)] },
		];
		const winners = new Map<ReturnType<typeof seatIndex>, number>([
			[seatIndex(0), 80],
			[seatIndex(1), 80],
		]);
		const payouts = distributePots(pots, winners);
		expect(payouts.get(seatIndex(0))).toBe(chips(50));
		expect(payouts.get(seatIndex(1))).toBe(chips(50));
	});

	test("tied hands with odd chip goes to first eligible", () => {
		const pots: Pot[] = [
			{ amount: chips(101), eligiblePlayers: [seatIndex(0), seatIndex(1)] },
		];
		const winners = new Map<ReturnType<typeof seatIndex>, number>([
			[seatIndex(0), 80],
			[seatIndex(1), 80],
		]);
		const payouts = distributePots(pots, winners);
		// 101 / 2 = 50 each, 1 remainder to first
		expect(payouts.get(seatIndex(0))).toBe(chips(51));
		expect(payouts.get(seatIndex(1))).toBe(chips(50));
	});

	test("side pot winner different from main pot winner", () => {
		const pots: Pot[] = [
			{
				amount: chips(90),
				eligiblePlayers: [seatIndex(0), seatIndex(1), seatIndex(2)],
			},
			{
				amount: chips(140),
				eligiblePlayers: [seatIndex(1), seatIndex(2)],
			},
		];
		// Seat 0 has best hand but only eligible for main pot
		// Seat 1 wins side pot
		const winners = new Map<ReturnType<typeof seatIndex>, number>([
			[seatIndex(0), 100],
			[seatIndex(1), 80],
			[seatIndex(2), 50],
		]);
		const payouts = distributePots(pots, winners);
		expect(payouts.get(seatIndex(0))).toBe(chips(90)); // main pot
		expect(payouts.get(seatIndex(1))).toBe(chips(140)); // side pot
		expect(payouts.has(seatIndex(2))).toBe(false);
	});
});
