import { describe, expect, test } from "bun:test";
import {
	type Card,
	chips,
	type GameState,
	handId,
	seatIndex,
} from "../../src/engine/types";
import {
	cardsToString,
	cardToEmoji,
	faceDownCards,
} from "../../src/slack/blocks/cards";
import {
	buildGameOverMessage,
	buildPlayingMessage,
	buildShowdownMessage,
	buildWaitingMessage,
} from "../../src/slack/blocks/game-message";
import { buildHoleCardsMessage } from "../../src/slack/blocks/hole-cards";
import {
	buildEmptyLeaderboard,
	buildLeaderboardMessage,
} from "../../src/slack/blocks/leaderboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(rank: Card["rank"], suit: Card["suit"]): Card {
	return { rank, suit };
}

function findBlockText(blocks: object[], search: string): boolean {
	return JSON.stringify(blocks).includes(search);
}

function findAction(blocks: object[], actionId: string): boolean {
	return JSON.stringify(blocks).includes(actionId);
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
	return {
		id: "game-1",
		phase: "flop",
		players: [
			{
				userId: "U001",
				seat: seatIndex(0),
				stack: chips(500),
				bet: chips(0),
				folded: false,
				allIn: false,
				sittingOut: false,
				consecutiveTimeouts: 0,
			},
			{
				userId: "U002",
				seat: seatIndex(1),
				stack: chips(450),
				bet: chips(50),
				folded: false,
				allIn: false,
				sittingOut: false,
				consecutiveTimeouts: 0,
			},
		],
		deck: [],
		communityCards: [
			makeCard("A", "spades"),
			makeCard("K", "hearts"),
			makeCard("10", "diamonds"),
		],
		pots: [
			{ amount: chips(200), eligiblePlayers: [seatIndex(0), seatIndex(1)] },
		],
		dealerSeat: seatIndex(0),
		activeSeat: seatIndex(1),
		smallBlind: chips(5),
		bigBlind: chips(10),
		handId: handId("hand-1"),
		handNumber: 3,
		betting: {
			currentBet: chips(0),
			minRaise: chips(10),
			lastRaiserSeat: null,
			actedThisRound: new Set(),
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// cardToEmoji
// ---------------------------------------------------------------------------

describe("cardToEmoji", () => {
	test("maps spades correctly", () => {
		expect(cardToEmoji(makeCard("A", "spades"))).toBe(":spades: A");
	});

	test("maps hearts correctly", () => {
		expect(cardToEmoji(makeCard("10", "hearts"))).toBe(":hearts: 10");
	});

	test("maps diamonds correctly", () => {
		expect(cardToEmoji(makeCard("Q", "diamonds"))).toBe(":diamonds: Q");
	});

	test("maps clubs correctly", () => {
		expect(cardToEmoji(makeCard("2", "clubs"))).toBe(":clubs: 2");
	});
});

describe("cardsToString", () => {
	test("joins multiple cards", () => {
		const result = cardsToString([
			makeCard("A", "spades"),
			makeCard("K", "hearts"),
		]);
		expect(result).toContain(":spades: A");
		expect(result).toContain(":hearts: K");
	});
});

describe("faceDownCards", () => {
	test("generates correct number of placeholders", () => {
		const result = faceDownCards(3);
		expect(result).toBe(":black_square: :black_square: :black_square:");
	});

	test("single card", () => {
		expect(faceDownCards(1)).toBe(":black_square:");
	});
});

// ---------------------------------------------------------------------------
// buildWaitingMessage
// ---------------------------------------------------------------------------

describe("buildWaitingMessage", () => {
	const game = {
		id: "g1",
		buyIn: 500,
		creatorId: "U001",
		players: [{ userId: "U001" }, { userId: "U002" }],
	};

	test("contains Join button", () => {
		const blocks = buildWaitingMessage(game);
		expect(findAction(blocks, "poker_join")).toBe(true);
	});

	test("contains Start button", () => {
		const blocks = buildWaitingMessage(game);
		expect(findAction(blocks, "poker_start")).toBe(true);
	});

	test("lists players", () => {
		const blocks = buildWaitingMessage(game);
		expect(findBlockText(blocks, "<@U001>")).toBe(true);
		expect(findBlockText(blocks, "<@U002>")).toBe(true);
	});

	test("includes buy-in amount", () => {
		const blocks = buildWaitingMessage(game);
		expect(findBlockText(blocks, "500")).toBe(true);
	});

	test("includes instruction text", () => {
		const blocks = buildWaitingMessage(game);
		expect(
			findBlockText(blocks, "Creator can start when 2+ players have joined"),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildPlayingMessage
// ---------------------------------------------------------------------------

describe("buildPlayingMessage", () => {
	test("includes community cards", () => {
		const state = makeGameState();
		const blocks = buildPlayingMessage(state);
		expect(findBlockText(blocks, ":spades: A")).toBe(true);
		expect(findBlockText(blocks, ":hearts: K")).toBe(true);
	});

	test("includes hand number and phase", () => {
		const state = makeGameState();
		const blocks = buildPlayingMessage(state);
		expect(findBlockText(blocks, "Hand #3")).toBe(true);
		expect(findBlockText(blocks, "Flop")).toBe(true);
	});

	test("includes player rows", () => {
		const state = makeGameState();
		const blocks = buildPlayingMessage(state);
		expect(findBlockText(blocks, "<@U001>")).toBe(true);
		expect(findBlockText(blocks, "<@U002>")).toBe(true);
	});

	test("includes action buttons", () => {
		const state = makeGameState();
		const blocks = buildPlayingMessage(state);
		expect(findAction(blocks, "poker_fold")).toBe(true);
		expect(findAction(blocks, "poker_check")).toBe(true);
		expect(findAction(blocks, "poker_raise")).toBe(true);
	});

	test("shows Call button when there is a bet to call", () => {
		const state = makeGameState({
			betting: {
				currentBet: chips(50),
				minRaise: chips(100),
				lastRaiserSeat: seatIndex(0),
				actedThisRound: new Set(),
			},
		});
		const blocks = buildPlayingMessage(state);
		expect(findAction(blocks, "poker_call")).toBe(true);
		expect(findBlockText(blocks, "Call 50")).toBe(true);
	});

	test("shows waiting for active player", () => {
		const state = makeGameState();
		const blocks = buildPlayingMessage(state);
		expect(findBlockText(blocks, "Waiting for <@U002>")).toBe(true);
	});

	test("shows side pots separately when multiple", () => {
		const state = makeGameState({
			pots: [
				{ amount: chips(300), eligiblePlayers: [seatIndex(0), seatIndex(1)] },
				{ amount: chips(150), eligiblePlayers: [seatIndex(0)] },
			],
		});
		const blocks = buildPlayingMessage(state);
		expect(findBlockText(blocks, "Main Pot: 300")).toBe(true);
		expect(findBlockText(blocks, "Side Pot: 150")).toBe(true);
	});

	test("shows face-down placeholders for preflop", () => {
		const state = makeGameState({ phase: "preflop", communityCards: [] });
		const blocks = buildPlayingMessage(state);
		expect(findBlockText(blocks, ":black_square:")).toBe(true);
	});

	test("shows last hand result when provided", () => {
		const state = makeGameState();
		const blocks = buildPlayingMessage(state, "U001 wins 200 chips!");
		expect(findBlockText(blocks, "U001 wins 200 chips!")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildShowdownMessage
// ---------------------------------------------------------------------------

describe("buildShowdownMessage", () => {
	test("reveals cards and shows winner", () => {
		const state = makeGameState({ phase: "showdown" });
		const results = [
			{
				userId: "U001",
				cards: [makeCard("A", "spades"), makeCard("K", "spades")],
				handName: "Flush",
				payout: 200,
			},
			{
				userId: "U002",
				cards: [makeCard("10", "hearts"), makeCard("J", "hearts")],
				handName: "Pair",
				payout: 0,
			},
		];
		const blocks = buildShowdownMessage(state, results);
		expect(findBlockText(blocks, "Flush")).toBe(true);
		expect(findBlockText(blocks, "+200")).toBe(true);
		expect(findBlockText(blocks, ":spades: A")).toBe(true);
		expect(findBlockText(blocks, "Showdown")).toBe(true);
	});

	test("shows community cards", () => {
		const state = makeGameState({ phase: "showdown" });
		const blocks = buildShowdownMessage(state, []);
		expect(findBlockText(blocks, "Board")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildGameOverMessage
// ---------------------------------------------------------------------------

describe("buildGameOverMessage", () => {
	test("includes player P&L", () => {
		const game = {
			handsPlayed: 10,
			players: [
				{ userId: "U001", chipsDelta: 250 },
				{ userId: "U002", chipsDelta: -250 },
			],
		};
		const blocks = buildGameOverMessage(game);
		expect(findBlockText(blocks, "+250")).toBe(true);
		expect(findBlockText(blocks, "-250")).toBe(true);
		expect(findBlockText(blocks, "Game Over")).toBe(true);
	});

	test("shows hands played", () => {
		const game = { handsPlayed: 15, players: [] };
		const blocks = buildGameOverMessage(game);
		expect(findBlockText(blocks, "15")).toBe(true);
	});

	test("sorts players by P&L descending", () => {
		const game = {
			handsPlayed: 5,
			players: [
				{ userId: "U003", chipsDelta: -100 },
				{ userId: "U001", chipsDelta: 300 },
				{ userId: "U002", chipsDelta: -200 },
			],
		};
		const blocks = buildGameOverMessage(game);
		const json = JSON.stringify(blocks);
		const u1Pos = json.indexOf("U001");
		const u2Pos = json.indexOf("U002");
		const u3Pos = json.indexOf("U003");
		expect(u1Pos).toBeLessThan(u3Pos);
		expect(u3Pos).toBeLessThan(u2Pos);
	});
});

// ---------------------------------------------------------------------------
// buildHoleCardsMessage
// ---------------------------------------------------------------------------

describe("buildHoleCardsMessage", () => {
	test("includes card emoji", () => {
		const cards = [makeCard("A", "spades"), makeCard("K", "hearts")];
		const blocks = buildHoleCardsMessage(cards);
		expect(findBlockText(blocks, ":spades: A")).toBe(true);
		expect(findBlockText(blocks, ":hearts: K")).toBe(true);
	});

	test("includes hand hint when provided", () => {
		const cards = [makeCard("A", "spades"), makeCard("A", "hearts")];
		const blocks = buildHoleCardsMessage(cards, "Pocket Aces!");
		expect(findBlockText(blocks, "Pocket Aces!")).toBe(true);
	});

	test("includes turn info when provided", () => {
		const cards = [makeCard("A", "spades"), makeCard("K", "hearts")];
		const blocks = buildHoleCardsMessage(cards, undefined, {
			pot: 100,
			toCall: 20,
		});
		expect(findBlockText(blocks, "100")).toBe(true);
		expect(findBlockText(blocks, "20")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildLeaderboardMessage
// ---------------------------------------------------------------------------

describe("buildLeaderboardMessage", () => {
	test("formats rankings correctly", () => {
		const entries = [
			{ userId: "U001", rank: 1, value: 1500, gamesPlayed: 10 },
			{
				userId: "U002",
				rank: 2,
				value: 800,
				gamesPlayed: 8,
				movement: "up" as const,
			},
			{
				userId: "U003",
				rank: 3,
				value: -200,
				gamesPlayed: 5,
				movement: "down" as const,
			},
		];
		const blocks = buildLeaderboardMessage("alltime", entries);
		expect(findBlockText(blocks, "first_place_medal")).toBe(true);
		expect(findBlockText(blocks, "second_place_medal")).toBe(true);
		expect(findBlockText(blocks, "U001")).toBe(true);
		expect(findBlockText(blocks, "10 games")).toBe(true);
		expect(findBlockText(blocks, "arrow_up")).toBe(true);
	});

	test("shows win rate as percentage", () => {
		const entries = [{ userId: "U001", rank: 1, value: 75, gamesPlayed: 20 }];
		const blocks = buildLeaderboardMessage("winrate", entries);
		expect(findBlockText(blocks, "75%")).toBe(true);
	});

	test("shows weekly title", () => {
		const blocks = buildLeaderboardMessage("weekly", []);
		expect(findBlockText(blocks, "Weekly Leaderboard")).toBe(true);
	});
});

describe("buildEmptyLeaderboard", () => {
	test("shows appropriate message", () => {
		const blocks = buildEmptyLeaderboard("weekly");
		expect(findBlockText(blocks, "No weekly data yet")).toBe(true);
	});
});
