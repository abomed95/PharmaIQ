#!/usr/bin/env bash
# Retour arrière : renvoie tout le trafic vers une révision précédente (effet en quelques secondes).
#
#   ./deploy/gcp/rollback.sh                                  # liste les révisions
#   ./deploy/gcp/rollback.sh pharmaiq-web-00012-abc        # dry run
#   ./deploy/gcp/rollback.sh pharmaiq-web-00012-abc --apply
#
# La base n'est pas touchée : le code revient en arrière, pas les migrations. Celles du dépôt
# sont additives (l'ancienne révision fonctionne avec le nouveau schéma) ; sinon, restaure
# la sauvegarde Supabase.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" "$@"
REVISION=""
for arg in "$@"; do [[ "$arg" != --* ]] && REVISION="$arg"; done

if [[ -z "$REVISION" ]]; then
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
    --format="table(metadata.name, status.conditions[0].status:label=PRÊTE, metadata.creationTimestamp.date('%Y-%m-%d %H:%M'):label=CRÉÉE)"
  exit 0
fi
banner
run gcloud run services update-traffic "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --to-revisions="$REVISION=100"
note "Pour revenir à la dernière version plus tard : gcloud run services update-traffic $SERVICE --to-latest --region=$REGION"
