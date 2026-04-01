# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SlackPoker — a Texas Hold'em poker game that runs entirely inside Slack using slash commands and Block Kit interactive messages. Players manage persistent chip ledgers, compete on leaderboards, and play full poker hands without leaving Slack.

## Commands

- **Install dependencies:** `bun install`
- **Run dev server (hot reload):** `bun run dev` — serves on http://localhost:3000
- **Run tests:** `bun test`
- **Run single test:** `bun test <path>`
- **Start local Postgres + Redis:** `docker compose up -d`
- **Stop local services:** `docker compose down` (add `-v` to also wipe data)

## Tech Stack

- **Runtime:** Bun
- **Web framework:** Hono (with JSX via `hono/jsx`)
- **Database:** PostgreSQL 16 with Drizzle ORM
- **Cache / Game State:** Redis with GroupMQ for per-table action queues
- **Postgres driver:** `postgres` (porsager) — NOT `bun:sql` (drizzle-kit incompatibility)
- **Slack:** `@slack/web-api` + `@slack/socket-mode` (no Bolt — we use Hono for HTTP)
- **Language:** TypeScript (strict mode)
- **Logging:** pino (structured JSON to stdout — no platform dependency)
- **Linter/Formatter:** Biome (sole tool — no ESLint or Prettier)
- **Deployment:** Docker container (any platform — no vendor lock-in)
- **Package manager:** Bun

## Architecture

The codebase is split into four layers with strict dependency boundaries:

- **`src/engine/`** — Pure game logic (deck, hand evaluation, betting, pot calculation, table state machine). **Zero I/O dependencies.** This is the most testable layer; all functions take state in and return new state.
- **`src/slack/`** — Slack integration: route handlers, Block Kit message builders, Slack API client. Depends on engine and db.
- **`src/db/`** — Database layer: Drizzle schema, ledger service (append-only events), player stats. All chip mutations go through `ledger_events` for auditability.
- **`src/workers/`** — Background processors: per-table Redis action queues, 60s turn timer (auto-fold), daily/weekly cron jobs.

**Dependency rule:** `engine/` imports nothing outside itself. `db/` imports nothing from `slack/`. `slack/` and `workers/` can import from both `engine/` and `db/`.

## Key Patterns

- **Immutable game state:** `applyAction(state, action) → newState` in the engine. No mutation.
- **Append-only ledger:** All chip movements (buy-in, win, loss, refill, transfer) are recorded as events in `ledger_events`. The `ledger_accounts` balance is the source of truth, protected by optimistic locking (version counter).
- **Idempotency keys** on all ledger event inserts to prevent double-credits on retries.
- **Branded types:** `Chips`, `SeatIndex`, `HandId` prevent mixing different numeric domains at compile time.
- **GroupMQ per-table groups** — single queue, one `groupId` per table. Serial within a table, parallel across tables.
- **Hybrid storage:** Redis for live game state (sub-ms reads), Postgres for permanent record. Postgres is always source of truth for balances.
- **Immediate ack:** All Slack requests must be acknowledged with 200 OK within 3 seconds. Actual work is enqueued to Redis after ack.
- **In-place message updates:** The game state is a single Slack message updated via `chat.update` — no message spam.

## Watch Out For

- **Slack 3-second timeout:** If the ack takes longer than 3s, Slack shows an error to the user. Always ack first, process later.
- **Side pot complexity:** Multiple all-ins at different stack sizes create side pots. The `engine/pot.ts` logic must handle N-way side pots correctly.
- **Hole card security:** Hole cards are AES-256-GCM encrypted in `game_hands`. Never include hole card data in channel messages — only in DMs.
- **Button clicks from wrong player:** Send ephemeral "It's [name]'s turn" — do NOT silently ignore (confuses users).
- **Heads-up blind exception:** In 2-player games, the dealer posts the small blind (not the standard order).
- **Hand evaluator is internal:** No external dependency — custom implementation in `engine/hand-evaluator.ts`. Study reference repos for algorithms but don't import them.
- **Normalized schema:** Use `game_players` join table, NOT JSONB `players` column on `games` (JSONB causes poor query plans and no referential integrity).
- **Prefer internal logic over dependencies:** For core game logic (deck, hand evaluation, pot calculation, betting), build internally rather than importing packages. External deps are fine for infrastructure (Drizzle, Redis, Slack API).
- **Ledger writes only on game end:** Chips stay at the table during a session. Only write to ledger on buy-in (game start) and cash-out (game end/leave). Never per-hand.
- **One game per player:** A player cannot be in two active games simultaneously.
- **DM updates via `chat.update`:** Update the same DM message for hole card hints and turn notifications. Never send new DMs per street (notification spam).

## Lint & Format

- **Check:** `bunx biome check .`
- **Fix:** `bunx biome check --write .`

## Deployment

- **Local Raspberry Pi:** Run `/deploy-pi` to sync source, rebuild, and verify health on the Pi
- Deploy config (SSH credentials) lives in `.env.deploy` (gitignored) — never commit secrets
- Pi runs the full stack via `docker-compose.prod.yml` on port 4444 (Socket Mode, no public URL needed)
- Database migrations are manual — pipe SQL to the postgres container (see deploy skill for details)

## Plan Tracking

- Implementation plan lives in `.claude/plans/implementation.md`
- Run `/plan-check` to validate implementation progress against the plan
- Run `/plan-refine <area>` to deep-dive and update a specific section of the plan
