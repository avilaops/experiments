FROM node:24-alpine AS core-build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY examples ./examples
COPY schemas ./schemas
RUN npm run build

FROM core-build AS dashboard-build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard ./
RUN npm run build

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production LAB_HOST=0.0.0.0 LAB_PORT=3300 LAB_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=core-build --chown=node:node /app/dist ./dist
COPY --from=core-build --chown=node:node /app/schemas ./schemas
COPY --from=core-build --chown=node:node /app/examples/suites ./examples/suites
RUN mkdir /data && chown node:node /data
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3300/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/lab/serve.js"]

FROM node:24-alpine AS dashboard
WORKDIR /app/dashboard
ENV NODE_ENV=production DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3301
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=dashboard-build --chown=node:node /app/dashboard/dist ./dist
COPY --from=dashboard-build --chown=node:node /app/dashboard/public ./public
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3301/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/serve.mjs"]
