# syntax=docker/dockerfile:1

# --- install dependencies (with dev, for the build) ---
# Base pinned to a minor version for reproducibility. For a fully reproducible
# build, pin to a digest (e.g. oven/bun:1.2@sha256:…) in a network-enabled CI.
FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- build the SvelteKit app (adapter-node) ---
FROM oven/bun:1.2 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# --- runtime: production deps + built server + migrations ---
FROM oven/bun:1.2 AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/posterpilot.db \
    KOMETA_ASSETS_DIR=/kometa \
    LOG_DIR=/data/logs
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000

# Tool-free health probe against the public /api/health endpoint (no curl/wget in
# the image; bun is already present). Uses the configured PORT.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "./build/index.js"]
