# 🃏 SlackPoker — Texas Hold'em for Slack

Welcome to **SlackPoker**! A full-featured Texas Hold'em poker game that runs entirely inside Slack. No tabs, no apps, no context switching — just poker in your workspace. 🎰

## 📌 Features

- 🂡 **Full Texas Hold'em** – Standard rules, 2–9 players per table.
- 💬 **Native Slack Experience** – Slash commands, Block Kit UI, interactive buttons.
- 🔒 **Private Hole Cards** – Dealt via DM, encrypted at rest (AES-256-GCM).
- 💰 **Chip Ledger** – Persistent balances, daily refills, player-to-player transfers.
- 🏆 **Leaderboards** – Weekly, all-time, and win-rate rankings.
- ⏱️ **Auto-fold Timer** – 60-second turn timeout keeps games moving.
- 🏅 **Tournaments** – *(v1.1)* Buy-in tournaments with escalating blinds.

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
   Fill in your Slack credentials and database URLs (see [Environment Variables](#-environment-variables)).

4. **Start Postgres + Redis**
   ```sh
   docker compose up -d
   ```

5. **Run database migrations**
   ```sh
   bunx drizzle-kit push
   ```

6. **Start the dev server**
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
| `SLACK_SIGNING_SECRET` | Signing secret for request verification |
| `SLACK_APP_TOKEN` | App-level token (`xapp-...`) for Socket Mode (dev only) |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_KEY` | AES-256 key for hole card encryption |

**Local defaults** (with Docker Compose):
```
DATABASE_URL=postgres://poker:poker@localhost:5432/slackpoker
REDIS_URL=redis://localhost:6379
```

---

## 🏗️ Architecture

SlackPoker is split into four layers with strict dependency boundaries:

```
src/
├── 🎯 engine/       # Pure game logic — zero I/O, fully testable
│   ├── deck.ts       # Deck & shuffle (crypto PRNG)
│   ├── hand-evaluator.ts
│   ├── betting.ts    # Betting rounds, blinds, all-in
│   ├── pot.ts        # Main pot + side pots
│   └── table.ts      # State machine (preflop → showdown)
│
├── 💬 slack/         # Slack integration layer
│   ├── routes.ts     # Hono route handlers
│   ├── commands/     # /poker subcommand handlers
│   ├── actions.ts    # Button click dispatcher
│   ├── blocks/       # Block Kit message builders
│   └── client.ts     # Slack Web API wrapper
│
├── 🗄️ db/            # Database layer (Drizzle ORM)
│   ├── schema.ts     # Table definitions
│   ├── ledger.ts     # Append-only chip ledger
│   ├── stats.ts      # Player stats & leaderboards
│   └── migrations/   # SQL migrations
│
└── ⚙️ workers/       # Background processing
    ├── action-queue.ts  # Redis queue (one per table)
    ├── turn-timer.ts    # 60s auto-fold
    └── cron.ts          # Daily refill, weekly leaderboard
```

> **🚧 Dependency Rule:** `engine/` imports nothing outside itself. `db/` imports nothing from `slack/`. Only `slack/` and `workers/` reach into both.

---

## 🎮 Slash Commands

| Command | Description |
|---------|-------------|
| `/poker new [buy-in]` | 🆕 Create a new table (default: 500, range: 100-5000) |
| `/poker join` | 🙋 Join the open table in this channel |
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

---

## 🐳 Docker Setup

Docker Compose provides **PostgreSQL 16** and **Redis 7** for local development.

### Common Commands

```sh
# 🟢 Start services
docker compose up -d

# 🔍 Check status
docker compose ps

# 📋 View logs
docker compose logs postgres
docker compose logs redis

# 🔴 Stop services (keeps data)
docker compose down

# 💥 Stop and wipe all data
docker compose down -v

# 🔄 Restart a service
docker compose restart postgres
```

---

## ⚙️ Common Commands

### 🏃 Development
```sh
bun run dev              # Start dev server with hot reload
```

### 🧪 Testing
```sh
bun test                 # Run all tests
bun test tests/engine/   # Run engine tests only
bun test <path>          # Run a specific test file
```

### 🧹 Lint & Format
```sh
bunx biome check .              # Check for issues
bunx biome check --write .      # Fix issues automatically
```

### 🗄️ Database
```sh
bunx drizzle-kit push           # Apply schema changes
bunx drizzle-kit generate       # Generate a migration
bunx drizzle-kit studio         # Open Drizzle Studio (DB browser)
```

---

## 🃏 How a Hand Works

Here's what happens under the hood when a hand is played:

```
1. 👤 Player clicks "Call" button in Slack
2. 📨 Slack sends POST to /slack/actions
3. ✅ Hono handler acks immediately (200 OK)
4. 📥 Action enqueued to table's Redis queue
5. ⚙️ Worker processes: validate turn → update game state
6. 🎨 Block Kit renderer builds new message
7. 🔄 chat.update refreshes the shared game message
8. 💰 If hand over → payout recorded. If game over → ledger settlement
```

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
| ✅ **Linting** | Biome |
| 🧪 **Testing** | `bun test` (built-in) |
| 🚀 **Deployment** | Docker (any platform) |

---

## 🗺️ Roadmap

- [x] 📐 Project setup & architecture
- [ ] 🎯 Game engine (deck, hand eval, betting, pots)
- [ ] 🗄️ Database schema & ledger service
- [ ] 💬 Slack integration (commands, actions, Block Kit)
- [ ] ⚙️ Workers (action queues, turn timer, cron)
- [ ] 🔒 Security (encryption, verification, rate limits)
- [ ] 🧪 Testing & QA
- [ ] 🚀 Deployment & beta
- [ ] 🏅 Tournament mode (v1.1)

---

## 🤝 Contributing

Contributions are welcome! Before submitting a PR:

1. Ensure all tests pass: `bun test`
2. Lint your code: `bunx biome check --write .`
3. Follow the existing architecture boundaries
4. Add tests for new engine logic

---

## 📄 License

This project is private and not licensed for public distribution.
