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

describe("createBettingRound", () => {
	test("creates initial state with zero current bet", () => {
		const round = createBettingRound(chips(5), chips(10));
		expect(round.currentBet).toBe(chips(0));
		expect(round.minRaise).toBe(chips(10));
		expect(round.lastRaiserSeat).toBeNull();
		expect(round.actedThisRound.size).toBe(0);
	});
});

describe("canCheck", () => {
	test("true when no bet to match", () => {
		const player = makePlayer({ seat: 0 });
		const round = makeRound({ currentBet: chips(0) });
		expect(canCheck(player, round)).toBe(true);
	});

	test("true when player bet matches current bet", () => {
		const player = makePlayer({ seat: 0, bet: 50 });
		const round = makeRound({ currentBet: chips(50) });
		expect(canCheck(player, round)).toBe(true);
	});

	test("false when there is a bet to match", () => {
		const player = makePlayer({ seat: 0, bet: 0 });
		const round = makeRound({ currentBet: chips(50) });
		expect(canCheck(player, round)).toBe(false);
	});

	test("false when player is folded", () => {
		const player = makePlayer({ seat: 0, folded: true });
		const round = makeRound({ currentBet: chips(0) });
		expect(canCheck(player, round)).toBe(false);
	});
});

describe("canCall", () => {
	test("true when there is a bet and player has chips", () => {
		const player = makePlayer({ seat: 0, stack: 1000 });
		const round = makeRound({ currentBet: chips(50) });
		expect(canCall(player, round)).toBe(true);
	});

	test("false when player already matched the bet", () => {
		const player = makePlayer({ seat: 0, bet: 50 });
		const round = makeRound({ currentBet: chips(50) });
		expect(canCall(player, round)).toBe(false);
	});

	test("false when no bet to match", () => {
		const player = makePlayer({ seat: 0 });
		const round = makeRound({ currentBet: chips(0) });
		expect(canCall(player, round)).toBe(false);
	});

	test("false when player is all-in", () => {
		const player = makePlayer({ seat: 0, allIn: true, stack: 0 });
		const round = makeRound({ currentBet: chips(50) });
		expect(canCall(player, round)).toBe(false);
	});
});

describe("canRaise", () => {
	test("true for valid raise amount", () => {
		const player = makePlayer({ seat: 0, stack: 1000 });
		const round = makeRound({ currentBet: chips(50), minRaise: chips(50) });
		// Need to raise to at least 100 (50 + 50), player has bet 0, so amount >= 100
		expect(canRaise(player, round, chips(100))).toBe(true);
	});

	test("false when raise is below minimum", () => {
		const player = makePlayer({ seat: 0, stack: 1000 });
		const round = makeRound({ currentBet: chips(50), minRaise: chips(50) });
		// Need to raise to at least 100 total bet, but amount 30 only gets to 30
		expect(canRaise(player, round, chips(30))).toBe(false);
	});

	test("false when amount exceeds stack", () => {
		const player = makePlayer({ seat: 0, stack: 50 });
		const round = makeRound({ currentBet: chips(0), minRaise: chips(10) });
		expect(canRaise(player, round, chips(60))).toBe(false);
	});

	test("true when raising exactly min raise from zero", () => {
		const player = makePlayer({ seat: 0, stack: 1000 });
		const round = makeRound({ currentBet: chips(0), minRaise: chips(10) });
		expect(canRaise(player, round, chips(10))).toBe(true);
	});

	test("valid raise with existing partial bet (SB scenario)", () => {
		// SB posted 5, current bet is 10 (BB), minRaise is 10
		const player = makePlayer({ seat: 0, stack: 995, bet: 5 });
		const round = makeRound({ currentBet: chips(10), minRaise: chips(10) });
		// To raise to 20 total bet, needs to put in 15 more (20 - 5 existing)
		expect(canRaise(player, round, chips(15))).toBe(true);
	});
});

describe("callAmount", () => {
	test("full call amount when no prior bet", () => {
		const player = makePlayer({ seat: 0 });
		const round = makeRound({ currentBet: chips(50) });
		expect(callAmount(player, round)).toBe(chips(50));
	});

	test("partial amount with existing bet (SB posting)", () => {
		const player = makePlayer({ seat: 0, bet: 5 });
		const round = makeRound({ currentBet: chips(10) });
		expect(callAmount(player, round)).toBe(chips(5));
	});

	test("zero when already matched", () => {
		const player = makePlayer({ seat: 0, bet: 50 });
		const round = makeRound({ currentBet: chips(50) });
		expect(callAmount(player, round)).toBe(chips(0));
	});
});

describe("applyBetAction fold", () => {
	test("marks player as folded", () => {
		const players = [makePlayer({ seat: 0 }), makePlayer({ seat: 1 })];
		const round = makeRound({ currentBet: chips(50) });
		const result = applyBetAction(players, round, seatIndex(0), {
			type: "fold",
			playerId: "user-0",
		});
		expect(result.players[0].folded).toBe(true);
		expect(result.players[1].folded).toBe(false);
	});
});

describe("applyBetAction check", () => {
	test("validates and marks acted", () => {
		const players = [makePlayer({ seat: 0 }), makePlayer({ seat: 1 })];
		const round = makeRound({ currentBet: chips(0) });
		const result = applyBetAction(players, round, seatIndex(0), {
			type: "check",
			playerId: "user-0",
		});
		expect(result.round.actedThisRound.has(seatIndex(0))).toBe(true);
	});

	test("throws when there is a bet to match", () => {
		const players = [makePlayer({ seat: 0 }), makePlayer({ seat: 1 })];
		const round = makeRound({ currentBet: chips(50) });
		expect(() =>
			applyBetAction(players, round, seatIndex(0), {
				type: "check",
				playerId: "user-0",
			}),
		).toThrow();
	});
});

