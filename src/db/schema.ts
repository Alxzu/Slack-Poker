import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export const ledgerAccounts = pgTable(
	"ledger_accounts",
	{
		workspaceId: text("workspace_id").notNull(),
		userId: text("user_id").notNull(),
		balance: integer("balance").notNull().default(1000),
		lockVersion: integer("lock_version").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.workspaceId, table.userId] }),
		check("balance_non_negative", sql`${table.balance} >= 0`),
	],
);

export const games = pgTable("games", {
	id: uuid("id").primaryKey().defaultRandom(),
	workspaceId: text("workspace_id").notNull(),
	channelId: text("channel_id").notNull(),
	buyIn: integer("buy_in").notNull().default(500),
	status: text("status", {
		enum: ["waiting", "active", "complete", "cancelled"],
	})
		.notNull()
		.default("waiting"),
	smallBlind: integer("small_blind").notNull().default(5),
	bigBlind: integer("big_blind").notNull().default(10),
	messageTs: text("message_ts"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const ledgerEvents = pgTable("ledger_events", {
	id: uuid("id").primaryKey().defaultRandom(),
	workspaceId: text("workspace_id").notNull(),
	userId: text("user_id").notNull(),
	type: text("type", {
		enum: ["buy_in", "cash_out", "refill", "transfer_in", "transfer_out"],
	}).notNull(),
	amount: integer("amount").notNull(),
	balanceBefore: integer("balance_before").notNull(),
	balanceAfter: integer("balance_after").notNull(),
	lockVersionBefore: integer("lock_version_before").notNull(),
	lockVersionAfter: integer("lock_version_after").notNull(),
	gameId: uuid("game_id").references(() => games.id),
	idempotencyKey: text("idempotency_key").unique(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const gamePlayers = pgTable(
	"game_players",
	{
		gameId: uuid("game_id")
			.notNull()
			.references(() => games.id),
		userId: text("user_id").notNull(),
		seat: integer("seat").notNull(),
		chipsStart: integer("chips_start").notNull(),
		chipsEnd: integer("chips_end"),
		result: text("result"),
	},
	(table) => [primaryKey({ columns: [table.gameId, table.userId] })],
);

export const gameHands = pgTable("game_hands", {
	id: uuid("id").primaryKey().defaultRandom(),
	gameId: uuid("game_id")
		.notNull()
		.references(() => games.id),
	handNumber: integer("hand_number").notNull(),
	dealerSeat: integer("dealer_seat").notNull(),
	communityCards: jsonb("community_cards"),
	holeCardsEncrypted: text("hole_cards_encrypted"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const handPayouts = pgTable(
	"hand_payouts",
	{
		handId: uuid("hand_id")
			.notNull()
			.references(() => gameHands.id),
		userId: text("user_id").notNull(),
		potIndex: integer("pot_index").notNull().default(0),
		amount: integer("amount").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.handId, table.userId, table.potIndex] }),
	],
);

export const playerStats = pgTable(
	"player_stats",
	{
		workspaceId: text("workspace_id").notNull(),
		userId: text("user_id").notNull(),
		gamesPlayed: integer("games_played").notNull().default(0),
		gamesWon: integer("games_won").notNull().default(0),
		chipsWon: integer("chips_won").notNull().default(0),
		chipsLost: integer("chips_lost").notNull().default(0),
		biggestPot: integer("biggest_pot").notNull().default(0),
		weekNet: integer("week_net").notNull().default(0),
		weekStart: date("week_start"),
	},
	(table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const actionMetrics = pgTable("action_metrics", {
	id: uuid("id").primaryKey().defaultRandom(),
	workspaceId: text("workspace_id").notNull(),
	gameId: uuid("game_id"),
	action: text("action").notNull(),
	detail: text("detail"),
	durationMs: integer("duration_ms"),
	success: boolean("success").notNull().default(true),
	error: text("error"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
