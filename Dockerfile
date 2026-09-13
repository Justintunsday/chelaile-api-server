FROM oven/bun:1.2-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY src ./src

RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.2-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY data ./data

EXPOSE 8787

ENTRYPOINT ["bun", "dist/api/server.js"]
