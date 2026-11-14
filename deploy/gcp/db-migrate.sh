#!/usr/bin/env bash
# Schéma et politiques RLS de la base Supabase, AVANT le premier déploiement.
#
#   ./deploy/gcp/db-migrate.sh                            # dry run, base neuve
#   ./deploy/gcp/db-migrate.sh --apply                    # base neuve
#   ./deploy/gcp/db-migrate.sh --base-existante --apply   # base créée autrefois par `db push`
#
# --base-existante indique à Prisma que la première migration (0_init) est déjà
# en place, puis applique les suivantes. FAIS UNE SAUVEGARDE AVANT : le script la
# demande. Ensuite, cloudbuild.yaml rejoue migrations et RLS à chaque déploiement.
#
# L'URL du propriétaire est lue dans Secret Manager (pharmaiq-direct-url) et
# passée à Prisma par l'environnement ; elle n'est jamais affichée.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" "$@"
EXISTING=0
for arg in "$@"; do [[ "$arg" == "--base-existante" ]] && EXISTING=1; done
banner
cd "$REPO_ROOT"

# pnpm direct, sinon par corepack (fourni avec Node, sans installation globale).
if command -v pnpm >/dev/null 2>&1; then PNPM=(pnpm); else PNPM=(corepack pnpm); fi

step "1. Dépendances et client Prisma"
run "${PNPM[@]}" install --frozen-lockfile
run "${PNPM[@]}" db:generate

step "2. Connexion propriétaire (lue dans Secret Manager)"
if (( APPLY )); then
  DIRECT_URL="$(secret_value pharmaiq-direct-url)"
  export DIRECT_URL DATABASE_URL="$DIRECT_URL"
  note "URL chargée dans l'environnement (non affichée)"
else
  note "+ DIRECT_URL=DATABASE_URL=<secret pharmaiq-direct-url>"
fi

if (( EXISTING )); then
  step "3. Base existante : 0_init marquée comme déjà appliquée"
  if (( APPLY )); then
    read -rp "   Sauvegarde faite (Supabase → Database → Backups, ou pg_dump) ? Tape « oui » : " ok </dev/tty
    [[ "$ok" == "oui" ]] || { echo "   Abandon : fais d'abord la sauvegarde." >&2; exit 1; }
    # P3008 = déjà marquée : le script peut donc être relancé.
    if ! out="$("${PNPM[@]}" --filter @pharmaiq/db exec prisma migrate resolve --applied 0_init 2>&1)"; then
      if grep -q P3008 <<<"$out"; then note "0_init était déjà marquée"; else echo "$out" >&2; exit 1; fi
    fi
  else
    run "${PNPM[@]}" --filter @pharmaiq/db exec prisma migrate resolve --applied 0_init
  fi
fi

step "4. Migrations en attente"
run "${PNPM[@]}" --filter @pharmaiq/db run deploy

step "5. Politiques RLS (OBLIGATOIRE après toute migration : une table sans politique est une fuite)"
note "Retire aussi tout droit aux rôles authenticated et anon de Supabase (voir SECURITY.md)."
run "${PNPM[@]}" db:rls

step "Terminé"
note "Étape suivante : ./deploy/gcp/first-deploy.sh"
