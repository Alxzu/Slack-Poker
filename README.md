# 🃏 SlackPoker — Texas Hold'em for Slack

Welcome to **SlackPoker**! A full-featured Texas Hold'em poker game that runs entirely inside Slack. No tabs, no apps, no context switching — just poker in your workspace. 🎰

## 📌 Features

- 🂡 **Full Texas Hold'em** – Standard rules, 2–8 players per table
- 💬 **Native Slack Experience** – Slash commands, Block Kit UI, interactive buttons
- 🔒 **Private Hole Cards** – Dealt via DM, encrypted at rest (AES-256-GCM)
- 💰 **Chip Ledger** – Persistent balances, daily refills, player-to-player transfers
- 🏆 **Leaderboards** – Weekly, all-time, and win-rate rankings
- ⏱️ **Auto-fold Timer** – 60-second turn timeout keeps games moving
- 🛡️ **Security** – Rate limiting, input sanitization, error boundaries
- 📊 **Observability** – Structured logging (pino), action metrics, health checks
- 🐳 **Docker Ready** – One command to deploy anywhere
- 🏅 **Tournaments** – *(v1.1)* Buy-in tournaments with escalating blinds

---

## 🛠️ Setup & Installation

### 📋 Prerequisites

Ensure you have the following installed:
- **Bun**: `1.x` (runtime + package manager)
- **Docker**: For local Postgres + Redis
- **Slack App**: Configured at [api.slack.com](https://api.slack.com)

### 🔧 Installation Steps

1. **Clone the repository**
   ```sh
   git clone https://github.com/your-org/slack-poker.git
   cd slack-poker
   ```

2. **Install dependencies**
   ```sh
   bun install
   ```

3. **Set up environment variables**
   ```sh
   cp .env.example .env
   ```
   Fill in your Slack credentials and encryption key (see [Environment Variables](#-environment-variables)).

4. **Start Postgres + Redis**
   ```sh
   docker compose up -d
   ```

5. **Run database migrations**
   ```sh
   bun run db:push
   ```

6. **Start the dev server** (Socket Mode — no public URL needed)
   ```sh
   bun run dev
   ```

7. **🎉 Open Slack and type `/poker help`!**

---

## 🔧 Environment Variables

Copy `.env.example` and configure:

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-...`) from your Slack app |
| `SLACK_SIGNING_SECRET` | Signing secret for request verification (HTTP mode) |
| `SLACK_APP_TOKEN` | App-level token (`xapp-...`) for Socket Mode (dev) |
| `SLACK_MODE` | `socket` (dev, no public URL) or `http` (production) |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_KEY` | AES-256 key for hole card encryption (`openssl rand -hex 32`) |

**Local defaults** (with Docker Compose):
```
DATABASE_URL=postgres://poker:poker@localhost:5432/slackpoker
REDIS_URL=redis://localhost:6379
SLACK_MODE=socket
```

---

## 🏗️ Architecture

SlackPoker is split into five layers with strict dependency boundaries:

```
src/
├── 🎯 engine/          # Pure game logic — zero I/O, zero external deps
│   ├── types.ts         # Branded types (Chips, SeatIndex, HandId)
│   ├── deck.ts          # Deck & shuffle (crypto PRNG, rejection sampling)
│   ├── hand-evaluator.ts # Custom 7-card evaluator (no external deps)
│   ├── betting.ts       # Betting rounds, blinds, all-in
│   ├── pot.ts           # Main pot + N-way side pots
│   └── table.ts         # State machine (preflop → showdown)
│
├── 💬 slack/            # Slack integration layer
│   ├── routes.ts        # Hono route handlers
│   ├── commands/        # 14 /poker subcommand handlers
│   ├── actions.ts       # Button click dispatcher
│   ├── blocks/          # Block Kit message builders (4 game states)
│   ├── client.ts        # Slack Web API wrapper (retry + DM cache)
│   ├── verify.ts        # HMAC-SHA256 signature verification
│   ├── socket.ts        # Socket Mode adapter for dev
│   ├── rate-limit.ts    # Sliding window rate limiter
│   ├── error-boundary.ts # Safe error handling (no stack traces to Slack)
│   ├── sanitize.ts      # Input sanitization
│   └── middleware/       # Request logging
│
├── 🗄️ db/               # Database layer (Drizzle ORM + postgres.js)
│   ├── schema.ts        # 8 tables (ledger, games, hands, payouts, metrics)
│   ├── ledger.ts        # Append-only chip ledger with optimistic locking
│   ├── stats.ts         # Player stats & leaderboards
│   ├── games.ts         # Game lifecycle persistence
│   └── metrics.ts       # Action metrics (fire-and-forget)
│
├── ⚙️ workers/          # Background processing
│   ├── game-manager.ts  # Redis game state management
│   ├── action-queue.ts  # GroupMQ queue (serial per table, parallel across)
│   ├── turn-timer.ts    # 60s auto-fold via delayed jobs
│   ├── cron.ts          # Weekly leaderboard + idle game cleanup
│   └── startup.ts       # Recovery after restart
│
└── 🔧 utils/
    ├── logger.ts        # pino structured JSON logging
    ├── crypto.ts        # AES-256-GCM encrypt/decrypt
    ├── ids.ts           # ID generation
    └── shutdown.ts      # Graceful SIGTERM/SIGINT handling
```

> **🚧 Dependency Rule:** `engine/` imports nothing outside itself. `db/` imports nothing from `slack/`. Only `slack/` and `workers/` reach into both.

---

## 🎮 Slash Commands

| Command | Description |
|---------|-------------|
| `/poker new [buy-in]` | 🆕 Create a new table (default: 500, range: 100-5000) |
| `/poker join` | 🙋 Join the open table (or click the Join button) |
| `/poker start` | ▶️ Start the game (creator only, 2+ players) |
| `/poker leave` | 🚪 Leave the game (fold + cash out) |
| `/poker cancel` | ❌ Cancel a waiting game (creator only) |
| `/poker end` | 🛑 End an active game, settle all chips (creator only) |
| `/poker status` | 👀 Show current game state |
| `/poker cards` | 🃏 Re-send your hole cards via DM |
| `/poker balance` | 💰 Check your chip balance and stats |
| `/poker refill` | 🔄 Claim daily refill (balance must be < 100) |
| `/poker transfer @user <amount>` | 🎁 Send chips to a teammate (max 1000/day) |
| `/poker leaderboard [weekly\|alltime\|winrate]` | 🏆 View rankings |
| `/poker stats [@user]` | 📊 View detailed player stats |
| `/poker help` | ❓ Show rules and command reference |

> 💡 **Tip:** You can also use the **Join Game** and **Start Game** buttons directly on the game message!

---

## 🐳 Docker

### Local Development

```sh
docker compose up -d          # Start Postgres + Redis
docker compose ps             # Check status
docker compose logs postgres  # View logs
docker compose down           # Stop (keeps data)
docker compose down -v        # Stop + wipe data
```

### Production (Self-Hosted)

```sh
docker compose -f docker-compose.prod.yml up -d
```

Runs the full stack: app + Postgres + Redis with health checks and restart policies.

Or build and run the app container separately:

```sh
docker build -t slackpoker .
docker run -p 3000:3000 --env-file .env slackpoker
```

> ⚠️ **Important:** The app must run as a persistent process (no scale-to-zero). Slack's 3-second ack timeout and the GroupMQ workers require it.

---

## ⚙️ Development Commands

### 🏃 Server
```sh
bun run dev                  # Start dev server (hot reload + Socket Mode)
```

### 🧪 Testing
```sh
bun test                     # Run all 344 tests
bun test tests/engine/       # Engine tests only (191 tests)
bun test tests/integration/  # Integration tests
bun test tests/slack/        # Slack layer tests
bun test <path>              # Run a specific test file
```

### 🧹 Lint & Format
```sh
bun run lint                 # Check for issues
bun run lint:fix             # Fix issues automatically
```

### 🗄️ Database
```sh
bun run db:push              # Apply schema changes (dev)
bun run db:generate          # Generate a migration (prod)
bun run db:migrate           # Run migrations (prod)
bun run db:studio            # Open Drizzle Studio (DB browser)
```

---

## 🃏 How a Hand Works

Here's what happens under the hood when a hand is played:

```
1. 👤 Player clicks "Call" button in Slack
2. 📨 Slack sends POST to /slack/actions
3. ✅ Hono handler acks immediately (200 OK)
4. 📥 Action enqueued to table's GroupMQ queue
5. ⚙️ Worker processes: validate turn → apply action → update state
6. 🎨 Block Kit renderer builds new channel message
7. 🔄 chat.update refreshes the game message in-place
8. 📩 Hole card DM updated with hand hint (same message, no spam)
9. 💰 If hand over → payout recorded. If game over → ledger settlement
```

### 🔑 Key Design Decisions

- **Immutable state:** `applyAction(state, action) → newState` — no mutation
- **Chips stay at the table:** Ledger writes only on game start (buy-in) and game end (cash-out)
- **One game per player:** Can't join two tables simultaneously
- **One table per channel:** Keeps message management simple
- **Serial per table:** GroupMQ processes actions one at a time per table, parallel across tables
- **Branded types:** `Chips`, `SeatIndex`, `HandId` prevent mixing at compile time

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| 🏎️ **Runtime** | Bun |
| 🌐 **HTTP** | Hono |
| 🗄️ **Database** | PostgreSQL 16 + Drizzle ORM |
| ⚡ **Cache / Queues** | Redis + GroupMQ |
| 💬 **Slack** | `@slack/web-api` + `@slack/socket-mode` |
| 🃏 **Hand Eval** | Custom (internal, no external deps) |
| 📋 **Logging** | pino (structured JSON) |
| 🛡️ **Security** | Rate limiting + error boundary + input sanitization |
| ✅ **Linting** | Biome |
| 🧪 **Testing** | `bun test` (344 tests) |
| 🚀 **Deployment** | Docker (any platform) |

---

## 📊 Observability

### Health Check
```sh
curl http://localhost:3000/health
# → { "status": "ok", "postgres": true, "redis": true, "activeGames": 2, "uptime": 3600 }
```

### Structured Logs
All logs are JSON via pino, piped to stdout. Every request gets a `requestId` header (`X-Request-Id`).

### Action Metrics
Stored in the `action_metrics` Postgres table. Query ad-hoc:

```sql
-- p95 latency (last 24h)
SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
FROM action_metrics WHERE created_at > now() - interval '24 hours';

-- Error rate
SELECT COUNT(*) FILTER (WHERE NOT success)::float / COUNT(*) * 100
FROM action_metrics WHERE created_at > now() - interval '24 hours';
```

Auto-purged after 30 days.

---

## 🗺️ Roadmap

- [x] 📐 Project setup & architecture
- [x] 🎯 Game engine (deck, hand eval, betting, pots, table state machine)
- [x] 🗄️ Database schema & ledger service
- [x] 💬 Slack integration (14 commands, Block Kit, interactive buttons)
- [x] ⚙️ Workers (action queues, turn timer, cron, game manager)
- [x] 🔒 Security (rate limiting, error boundaries, input sanitization)
- [x] 🧪 Testing (344 tests — unit, integration, edge cases, snapshots)
- [x] 🚀 Deployment (Dockerfile, prod compose, health checks, observability)
- [x] 🔌 Socket Mode + graceful shutdown
- [ ] 🏅 Tournament mode (v1.1)

---

## 🤝 Contributing

Contributions are welcome! Before submitting a PR:

1. Ensure all tests pass: `bun test`
2. Lint your code: `bun run lint:fix`
3. Follow the architecture boundaries (`engine/` has zero I/O)
4. Add tests for new engine logic
5. Never expose internal errors to Slack responses

---

## 📄 License

This project is private and not licensed for public distribution.
