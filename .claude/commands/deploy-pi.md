---
name: deploy-pi
description: Deploy the app to the local Raspberry Pi via Docker Compose. Syncs source, rebuilds the app container, and verifies health.
allowed-tools: Read, Bash
---

# Deploy to Local Raspberry Pi

Deploy the current source code to the Raspberry Pi running Docker Compose.

## Prerequisites

- `sshpass` installed locally (`brew install hudochenkov/sshpass/sshpass`)
- `.env.deploy` file in project root with `PI_HOST`, `PI_PASSWORD`, `PI_PROJECT_DIR`
- Pi already has the initial stack running (`docker-compose.prod.yml`, `.env` with Slack tokens)

## Steps

1. **Read deploy config** from `.env.deploy` to get `PI_HOST`, `PI_PASSWORD`, and `PI_PROJECT_DIR`.

2. **Sync source files** to the Pi using rsync:
   ```
   sshpass -p "$PI_PASSWORD" rsync -avz \
     --exclude='node_modules' --exclude='.git' --exclude='.env' \
     --exclude='.env.*' --exclude='pnpm-lock.yaml' \
     --exclude='docker-compose.prod.yml' \
     -e "ssh -o StrictHostKeyChecking=no" \
     src/ package.json bun.lock drizzle.config.ts Dockerfile \
     $PI_HOST:$PI_PROJECT_DIR/
   ```
   Only sync source code and build files. Never overwrite the Pi's `.env` or `docker-compose.prod.yml`.

3. **Rebuild and restart** the app container on the Pi:
   ```
   sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no $PI_HOST \
     "cd $PI_PROJECT_DIR && docker compose -f docker-compose.prod.yml up -d --build app"
   ```

4. **Wait 5 seconds** then **verify health**:
   ```
   sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no $PI_HOST \
     "curl -s http://localhost:4444/health"
   ```
   Confirm the response shows `"status":"ok"` with `postgres: true` and `redis: true`.

5. **Check logs** for errors (last 10 lines):
   ```
   sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no $PI_HOST \
     "cd $PI_PROJECT_DIR && docker compose -f docker-compose.prod.yml logs app --tail 10"
   ```
   Verify Socket Mode is connected and no errors are present.

6. **Report** the deployment result: healthy/unhealthy, active games count, uptime, and any errors from logs.

## Notes

- The Pi is ARM64 (aarch64) — all Docker images must support `linux/arm64`.
- The app runs on port 4444 (mapped to container port 3000).
- Socket Mode is used (no public URL needed) — the app connects outbound to Slack.
- Database migrations are NOT run automatically. If schema changed, run:
  ```
  sshpass -p "$PI_PASSWORD" ssh $PI_HOST \
    "cd $PI_PROJECT_DIR && docker compose -f docker-compose.prod.yml exec -T postgres psql -U poker -d slackpoker"
  ```
  and pipe the new migration SQL file.
