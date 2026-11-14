# DEPLOY — PharmaIQ sur Google Cloud

Rien de ce document n'a été exécuté : aucune ressource n'a été créée ni facturée. Les commandes sont à
lancer par toi, dans l'ordre. Ce qui a été **testé en local** : le build de l'image, son exécution
(utilisateur non-root, sonde de santé, connexion PostgreSQL) et l'application des migrations sur une base vide.

## 1. Architecture retenue

| Besoin | Choix | Pourquoi |
|---|---|---|
| Application | **Cloud Run** (1 service, image `Dockerfile`) | Next.js autonome, sans état, démarrage en moins d'une seconde |
| Base + authentification | **Supabase conservé** | L'auth (cookies, invitations, `app_metadata`) repose sur Supabase Auth ; la remplacer est une réécriture, pas un déploiement |
| Secrets | **Secret Manager** | Jamais de secret dans l'image ni dans `cloudbuild.yaml` |
| Tâche horaire d'alertes | **Cloud Scheduler** → `GET /api/alerts/run` | Remplace Vercel Cron (`vercel.json` reste en place, sans effet sur Cloud Run) |
| Images | **Artifact Registry** | |
| Journaux | **Cloud Logging** | L'application écrit déjà une ligne JSON par événement (`severity`, `message`) |

**Option écartée pour l'instant : Cloud SQL.** Migrer la base vers Cloud SQL (≈ 10 à 30 $/mois de plus) n'apporte
rien tant que l'auth reste chez Supabase : il faudrait deux bases ou une réplication des comptes. À reconsidérer
si tu quittes Supabase Auth.

**Région.** `europe-west1` par défaut (tarif le plus bas, proche de la région Supabase habituelle). Choisis la
même région que ton projet Supabase : c'est la latence application ↔ base qui compte, plus que la distance à
Djibouti. `me-central1` (Doha) est plus proche des utilisateurs mais plus chère et loin d'une base européenne.

## 2. Variables à renseigner

```bash
export PROJECT_ID="ton-projet-gcp"
export REGION="europe-west1"
export SERVICE="pharmaiq-web"
export SA="pharmaiq-run"
export REPO="pharmaiq"
# Publiques (incrustées dans le JavaScript du navigateur au build)
export SUPABASE_URL="https://xxxxxxxx.supabase.co"
export SUPABASE_ANON_KEY="eyJ..."
export APP_URL="https://app.exemple.dj"   # ou l'URL *.run.app, connue après le 1er déploiement
```

Secrets attendus (valeurs à saisir toi-même, jamais dans un fichier versionné) :

| Secret | Contenu |
|---|---|
| `pharmaiq-database-url` | URL **poolée** du rôle `pharmaiq_app` (soumis à la RLS, `nobypassrls`) |
| `pharmaiq-admin-database-url` | URL du rôle système (`BYPASSRLS`) — inscription, session, cron |
| `pharmaiq-direct-url` | URL directe (sans pooler) du propriétaire — migrations uniquement |
| `pharmaiq-supabase-service-role` | Clé `service_role` Supabase |
| `pharmaiq-anthropic-api-key` | Clé Anthropic |
| `pharmaiq-cron-secret` | `openssl rand -base64 32` |
| `pharmaiq-whatsapp-token` | Jeton WhatsApp Business (facultatif) |

## 3. Mise en place (une seule fois)

```bash
gcloud config set project "$PROJECT_ID"

# API nécessaires
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com

# Dépôt d'images
gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"

# Compte de service dédié, sans aucun rôle de projet
gcloud iam service-accounts create "$SA" --display-name="PharmaIQ — Cloud Run"

# Secrets : la valeur est lue sur l'entrée standard (elle n'apparaît pas dans l'historique du shell)
for s in pharmaiq-database-url pharmaiq-admin-database-url pharmaiq-direct-url \
         pharmaiq-supabase-service-role pharmaiq-anthropic-api-key pharmaiq-cron-secret; do
  echo "Valeur de $s :"; read -rs v
  printf '%s' "$v" | gcloud secrets create "$s" --replication-policy=automatic --data-file=-
done; unset v

# Privilège minimal : le service ne lit QUE ses secrets d'exécution (pas l'URL de migration)
for s in pharmaiq-database-url pharmaiq-admin-database-url pharmaiq-supabase-service-role \
         pharmaiq-anthropic-api-key pharmaiq-cron-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA@$PROJECT_ID.iam.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done

# Cloud Build : lire l'URL de migration, déployer, agir au nom du compte de service
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CB="serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com"
gcloud secrets add-iam-policy-binding pharmaiq-direct-url --member="$CB" --role=roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$CB" --role=roles/run.admin
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$CB" --role=roles/artifactregistry.writer
gcloud iam service-accounts add-iam-policy-binding "$SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --member="$CB" --role=roles/iam.serviceAccountUser
```

