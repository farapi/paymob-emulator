# syntax=docker/dockerfile:1.7
# Multi-stage build (spec section 19.1): Debian slim runtime, tini as PID 1,
# non-root user, single image serving API + dashboard + checkout + scheduler.

FROM node:22-bookworm-slim AS base
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /workspace

# ---- deps: install once, cached across builds unless lockfile changes ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/scenario-engine/package.json packages/scenario-engine/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: compile contracts -> scenario-engine -> server, and the web SPA ----
FROM deps AS build
COPY . .
RUN pnpm --filter @paymob-simulator/contracts run build \
 && pnpm --filter @paymob-simulator/scenario-engine run build \
 && pnpm --filter @paymob-simulator/web run build \
 && pnpm --filter @paymob-simulator/server run build

# ---- prune: production-only node_modules for the runtime image ----
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 simulator \
 && useradd --uid 10001 --gid simulator --home /app --shell /usr/sbin/nologin simulator

WORKDIR /app
ENV NODE_ENV=production \
    SIM_PORT=8080 \
    SIM_DATA_DIR=/data \
    SIM_PUBLIC_URL=http://localhost:8080

COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=prod-deps /workspace/packages/scenario-engine/node_modules ./packages/scenario-engine/node_modules
COPY --from=prod-deps /workspace/apps/server/node_modules ./apps/server/node_modules

COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/scenario-engine/dist ./packages/scenario-engine/dist
COPY --from=build /workspace/packages/scenario-engine/package.json ./packages/scenario-engine/package.json
COPY --from=build /workspace/apps/server/dist ./apps/server/dist
COPY --from=build /workspace/apps/server/package.json ./apps/server/package.json
COPY --from=build /workspace/apps/web/dist ./apps/web/dist
COPY --from=build /workspace/migrations ./migrations
COPY apps/server/healthcheck.mjs ./apps/server/healthcheck.mjs

RUN mkdir -p /data && chown -R simulator:simulator /data /app

USER simulator
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=5s --timeout=2s --start-period=10s --retries=10 \
  CMD ["node", "/app/apps/server/healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
