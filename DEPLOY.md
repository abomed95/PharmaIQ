# DEPLOY — PharmaIQ sur Google Cloud

Rien n'a été exécuté sur Google Cloud : aucune ressource n'a été créée ni facturée. Les scripts de
`deploy/gcp/` sont à lancer par toi, dans l'ordre. Ce qui a été **testé en local** : le build de l'image, son exécution
(utilisateur non-root, sonde de santé, connexion PostgreSQL) et l'application des migrations sur une base vide. Scripts : dry run relu ; `db-migrate.sh --apply` exécuté
pour de vrai sur PostgreSQL 16 (base neuve, puis base « `db push` » avec relance) ; `setup.sh` et
`first-deploy.sh` en `--apply` contre une doublure de `gcloud` (aucun secret en argument ni à l'écran).

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

## 2. Les scripts (`deploy/gcp/`)

Toute la procédure est scriptée. Chaque script **affiche** ce qu'il ferait (dry run) ; il n'agit qu'avec `--apply`.
Lance-les depuis **Cloud Shell** (console Google Cloud, bouton `>_`) : `gcloud`, Node et `pnpm` (par corepack) y sont
disponibles.

| Ordre | Script | Rôle |
|---|---|---|
| 0 | *(Supabase, éditeur SQL)* | `create role pharmaiq_app login password '…' nobypassrls;` — une fois |
| 1 | `setup.sh` | API, dépôt d'images, compte de service, 6 secrets (5 saisis au clavier, le jeton du cron généré), droits minimaux |
| 2 | `db-migrate.sh` | migrations Prisma puis RLS ; `--base-existante` pour une base créée autrefois par `db push` |
| 3 | `first-deploy.sh` | image (avec les `NEXT_PUBLIC_*`), service, vérification `/api/health?deep=1`, tâche d'alertes horaire |
| — | `rollback.sh` | liste les révisions, ou renvoie le trafic vers l'une d'elles |

```bash
git clone <ce dépôt> && cd PharmaIQ
cp deploy/gcp/config.env.example deploy/gcp/config.env   # PROJECT_ID, SUPABASE_URL, SUPABASE_ANON_KEY (aucun secret)
./deploy/gcp/setup.sh --apply
./deploy/gcp/db-migrate.sh --apply                      # ou : --base-existante --apply
./deploy/gcp/first-deploy.sh --apply
```

**Secrets demandés par `setup.sh`** (saisie masquée, jamais affichés ni passés en argument) :

| Secret | Contenu | Lu par |
|---|---|---|
| `pharmaiq-database-url` | URL **poolée** (port 6543, `?pgbouncer=true`) du rôle `pharmaiq_app` | service |
| `pharmaiq-admin-database-url` | URL du rôle système (`BYPASSRLS`) : inscription, session, cron | service |
| `pharmaiq-direct-url` | URL directe (sans pooler) du propriétaire | migrations (`db-migrate.sh`, Cloud Build) |
| `pharmaiq-supabase-service-role` | clé `service_role` de Supabase | service |
| `pharmaiq-anthropic-api-key` | clé Anthropic | service |
| `pharmaiq-cron-secret` | **généré** | service, tâche d'alertes |

**Base existante.** `db-migrate.sh --base-existante` demande de confirmer la sauvegarde (Supabase → Database →
Backups, ou `pg_dump`), marque `0_init` comme appliquée, applique les migrations suivantes puis la RLS. Il peut
être relancé : une migration déjà marquée est reconnue. La RLS retire aussi tout droit aux rôles `authenticated`
et `anon` de Supabase : un outil qui lisait tes tables par l'API REST de Supabase cessera de fonctionner (c'est
voulu, voir `SECURITY.md`).

**URL de l'application.** Elle est incrustée au build (contrôle d'origine, liens d'invitation). Laissée vide,
`first-deploy.sh` utilise l'URL Cloud Run prévisible `https://<service>-<numéro du projet>.<région>.run.app`. Si
elle ne répond pas, le script affiche l'URL réelle du service : renseigne-la dans `APP_URL` et relance. Ajoute-la
ensuite dans Supabase → Authentication → URL Configuration.

**Tâche d'alertes** (remplace Vercel Cron, `vercel.json` reste sans effet sur Cloud Run). `first-deploy.sh` la
crée ou la met à jour. Le jeton passe par un fichier temporaire lisible par toi seul, jamais en argument ; il
reste visible dans la configuration de la tâche pour qui a le rôle `cloudscheduler.viewer` : limite ce rôle.

**Compte Cloud Build.** `setup.sh` demande à Google lequel est utilisé (compte Compute par défaut ou ancien compte
Cloud Build, selon l'âge du projet), lui donne `run.developer` plutôt que `run.admin`, et l'accès à
`pharmaiq-direct-url` pour les migrations.

## 3. Déploiements suivants

```bash
source deploy/gcp/config.env      # SUPABASE_URL, SUPABASE_ANON_KEY, APP_URL (valeurs publiques)
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_SUPABASE_URL="$SUPABASE_URL",_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY",_APP_URL="$APP_URL"
```

Si `APP_URL` est restée vide dans `config.env`, remplace `$APP_URL` par l'URL affichée par `first-deploy.sh`.

Le pipeline : typage et tests → image → Artifact Registry → migrations + RLS → révision **sans trafic** →
sonde `/api/health?deep=1` → bascule du trafic. Si une étape échoue, l'ancienne révision continue de servir.

## 4. Retour arrière

```bash
./deploy/gcp/rollback.sh                                 # liste les révisions
./deploy/gcp/rollback.sh pharmaiq-web-00012-abc --apply  # 100 % du trafic sur cette révision
```

**Base de données.** Le retour arrière du code ne défait pas une migration. Les migrations de ce dépôt sont
additives (colonne nullable, index) : l'ancienne révision fonctionne avec le nouveau schéma. Pour une future
migration destructive, déploie en deux temps (ajouter → basculer → retirer), ou restaure la sauvegarde.

## 5. Estimation de coût mensuel

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

## 6. Points d'attention

- **Identifiants de modèle.** Les valeurs par défaut du code (`claude-sonnet-5`, `claude-opus-5`) ne correspondent
  pas aux identifiants de la famille Claude 5 (`claude-sonnet-5-5`, `claude-opus-5-5`). `first-deploy.sh` passe
  donc les bons identifiants au service (`ANTHROPIC_MODEL_*` dans `config.env`), et les déploiements suivants les
  conservent. Teste la lecture d'un reçu après le premier déploiement.
- **`NEXT_PUBLIC_*` au build.** Changer d'URL Supabase ou d'URL d'application impose de reconstruire l'image.
- **Limitation de débit.** Elle est en mémoire, donc par instance. Avec `--max-instances=4`, la limite réelle
  d'inscriptions est jusqu'à quatre fois la valeur configurée. Pour une vraie barrière : équilibreur HTTPS +
  Cloud Armor (≈ 20 $/mois de plus), et passer alors `TRUSTED_PROXY_HOPS=2`.
- **Connexions à la base.** Chaque instance ouvre son propre pool Prisma. Utilise l'URL **poolée** de Supabase
  (port 6543, `?pgbouncer=true`) pour `DATABASE_URL`, sinon 4 instances peuvent saturer la base.
- **Domaine personnalisé.** `gcloud beta run domain-mappings create` ou un équilibreur de charge ; pense à
  mettre à jour `APP_URL` et à reconstruire.
