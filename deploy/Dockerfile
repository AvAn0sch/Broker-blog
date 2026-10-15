FROM node:22.23.2-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.4.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM dependencies AS test
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN node -e "const fs=require('node:fs');fs.mkdirSync('/etc/ssl/certs',{recursive:true});if(!fs.existsSync('/etc/ssl/certs/ca-certificates.crt'))fs.writeFileSync('/etc/ssl/certs/ca-certificates.crt',require('node:tls').rootCertificates.join(String.fromCharCode(10)))" \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && pnpm exec playwright install --with-deps chromium
COPY . .
CMD ["pnpm", "verify:foundation"]

FROM build AS runtime
ENV NODE_ENV=production APP_HOST=0.0.0.0
RUN mkdir -p /app/.local/media/test /app/.next/cache && chown -R node:node /app/.next/cache && chown node:node /app/.local /app/.local/media /app/.local/media/test
USER node
EXPOSE 3000
CMD ["node", "scripts/run.mjs", "start"]
