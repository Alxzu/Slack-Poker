---
paths: ["src/db/**/*.ts", "drizzle.config.ts"]
---

# Drizzle ORM Rules

- Use the **drizzle-orm** skill for schema design, migrations, and query patterns
- Schema defined in `src/db/schema.ts` using Drizzle's `pgTable` helpers
- Migrations managed via `drizzle-kit` — never write migration SQL by hand
- Use `postgres` (porsager) driver — NOT `bun:sql` (drizzle-kit incompatibility)
- All chip mutations must go through the ledger service (append-only `ledger_events`)
- Ledger writes only on game start (buy-in) and game end (cash_out) — never per-hand
- Use optimistic locking (version counter) on `ledger_accounts` updates
- Always include idempotency keys on ledger event inserts
- Use transactions for multi-table writes (e.g., transfer = debit sender + credit receiver)
- Use normalized `game_players` table — NOT JSONB for player lists
- Use `hand_payouts` table for winners — NOT singular `winner_user_id` (split pots)
- `drizzle-kit push` for dev, `drizzle-kit generate` + `migrate` for production