describe("applyBetAction call", () => {
	test("deducts correct chips", () => {
		const players = [
			makePlayer({ seat: 0, stack: 1000 }),
			makePlayer({ seat: 1, stack: 1000, bet: 50 }),
		];
		const round = makeRound({ currentBet: chips(50) });
		const result = applyBetAction(players, round, seatIndex(0), {
			type: "call",
			playerId: "user-0",
		});
		expect(result.players[0].stack).toBe(chips(950));
		expect(result.players[0].bet).toBe(chips(50));
	});

	test("goes all-in if insufficient chips", () => {
		const players = [
			makePlayer({ seat: 0, stack: 30 }),
			makePlayer({ seat: 1, stack: 1000, bet: 50 }),
		];
		const round = makeRound({ currentBet: chips(50) });
		const result = applyBetAction(players, round, seatIndex(0), {
			type: "call",
			playerId: "user-0",
		});
		expect(result.players[0].stack).toBe(chips(0));
		expect(result.players[0].bet).toBe(chips(30));
		expect(result.players[0].allIn).toBe(true);
	});
});

describe("applyBetAction raise", () => {
	test("updates currentBet and minRaise and deducts chips", () => {
		const players = [
			makePlayer({ seat: 0, stack: 1000 }),
			makePlayer({ seat: 1, stack: 1000, bet: 50 }),
		];
		const round = makeRound({ currentBet: chips(50), minRaise: chips(50) });
		// Raise by putting in 100 more (total bet becomes 100)
		const result = applyBetAction(players, round, seatIndex(0), {
			type: "raise",
			playerId: "user-0",
			amount: chips(100),
		});
		expect(result.players[0].stack).toBe(chips(900));
		expect(result.players[0].bet).toBe(chips(100));
		expect(result.round.currentBet).toBe(chips(100));
		expect(result.round.minRaise).toBe(chips(50));
		expect(result.round.lastRaiserSeat).toBe(seatIndex(0));
	});
});

describe("isBettingRoundComplete", () => {
	test("false when not all players have acted", () => {
		const players = [makePlayer({ seat: 0 }), makePlayer({ seat: 1 })];
		const round = makeRound({
			currentBet: chips(0),
			actedThisRound: new Set([seatIndex(0)]),
		});
		expect(isBettingRoundComplete(players, round)).toBe(false);
	});

	test("true when all active players acted and matched", () => {
		const players = [
			makePlayer({ seat: 0, bet: 50 }),
			makePlayer({ seat: 1, bet: 50 }),
		];
		const round = makeRound({
			currentBet: chips(50),
			actedThisRound: new Set([seatIndex(0), seatIndex(1)]),
		});
		expect(isBettingRoundComplete(players, round)).toBe(true);
	});

	test("true when all but one folded", () => {
		const players = [
			makePlayer({ seat: 0, folded: true }),
			makePlayer({ seat: 1 }),
		];
		const round = makeRound({
			actedThisRound: new Set([seatIndex(0)]),
		});
		expect(isBettingRoundComplete(players, round)).toBe(true);
	});

	test("false when player has acted but not matched bet", () => {
		const players = [
			makePlayer({ seat: 0, bet: 25 }),
			makePlayer({ seat: 1, bet: 50 }),
		];
		const round = makeRound({
			currentBet: chips(50),
			actedThisRound: new Set([seatIndex(0), seatIndex(1)]),
		});
		expect(isBettingRoundComplete(players, round)).toBe(false);
	});

	test("true when remaining players are all-in", () => {
		const players = [
			makePlayer({ seat: 0, allIn: true, stack: 0, bet: 100 }),
			makePlayer({ seat: 1, allIn: true, stack: 0, bet: 200 }),
		];
		const round = makeRound({ currentBet: chips(200) });
		expect(isBettingRoundComplete(players, round)).toBe(true);
	});
});

describe("getNextActiveSeat", () => {
	test("finds next active player", () => {
		const players = [
			makePlayer({ seat: 0 }),
			makePlayer({ seat: 1 }),
			makePlayer({ seat: 2 }),
		];
		expect(getNextActiveSeat(players, seatIndex(0), seatIndex(0))).toBe(
			seatIndex(1),
		);
	});

	test("skips folded players", () => {
		const players = [
			makePlayer({ seat: 0 }),
			makePlayer({ seat: 1, folded: true }),
			makePlayer({ seat: 2 }),
		];
		expect(getNextActiveSeat(players, seatIndex(0), seatIndex(0))).toBe(
			seatIndex(2),
		);
	});

	test("skips all-in players", () => {
		const players = [
			makePlayer({ seat: 0 }),
			makePlayer({ seat: 1, allIn: true, stack: 0 }),
			makePlayer({ seat: 2 }),
		];
		expect(getNextActiveSeat(players, seatIndex(0), seatIndex(0))).toBe(
			seatIndex(2),
		);
	});

	test("wraps around the table", () => {
		const players = [makePlayer({ seat: 0 }), makePlayer({ seat: 5 })];
		expect(getNextActiveSeat(players, seatIndex(5), seatIndex(0))).toBe(
			seatIndex(0),
		);
	});

	test("returns null if no active players", () => {
		const players = [
			makePlayer({ seat: 0, folded: true }),
			makePlayer({ seat: 1, allIn: true, stack: 0 }),
		];
		expect(getNextActiveSeat(players, seatIndex(0), seatIndex(0))).toBeNull();
	});
});
