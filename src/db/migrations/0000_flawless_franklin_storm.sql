CREATE TABLE "action_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"game_id" uuid,
	"action" text NOT NULL,
	"detail" text,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_hands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"hand_number" integer NOT NULL,
	"dealer_seat" integer NOT NULL,
	"community_cards" jsonb,
	"hole_cards_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"seat" integer NOT NULL,
	"chips_start" integer NOT NULL,
	"chips_end" integer,
	"result" text,
	CONSTRAINT "game_players_game_id_user_id_pk" PRIMARY KEY("game_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"buy_in" integer DEFAULT 500 NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"small_blind" integer DEFAULT 5 NOT NULL,
	"big_blind" integer DEFAULT 10 NOT NULL,
	"message_ts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hand_payouts" (
	"hand_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"pot_index" integer DEFAULT 0 NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "hand_payouts_hand_id_user_id_pot_index_pk" PRIMARY KEY("hand_id","user_id","pot_index")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"balance" integer DEFAULT 1000 NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "balance_non_negative" CHECK ("ledger_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"lock_version_before" integer NOT NULL,
	"lock_version_after" integer NOT NULL,
	"game_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"games_won" integer DEFAULT 0 NOT NULL,
	"chips_won" integer DEFAULT 0 NOT NULL,
	"chips_lost" integer DEFAULT 0 NOT NULL,
	"biggest_pot" integer DEFAULT 0 NOT NULL,
	"week_net" integer DEFAULT 0 NOT NULL,
	"week_start" date,
	CONSTRAINT "player_stats_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "game_hands" ADD CONSTRAINT "game_hands_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_payouts" ADD CONSTRAINT "hand_payouts_hand_id_game_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."game_hands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;