# syntax=docker/dockerfile:1
# PharmaIQ — image de production pour Cloud Run (Next.js autonome).
#   docker build -t pharmaiq \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#     --build-arg NEXT_PUBLIC_APP_URL=... .

# ---- Base commune : même système au build et à l'exécution, pour que le moteur
# ---- Prisma généré au build soit celui que l'exécution attend.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- Dépendances : couche mise en cache tant que les manifestes ne changent pas.
FROM base AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/whatsapp/package.json packages/whatsapp/
RUN pnpm install --frozen-lockfile

# ---- Build.
FROM deps AS build
COPY . .
# Les variables NEXT_PUBLIC_* sont INCRUSTÉES dans le JavaScript du navigateur
# et dans l'en-tête CSP au moment du build : elles ne se changent pas au
# déploiement. Elles sont publiques par nature (jamais de secret ici).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_DEFAULT_LOCALE=fr
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_DEFAULT_LOCALE=$NEXT_PUBLIC_DEFAULT_LOCALE
RUN pnpm db:generate \
    && pnpm turbo run build --filter=@pharmaiq/web

# ---- Exécution : ni sources, ni outils de build, ni gestionnaire de paquets.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Utilisateur non privilégié fourni par l'image officielle (uid 1000).
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
