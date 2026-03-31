---
paths: ["src/engine/**/*.ts", "tests/engine/**/*.ts"]
---

# Game Engine Rules

- The engine is **pure logic** — zero I/O, no database, no Slack, no Redis imports, no external dependencies
- Hand evaluator is custom internal implementation — never import `pokersolver` or similar packages
- All state transitions are immutable: `applyAction(state, action) → newState`
- Use branded types: `Chips`, `SeatIndex`, `HandId` — never mix numeric domains
- Use `crypto.getRandomValues()` for deck shuffling (batch + rejection sampling)
- Side pot calculations must handle N-way all-ins at different stack sizes
- All-in auto-deal: if all remaining players are all-in, deal remaining streets without pausing
- Player busts (0 chips): remove from table, trigger game-end if < 2 players remain
- In heads-up (2 players), dealer posts the small blind
- Consecutive timeout: after 3 auto-folds, sit out; after 6, kick
- Every engine function must have corresponding unit tests
- Test with deterministic (pre-set) deck orders for reproducible scenarios
