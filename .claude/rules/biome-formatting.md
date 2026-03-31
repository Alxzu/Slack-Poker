---
paths: ["src/**/*.ts", "tests/**/*.ts", "biome.json"]
---

# Biome Rules

- Use the **biome** skill for linting and formatting configuration
- Biome is the sole linter/formatter — do not add ESLint or Prettier
- Run `bunx biome check --write .` to lint and format in one pass
- Run `bunx biome check .` to check without writing (CI mode)
- All code must pass `biome check` before committing
- Configure project-specific rules in `biome.json` at the project root
