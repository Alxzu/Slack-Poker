---
paths: ["src/engine/**/*.ts", "tests/engine/**/*.ts"]
---

# Game Engine Rules

- The engine is **pure logic** — zero I/O, no database, no Slack, no Redis imports
- All state transitions are immutable: `applyAction(state, action) → newState`
- Use `crypto.getRandomValues()` for deck shuffling (cryptographically secure)
- Side pot calculations must handle N-way all-ins at different stack sizes
- In heads-up (2 players), dealer posts the small blind
- Every engine function must have corresponding unit tests
- Test with deterministic (pre-set) deck orders for reproducible scenarios
