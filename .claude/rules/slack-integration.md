---
paths: ["src/slack/**/*.ts"]
---

# Slack Integration Rules

- Use the **slack-block-kit** skill when building or modifying Block Kit messages
- All Slack requests must be acknowledged with 200 OK within 3 seconds — enqueue work to Redis after ack
- Use `chat.update` to modify the game message in-place — never spam new messages
- Hole cards are sent via DM only — never include them in channel messages
- Silently ignore button clicks from non-active players (no error response)
- Verify Slack request signatures (HMAC-SHA256) on all incoming requests
- Use `@slack/web-api` for API calls — we do NOT use `@slack/bolt` (Hono handles HTTP)
- Block Kit messages have size limits — keep payloads under 50 blocks
