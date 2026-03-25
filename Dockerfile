# ── Base ──────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# ── Backend Dependencies ─────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ── Frontend Dependencies ────────────────────────────
FROM base AS frontend-deps
COPY packages/frontend/package.json packages/frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

# ── Frontend Build ───────────────────────────────────
FROM base AS frontend-build
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
COPY --from=frontend-deps /app/node_modules ./node_modules
COPY packages/frontend/ ./
RUN npx vite build

# ── Development ──────────────────────────────────────
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=frontend-build /app/dist ./packages/frontend/dist
EXPOSE 3009
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && npx tsx src/db/seed.ts && npx tsx watch src/server.ts"]

# ── Build ────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Production ───────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S hub -u 1001
COPY --from=build /app/dist ./dist
COPY --from=frontend-build /app/dist ./packages/frontend/dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
USER hub
EXPOSE 3009
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
