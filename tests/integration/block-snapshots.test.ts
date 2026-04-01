import { describe, expect, test } from "bun:test";
import type {
	BettingRoundState,
	Card,
	GameState,
	PlayerState,
} from "../../src/engine/types";
import { chips, handId, seatIndex } from "../../src/engine/types";
import {
	buildGameOverMessage,
	buildPlayingMessage,
	buildShowdownMessage,
	buildWaitingMessage,
} from "../../src/slack/blocks/game-message";

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
		handNumber: overrides.handNumber ?? 1,
		betting: overrides.betting ?? makeRound(),
	};
}

function _blockText(block: unknown): string {
	const b = block as Record<string, unknown>;
	const text = b.text as Record<string, string> | undefined;
	return text?.text ?? "";
}

function flattenBlocks(blocks: object[]): string {
	return JSON.stringify(blocks);
}

// ── Waiting room message ─────────────────────────────────────────

describe("Waiting room message structure", () => {
	test("contains Join and Start buttons with correct action_ids", () => {
		const blocks = buildWaitingMessage({
			id: "game-1",
			buyIn: 500,
			creatorId: "U_CREATOR",
			players: [
				{ userId: "U_ALICE" },
				{ userId: "U_BOB" },
				{ userId: "U_CHARLIE" },
				{ userId: "U_DAVE" },
			],
		});

		const json = flattenBlocks(blocks);

		// Check Join button
		expect(json).toContain("poker_join");
		expect(json).toContain("Join Game");

		// Check Start button
		expect(json).toContain("poker_start");
		expect(json).toContain("Start Game");

		// Check player list shown
		expect(json).toContain("<@U_ALICE>");
		expect(json).toContain("<@U_BOB>");
		expect(json).toContain("<@U_CHARLIE>");
		expect(json).toContain("<@U_DAVE>");

		// Check buy-in shown
		expect(json).toContain("500");
	});

	test("shows 'No players yet' when empty", () => {
		const blocks = buildWaitingMessage({
			id: "game-2",
			buyIn: 1000,
			creatorId: "U_CREATOR",
			players: [],
		});

		const json = flattenBlocks(blocks);
		expect(json).toContain("No players yet");
	});
});

// ── Playing message ──────────────────────────────────────────────

