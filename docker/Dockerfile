# syntax=docker/dockerfile:1

FROM node:24-slim AS base
RUN npm install -g pnpm@12.18.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY packages/catalog/package.json packages/catalog/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/providers packages/providers
COPY packages/catalog packages/catalog
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm run build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY packages/catalog/package.json packages/catalog/
RUN pnpm install --frozen-lockfile --prod

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/server/node_modules apps/server/node_modules
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY packages/providers/package.json packages/providers/
COPY --from=build /app/packages/providers/dist packages/providers/dist
COPY packages/catalog/package.json packages/catalog/
COPY --from=build /app/packages/catalog/dist packages/catalog/dist
COPY packages/catalog/data packages/catalog/data
COPY apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
# Served by the server at / (WEB_DIR defaults to ../web/dist).
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir /data && chown node:node /data
ENV DATA_DIR=/data
USER node
EXPOSE 3000
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
