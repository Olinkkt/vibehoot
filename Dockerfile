# syntax=docker/dockerfile:1

# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app

# Ensure devDependencies are installed even if build-time NODE_ENV=production is set
ENV NODE_ENV=development

COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev

# Stage 2: Build application
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Stage 3: Production runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy runtime assets and dependencies
COPY --chown=nextjs:nodejs --from=builder /app/package.json ./package.json
COPY --chown=nextjs:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs --from=builder /app/.next ./.next
COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/server.ts ./server.ts
COPY --chown=nextjs:nodejs --from=builder /app/src ./src
COPY --chown=nextjs:nodejs --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