> Selon la date de création du projet, Cloud Build utilise le compte `…@cloudbuild.gserviceaccount.com` ou le
> compte Compute par défaut. Vérifie dans **Cloud Build → Paramètres** lequel est actif et adapte `CB`.

## 4. Base de données

### Base Supabase existante (créée par `db push`)

Le dépôt contient désormais des migrations versionnées. Il faut dire à Prisma que la première est déjà en place :

```bash
export DIRECT_URL="postgresql://…"      # propriétaire, connexion directe
export DATABASE_URL="$DIRECT_URL"
pnpm install && pnpm db:generate
pnpm --filter @pharmaiq/db exec prisma migrate resolve --applied 0_init
pnpm --filter @pharmaiq/db run deploy   # applique 1_purchase_client_ref
pnpm db:rls                             # OBLIGATOIRE après toute migration
```

**Fais une sauvegarde avant** (tableau de bord Supabase → Database → Backups, ou `pg_dump "$DIRECT_URL" > avant.sql`).
`db:rls` retire aussi tout droit aux rôles `authenticated` et `anon` de Supabase : si un autre outil lisait tes
tables par l'API REST de Supabase, il cessera de fonctionner (c'est voulu, voir `SECURITY.md`).

### Base neuve

```bash
pnpm --filter @pharmaiq/db run deploy && pnpm db:rls
```

Rôle applicatif, à créer une fois dans l'éditeur SQL (mot de passe fort) :

```sql
create role pharmaiq_app login password '…' nobypassrls;
```

## 5. Premier déploiement

```bash
# Image construite en local puis publiée. Les valeurs NEXT_PUBLIC_* doivent
# être passées au build : `gcloud builds submit --tag` ne sait pas le faire.
gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build -t "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:initial" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_APP_URL="$APP_URL" .
docker push "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:initial"
```

```bash
gcloud run deploy "$SERVICE" \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:initial" \
  --region="$REGION" \
  --service-account="$SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --port=8080 --cpu=1 --memory=512Mi \
  --min-instances=0 --max-instances=4 --concurrency=40 --timeout=300 \
  --set-env-vars="NODE_ENV=production,TRUSTED_PROXY_HOPS=1,WHATSAPP_DRY_RUN=true,ANTHROPIC_MODEL_VISION=claude-sonnet-5,ANTHROPIC_MODEL_TEXT=claude-opus-5" \
  --set-secrets="DATABASE_URL=pharmaiq-database-url:latest,ADMIN_DATABASE_URL=pharmaiq-admin-database-url:latest,SUPABASE_SERVICE_ROLE_KEY=pharmaiq-supabase-service-role:latest,ANTHROPIC_API_KEY=pharmaiq-anthropic-api-key:latest,CRON_SECRET=pharmaiq-cron-secret:latest"

# Sonde de démarrage et de vivacité sur /api/health
gcloud run services update "$SERVICE" --region="$REGION" \
  --startup-probe=httpGet.path=/api/health,initialDelaySeconds=0,periodSeconds=3,failureThreshold=10 \
  --liveness-probe=httpGet.path=/api/health,periodSeconds=30

URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')
curl "$URL/api/health?deep=1"     # attendu : {"status":"ok","database":"ok"}
```

À faire ensuite :

1. Si `APP_URL` n'était pas encore connue, **reconstruis** l'image avec la vraie URL (elle est incrustée au build
   et sert au contrôle d'origine et aux liens d'invitation).
2. Dans Supabase → Authentication → URL Configuration : ajoute `$APP_URL` aux URL autorisées.
3. Vérifie les identifiants de modèle (`ANTHROPIC_MODEL_*`) dans ta console Anthropic — voir « Points d'attention ».

### Tâche d'alertes (remplace Vercel Cron)