describe("Playing message with all elements", () => {
	test("renders header, community cards, player statuses, and action buttons", () => {
		const state = makeGameState({
			phase: "flop",
			handNumber: 3,
			players: [
				makePlayer({
					userId: "U_ALICE",
					seat: 0,
					stack: chips(800),
					bet: chips(50),
				}),
				makePlayer({
					userId: "U_BOB",
					seat: 1,
					stack: chips(0),
					bet: chips(200),
					allIn: true,
				}),
				makePlayer({
					userId: "U_CHARLIE",
					seat: 2,
					stack: chips(950),
					folded: true,
				}),
				makePlayer({
					userId: "U_DAVE",
					seat: 3,
					stack: chips(700),
					bet: chips(50),
				}),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			communityCards: [
				card("A", "spades"),
				card("K", "hearts"),
				card("10", "diamonds"),
			],
			pots: [
				{
					amount: chips(300),
					eligiblePlayers: [
						seatIndex(0),
						seatIndex(1),
						seatIndex(2),
						seatIndex(3),
					],
				},
			],
			betting: makeRound({ currentBet: chips(50), minRaise: chips(50) }),
		});

		const blocks = buildPlayingMessage(state);
		const json = flattenBlocks(blocks);

		// Header shows hand number, phase, pot
		expect(json).toContain("Hand #3");
		expect(json).toContain("Flop");
		expect(json).toContain("300");

		// Community cards shown
		expect(json).toContain("Board");

		// Folded player shows "Folded"
		expect(json).toContain("Folded");

		// All-in player shows "ALL IN"
		expect(json).toContain("ALL IN");

		// Active player has turn indicator
		expect(json).toContain(":point_right:");
		expect(json).toContain("<@U_ALICE>");

		// Action buttons present
		expect(json).toContain("poker_fold");
		expect(json).toContain("poker_call");
		expect(json).toContain("poker_raise");
	});

	test("shows check button when no bet to match", () => {
		const state = makeGameState({
			phase: "flop",
			handNumber: 1,
			players: [
				makePlayer({ userId: "U_ALICE", seat: 0, stack: chips(990) }),
				makePlayer({ userId: "U_BOB", seat: 1, stack: chips(990) }),
			],
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			communityCards: [
				card("A", "spades"),
				card("K", "hearts"),
				card("10", "diamonds"),
			],
			pots: [
				{ amount: chips(20), eligiblePlayers: [seatIndex(0), seatIndex(1)] },
			],
			betting: makeRound({ currentBet: chips(0) }),
		});

		const blocks = buildPlayingMessage(state);
		const json = flattenBlocks(blocks);

		expect(json).toContain("poker_check");
		expect(json).toContain("Check");
	});
});

// ── Showdown message ─────────────────────────────────────────────

describe("Showdown message reveals cards", () => {
	test("shows winner cards, hand name, and payout", () => {
		const state = makeGameState({
			phase: "showdown",
			handNumber: 5,
			communityCards: [
				card("A", "spades"),
				card("K", "hearts"),
				card("10", "diamonds"),
				card("7", "clubs"),
				card("2", "spades"),
			],
		});

		const results = [
			{
				userId: "U_ALICE",
				cards: [card("A", "hearts"), card("A", "diamonds")],
				handName: "Three of a Kind",
				payout: 500,
			},
			{
				userId: "U_BOB",
				cards: [card("K", "diamonds"), card("Q", "hearts")],
				handName: "Pair",
				payout: 0,
			},
		];

		const blocks = buildShowdownMessage(state, results);
		const json = flattenBlocks(blocks);

		// Winner's hand name shown
		expect(json).toContain("Three of a Kind");
		// Payout shown
		expect(json).toContain("+500");
		// Cards rendered
		expect(json).toContain("U_ALICE");
		expect(json).toContain("U_BOB");
		// Hand number in header
		expect(json).toContain("Hand #5");
		// Board shown
		expect(json).toContain("Board");
	});
});

// ── Game over with P&L ───────────────────────────────────────────

describe("Game over with P&L", () => {
	test("shows profit/loss sorted by chips delta", () => {
		const blocks = buildGameOverMessage({
			handsPlayed: 15,
			players: [
				{ userId: "U_ALICE", chipsDelta: 300 },
				{ userId: "U_BOB", chipsDelta: -150 },
				{ userId: "U_CHARLIE", chipsDelta: -150 },
			],
		});

		const json = flattenBlocks(blocks);

		// Game over header
		expect(json).toContain("Game Over");

		// Hands played
		expect(json).toContain("15");

		// Positive delta shown with +
		expect(json).toContain("+300");

		// Negative delta shown
		expect(json).toContain("-150");

		// Players sorted by delta (highest first)
		const aliceIdx = json.indexOf("U_ALICE");
		const bobIdx = json.indexOf("U_BOB");
		expect(aliceIdx).toBeLessThan(bobIdx);

		// Upward trend emoji for winner
		expect(json).toContain(":chart_with_upwards_trend:");
		// Downward trend for losers
		expect(json).toContain(":chart_with_downwards_trend:");
	});
});

// ── Message stays under 50 blocks ────────────────────────────────

describe("Message stays under 50 blocks", () => {
	test("playing message with 8 players stays under 50 blocks", () => {
		const players = Array.from({ length: 8 }, (_, i) =>
			makePlayer({
				userId: `U_PLAYER_${i}`,
				seat: i,
				stack: chips(1000 - i * 50),
				bet: chips(i * 10),
			}),
		);

		const state = makeGameState({
			phase: "flop",
			handNumber: 10,
			players,
			activeSeat: seatIndex(0),
			dealerSeat: seatIndex(0),
			communityCards: [
				card("A", "spades"),
				card("K", "hearts"),
				card("10", "diamonds"),
			],
			pots: [
				{
					amount: chips(500),
					eligiblePlayers: players.map((p) => p.seat),
				},
			],
			betting: makeRound({ currentBet: chips(50) }),
		});

		const blocks = buildPlayingMessage(state);
		expect(blocks.length).toBeLessThanOrEqual(50);
	});
});
