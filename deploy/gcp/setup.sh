#!/usr/bin/env bash
# Mise en place UNIQUE de l'infrastructure Google Cloud de PharmaIQ.
#
#   ./deploy/gcp/setup.sh            # dry run : affiche les commandes, ne crée rien
#   ./deploy/gcp/setup.sh --apply    # exécute (crée des ressources)
#
# Idempotent : relancé, il saute ce qui existe déjà. Crée les API, le dépôt
# d'images, le compte de service, les secrets (saisis au clavier ou générés,
# jamais affichés) et les droits minimaux. La base reste chez Supabase.
#
# Prérequis côté Supabase (éditeur SQL), une seule fois, AVANT ce script :
#   create role pharmaiq_app login password '<mot de passe fort>' nobypassrls;
# Son URL poolée est demandée ci-dessous (pharmaiq-database-url).

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" "$@"
banner

step "1. API nécessaires"
run gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com iam.googleapis.com --project="$PROJECT_ID"

step "2. Dépôt d'images Artifact Registry"
if exists gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" --project="$PROJECT_ID"; then
  note "déjà présent"
else
  run gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker \
    --location="$REGION" --project="$PROJECT_ID" --description="Images PharmaIQ"
fi

step "3. Compte de service de l'application (aucun rôle de projet)"
if exists gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID"; then
  note "déjà présent"
else
  run gcloud iam service-accounts create "$SERVICE_ACCOUNT" --display-name="PharmaIQ - Cloud Run" --project="$PROJECT_ID"
fi

step "4. Secrets (Secret Manager)"
# Saisie masquée d'un secret obligatoire ; vérifie un préfixe attendu quand il y en a un.
ask_into_secret() {
  local name="$1" prompt="$2" prefix="${3:-}" value
  if secret_exists "$name"; then note "$name déjà présent"; return; fi
  value="$(ask_secret "$prompt")"
  if (( APPLY )); then
    [[ -n "$value" ]] || { echo "   $name : valeur vide, abandon." >&2; exit 1; }
    [[ -z "$prefix" || "$value" == "$prefix"* ]] || { echo "   $name : la valeur doit commencer par « $prefix »." >&2; exit 1; }
  fi
  printf '%s' "$value" | put_secret "$name"
}
note "URL de connexion Supabase : Project Settings → Database → Connection string."
ask_into_secret pharmaiq-database-url \
  "URL POOLÉE (port 6543, ?pgbouncer=true) du rôle pharmaiq_app (soumis à la RLS)" "postgres"
ask_into_secret pharmaiq-admin-database-url \
  "URL du rôle système (BYPASSRLS) : inscription, session, tâche d'alertes" "postgres"
ask_into_secret pharmaiq-direct-url \
  "URL DIRECTE (port 5432, sans pooler) du propriétaire : migrations uniquement" "postgres"
ask_into_secret pharmaiq-supabase-service-role "Clé service_role de Supabase (Settings → API)"
ask_into_secret pharmaiq-anthropic-api-key "Clé d'API Anthropic (console Anthropic → API Keys)"
if secret_exists pharmaiq-cron-secret; then note "pharmaiq-cron-secret déjà présent"
else
  note "pharmaiq-cron-secret : généré (protège /api/alerts/run)"
  random_secret | put_secret pharmaiq-cron-secret
fi

step "5. Droits minimaux"
note "L'application lit ses 5 secrets d'exécution, PAS l'URL de migration (propriétaire)."
for secret in pharmaiq-database-url pharmaiq-admin-database-url pharmaiq-supabase-service-role \
              pharmaiq-anthropic-api-key pharmaiq-cron-secret; do
  run gcloud secrets add-iam-policy-binding "$secret" --project="$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role=roles/secretmanager.secretAccessor --condition=None --quiet
done
BUILD_SA="$(build_service_account)"
note "Cloud Build lit l'URL de migration : cloudbuild.yaml applique migrations et RLS à chaque déploiement."
run gcloud secrets add-iam-policy-binding pharmaiq-direct-url --project="$PROJECT_ID" \
  --member="serviceAccount:$BUILD_SA" --role=roles/secretmanager.secretAccessor --condition=None --quiet
grant_cloud_build "$BUILD_SA" "$SA_EMAIL"

step "Terminé"
note "Étapes suivantes : ./deploy/gcp/db-migrate.sh (schéma et RLS), puis ./deploy/gcp/first-deploy.sh"
