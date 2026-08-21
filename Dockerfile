# syntax=docker/dockerfile:1

# This is a pnpm project. Building with npm would resolve a different
# dependency tree than the one that is tested, so both stages use pnpm via
# corepack (bundled with Node 22).

# Node 22 is the floor, not a preference: @supabase/supabase-js 2.112 and its
# realtime-js dependency declare engines >=22.0.0 and dropped the bundled `ws`
# shim in favour of the global WebSocket, which Node 20 does not expose.
# Keep this in sync with the engines field in package.json, .nvmrc and CI.

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
# Dev dependencies are needed here: the build runs tsc.
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Install production dependencies fresh rather than copying node_modules -
# pnpm's layout is symlink-based and does not survive a cross-stage copy.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# The build step also copies src/assets into dist/src, so dist is self-contained.
COPY --from=builder /app/dist ./dist

EXPOSE 8000
CMD ["node", "dist/src/index.js"]
