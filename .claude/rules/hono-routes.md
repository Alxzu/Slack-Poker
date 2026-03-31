---
paths: ["src/**/*.ts", "src/index.ts", "src/slack/routes.ts"]
---

# Hono Framework Rules

- Use the **hono** skill for Hono patterns, middleware, and routing conventions
- All routes are registered in `src/index.ts` or delegated via `app.route()`
- Use Hono's built-in middleware (cors, logger, etc.) — don't reinvent
- JSX uses `hono/jsx` (configured in tsconfig), not React
- Always type context with `Context` from hono for handler params
