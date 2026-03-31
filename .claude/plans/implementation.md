# SlackPoker — Implementation Plan

Based on the PRD v1.0 (March 2026). This plan covers the full v1 scope (P0 + P1 features).
Tournament mode (P1/v1.1) is outlined but not detailed.

---

## Phase 1: Project Foundation (Week 1)

### 1.1 Project Setup & Tooling
- [ ] Configure `tsconfig.json` with path aliases (`@/engine`, `@/slack`, `@/db`, `@/workers`)
- [ ] Add Biome for linting/formatting (`biome.json` config)
- [ ] Add `bun test` configuration and scripts to `package.json`
- [ ] Set up `.env.example` with all required env vars (documented below)
- [ ] Add Docker Compose for local Postgres + Redis (see 1.5)

### 1.2 Environment Variables
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-... (if using socket mode for dev)
DATABASE_URL=postgres://...
REDIS_URL=redis://...
ENCRYPTION_KEY=... (AES-256 for hole card encryption)
```

### 1.3 Source Directory Structure
```
src/
├── index.ts                 # Hono app entrypoint, route registration
├── config.ts                # Env var loading and validation
├── engine/                  # Pure game logic — zero Slack/DB dependencies
│   ├── deck.ts              # Deck, shuffle (crypto PRNG)
│   ├── hand-evaluator.ts    # 7-card evaluation → best 5-card hand
│   ├── betting.ts           # Betting round logic, blinds, all-in side pots
│   ├── table.ts             # Table state machine (waiting → preflop → flop → turn → river → showdown)
│   ├── pot.ts               # Pot and side pot calculations
│   └── types.ts             # Card, Hand, Player, GameState types
├── slack/                   # Slack integration layer
│   ├── routes.ts            # Hono routes: /slack/commands, /slack/actions, /slack/events
│   ├── verify.ts            # Slack request signature verification middleware
│   ├── commands/            # One handler per slash subcommand
│   │   ├── new.ts
│   │   ├── join.ts
│   │   ├── start.ts
│   │   ├── balance.ts
│   │   ├── refill.ts
│   │   ├── transfer.ts
│   │   ├── leaderboard.ts
│   │   ├── stats.ts
│   │   └── help.ts
│   ├── actions.ts           # Interactive button/modal payload dispatcher
│   ├── blocks/              # Block Kit message builders
│   │   ├── game-message.ts  # Main channel game message
│   │   ├── hole-cards.ts    # DM hole card message
│   │   └── leaderboard.ts   # Leaderboard message
│   └── client.ts            # Slack Web API wrapper (chat.postMessage, chat.update, etc.)
├── db/                      # Database layer
│   ├── connection.ts        # Postgres connection pool (pg or drizzle)
│   ├── schema.ts            # Table definitions
│   ├── migrations/          # SQL migration files
│   ├── ledger.ts            # Ledger account & event operations
│   ├── stats.ts             # player_stats read/write
│   └── games.ts             # Game and hand persistence
├── workers/                 # Background processing
│   ├── action-queue.ts      # Redis queue consumer — one queue per table
│   ├── turn-timer.ts        # 60s auto-fold timer per active player
│   └── cron.ts              # Daily refill, weekly leaderboard post
└── utils/
    ├── crypto.ts            # AES-256 encrypt/decrypt for hole cards
    └── ids.ts               # ID generation helpers
```

### 1.4 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | Drizzle ORM | Type-safe, lightweight, good Bun support |
| Slack SDK | Raw HTTP via Hono (no @slack/bolt) | Bolt bundles Express; we already have Hono. Use `@slack/web-api` for API calls only |
| Hand evaluator | `pokersolver` npm package initially | Swap to Rust WASM if perf becomes an issue |
| Queue | BullMQ on Redis | Mature, supports per-table named queues |
| Migrations | Drizzle Kit | Keeps schema and migrations in sync |

### 1.5 Docker Compose (`docker-compose.yml`)

The compose file defines two services for local development:

**Services:**
- **`postgres`** — PostgreSQL 16, port 5432, with a named volume for data persistence between restarts
- **`redis`** — Redis 7, port 6379

**Common commands:**
```bash
# Start both services in the background
docker compose up -d

