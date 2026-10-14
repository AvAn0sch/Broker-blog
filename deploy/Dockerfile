FROM node:22.23.2-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.4.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS test
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN pnpm exec playwright install --with-deps chromium
CMD ["pnpm", "exec", "playwright", "test"]

FROM build AS runtime
ENV NODE_ENV=production APP_HOST=0.0.0.0
RUN mkdir -p /app/.local/media/test && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
