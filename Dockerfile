FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY patches/ patches/
RUN bun install --frozen-lockfile --production
COPY src/ src/
COPY drizzle.config.ts ./
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