# Check running services
docker compose ps

# View logs (useful when debugging connection issues)
docker compose logs postgres
docker compose logs redis

# Stop services (data is preserved in volumes)
docker compose down

# Stop AND delete all data (fresh start)
docker compose down -v

# Restart a single service
docker compose restart postgres
```

The `DATABASE_URL` and `REDIS_URL` in `.env` will point to these local containers:
```
DATABASE_URL=postgres://poker:poker@localhost:5432/slackpoker
REDIS_URL=redis://localhost:6379
```

---

## Phase 2: Game Engine (Weeks 1–2)

This is the core — **pure TypeScript, no I/O, fully unit-testable**.

### 2.1 Card & Deck (`engine/deck.ts`)
- [ ] `Card` type: `{ rank: Rank, suit: Suit }`
- [ ] `createDeck()`: returns 52-card array
- [ ] `shuffle(deck)`: Fisher-Yates using `crypto.getRandomValues()`
- [ ] `deal(deck, count)`: returns cards + remaining deck

### 2.2 Hand Evaluator (`engine/hand-evaluator.ts`)
- [ ] Integrate `pokersolver` or implement evaluator
- [ ] `evaluateHand(7 cards) → { rank, name, bestFive }`
- [ ] `compareHands(handA, handB) → -1 | 0 | 1`
- [ ] Handle all rankings: high card → royal flush
- [ ] **Tests**: exhaustive edge cases — split pots, kickers, suited vs offsuit

### 2.3 Betting Logic (`engine/betting.ts`)
- [ ] `BettingRound` state: tracks bets per player, current bet to match, min raise
- [ ] Actions: `fold(player)`, `check(player)`, `call(player)`, `raise(player, amount)`
- [ ] Validate each action against game state (can't check when there's a bet, etc.)
- [ ] Calculate required call amount per player
- [ ] Detect round completion (all active players have acted and matched)
- [ ] **Tests**: all action sequences, invalid action rejection

### 2.4 Pot Calculation (`engine/pot.ts`)
- [ ] `calculatePots(players, bets)` → main pot + side pots
- [ ] Handle multiple all-ins at different stack sizes
- [ ] `distributePots(pots, handRankings)` → payout per player
- [ ] **Tests**: 2-player, 3+ player, multiple side pots, split pots

### 2.5 Table State Machine (`engine/table.ts`)
- [ ] States: `WAITING` → `PRE_FLOP` → `FLOP` → `TURN` → `RIVER` → `SHOWDOWN` → `COMPLETE`
- [ ] `GameState` type: players, deck, community cards, pots, current stage, active player index, dealer position
- [ ] `createGame(players, blinds)` → initial GameState
- [ ] `applyAction(state, action)` → new GameState (immutable transitions)
- [ ] Auto-advance: if all but one fold → immediate win; if betting round complete → next street
- [ ] Dealer button rotation between hands
- [ ] Blind posting (SB/BB) with heads-up exception (2 players)
- [ ] **Tests**: full game simulations end-to-end with known deck orders

---

## Phase 3: Database & Ledger (Week 3)

### 3.1 Schema & Migrations (`db/schema.ts`, `db/migrations/`)
- [ ] `ledger_accounts` table:
  ```sql
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 1000,
  version INTEGER NOT NULL DEFAULT 0,  -- optimistic locking
  PRIMARY KEY (workspace_id, user_id)
  ```
- [ ] `ledger_events` table:
  ```sql
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- buy_in, win, loss, refill, transfer, tournament_entry
  amount INTEGER NOT NULL,
  game_id UUID REFERENCES games(id),
  idempotency_key TEXT UNIQUE,  -- prevent double-credits
  created_at TIMESTAMPTZ DEFAULT now()
  ```
- [ ] `games` table:
  ```sql
  id UUID PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  buy_in INTEGER NOT NULL DEFAULT 500,
  status TEXT NOT NULL,  -- waiting, active, complete
  players JSONB NOT NULL,  -- [{user_id, seat}]
  winner_user_id TEXT,
  total_pot INTEGER,
  message_ts TEXT,  -- Slack message timestamp for chat.update
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
  ```
- [ ] `game_hands` table:
  ```sql
  id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(id),
  hand_number INTEGER NOT NULL,
  hole_cards_encrypted BYTEA,  -- AES-256 encrypted JSON
  community_cards TEXT[],
  winner_user_id TEXT,
  pot INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
  ```
- [ ] `player_stats` table:
  ```sql
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  chips_won INTEGER DEFAULT 0,
  chips_lost INTEGER DEFAULT 0,
  week_net INTEGER DEFAULT 0,
  week_start DATE,
  PRIMARY KEY (workspace_id, user_id)
  ```
- [ ] Run initial migration, verify with `drizzle-kit push`

### 3.2 Ledger Service (`db/ledger.ts`)
- [ ] `getOrCreateAccount(workspaceId, userId)` — creates with 1000 chips on first access
- [ ] `debit(workspaceId, userId, amount, type, idempotencyKey)` — optimistic lock with version check
- [ ] `credit(workspaceId, userId, amount, type, idempotencyKey)`
- [ ] `transfer(fromUser, toUser, amount)` — in a transaction, enforce 1000/day cap
- [ ] `claimRefill(workspaceId, userId)` — only if balance < 100, once per day
- [ ] All mutations write to `ledger_events` atomically
- [ ] **Tests**: concurrent debit race conditions, idempotency, transfer caps

### 3.3 Stats Service (`db/stats.ts`)
- [ ] `updateStatsAfterGame(workspaceId, players, winner, pot)`
- [ ] `getLeaderboard(workspaceId, type: 'weekly' | 'alltime' | 'winrate')`
- [ ] `getPlayerStats(workspaceId, userId)`
- [ ] Weekly reset: zero out `week_net` on Monday 00:00 UTC
- [ ] **Tests**: leaderboard ordering, winrate min-games filter

---

## Phase 4: Slack Integration (Weeks 3–4)

### 4.1 Slack App Configuration (External)
- [ ] Create Slack app at api.slack.com
- [ ] Enable slash command: `/poker`
- [ ] Enable interactivity: Request URL → `https://<host>/slack/actions`
- [ ] Bot scopes: `commands`, `chat:write`, `im:write`, `users:read`
- [ ] Install to dev workspace

