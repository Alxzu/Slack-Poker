---
paths: ["src/db/**/*.ts", "drizzle.config.ts"]
---

# Drizzle ORM Rules

- Use the **drizzle-orm** skill for schema design, migrations, and query patterns
- Schema defined in `src/db/schema.ts` using Drizzle's `pgTable` helpers
- Migrations managed via `drizzle-kit` — never write migration SQL by hand
- All chip mutations must go through the ledger service (append-only `ledger_events`)
- Use optimistic locking (version counter) on `ledger_accounts` updates
- Always include idempotency keys on ledger event inserts
- Use transactions for multi-table writes (e.g., transfer = debit sender + credit receiver)
