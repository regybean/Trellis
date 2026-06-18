
FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl bash && \
  corepack enable

# Set up pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN pnpm config set store-dir /pnpm/store
RUN pnpm install -g dotenv-cli turbo@^2 --ignore-scripts

### PREPARE
FROM base AS prepare

COPY . .

# Generate a partial monorepo with a pruned lockfile
RUN turbo prune @acme/nextjs --docker

#### BUILDER
FROM base AS builder

ARG STAGE
ARG TURBO_TOKEN
ARG TURBO_TEAM

ENV STAGE=$STAGE
ENV TURBO_TOKEN=$TURBO_TOKEN
ENV TURBO_TEAM=$TURBO_TEAM
ENV CI=true
ENV NODE_ENV=production
ENV TURBO_REMOTE_ONLY=true

# Install dependencies
COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --ignore-scripts

# Build the project
COPY --from=prepare /app/out/full/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  dotenv -e ./apps/nextjs/.env.${STAGE} -- pnpm turbo build --filter=@acme/nextjs

### PRODUCTION
FROM base AS production

RUN apt-get update && apt-get install -y tini jq curl netcat-openbsd postgresql-client

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 --ingroup nodejs --disabled-password --shell /usr/sbin/nologin nextjs

# Create all necessary directories with proper permissions
RUN mkdir -p /app/.config /app/.cache /app/.local/share/pnpm && \
  chown -R nextjs:nodejs /app

# Set up isolated environment for nextjs user
ENV HOME=/app
ENV PNPM_HOME=/app/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV XDG_CACHE_HOME=/app/.cache


# Copy the build and public files
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/.next/static ./apps/nextjs/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/public ./apps/nextjs/public

# Copy migration files
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/migrations/db ./migrations/db
# Copy the drizzle config and env files required to work
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/drizzle.config.ts ./drizzle.config.ts
# copy the node modules required to migrate 
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

RUN cat package.json
# Copy the package.json AFTER standalone so it doesn't get overwritten
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/package.json ./package.json
RUN cat package.json
# Copy the entrypoint script so we can run the container
COPY --from=builder --chown=nextjs:nodejs /app/apps/nextjs/production.docker.entrypoint.sh ./production.docker.entrypoint.sh
RUN chmod +x ./production.docker.entrypoint.sh

USER nextjs

# Configure pnpm for the nextjs user with isolated store
RUN pnpm config set store-dir /app/.local/share/pnpm/store

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "./production.docker.entrypoint.sh"]
