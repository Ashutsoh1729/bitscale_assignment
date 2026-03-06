# ── Build stage ──
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# ── Production stage ──
FROM oven/bun:1-slim AS production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "./src/index.ts"]