```bash
gcloud scheduler jobs create http pharmaiq-alertes \
  --location="$REGION" --schedule="0 * * * *" --time-zone="Etc/UTC" \
  --uri="$URL/api/alerts/run" --http-method=GET \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=pharmaiq-cron-secret)" \
  --attempt-deadline=320s
```

Le jeton est alors visible dans la configuration de la tâche pour qui a le rôle `cloudscheduler.viewer` :
limite ce rôle.

## 6. Déploiements suivants

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_SUPABASE_URL="$SUPABASE_URL",_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY",_APP_URL="$APP_URL"
```

Le pipeline : typage et tests → image → Artifact Registry → migrations + RLS → révision **sans trafic** →
sonde `/api/health?deep=1` → bascule du trafic. Si une étape échoue, l'ancienne révision continue de servir.

## 7. Retour arrière

```bash
# Révisions disponibles
gcloud run revisions list --service="$SERVICE" --region="$REGION"

# Remettre 100 % du trafic sur une révision saine (effet en quelques secondes)
gcloud run services update-traffic "$SERVICE" --region="$REGION" --to-revisions=NOM-DE-LA-REVISION=100
```

**Base de données.** Le retour arrière du code ne défait pas une migration. Les migrations de ce dépôt sont
additives (colonne nullable, index) : l'ancienne révision fonctionne avec le nouveau schéma. Pour une future
migration destructive, déploie en deux temps (ajouter → basculer → retirer), ou restaure la sauvegarde.

## 8. Estimation de coût mensuel

Ordres de grandeur, région `europe-west1`, à **vérifier avec le simulateur Google Cloud** avant de t'engager :
je n'ai pas interrogé la grille tarifaire en vigueur.

| Poste | Hypothèse | Estimation |
|---|---|---|
| Cloud Run | 5 pharmacies, ~50 000 requêtes/mois, instance minimale à 0 | 0 à 3 $ (souvent couvert par le volume gratuit) |
| Cloud Run, instance minimale à 1 | supprime le démarrage à froid (~1 s) | + 10 à 15 $ |
| Artifact Registry | ~1 Go d'images | < 1 $ |
| Secret Manager | 7 secrets | < 1 $ |
| Cloud Scheduler | 1 tâche | gratuit (3 tâches offertes) |
| Cloud Build | quelques builds par semaine | gratuit dans le quota quotidien |
| Cloud Logging | < 50 Gio/mois | gratuit |
| **Sous-total Google Cloud** | | **≈ 1 à 5 $** (15 à 20 $ avec instance minimale) |
| Supabase | offre gratuite, ou Pro | 0 ou 25 $ |
| Anthropic | plafonné par pharmacie et par jour (`AI_DAILY_LIMIT_*`) | selon l'usage — c'est le poste variable |
| WhatsApp Business | 1 message par pharmacie et par jour | selon le tarif Meta du pays |

Le plafond théorique du poste IA se calcule : 200 questions + 100 reçus + 30 conseils par pharmacie et par jour,
au tarif du modèle choisi. Baisse `AI_DAILY_LIMIT_*` si ce plafond est trop haut pour toi.

## 9. Points d'attention

- **Identifiants de modèle.** Les valeurs par défaut du code (`claude-sonnet-5`, `claude-opus-5`) ne correspondent
  pas aux identifiants que je connais pour la famille Claude 5 (`claude-sonnet-5-5`, `claude-opus-5-5`). Je ne les
  ai pas modifiées. Vérifie-les, sinon la lecture de reçus et l'assistant renverront une erreur.
- **`NEXT_PUBLIC_*` au build.** Changer d'URL Supabase ou d'URL d'application impose de reconstruire l'image.
- **Limitation de débit.** Elle est en mémoire, donc par instance. Avec `--max-instances=4`, la limite réelle
  d'inscriptions est jusqu'à quatre fois la valeur configurée. Pour une vraie barrière : équilibreur HTTPS +
  Cloud Armor (≈ 20 $/mois de plus), et passer alors `TRUSTED_PROXY_HOPS=2`.
- **Connexions à la base.** Chaque instance ouvre son propre pool Prisma. Utilise l'URL **poolée** de Supabase
  (port 6543, `?pgbouncer=true`) pour `DATABASE_URL`, sinon 4 instances peuvent saturer la base.
- **Domaine personnalisé.** `gcloud beta run domain-mappings create` ou un équilibreur de charge ; pense à
  mettre à jour `APP_URL` et à reconstruire.