### 4.2 Request Handling (`slack/routes.ts`, `slack/verify.ts`)
- [ ] Slack signature verification middleware (HMAC-SHA256)
- [ ] `POST /slack/commands` — parse `/poker <subcommand>` and route
- [ ] `POST /slack/actions` — parse interactive payload, route by action_id
- [ ] Immediate `200 OK` ack on all requests (< 3 seconds)
- [ ] Enqueue actual work to Redis queue after ack

### 4.3 Command Handlers (`slack/commands/`)
- [ ] `new.ts` — create game, post initial Block Kit message, store `message_ts`
- [ ] `join.ts` — add player to waiting game, update message
- [ ] `start.ts` — validate creator + min 2 players, deal cards, start game
- [ ] `balance.ts` — query ledger, respond ephemeral
- [ ] `refill.ts` — call ledger refill, respond ephemeral
- [ ] `transfer.ts` — parse `@user <amount>`, call ledger transfer
- [ ] `leaderboard.ts` — query stats, render leaderboard block
- [ ] `stats.ts` — query player stats, render profile block
- [ ] `help.ts` — static help text with command reference

### 4.4 Game Action Handler (`slack/actions.ts`)
- [ ] Parse `action_id` from button payloads: `fold`, `check`, `call`, `raise`
- [ ] Validate: is it this player's turn? (silently ignore if not)
- [ ] For `raise`: open modal dialog with amount input, handle `view_submission`
- [ ] Enqueue validated action to table's Redis queue

### 4.5 Block Kit Builders (`slack/blocks/`)
- [ ] `game-message.ts`:
  - Header section: game title, pot, hand #, stage
  - Community cards section: card emoji (🂡 or text like `A♠`), face-down placeholders
  - Player rows: name, stack, last action, dealer/blind badge
  - Action buttons: Fold / Check / Call $X / Raise (disabled for non-active players)
