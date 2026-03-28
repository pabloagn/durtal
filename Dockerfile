# =============================================================================
# Durtal — Multi-stage Docker Build
# =============================================================================
# Stage 1: Install dependencies
# Stage 2: Build Next.js application
# Stage 3: Production runtime (minimal image)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# Install libc6-compat for Alpine compatibility with some npm packages
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set Next.js to produce standalone output
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable pnpm && pnpm build

# ---------------------------------------------------------------------------
# Stage 3: Production Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
