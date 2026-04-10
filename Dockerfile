# ── Base ──────────────────────────────────────────────
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# ── Dependencies ─────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/backend/package.json packages/backend/
RUN npm ci -w packages/backend --ignore-scripts

# ── Build ────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY packages/backend/ packages/backend/
COPY package.json ./
RUN npm -w packages/backend run build

# ── Production ───────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S hub -u 1001
COPY --from=build /app/packages/backend/dist ./dist
COPY --from=build /app/packages/backend/src/db/migrations ./dist/db/migrations
COPY --from=deps /app/node_modules ./node_modules
COPY packages/backend/package.json ./package.json
USER hub
EXPOSE 3009
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
