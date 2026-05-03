# syntax=docker/dockerfile:1.7
#
# Multi-stage build for options-trader.
#
# Stage 1 (builder): installs every workspace, compiles the React/Vite app,
#                    and prebuilds better-sqlite3's native module.
# Stage 2 (runtime): slim image with node + the app source. The server runs
#                    via tsx and serves /api plus the bundled web dist on a
#                    single port.
#
# Why tsx in production?
# - The cross-workspace TypeScript imports (apps/server <- packages/shared)
#   are easier to ship as source than to set up a full tsc emit pipeline
#   inside Docker. tsx adds ~50ms boot overhead — fine for a single-user app.
#
# SQLite data lives in /data. Mount a volume there in production.

# ─── Builder ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

# better-sqlite3 prebuilds need glibc-based python+make+g++ at install time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy lockfile-defining files first so layer caching works.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json     apps/server/package.json
COPY apps/web/package.json        apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --workspaces --include-workspace-root

# Bring in the rest of the source.
COPY tsconfig.base.json   ./
COPY apps/server          apps/server
COPY apps/web             apps/web
COPY packages/shared      packages/shared

# Type-check + Vite build the web app (server stays as source).
RUN npm run build:web

# ─── Runtime ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/options-trader.sqlite \
    WEB_STATIC_DIR=/app/apps/web/dist

WORKDIR /app

# Run as a non-root user.
RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid app --create-home app \
 && mkdir -p /data \
 && chown -R app:app /data

# Copy node_modules + source from builder.
COPY --from=builder --chown=app:app /app/node_modules                  ./node_modules
COPY --from=builder --chown=app:app /app/apps/server/node_modules      ./apps/server/node_modules
COPY --from=builder --chown=app:app /app/apps/server/package.json      ./apps/server/package.json
COPY --from=builder --chown=app:app /app/apps/server/src               ./apps/server/src
COPY --from=builder --chown=app:app /app/apps/server/tsconfig.json     ./apps/server/tsconfig.json
COPY --from=builder --chown=app:app /app/apps/web/dist                 ./apps/web/dist
COPY --from=builder --chown=app:app /app/packages/shared               ./packages/shared
COPY --from=builder --chown=app:app /app/package.json                  ./package.json
COPY --from=builder --chown=app:app /app/tsconfig.base.json            ./tsconfig.base.json

USER app

EXPOSE 4000
VOLUME ["/data"]

# Container-native healthcheck: /api/health returns 200 OK.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "apps/server/src/index.ts"]
