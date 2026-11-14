#!/usr/bin/env bash
# PREMIER déploiement de PharmaIQ sur Cloud Run (les suivants passent par cloudbuild.yaml).
#
#   ./deploy/gcp/first-deploy.sh            # dry run
#   ./deploy/gcp/first-deploy.sh --apply    # construit l'image, crée le service et la tâche d'alertes
#
# Prérequis : setup.sh --apply et db-migrate.sh --apply terminés.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" "$@"
banner
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/web:initial"

if [[ "$SUPABASE_URL" == *xxxxxxxx* || -z "$SUPABASE_ANON_KEY" ]]; then
  echo "Renseigne SUPABASE_URL et SUPABASE_ANON_KEY dans deploy/gcp/config.env." >&2
  (( APPLY )) && exit 1
fi

step "1. URL de l'application"
# Incrustée au build (contrôle d'origine, liens d'invitation) : elle doit être
# connue AVANT. L'URL Cloud Run « numéro de projet » est prévisible.
if [[ -z "$APP_URL" ]]; then
  if (( APPLY )); then
    PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  else
    PROJECT_NUMBER="<numéro-du-projet>"
  fi
  APP_URL="https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"
fi
note "$APP_URL"

step "2. Construction de l'image sur Cloud Build (8 à 15 minutes)"
run gcloud builds submit "$REPO_ROOT" --project="$PROJECT_ID" --config="$HERE/build-image.yaml" \
  --substitutions="_IMAGE=$IMAGE,_SUPABASE_URL=$SUPABASE_URL,_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,_APP_URL=$APP_URL"

step "3. Création du service Cloud Run"
run gcloud run deploy "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$SA_EMAIL" \
  --allow-unauthenticated \
  --port=8080 --cpu=1 --memory=512Mi \
  --min-instances="$MIN_INSTANCES" --max-instances="$MAX_INSTANCES" \
  --concurrency=40 --timeout=300 \
  --set-env-vars="NODE_ENV=production,TRUSTED_PROXY_HOPS=1,WHATSAPP_DRY_RUN=$WHATSAPP_DRY_RUN,ANTHROPIC_MODEL_VISION=$ANTHROPIC_MODEL_VISION,ANTHROPIC_MODEL_TEXT=$ANTHROPIC_MODEL_TEXT" \
  --set-secrets="DATABASE_URL=pharmaiq-database-url:latest,ADMIN_DATABASE_URL=pharmaiq-admin-database-url:latest,SUPABASE_SERVICE_ROLE_KEY=pharmaiq-supabase-service-role:latest,ANTHROPIC_API_KEY=pharmaiq-anthropic-api-key:latest,CRON_SECRET=pharmaiq-cron-secret:latest" \
  --startup-probe="httpGet.path=/api/health,initialDelaySeconds=0,periodSeconds=3,timeoutSeconds=3,failureThreshold=10" \
  --liveness-probe="httpGet.path=/api/health,periodSeconds=30,timeoutSeconds=5,failureThreshold=3"

step "4. Vérification"
if (( APPLY )); then
  if ! HEALTH="$(curl --fail --silent --show-error --max-time 30 "$APP_URL/api/health?deep=1")"; then
    echo "   $APP_URL ne répond pas. URL réelle du service : $(service_url)" >&2
    echo "   Renseigne-la dans APP_URL (config.env) puis relance ce script : elle est incrustée au build." >&2
    exit 1
  fi
  echo "   $HEALTH"
  grep -q '"database":"ok"' <<<"$HEALTH" || { echo "   ATTENTION : la base ne répond pas (URL poolée, rôle pharmaiq_app ?)" >&2; exit 1; }
else
  note "+ curl $APP_URL/api/health?deep=1   (attendu : {\"status\":\"ok\",\"database\":\"ok\"})"
fi

step "5. Tâche d'alertes horaire (Cloud Scheduler, remplace Vercel Cron)"
note "Le jeton passe par un fichier temporaire, jamais en argument. Il reste lisible dans la"
note "configuration de la tâche par qui a le rôle cloudscheduler.viewer : limite ce rôle."
if exists gcloud scheduler jobs describe pharmaiq-alertes --location="$REGION" --project="$PROJECT_ID"; then
  secret_value pharmaiq-cron-secret | bearer_flags --update-headers | run_with_flags \
    gcloud scheduler jobs update http pharmaiq-alertes --location="$REGION" --project="$PROJECT_ID" \
      --schedule="$ALERT_SCHEDULE" --uri="$APP_URL/api/alerts/run" --http-method=GET
else
  secret_value pharmaiq-cron-secret | bearer_flags --headers | run_with_flags \
    gcloud scheduler jobs create http pharmaiq-alertes --location="$REGION" --project="$PROJECT_ID" \
      --schedule="$ALERT_SCHEDULE" --time-zone="Etc/UTC" --uri="$APP_URL/api/alerts/run" \
      --http-method=GET --attempt-deadline=320s
fi

step "À faire à la main"
note "1. Supabase → Authentication → URL Configuration : ajoute $APP_URL aux URL autorisées."
note "2. Teste la lecture d'un reçu : elle valide l'identifiant $ANTHROPIC_MODEL_VISION et la clé Anthropic."
note ""
note "Déploiements suivants :"
note "  gcloud builds submit --config cloudbuild.yaml --project=$PROJECT_ID \\"
note "    --substitutions=_REGION=$REGION,_REPOSITORY=$REPOSITORY,_SERVICE=$SERVICE,_SERVICE_ACCOUNT=$SERVICE_ACCOUNT,_SUPABASE_URL=$SUPABASE_URL,_SUPABASE_ANON_KEY=<clé anon>,_APP_URL=$APP_URL"
note "Retour arrière : ./deploy/gcp/rollback.sh"