- [ ] `hole-cards.ts`:
  - Two card emoji, large format
  - Best hand hint (updated each street)
- [ ] `leaderboard.ts`:
  - Podium: 🏆🥈🥉 top 3
  - Ranked table with chip delta and games played
  - Week-over-week movement (▲/▼)

### 4.6 Slack API Client (`slack/client.ts`)
- [ ] `postMessage(channel, blocks)` — initial game message
- [ ] `updateMessage(channel, ts, blocks)` — in-place update
- [ ] `postDM(userId, blocks)` — hole cards via DM
- [ ] `postEphemeral(channel, userId, blocks)` — balance, errors
- [ ] Rate limiting awareness (Slack tier 3: ~50 req/min)

---

## Phase 5: Workers & Real-Time Game Loop (Week 4–5)

### 5.1 Action Queue (`workers/action-queue.ts`)
- [ ] One BullMQ queue per active table (key: `table:<game_id>`)
- [ ] Consumer: dequeue action → load game state from Redis → apply engine action → persist new state
- [ ] On state transition (e.g., flop dealt): trigger Block Kit update
- [ ] On hand complete: write ledger events, update stats, deal next hand or end game
- [ ] On game complete: post final results, clean up Redis state
- [ ] Concurrency: 1 worker per queue (serial processing per table)

### 5.2 Turn Timer (`workers/turn-timer.ts`)
- [ ] On each turn start: set Redis key `timer:<game_id>:<user_id>` with 60s TTL
- [ ] Use Redis keyspace notifications or a delayed BullMQ job
- [ ] On expiry: enqueue auto-fold action for that player
- [ ] Cancel timer when player acts in time

### 5.3 Cron Jobs (`workers/cron.ts`)
- [ ] **Daily refill** (00:00 UTC): find accounts with balance < 100, top up to 500, write ledger events
- [ ] **Weekly leaderboard** (Monday 00:00 UTC): 
  - Find channel with most games that week
  - Post leaderboard message to that channel
  - Reset `week_net` in `player_stats`

---

## Phase 6: Encryption & Security (Week 5)

### 6.1 Hole Card Encryption (`utils/crypto.ts`)
- [ ] AES-256-GCM encrypt/decrypt functions
- [ ] Key derived from `ENCRYPTION_KEY` env var via HKDF
- [ ] Encrypt hole cards before writing to `game_hands`
- [ ] Decrypt only when needed (showdown, DM sending)
- [ ] Key rotation strategy: per-workspace key stored in a `workspace_keys` table

### 6.2 Security Checklist
- [ ] Slack signature verification on all incoming requests
- [ ] No hole card data in channel messages (only in DMs)
- [ ] Idempotency keys on all ledger writes
- [ ] Rate limiting on `/poker` commands (per user, per workspace)
- [ ] Input validation on all user-provided values (raise amounts, transfer amounts)
- [ ] No stack traces or internal errors exposed to Slack responses

---

## Phase 7: Testing & QA (Weeks 5–6)

**Framework:** `bun test` (built-in, Jest-compatible API). Zero config, fast, includes mocking and snapshots out of the box.

**Test structure:** Mirror `src/` layout under `tests/` (e.g., `tests/engine/`, `tests/db/`, `tests/slack/`).

### 7.1 Unit Tests (`bun test tests/engine/`)
- [ ] **Engine (pure functions, no mocks needed):**
  - Deck: shuffle randomness distribution, deal correctness, 52-card integrity
  - Hand evaluator: all 10 hand rankings, kicker comparisons, split pot detection
  - Betting: action validation, round completion detection, min-raise enforcement
  - Pot: main pot, N-way side pots, distribution to winners
  - Table state machine: full state transitions, auto-advance on all-fold, dealer rotation, heads-up blind exception
- [ ] **Ledger (mock DB or test transaction rollback):**
  - Credit/debit with optimistic lock version check
  - Idempotency key deduplication
  - Transfer daily cap enforcement
  - Refill eligibility (balance < 100, once per day)
