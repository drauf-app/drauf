# syntax=docker/dockerfile:1

FROM node:24-slim AS base
RUN npm install -g pnpm@12.18.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm run build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/server/node_modules apps/server/node_modules
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
USER node
EXPOSE 3000
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
