# ─── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
WORKDIR /app

# Manifests first for layer caching. --ignore-scripts skips the husky `prepare`
# hook and the `postinstall` prisma generate (run explicitly below).
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ─── Stage 2: migrator (opt-in: `docker build --target migrator`) ─────────────
# One-off job / init container: `docker run --env DATABASE_URL=... <image>`.
# Never run migrations on app boot.
FROM builder AS migrator
CMD ["npx", "prisma", "migrate", "deploy"]

# ─── Stage 3: production runner (default target) ──────────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# The generated client lives in node_modules/.prisma; same base image => same engine binary.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

# Run as the unprivileged user that ships with the node image.
RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" > /dev/null || exit 1

CMD ["node", "dist/main.js"]
