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
- **Cache / Game State:** Redis with BullMQ for action queues
- **Slack:** `@slack/web-api` (no Bolt — we use Hono for HTTP)
- **Language:** TypeScript (strict mode)
- **Linter/Formatter:** Biome (sole tool — no ESLint or Prettier)
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
- **One Redis queue per table** — actions processed serially to prevent race conditions. Different tables process in parallel.
- **Immediate ack:** All Slack requests must be acknowledged with 200 OK within 3 seconds. Actual work is enqueued to Redis after ack.
- **In-place message updates:** The game state is a single Slack message updated via `chat.update` — no message spam.

## Watch Out For

- **Slack 3-second timeout:** If the ack takes longer than 3s, Slack shows an error to the user. Always ack first, process later.
- **Side pot complexity:** Multiple all-ins at different stack sizes create side pots. The `engine/pot.ts` logic must handle N-way side pots correctly.
- **Hole card security:** Hole cards are AES-256-GCM encrypted in `game_hands`. Never include hole card data in channel messages — only in DMs.
- **Button clicks from wrong player:** Silently ignore actions from non-active players (no error message).
- **Heads-up blind exception:** In 2-player games, the dealer posts the small blind (not the standard order).

## Lint & Format

- **Check:** `bunx biome check .`
- **Fix:** `bunx biome check --write .`

## Plan Tracking

- Implementation plan lives in `.claude/plans/implementation.md`
- Run `/plan-check` to validate implementation progress against the plan
- Run `/plan-refine <area>` to deep-dive and update a specific section of the plan
