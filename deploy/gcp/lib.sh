# Fonctions communes aux scripts de déploiement (chargé par `source`).
#
# Mode par défaut : DRY RUN. Les commandes sont AFFICHÉES, rien n'est créé ni
# facturé et aucune requête n'est envoyée à Google Cloud. Ajouter --apply pour
# les exécuter réellement.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  esac
done

if [[ ! -f "$HERE/config.env" ]]; then
  echo "config.env absent : copier deploy/gcp/config.env.example en deploy/gcp/config.env puis l'adapter." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$HERE/config.env"
if [[ "${PROJECT_ID:-}" == "ton-projet-gcp" || -z "${PROJECT_ID:-}" ]]; then
  echo "Renseigne PROJECT_ID dans deploy/gcp/config.env." >&2
  exit 1
fi

SA_EMAIL="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }

# Exécute la commande, ou l'affiche en mode dry run.
run() {
  if (( APPLY )); then
    "$@"
  else
    printf '   +'; printf ' %q' "$@"; printf '\n'
  fi
}

# Comme run, mais certains drapeaux (jetons, textes libres) sont lus sur l'entrée
# standard au format YAML/JSON et passés par un fichier temporaire lisible par
# toi seul, supprimé aussitôt : ils n'apparaissent ni dans `ps`, ni dans
# l'historique, ni à l'écran.
run_with_flags() {
  if (( ! APPLY )); then
    cat >/dev/null
    printf '   +'; printf ' %q' "$@"; printf ' --flags-file=<fichier temporaire, non affiché>\n'
    return
  fi
  local file rc=0
  file="$(umask 077 && mktemp)"
  cat >"$file"
  "$@" --flags-file="$file" || rc=$?
  rm -f "$file"
  return "$rc"
}

# Écrit la valeur courante d'un secret sur la sortie standard (à brancher sur un
# tube, jamais dans une variable affichée). Valeur fictive en dry run.
secret_value() {
  if (( ! APPLY )); then printf 'valeur-fictive-dry-run'; return; fi
  gcloud secrets versions access latest --secret="$1" --project="$PROJECT_ID"
}

# Lit un jeton sur l'entrée standard et produit le YAML (JSON) d'un drapeau
# d'en-têtes : {"<drapeau>": {"Authorization": "Bearer <jeton>"}}.
bearer_flags() {
  python3 -c 'import json, sys; print(json.dumps({sys.argv[1]: {"Authorization": "Bearer " + sys.stdin.read().strip()}}))' "$1"
}

# Vrai si la ressource existe (commande `describe` silencieuse). Toujours faux
# en dry run : aucune requête n'est envoyée, la commande de création est affichée.
exists() {
  (( APPLY )) || return 1
  "$@" >/dev/null 2>&1
}

# Crée ou met à jour un secret avec une valeur lue sur l'entrée standard.
# La valeur ne passe jamais en argument (visible dans `ps` et l'historique).
put_secret() {
  local name="$1"
  if (( ! APPLY )); then
    note "+ secret $name : valeur fournie sur l'entrée standard, jamais affichée"
    cat >/dev/null
    return
  fi
  if gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets versions add "$name" --project="$PROJECT_ID" --data-file=- >/dev/null
  else
    gcloud secrets create "$name" --project="$PROJECT_ID" --replication-policy=automatic --data-file=- >/dev/null
  fi
  note "secret $name enregistré"
}

secret_exists() { exists gcloud secrets describe "$1" --project="$PROJECT_ID"; }

# Lecture masquée au clavier (rien n'apparaît à l'écran ni dans l'historique).
ask_secret() {
  local prompt="$1" value
  if (( ! APPLY )); then printf 'valeur-fictive-dry-run'; return; fi
  read -rsp "   $prompt : " value </dev/tty; printf '\n' >/dev/tty
  printf '%s' "$value"
}

# Lecture visible au clavier, avec valeur par défaut (textes non secrets).
ask() {
  local prompt="$1" default="${2:-}" value
  if (( ! APPLY )); then printf '%s' "${default:-<$prompt>}"; return; fi
  read -rp "   $prompt${default:+ [$default]} : " value </dev/tty
  printf '%s' "${value:-$default}"
}

random_secret() { python3 -c "import secrets; print(secrets.token_urlsafe(48), end='')"; }
# Lettres et chiffres seulement : pas d'encodage URL dans une URL de connexion.
random_password() { python3 -c "import secrets, string; a=string.ascii_letters+string.digits; print(''.join(secrets.choice(a) for _ in range(32)), end='')"; }

# Compte de service utilisé par Cloud Build. Selon l'âge du projet, c'est le
# compte Compute par défaut ou l'ancien compte Cloud Build : on le demande à
# Google plutôt que de le deviner.
build_service_account() {
  if (( ! APPLY )); then printf '<compte-cloud-build>'; return; fi
  local sa
  sa="$(gcloud builds get-default-service-account --project="$PROJECT_ID" --format=json \
    | grep -oE '[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com' | head -1)"
  if [[ -z "$sa" ]]; then
    echo "   Compte de service Cloud Build introuvable : vérifie Cloud Build → Paramètres." >&2
    exit 1
  fi
  printf '%s' "$sa"
}

# Droits de Cloud Build pour les déploiements suivants (cloudbuild.yaml) :
# publier les images, déployer des révisions, écrire ses journaux, agir au nom
# des comptes de service donnés. roles/run.developer suffit : il ne permet pas
# de modifier qui a le droit d'appeler le service.
grant_cloud_build() {
  local build_sa="$1"; shift
  note "Cloud Build ($build_sa) : images, révisions, journaux."
  for role in roles/run.developer roles/artifactregistry.writer roles/logging.logWriter; do
    run gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$build_sa" \
      --role="$role" --condition=None --quiet
  done
  local sa
  for sa in "$@"; do
    run gcloud iam service-accounts add-iam-policy-binding "$sa" --project="$PROJECT_ID" \
      --member="serviceAccount:$build_sa" --role=roles/iam.serviceAccountUser --quiet
  done
}

service_url() {
  if (( ! APPLY )); then printf '<URL-du-service>'; return; fi
  gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'
}

banner() {
  if (( APPLY )); then
    printf '\033[1mMode EXÉCUTION — projet %s, région %s.\033[0m\n' "$PROJECT_ID" "$REGION"
  else
    printf '\033[1mMode DRY RUN — rien ne sera créé ni facturé. Relancer avec --apply pour exécuter.\033[0m\n'
  fi
}
