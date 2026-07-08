# =============================================================================
#  Elpima Dev — Production Dockerfile
#  Multi-stage build optimised for security, size, and Prisma compatibility.
# =============================================================================

# ─── Builder stage ───────────────────────────────────────────────────────────
FROM node:22-bookworm AS builder

# Prevent Node from showing the "npm update available" banner.
# Keep npm's output minimal in CI.
ENV NODE_ENV=production \
    npm_config_update_notifier=false

WORKDIR /build

# 1. Copy manifest files first — Docker layer caching means this step
#    is only re-run when dependencies change.
COPY package.json package-lock.json* ./

# Install FULL dependency tree (including devDependencies).
# The Prisma CLI is almost always a devDependency, and `prisma generate`
# below needs it. We prune dev deps out after generate runs.
# --ignore-scripts here just skips lifecycle scripts (postinstall etc.);
# we call `prisma generate` explicitly, so nothing is lost.
RUN npm ci --ignore-scripts --no-audit --no-fund && \
    npm cache clean --force

# 2. Copy Prisma schema + config before generating the client.
#    Prisma 7's config-based workflow reads `prisma.config.ts` (if present)
#    in addition to schema.prisma — both need to exist before `generate`.
#    (Migration files are NOT copied — they're applied out-of-band by the
#     orchestrator / init container, so make sure that step is wired up.)
COPY prisma/schema.prisma ./prisma/
COPY prisma.config.ts ./

RUN npx prisma generate

# 3. Copy the rest of the application source.
#    .dockerignore keeps out node_modules, .env, tests, etc.
COPY . .

# 4. Now that the client is generated, drop devDependencies to shrink
#    the layer that gets copied into the production stage.
RUN npm prune --omit=dev


# ─── Production stage ────────────────────────────────────────────────────────
#  Debian-slim is intentionally used instead of Alpine. Prisma's query
#  engine (and driver adapters) depend on glibc + OpenSSL 3.x, both of
#  which are first-class citizens on Debian. Alpine's musl libc requires
#  extra binary downloads and can surface hard-to-debug segfaults.
FROM node:22-bookworm-slim AS production

ENV NODE_ENV=production \
    npm_config_update_notifier=false \
    NODE_OPTIONS="--no-warnings"

WORKDIR /app

# Install runtime system deps: OpenSSL 3 + ca-certificates for Prisma,
# plus tini as a proper PID 1 init process (handles signal forwarding
# and zombie reaping if any background job spawns subprocesses).
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      openssl \
      ca-certificates \
      tini \
    && \
    rm -rf /var/lib/apt/lists/* /var/log/apt/*

# Copy the pruned production build from the builder stage.
COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/package.json ./
COPY --from=builder --chown=node:node /build/server.js ./
COPY --from=builder --chown=node:node /build/prisma ./prisma/
COPY --from=builder --chown=node:node /build/src ./src/

# Switch to the unprivileged user (UID 1000, ships with the base image).
USER node

# ── Health check ────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT:-3000}/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

# Document the port the app listens on.
# NOTE: actual port is configured at runtime via the PORT env var;
#       3000 follows the value in .env.example / the Express convention.
EXPOSE 3000

# ── Start ───────────────────────────────────────────────────────────────────
# tini as PID 1 ensures signals (SIGTERM from `docker stop` / k8s) reach
# the Node process correctly and any stray child processes get reaped.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]