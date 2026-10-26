# Build from the repo root:  docker build -f apps/controller/Dockerfile -t gl-steering-controller .
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/controller/package.json apps/controller/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @gl-steering/controller --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY packages/core packages/core
COPY apps/controller apps/controller
COPY db db
WORKDIR /app/apps/controller
USER node
# tsx runs TypeScript directly; SIGTERM closes open valves before exit.
CMD ["node", "--import", "tsx", "src/index.ts"]