- [ ] **Stats:**
  - Leaderboard ordering (weekly, alltime, winrate)
  - Winrate min-games filter (10+ games)
  - Weekly reset zeroes `week_net`
- [ ] Target: 90%+ coverage on `engine/` and `db/`

### 7.2 Integration Tests (`bun test tests/integration/`)
- [ ] **DB integration (real Postgres via Docker Compose):**
  - Ledger concurrent debit race conditions (optimistic locking holds)
  - Full game lifecycle: create game → record hands → payout → stats updated
- [ ] **Slack handlers (mock `@slack/web-api` with `Bun.mock()`):**
  - Slash command routing → correct handler invoked
  - Block Kit snapshot tests: rendered messages match expected structure
  - Signature verification: valid passes, invalid rejects
  - Action handler: correct player accepted, wrong player silently ignored
- [ ] **Full game flow end-to-end:**
  - Create → join → start → play hands → showdown → ledger updated → stats updated

### 7.3 Load/Concurrency Tests
- [ ] Simulate 5 concurrent tables with rapid actions
- [ ] Verify no race conditions on ledger (optimistic locking holds)
- [ ] Verify action queue processes in order per table

---

## Phase 8: Deployment & Ops (Week 7)

### 8.1 Deployment
- [ ] Dockerfile for Bun runtime
- [ ] Fly.io or Railway configuration
- [ ] Postgres provisioning (Fly Postgres or Neon)
- [ ] Redis provisioning (Upstash or Fly Redis)
- [ ] Environment variable configuration
- [ ] Health check endpoint: `GET /health`

### 8.2 Observability
- [ ] Structured logging (JSON) with request IDs
- [ ] Action latency tracking (target: p95 < 2s)
- [ ] Error rate monitoring
- [ ] Slack API error handling and retry logic

---

## Phase 9: Beta & Launch (Weeks 7–9)

### 9.1 Beta
- [ ] Install on internal workspace
- [ ] Play-test with team: minimum 10 full games
- [ ] Tune blind structure defaults
- [ ] Verify leaderboard accuracy
- [ ] Fix UI/UX issues in Block Kit messages

### 9.2 Launch
- [ ] Write self-hosted install guide (or submit to Slack App Directory)
- [ ] Final security review
- [ ] Confirm success metrics instrumentation

---

## Phase 10: Tournaments (v1.1, Week 10–12)

### Outline only — detail when v1 is stable
- [ ] `/poker tournament new <buy-in> <max-players>` command
- [ ] Tournament state: registration → active → heads-up → complete
- [ ] Separate tournament chip stack (not from ledger until buy-in)
- [ ] Blind escalation timer (configurable, default 15 min)
- [ ] Elimination tracking
- [ ] Prize distribution: 60/30/10 for top 3
- [ ] Tournament-specific Block Kit messages

---

## Open Questions (from PRD) — Proposed Answers

| # | Question | Proposed Answer |
|---|----------|-----------------|
| OQ-01 | Raise input: modal or inline? | **Modal** — cleaner UX, worth the extra round-trip |
| OQ-02 | Turn timeout behavior? | **Auto-fold after 60s** — prevents stalled games |
| OQ-03 | Multiple tables per channel? | **One table per channel** for v1 — simplifies message management |
| OQ-04 | Balances on workspace reinstall? | **Persist** — tied to workspace_id+user_id, not install state |
| OQ-05 | Distribution model? | **Self-hosted first**, Slack App Directory if there's demand |
| OQ-06 | House rake? | **No rake for v1** — keep economy simple |

---

## Dependencies (npm packages)

| Package | Purpose |
|---------|---------|
| `hono` | HTTP framework (already installed) |
| `@slack/web-api` | Slack API calls |
| `drizzle-orm` + `drizzle-kit` | ORM + migrations |
| `postgres` (porsager) | Postgres driver for Drizzle |
| `bullmq` | Redis-backed job queues |
| `ioredis` | Redis client (required by BullMQ) |
| `pokersolver` | Hand evaluation |
| `zod` | Input validation |
