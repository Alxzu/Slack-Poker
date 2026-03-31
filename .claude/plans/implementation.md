# SlackPoker — Implementation Plan

Based on the PRD v1.0 (March 2026). Refined with research from 5 parallel investigations into
game engines, Slack API patterns, database design, Redis queues, and reference projects.

**Confidence: 95%** — All open questions resolved, dependencies audited, reference implementations studied,
4 PM simulations completed (2-player, 6-player, economy, command audit) with 30+ gaps identified and resolved.

---

## Reference Projects

Study these before writing code:

| Repo | What to learn |
|------|--------------|
| [claudijo/poker-ts](https://github.com/claudijo/poker-ts) | Active TypeScript engine, side pots, betting rounds |
| [eliraz-refael/texasHoldem-ts](https://github.com/eliraz-refael/texasHoldem-ts) | Branded types, immutable state machine, pokersolver wrapper |
| [CharlieHess/slack-poker-bot](https://github.com/CharlieHess/slack-poker-bot) | Slack poker UX patterns, common pitfalls (1,675 stars) |
| [BeekeeperAlex/poker-engine](https://github.com/BeekeeperAlex/poker-engine) | Clean `{ amount, eligiblePlayers[] }` pot model |
| [ishikota/PyPokerEngine](https://github.com/ishikota/PyPokerEngine) | Event-driven architecture, strategy pattern for player agents |

---

## Phase 1: Project Foundation (Week 1)

### 1.1 Project Setup & Tooling
- [ ] Configure `tsconfig.json` with path aliases (`@/engine`, `@/slack`, `@/db`, `@/workers`)
- [ ] Add Biome for linting/formatting (`biome.json` config) ✅ Done
- [ ] Add `bun test` configuration and scripts to `package.json`
- [ ] Set up `.env.example` with all required env vars ✅ Done
- [ ] Add Docker Compose for local Postgres + Redis (see 1.5)
- [ ] Add `SLACK_MODE=socket|http` env var for dev/prod toggle

### 1.2 Environment Variables
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...            # only needed for HTTP mode
SLACK_APP_TOKEN=xapp-...            # only needed for Socket Mode (dev)
SLACK_MODE=socket                   # socket (dev) or http (prod)
DATABASE_URL=postgres://poker:poker@localhost:5432/slackpoker
REDIS_URL=redis://localhost:6379
ENCRYPTION_KEY=...                  # generate with: openssl rand -hex 32
```

### 1.3 Source Directory Structure
```
src/
├── index.ts                 # Hono app entrypoint, route registration
├── config.ts                # Env var loading and validation (zod)
├── engine/                  # Pure game logic — zero I/O dependencies
│   ├── types.ts             # Branded types: Chips, SeatIndex, HandId, Card, GameState
│   ├── deck.ts              # Deck, shuffle (crypto PRNG, rejection sampling)
│   ├── hand-evaluator.ts    # Custom 7-card evaluator (no external deps)
│   ├── betting.ts           # Betting round logic, blinds, action validation
│   ├── table.ts             # Table state machine (immutable transitions)
│   └── pot.ts               # Pot and side pot calculations
├── slack/                   # Slack integration layer
│   ├── routes.ts            # Hono routes: /slack/commands, /slack/actions
│   ├── verify.ts            # Slack signature verification (HMAC-SHA256, ~20 lines)
│   ├── socket.ts            # Socket Mode adapter for local dev
│   ├── commands/            # One handler per slash subcommand
│   │   ├── new.ts           # Create game (validates balance, one-per-channel)
│   │   ├── join.ts          # Join game (validates balance, DM-ability, not in another game)
│   │   ├── start.ts         # Start game (creator only, min 2 players, debits buy-ins)
│   │   ├── leave.ts         # Leave game (fold + cash out, or remove from lobby)
│   │   ├── cancel.ts        # Cancel waiting game (creator only, refund buy-ins)
│   │   ├── end.ts           # End active game (creator only, settles all chips)
│   │   ├── status.ts        # Show current game state (ephemeral)
│   │   ├── cards.ts         # Re-send hole cards via DM
│   │   ├── balance.ts
│   │   ├── refill.ts
│   │   ├── transfer.ts
│   │   ├── leaderboard.ts
│   │   ├── stats.ts
│   │   └── help.ts          # Also handles bare `/poker` and invalid subcommands
│   ├── actions.ts           # Interactive button/modal payload dispatcher
│   ├── blocks/              # Block Kit message builders
│   │   ├── game-message.ts  # Channel message: waiting, playing, showdown, game-over states
│   │   ├── cards.ts         # Card rendering: suit emoji + text (`:spades: A`)
│   │   ├── hole-cards.ts    # DM hole card message (updated in-place via chat.update)
│   │   └── leaderboard.ts   # Leaderboard message (+ empty state handling)
│   └── client.ts            # Slack Web API wrapper + DM channel cache
├── db/                      # Database layer
│   ├── connection.ts        # postgres.js (porsager) connection pool
│   ├── schema.ts            # Drizzle pgTable definitions
│   ├── migrations/          # SQL migration files (drizzle-kit generate)
│   ├── ledger.ts            # Append-only ledger with optimistic locking
│   ├── stats.ts             # player_stats read/write
│   └── games.ts             # Game, game_players, game_hands persistence
├── workers/                 # Background processing
│   ├── action-queue.ts      # GroupMQ consumer — one group per table
│   ├── turn-timer.ts        # Delayed job: 60s auto-fold
│   └── cron.ts              # Croner: daily refill, weekly leaderboard
└── utils/
    ├── crypto.ts            # AES-256-GCM encrypt/decrypt for hole cards
    ├── logger.ts            # pino structured JSON logger
    └── ids.ts               # ID generation helpers
```

### 1.4 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | Drizzle ORM | Type-safe, lightweight, good Bun support |
| Postgres driver | `postgres` (porsager) | Built-in pooling, Bun native. `bun:sql` has drizzle-kit incompatibility ([#4122](https://github.com/drizzle-team/drizzle-orm/issues/4122)) |
| Slack SDK | Hono + `@slack/web-api` (no Bolt) | Bolt bundles Express; conflicts with Hono routing ([bolt-js#212](https://github.com/slackapi/bolt-js/issues/212)) |
| Slack dev mode | `@slack/socket-mode` | No ngrok/public URL needed for local dev. Toggle via `SLACK_MODE` env var |
| Hand evaluator | Custom internal implementation | Zero external deps in engine. Study `poker-ts`, `texasHoldem-ts`, and lookup-table algorithms from [HenryRLee/PokerHandEvaluator](https://github.com/HenryRLee/PokerHandEvaluator) for reference |
| Queue | GroupMQ | Purpose-built for per-group serial processing. Open source, BullMQ-compatible API, fewer Redis connections than dynamic queues |
| Turn timer | GroupMQ delayed jobs | Persistent (survives restarts), cancellable by jobId. NOT Redis TTL (unreliable timing) or setTimeout (lost on restart) |
| Cron | Croner | Zero-dependency, explicit Bun support. Two simple jobs don't justify BullMQ repeatable jobs overhead |
| Migrations | `drizzle-kit push` (dev), `generate`+`migrate` (prod) | Fast iteration locally, auditable SQL files for production |
| State pattern | Immutable: `(state, action) → newState` | Trivially serializable for Redis/Postgres, easy to test, natural audit trail |
| Type safety | Branded types for Chips, SeatIndex, HandId | Prevents mixing seat numbers with chip amounts at compile time (from texasHoldem-ts) |
| Schema | Normalized `game_players` table | JSONB `players` column causes poor query plans and no referential integrity ([Heap analysis](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema): 2000x slowdowns) |
| Card rendering | Built-in suit emoji + text (`:spades: A`) | Zero setup, readable. Custom emoji pack as optional upgrade later |
| Game state storage | Redis (live) + Postgres (permanent) | Redis for sub-ms reads during gameplay; Postgres for hand history, leaderboards, audit |
| Buy-in timing | Debit on `/poker start` in a transaction | Validate balance on join (pre-check), debit all players atomically on start. Refund on cancel |
| Ledger writes | Only on game end (not per-hand) | Chips stay at the table during a session. Ledger events written when player leaves or game ends |
| Refill mechanism | Manual only (`/poker refill`) | Removed cron auto-refill — it overlapped with manual refill and caused chip inflation |
| Player restriction | One active game per player | Prevents split attention, interleaved DMs, and double buy-in issues |
| Max players | 8 per table (seats 0-7) | 9 risks exceeding Block Kit 50-block limit with full player state |
| Button feedback | Ephemeral "not your turn" to wrong player | Silent ignore is confusing — give feedback so players know the bot is working |
| Hole card DMs | Update same DM via `chat.update` | Avoids notification spam — one DM per hand, updated each street |
| Fold on win | Don't reveal winner's cards | Standard poker: winner only shows at showdown, not on fold |

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

---

## Phase 2: Game Engine (Weeks 1–2)

This is the core — **pure TypeScript, no I/O, fully unit-testable**.
Study `poker-ts` and `texasHoldem-ts` before starting.

### 2.1 Branded Types (`engine/types.ts`)
- [ ] `Chips` — branded number type for chip amounts
- [ ] `SeatIndex` — branded number for player seating (0–8)
- [ ] `HandId` — branded string for hand identification
- [ ] `Card` type: `{ rank: Rank, suit: Suit }`
- [ ] `PokerAction` discriminated union: `fold | check | call | raise(amount) | allIn`
- [ ] `GamePhase` type: `waiting | preflop | flop | turn | river | showdown | complete`
- [ ] `GameState` type: players, deck, community cards, pots, phase, active seat, dealer seat

### 2.2 Card & Deck (`engine/deck.ts`)
- [ ] `createDeck()`: returns 52-card array
- [ ] `shuffle(deck)`: Fisher-Yates with `crypto.getRandomValues()`:
  - Batch random values: `new Uint32Array(52)` in one call
  - Rejection sampling to avoid modulo bias
  - Return new array (immutable)
- [ ] `deal(deck, count)`: returns `{ dealt: Card[], remaining: Card[] }`
- [ ] **Tests**: 52-card integrity after shuffle, no duplicates, distribution uniformity

### 2.3 Hand Evaluator (`engine/hand-evaluator.ts`)

**Built internally — no external dependencies.** Study these for algorithms:
- `poker-ts` and `texasHoldem-ts` for TypeScript patterns
- [HenryRLee/PokerHandEvaluator](https://github.com/HenryRLee/PokerHandEvaluator) for lookup-table O(1) evaluation
- [goldfire/pokersolver](https://github.com/goldfire/pokersolver) for comparison logic (read, don't import)

- [ ] `HandRank` enum: `HIGH_CARD=1` through `ROYAL_FLUSH=10`
- [ ] `evaluateHand(cards: Card[]) → { rank: HandRank, name: string, bestFive: Card[] }`
  - Accept 5, 6, or 7 cards
  - From 7 cards: evaluate all C(7,5) = 21 combinations, return best
  - Each combination: check from strongest (royal flush) down to weakest (high card)
- [ ] `compareHands(handA, handB) → -1 | 0 | 1`
  - First compare by rank
  - If same rank: compare kickers in order (e.g., two pair → compare high pair, low pair, kicker)
- [ ] Internal hand detection functions:
  - `isFlush(cards)` — 5 of same suit
  - `isStraight(cards)` — 5 consecutive ranks (handle wheel: A-2-3-4-5)
  - `groupByRank(cards)` — for pairs, trips, quads, full house
- [ ] **Tests** (exhaustive — this is critical):
  - All 10 hand rankings with known examples
  - Kicker comparisons within same rank (e.g., pair of aces with K kicker vs Q kicker)
  - Wheel straight (A-2-3-4-5) — ace plays low
  - Broadway straight (10-J-Q-K-A)
  - Split pot: identical hands
  - 7-card evaluation: correct best-5 selection from 7
  - Edge: flush vs straight when both possible

### 2.4 Betting Logic (`engine/betting.ts`)
- [ ] `BettingRound` state: bets per player, current bet to match, min raise
- [ ] Action validators: `canCheck()`, `canCall()`, `canRaise(amount)`, `canFold()`
- [ ] `applyBetAction(round, action) → newRound` (immutable)
- [ ] Calculate required call amount per player
- [ ] Detect round completion: all active players have acted and matched the current bet
- [ ] Enforce min-raise rules (raise must be at least the size of the last raise)
- [ ] **Tests**: all action sequences, invalid action rejection, min-raise enforcement

### 2.5 Pot Calculation (`engine/pot.ts`)
- [ ] Data model: `Pot = { amount: Chips, eligiblePlayers: SeatIndex[] }` (from BeekeeperAlex)
- [ ] `calculatePots(players, contributions)` → `Pot[]` (main pot + side pots)
  - "Peel layers" algorithm: sort all-in amounts ascending, create pot per layer
- [ ] `distributePots(pots, handRankings) → Map<SeatIndex, Chips>`
  - Handle tied hands splitting a pot
  - Odd chip goes to player closest left of dealer
- [ ] **Edge case tests** (these are where poker engines break):
  - 2-way all-in
  - 3+ way all-in at different stack sizes
  - All-in for less than the blind
  - Player folds after partial contribution
  - Multiple all-ins at the same amount (same pot, not separate)
  - Tied hands with odd chip remainder
  - All players all-in (deal remaining community cards)

### 2.6 Table State Machine (`engine/table.ts`)
- [ ] `createGame(players, blinds) → GameState`
- [ ] `applyAction(state, action) → GameState` (pure, immutable)
- [ ] State transitions: `WAITING → PRE_FLOP → FLOP → TURN → RIVER → SHOWDOWN → COMPLETE`
- [ ] Auto-advance: all-but-one fold → immediate win; betting complete → next street
- [ ] **All-in auto-deal**: if all remaining players are all-in, deal remaining community cards without pausing for actions, go directly to showdown
- [ ] **Player busts (0 chips)**: remove from table, trigger game-end if < 2 players remain
- [ ] **Player leaves mid-hand**: auto-fold current hand, remove from table, trigger game-end if < 2 remain
- [ ] **Consecutive timeout**: after 3 auto-folds in a row, auto-sit-out the player (skip their turns). After 3 more, auto-kick and cash out
- [ ] Dealer button rotation between hands. Initial dealer: random seat
- [ ] Seat assignment: randomize on game start
- [ ] Blind posting: SB/BB with heads-up exception (dealer = SB in 2-player)
- [ ] **Can't post blind**: if a player's stack can't cover the blind, they're all-in for what they have
- [ ] Three-level action fallback: player action → default → Check/Call/Fold cascade
- [ ] `legalActions(state, seat) → PokerAction[]` — what can this player do right now?
- [ ] **Hand transition**: after showdown, 5-second delay before auto-dealing next hand (allows players to absorb results)
- [ ] **Tests**: full game simulations with deterministic (pre-set) deck orders for reproducibility
  - Test: all-in auto-deal (preflop all-in → flop/turn/river dealt automatically)
  - Test: player busts → removed → game ends if heads-up
  - Test: player leaves mid-hand → fold + removal
  - Test: 3 consecutive timeouts → sit-out

---

## Phase 3: Database & Ledger (Week 3)

### 3.1 Schema & Migrations (`db/schema.ts`, `db/migrations/`)

**Normalized schema** — no JSONB for player lists.

- [ ] `ledger_accounts` table:
  ```sql
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 1000 CHECK (balance >= 0),
  lock_version INTEGER NOT NULL DEFAULT 0,  -- optimistic locking
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
  ```
- [ ] `ledger_events` table (append-only, never updated/deleted):
  ```sql
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- buy_in, cash_out, refill, transfer_in, transfer_out, tournament_entry
  amount INTEGER NOT NULL,  -- positive = credit, negative = debit
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  lock_version_before INTEGER NOT NULL,
  lock_version_after INTEGER NOT NULL,
  game_id UUID REFERENCES games(id),
  idempotency_key TEXT UNIQUE,  -- prevent double-credits
  created_at TIMESTAMPTZ DEFAULT now()
  ```
- [ ] `games` table:
  ```sql
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  buy_in INTEGER NOT NULL DEFAULT 500,
  status TEXT NOT NULL,  -- waiting, active, complete, cancelled
  small_blind INTEGER NOT NULL DEFAULT 5,
  big_blind INTEGER NOT NULL DEFAULT 10,
  message_ts TEXT,  -- Slack message timestamp for chat.update
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
  ```
- [ ] `game_players` table (normalized — replaces JSONB):
  ```sql
  game_id UUID NOT NULL REFERENCES games(id),
  user_id TEXT NOT NULL,
  seat INTEGER NOT NULL,  -- 0-8
  chips_start INTEGER NOT NULL,  -- chips at game start
  chips_end INTEGER,  -- chips at game end (null if in progress)
  result TEXT,  -- win, loss, draw (null if in progress)
  PRIMARY KEY (game_id, user_id)
  ```
- [ ] `game_hands` table:
  ```sql
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id),
  hand_number INTEGER NOT NULL,
  dealer_seat INTEGER NOT NULL,
  community_cards JSONB,  -- 5 cards, opaque blob (never queried individually)
  hole_cards_encrypted BYTEA,  -- AES-256-GCM encrypted JSON of all players' cards
  created_at TIMESTAMPTZ DEFAULT now()
  ```
- [ ] `hand_payouts` table (replaces singular winner_user_id — supports split pots):
  ```sql
  hand_id UUID NOT NULL REFERENCES game_hands(id),
  user_id TEXT NOT NULL,
  pot_index INTEGER NOT NULL DEFAULT 0,  -- 0 = main pot, 1+ = side pots
  amount INTEGER NOT NULL,
  PRIMARY KEY (hand_id, user_id, pot_index)
  ```
- [ ] `player_stats` table (precomputed, updated in game-completion transaction):
  ```sql
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  chips_won INTEGER DEFAULT 0,
  chips_lost INTEGER DEFAULT 0,
  biggest_pot INTEGER DEFAULT 0,
  week_net INTEGER DEFAULT 0,
  week_start DATE,
  PRIMARY KEY (workspace_id, user_id)
  ```
- [ ] Run initial migration with `drizzle-kit push` (dev)

### 3.2 Ledger Service (`db/ledger.ts`)
- [ ] `getOrCreateAccount(workspaceId, userId)` — creates with 1000 chips on first access
- [ ] `debit(workspaceId, userId, amount, type, idempotencyKey)`:
  - Read `lock_version`, UPDATE with `WHERE lock_version = $expected` (optimistic lock)
  - Write ledger_event with `balance_before`/`balance_after` for audit chain
  - If 0 rows affected → version conflict, retry or fail
- [ ] `credit(workspaceId, userId, amount, type, idempotencyKey)` — same pattern
- [ ] `transfer(fromUser, toUser, amount)` — single transaction: debit sender + credit receiver. Enforce 1000/day cap per sender
- [ ] `claimRefill(workspaceId, userId)` — only if balance < 100, once per day per user
  - Check eligibility via `SELECT 1 FROM ledger_events WHERE type='refill' AND user_id=$1 AND created_at >= CURRENT_DATE`
  - Error messages: "Balance too high" (>= 100) or "Already refilled today, next refill available at midnight UTC"
- [ ] `gameSettlement(gameId)` — called when game ends:
  - Credit each player's final table stack back to ledger (type: `cash_out`)
  - Single transaction with stats update
  - Idempotency key: `game:{gameId}:settlement:{userId}`
- [ ] Idempotency: construct keys deterministically (e.g., `game:{gameId}:player:{userId}:buyin`)
- [ ] `CHECK (balance >= 0)` constraint prevents overdrafts at DB level
- [ ] **Tests**: concurrent debit race conditions, idempotency dedup, transfer cap, refill eligibility

### 3.3 Stats Service (`db/stats.ts`)
- [ ] `updateStatsAfterGame(tx, workspaceId, players, winner, pot)` — runs inside game-completion transaction
- [ ] `getLeaderboard(workspaceId, type: 'weekly' | 'alltime' | 'winrate')`
  - Winrate: `games_won / games_played`, min 10 games filter
- [ ] `getPlayerStats(workspaceId, userId)`
- [ ] Weekly reset: zero out `week_net` on Monday 00:00 UTC
- [ ] **Tests**: leaderboard ordering, winrate min-games filter, weekly reset

---

## Phase 4: Slack Integration (Weeks 3–4)

### 4.1 Slack App Configuration (External)
- [ ] Create Slack app at api.slack.com
- [ ] Enable slash command: `/poker`
- [ ] Enable interactivity: Request URL → `https://<host>/slack/actions`
- [ ] Enable Socket Mode (for dev)
- [ ] Bot scopes: `commands`, `chat:write`, `im:write`, `users:read`
- [ ] Generate App-Level Token (`xapp-`) with `connections:write` scope (Socket Mode)
- [ ] Install to dev workspace

### 4.2 Request Handling (`slack/routes.ts`, `slack/verify.ts`, `slack/socket.ts`)
- [ ] **HTTP mode** (production):
  - Slack signature verification middleware (HMAC-SHA256, ~20 lines)
  - Verify `X-Slack-Request-Timestamp` (reject if > 5 min old — replay protection)
  - Must read raw request body before JSON parsing
  - `POST /slack/commands` — parse `/poker <subcommand>` and route
  - `POST /slack/actions` — parse interactive payload, route by `action_id`
- [ ] **Socket Mode** (development):
  - `@slack/socket-mode` package — WebSocket, no public URL needed
  - Same command/action handlers, different transport
  - Toggle via `SLACK_MODE` env var
- [ ] Immediate `200 OK` ack on all requests (< 3 seconds)
- [ ] Use `response_url` for quick ephemeral feedback ("It's not your turn")
- [ ] Use `chat.update` for game state updates (no 30-min expiry like response_url)
- [ ] Enqueue actual game logic to GroupMQ after ack

### 4.3 Command Handlers (`slack/commands/`)

**Game lifecycle:**
- [ ] `new.ts`:
  - Check no active/waiting game in this channel (one-per-channel rule)
  - Validate buy-in: `MIN_BUY_IN=100`, `MAX_BUY_IN=5000`, default 500
  - Validate creator's balance >= buy-in (pre-check, not debit yet)
  - Post Block Kit message with "Join Game" and "Start Game" buttons
  - Store `message_ts` for future `chat.update`
- [ ] `join.ts`:
  - Check player is not already in another active game (one-game-per-player rule)
  - Validate balance >= buy-in
  - Test DM-ability: attempt `conversations.open` — reject join if DMs blocked
  - Add to `game_players`, update Block Kit message
  - Cap at 8 players
- [ ] `start.ts`:
  - Validate: creator only, min 2 players
  - Debit buy-in from all players in a single transaction
  - Randomize seating, pick random dealer
  - Deal hole cards (DM to each player), post game state to channel
- [ ] `leave.ts`:
  - **Waiting state**: remove from lobby, refund buy-in if already debited
  - **Active state**: fold current hand, cash out remaining table chips to ledger, remove from table
  - If < 2 players remain: end game
- [ ] `cancel.ts`:
  - Creator only, waiting state only
  - Refund all buy-ins, delete game, update message to "Cancelled"
- [ ] `end.ts`:
  - Creator only, active state
  - Finish current hand (or void if mid-betting), settle all chips back to ledger
  - Post game summary, mark game complete

**Information:**
- [ ] `status.ts` — ephemeral snapshot: pot, community cards, stacks, whose turn, your hand. Reuses `game-message.ts` builder
- [ ] `cards.ts` — re-send hole cards via DM (updates existing DM message)
- [ ] `balance.ts` — query ledger, respond ephemeral. If new account, append welcome blurb + pointer to `/poker help`
- [ ] `help.ts` — command reference. Also handles bare `/poker` (no subcommand) and invalid subcommands ("Unknown command `foo`. Did you mean...?")

**Economy:**
- [ ] `refill.ts` — call ledger refill, respond ephemeral with clear error messages for each case
- [ ] `transfer.ts` — parse `@user <amount>`, validate with Zod (`z.number().int().positive().max(1000)`), pre-check balance, call ledger transfer

**Social:**
- [ ] `leaderboard.ts` — query stats, render leaderboard. Handle empty state: "No games played yet"
- [ ] `stats.ts` — query player stats, render profile block

### 4.4 Game Action Handler (`slack/actions.ts`)
- [ ] Parse `action_id` from button payloads: `join_game`, `start_game`, `fold`, `check`, `call`, `raise`, `all_in`
- [ ] **Join/Start buttons**: handle interactive buttons on waiting-state message (in addition to slash commands)
- [ ] **Game action buttons**: validate it's this player's turn
  - **Wrong player**: respond with ephemeral "It's [name]'s turn. You'll be notified when it's yours" (NOT silent ignore)
  - **Non-player clicks game button**: ephemeral "You're not in this game. Use `/poker join` to play next time"
- [ ] For `raise`: open modal with context (pot size, current bet, min raise, max raise = stack, input field pre-filled with min raise)
- [ ] Show "Bet" button when no bet in current street, "Raise" when there's a bet to raise
- [ ] Show "All-In" button when stack <= 2x call amount, or "Call (All-In)" when call would consume entire stack
- [ ] Include `handId + actionSequence` as idempotency key to handle double-clicks
- [ ] Enqueue validated action to table's GroupMQ group

### 4.5 Block Kit Builders (`slack/blocks/`)
- [ ] `cards.ts`:
  - Render cards as suit emoji + text: `:spades: A`, `:hearts: K`, `:diamonds: 10`
  - Face-down placeholder: `:black_joker:` or `?`
  - Helper: `cardToEmoji(card: Card) → string`
- [ ] `game-message.ts` (must stay under 50 blocks). **Four states:**
  - **Waiting state**: game title, buy-in, player list, "Join Game" + "Start Game" buttons, instructional text
  - **Playing state**:
    - Header: game title, pot(s), hand #, stage
    - Community cards via `cards.ts`
    - Side pots displayed separately: "Main Pot: 300 (A, B, C) | Side Pot: 150 (A, B)"
    - Player rows: name, stack, last action, dealer/SB/BB badge, **turn indicator** (pointing emoji) for active player
    - "Waiting for [name]..." text when it's not your turn (instead of showing unusable buttons)
    - Action buttons for active player only
    - Previous hand result: "Last hand: Eve won 120 with a pair of Kings" (one-line summary)
  - **Showdown state**: reveal all remaining players' cards, winning hand name, pot awarded, chip changes
  - **Game-over state**: winner announcement, session stats (hands played, biggest pot, P&L per player), "Start New Game" button
- [ ] `hole-cards.ts`:
  - Two card emoji, large format via `cards.ts`
  - Best hand hint updated each street (update SAME DM via `chat.update`, don't send new messages)
  - Store DM `message_ts` per player per hand in Redis game state
  - When it's player's turn: append "It's your turn! Pot: X. You need Y to call." to the DM update
  - On fold-win (no showdown): do NOT reveal winner's cards
- [ ] `leaderboard.ts`:
  - Podium: 🏆🥈🥉 top 3
  - Ranked table: rank, display name, chip delta, games played
  - Week-over-week movement (▲/▼) for returning players
  - **Empty state**: "No games played this week yet. Start one with `/poker new`!"
  - Winrate empty state: "No players have completed 10+ games yet"

### 4.6 Slack API Client (`slack/client.ts`)
- [ ] Initialize `WebClient` from `@slack/web-api` with bot token
- [ ] `postMessage(channel, blocks)` — initial game message, returns `ts`
- [ ] `updateMessage(channel, ts, blocks)` — in-place game state update
  - Retry with exponential backoff (3 attempts: 1s/2s/4s)
  - If all retries fail: set `pendingUiUpdate` flag on game state, re-render on next successful action
- [ ] `openDM(userId) → channelId` — `conversations.open`, **cache result** (avoid repeated API calls)
- [ ] `postDM(userId, blocks) → ts` — hole cards via cached DM channel, returns `message_ts` for future updates
- [ ] `updateDM(userId, ts, blocks)` — update existing DM (for hand hints, turn notifications)
- [ ] `postEphemeral(channel, userId, blocks)` — balance, errors, "not your turn"
- [ ] Rate limit awareness: `chat.update` at Tier 3 (~50/min) is the binding constraint
  - At ~10-15 updates/min per table, comfortable for multiple concurrent tables

---

## Phase 5: Workers & Real-Time Game Loop (Weeks 4–5)

### 5.1 Action Queue (`workers/action-queue.ts`)
- [ ] Single GroupMQ queue, one `groupId` per active table (`table:<game_id>`)
- [ ] Worker with `concurrency: 8` — up to 8 tables processed in parallel, serial within each table
- [ ] Consumer flow:
  1. Dequeue action from group
  2. Load live game state from Redis (`game:{tableId}` JSON key)
  3. Validate action is still valid (state may have changed since HTTP ack)
  4. Apply engine: `applyAction(state, action) → newState`
  5. Persist new state to Redis
  6. Trigger Block Kit update via `chat.update`
- [ ] On hand complete:
  - Write `hand_payouts` to Postgres (permanent record)
  - Update table chips in Redis (NOT ledger — chips stay at table)
  - 5-second delay, then auto-deal next hand
  - If a player busted (0 chips): remove from table, check if game should end
- [ ] On game complete (< 2 players, or `/poker end`):
  - Settlement: credit each player's final table stack to ledger (type: `cash_out`) in single transaction
  - Update `game_players.chips_end` and `result`
  - Update `player_stats`
  - Post game-over Block Kit message with summary
  - Clean up Redis game state key
- [ ] **Postgres is source of truth for balances**; Redis holds table stacks during play. Reload from Postgres on game start

### 5.2 Turn Timer (`workers/turn-timer.ts`)
- [ ] On each turn start: add GroupMQ delayed job with 60s delay
  - Job ID: `timer:{tableId}:{handId}:{playerId}` (cancellable)
- [ ] On player action in time: remove the delayed job by ID
- [ ] On delayed job execution: enqueue auto-fold action for that player
- [ ] Delayed jobs are stored in Redis sorted set — **survive server restarts**
- [ ] NOT using Redis TTL keyspace notifications (unreliable timing under load)
- [ ] NOT using setTimeout (lost on crash)

### 5.3 Cron Jobs (`workers/cron.ts`)
- [ ] Use **Croner** (zero-dependency, explicit Bun support)
- [ ] ~~Daily refill~~ **REMOVED** — manual `/poker refill` only. Cron auto-refill caused chip inflation and overlapped with manual refill
- [ ] **Weekly leaderboard** (`0 0 * * 1` — Monday 00:00 UTC):
  - Post leaderboard to ALL channels that had games that week (not just the top one)
  - Reset `week_net` in `player_stats`
  - **Catch-up on startup**: check if last weekly post > 7 days ago, run immediately if missed
- [ ] **Idle game cleanup** (`*/5 * * * *` — every 5 minutes):
  - Find active games with no action in 30+ minutes
  - Post warning at 25 minutes: "Game will auto-end in 5 minutes due to inactivity"
  - At 30 minutes: end game, settle all chips back to ledger
  - Prevents zombie games blocking channels

---

## Phase 6: Encryption & Security (Week 5)

### 6.1 Hole Card Encryption (`utils/crypto.ts`)
- [ ] AES-256-GCM encrypt/decrypt functions
- [ ] Key derived from `ENCRYPTION_KEY` env var via HKDF
- [ ] Encrypt all players' hole cards as single JSON blob before writing to `game_hands`
- [ ] Decrypt only when needed (showdown resolution, DM sending)
- [ ] Key rotation: per-workspace key in a `workspace_keys` table (future)

### 6.2 Security Checklist
- [ ] Slack signature verification on all incoming HTTP requests
- [ ] Reject timestamps > 5 min old (replay attack protection)
- [ ] No hole card data in channel messages — only in DMs
- [ ] Idempotency keys on all ledger writes
- [ ] Action idempotency keys to handle Slack double-click retries
- [ ] Rate limiting on `/poker` commands (per user, per workspace)
- [ ] Input validation with Zod on all user-provided values (raise amounts, transfer amounts, buy-in)
  - Transfer: `z.number().int().positive().max(1000)`
  - Buy-in: `z.number().int().min(100).max(5000)`
  - Raise: `z.number().int().min(minRaise).max(playerStack)`
- [ ] `CHECK (balance >= 0)` DB constraint as last line of defense against overdrafts
- [ ] No stack traces or internal errors exposed in Slack responses

---

## Phase 7: Testing & QA (Weeks 5–6)

**Framework:** `bun test` (built-in, Jest-compatible API). Zero config, fast, includes mocking and snapshots.

**Test structure:** Mirror `src/` layout under `tests/` (e.g., `tests/engine/`, `tests/db/`, `tests/slack/`).

### 7.1 Unit Tests (`bun test tests/engine/`)
- [ ] **Engine (pure functions, no mocks needed):**
  - Deck: 52-card integrity, no duplicates after shuffle, deal correctness
  - Hand evaluator: all 10 rankings, kicker comparisons, wheel straight, split pot detection
  - Betting: action validation, round completion, min-raise enforcement
  - Pot: main pot, N-way side pots (the #1 bug source in poker engines), odd chip allocation
  - Table state machine: full transitions, auto-advance on all-fold, dealer rotation, heads-up blind exception
  - Use deterministic deck orders for reproducible test scenarios
- [ ] **Ledger (mock DB or test transaction rollback):**
  - Credit/debit with optimistic lock version check
  - Idempotency key deduplication
  - Transfer daily cap enforcement
  - Refill eligibility (balance < 100, once per day)
  - `CHECK (balance >= 0)` prevents overdraft
- [ ] **Stats:**
  - Leaderboard ordering (weekly, alltime, winrate)
  - Winrate min-games filter (10+ games)
  - Weekly reset zeroes `week_net`
- [ ] Target: 90%+ coverage on `engine/` and `db/`

### 7.2 Integration Tests (`bun test tests/integration/`)
- [ ] **DB integration (real Postgres via Docker Compose):**
  - Ledger concurrent debit race conditions (optimistic locking holds)
  - Full game lifecycle: create game → record hands → payout → stats updated
  - Idempotency: duplicate inserts return existing, no double-credit
- [ ] **Slack handlers (mock `@slack/web-api` with `Bun.mock()`):**
  - Slash command routing → correct handler invoked
  - Block Kit snapshot tests: rendered messages match expected structure
  - Signature verification: valid passes, invalid rejects, expired timestamp rejects
  - Action handler: correct player accepted, wrong player gets ephemeral feedback
- [ ] **Full game flow end-to-end:**
  - Create → join → start → play hands → showdown → ledger updated → stats updated
  - Verify Redis game state and Postgres permanent record are consistent

### 7.3 Load/Concurrency Tests
- [ ] Simulate 5 concurrent tables with rapid actions
- [ ] Verify no race conditions on ledger (optimistic locking holds)
- [ ] Verify GroupMQ processes actions in order within each table group

---

## Phase 8: Deployment & Ops (Week 7)

### 8.1 Deployment (Platform-Agnostic)

The app is deployed as a **Docker container** with external Postgres and Redis. Any platform that runs containers works (Fly.io, Railway, Render, AWS ECS, self-hosted).

- [ ] `Dockerfile` for Bun runtime:
  ```dockerfile
  FROM oven/bun:1 AS base
  WORKDIR /app
  COPY package.json bun.lock ./
  RUN bun install --frozen-lockfile --production
  COPY src/ src/
  EXPOSE 3000
  CMD ["bun", "run", "src/index.ts"]
  ```
- [ ] `docker-compose.prod.yml` — full stack (app + postgres + redis) for self-hosted deployments
- [ ] `GET /health` endpoint — returns DB + Redis connection status, used by any orchestrator
- [ ] **Critical requirement**: the process must stay running (no scale-to-zero / serverless). Slack's 3s ack timeout + GroupMQ workers require a persistent process. Configure your platform accordingly (e.g., `min_instances=1`)
- [ ] **Co-locate app, Postgres, and Redis in the same region** — cross-region adds 60ms per query
- [ ] Pre-warm DB/Redis connections on startup, not on first request
- [ ] All config via environment variables (see `.env.example`) — no platform-specific config files

### 8.2 Startup Recovery
- [ ] On process start: scan Redis for active game keys
- [ ] Cross-reference with Postgres `games WHERE status = 'active'`
- [ ] Resume game loop for each active game (re-register GroupMQ workers)
- [ ] Check for missed weekly leaderboard (last post > 7 days ago → run now)
- [ ] Post "I'm back! Resuming your game..." to active game channels

### 8.3 Observability

**No reliance on platform-specific logging.** The app owns its own observability.

#### Logging (`src/utils/logger.ts`)
- [ ] Use **pino** — fast structured JSON logger, works with Bun, zero-config
- [ ] Hono middleware: log every request with `requestId`, `method`, `path`, `status`, `durationMs`
- [ ] Game action logs: `{ event, gameId, handId, playerId, action, latencyMs }`
- [ ] Error logs: `{ event: "error", gameId, error, stack }` — never expose to Slack responses
- [ ] Log levels: `info` for actions, `warn` for retries/timeouts, `error` for failures
- [ ] Logs go to **stdout** — pipe to any aggregator (Datadog, Axiom, Loki, ELK, or just `docker logs`)

#### Metrics (`db/schema.ts` — `action_metrics` table)
- [ ] `action_metrics` table — lightweight, written async after each game action:
  ```sql
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  game_id UUID,
  action TEXT NOT NULL,        -- slash_command, game_action, api_call
  detail TEXT,                 -- e.g. "fold", "chat.update", "/poker new"
  duration_ms INTEGER NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,                  -- error message if failed
  created_at TIMESTAMPTZ DEFAULT now()
  ```
- [ ] Hono middleware measures request duration, writes to table via fire-and-forget (don't block the response)
- [ ] Worker measures action processing time (enqueue → complete)
- [ ] Slack API wrapper measures each API call duration + success/failure
- [ ] **Dashboard queries** (run ad-hoc or build a simple `/poker admin metrics` command):
  ```sql
  -- p95 action latency (last 24h)
  SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
  FROM action_metrics WHERE created_at > now() - interval '24 hours';

  -- Error rate (last 24h)
  SELECT COUNT(*) FILTER (WHERE NOT success)::float / COUNT(*) * 100 AS error_pct
  FROM action_metrics WHERE created_at > now() - interval '24 hours';

  -- Slowest actions
  SELECT detail, AVG(duration_ms), COUNT(*)
  FROM action_metrics GROUP BY detail ORDER BY AVG(duration_ms) DESC;
  ```
- [ ] Cron: purge metrics older than 30 days to prevent table bloat

#### Health Check (`GET /health`)
- [ ] Ping Postgres (simple `SELECT 1`)
- [ ] Ping Redis (`PING`)
- [ ] Return `{ status: "ok"|"degraded"|"down", postgres: bool, redis: bool, activeGames: number }`
- [ ] Any orchestrator (Docker, K8s, Fly, Railway) can poll this

#### Targets
- Action latency p95: < 2 seconds (button click → message update)
- Error rate: < 0.5% of total actions
- Slack API retry success: > 99% within 3 retries

---

## Phase 9: Beta & Launch (Weeks 7–9)

### 9.1 Beta
- [ ] Install on internal workspace
- [ ] Play-test with team: minimum 10 full games
- [ ] Tune blind structure defaults
- [ ] Verify leaderboard accuracy
- [ ] Fix UI/UX issues in Block Kit messages
- [ ] Stress test: rapid actions, concurrent tables
- [ ] Verify turn timer (auto-fold after 60s)

### 9.2 Launch
- [ ] Write self-hosted install guide
- [ ] Final security review
- [ ] Confirm success metrics instrumentation (WAU, games/week, latency, error rate)

---

## Phase 10: Tournaments (v1.1, Weeks 10–12)

### Outline only — detail when v1 is stable
- [ ] `/poker tournament new <buy-in> <max-players>` command
- [ ] Tournament state: registration → active → heads-up → complete
- [ ] Separate tournament chip stack (buy-in deducted from ledger on entry)
- [ ] Blind escalation timer (configurable, default 15 min)
- [ ] Elimination tracking
- [ ] Prize distribution: 60/30/10 for top 3
- [ ] Tournament-specific Block Kit messages

---

## Complete Slash Command Reference (v1)

| Command | Description | Priority |
|---------|-------------|----------|
| `/poker new [buy-in]` | Create a new table (default: 500, range: 100-5000) | P0 |
| `/poker join` | Join the open table in this channel | P0 |
| `/poker start` | Start the game (creator only, 2+ players) | P0 |
| `/poker leave` | Leave the game (fold + cash out) | P0 |
| `/poker cancel` | Cancel a waiting game (creator only) | P0 |
| `/poker end` | End an active game, settle all chips (creator only) | P0 |
| `/poker status` | Show current game state (ephemeral) | P0 |
| `/poker cards` | Re-send your hole cards via DM | P1 |
| `/poker balance` | Check your chip balance | P0 |
| `/poker refill` | Claim daily refill (balance < 100) | P1 |
| `/poker transfer @user <amt>` | Send chips (max 1000/day) | P2 |
| `/poker leaderboard [type]` | View weekly/alltime/winrate rankings | P0 |
| `/poker stats [@user]` | View detailed player stats | P2 |
| `/poker help` | Show rules and command reference | P0 |

**Interactive buttons** (in Block Kit messages):
- "Join Game" / "Start Game" — on waiting-state message
- Fold / Check / Call $X / Bet / Raise / All-In — on active game message (active player only)
- "Start New Game" — on game-over message

---

## Resolved Questions

All PRD open questions are now answered with research backing:

| # | Question | Answer | Basis |
|---|----------|--------|-------|
| OQ-01 | Raise input: modal or inline? | **Modal** — cleaner UX, Slack modals support number input natively | Slack API research |
| OQ-02 | Turn timeout behavior? | **Auto-fold after 60s** via GroupMQ delayed jobs (persistent, survives restarts) | Redis research: TTL notifications unreliable |
| OQ-03 | Multiple tables per channel? | **One table per channel** for v1 — single `message_ts` per channel simplifies updates | CharlieHess/slack-poker-bot had same constraint |
| OQ-04 | Balances on workspace reinstall? | **Persist** — tied to `(workspace_id, user_id)` in Postgres, not install state | DB research |
| OQ-05 | Distribution model? | **Self-hosted first** — Socket Mode for dev, HTTP for prod | Slack research: Socket Mode can't be used in App Directory |
| OQ-06 | House rake? | **No rake for v1** — manual refills are the only chip source. Add rake as a sink if inflation becomes a problem | Economy sim: removed auto-refill cron to reduce inflation |

**Additional questions resolved during PM simulation:**

| # | Question | Answer | Basis |
|---|----------|--------|-------|
| PM-01 | When is buy-in deducted? | On `/poker start` in a single transaction (validate on join) | Economy sim: prevents overdraft race conditions |
| PM-02 | When are chips written to ledger? | Only on game end — chips stay at table during session | 2p sim: per-hand ledger writes cause inconsistency |
| PM-03 | Can a player be in multiple games? | No — one active game per player | Economy sim: prevents split DMs, double buy-in |
| PM-04 | What happens when a player busts? | Removed from table. If < 2 remain, game ends | 6p sim: 0-chip player stuck with no action |
| PM-05 | How do games end? | `/poker end` (creator), last player standing, or 30-min idle timeout | 2p + 6p sim: no end mechanism existed |
| PM-06 | Non-active player clicks button? | Ephemeral "It's [name]'s turn" (not silent ignore) | 6p sim: silent ignore is confusing |
| PM-07 | How are hole card DMs updated? | `chat.update` on same DM (store `message_ts` per player) | 6p sim: new DMs per street = notification spam |
| PM-08 | What about empty leaderboards? | Show "No games played yet" message | Economy sim: blank message is broken UX |
| PM-09 | Cron auto-refill? | Removed — manual `/poker refill` only | Economy sim: dual mechanism caused inflation |
| PM-10 | Leaderboard posted where? | All channels with games that week | Economy sim: single-channel post misses players |

---

## Dependencies (npm packages)

| Package | Version | Purpose | Risk |
|---------|---------|---------|------|
| `hono` | 4.12.x | HTTP framework | ✅ Active, weekly releases, first-class Bun support |
| `@slack/web-api` | 7.x | Slack API calls | ✅ Active, maintained by Slack/Salesforce |
| `@slack/socket-mode` | 2.x | Dev-mode WebSocket transport | ✅ Active, lightweight |
| `drizzle-orm` + `drizzle-kit` | 0.45.x | ORM + migrations | ✅ Active. Use `postgres-js` adapter, NOT `bun-sql` |
| `postgres` | 3.x | Postgres driver (porsager) | ✅ Active, built-in pooling, native Bun support |
| `groupmq` | latest | Per-group serial job queue | ⚠️ Newer project (MIT, used in production at OpenPanel) |
| `ioredis` | 5.x | Redis client (required by GroupMQ) | ✅ Active, no Bun issues |
| `croner` | latest | Cron scheduling | ✅ Zero-dep, explicit Bun support |
| `pino` | 9.x | Structured JSON logging | ✅ Active, fast, works with Bun |
| `zod` | 4.x | Input validation | ✅ Active. Verify compatibility if using Hono validators (some expect zod 3.x) |
