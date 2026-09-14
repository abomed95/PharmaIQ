# Installation et exploitation

> **Sous Windows** : développer depuis **WSL2** (Ubuntu), pas depuis PowerShell.
> Node 22 LTS + pnpm (via corepack) s'installent une fois pour toutes dans la
> distribution. Un dossier monté sous `/mnt/c/...` fonctionne, mais l'install et
> le build y sont nettement plus lents qu'un dossier placé dans le système de
> fichiers Linux (`~/PharmaIQ`) — à envisager si l'attente devient gênante.

## 1. Base de données

### Option A — PostgreSQL local

```bash
createdb pharmaiq
```

`.env` :

```bash
DATABASE_URL="postgresql://pharmaiq_app:motdepasse@localhost:5432/pharmaiq"
DIRECT_URL="postgresql://postgres:motdepasse@localhost:5432/pharmaiq"
ADMIN_DATABASE_URL="postgresql://postgres:motdepasse@localhost:5432/pharmaiq"
```

### Option B — Supabase

Récupère les chaînes de connexion dans *Project Settings → Database* :

- `DATABASE_URL` : connexion **pooler** (port 6543), utilisée à l'exécution ;
- `DIRECT_URL` : connexion **directe** (port 5432), utilisée par les migrations Prisma.

### Le rôle applicatif (important)

La RLS est déclarée `FORCE`, mais **un superutilisateur ou un rôle `BYPASSRLS` la contourne**. En
production, l'application doit se connecter avec un rôle ordinaire :

```sql
create role pharmaiq_app login password '<mot de passe fort>' nobypassrls;
```

Puis `pnpm db:rls` lui accorde les privilèges nécessaires. Vérification :

```sql
select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'pharmaiq_app';
-- rolsuper et rolbypassrls doivent être false
```

`ADMIN_DATABASE_URL` (propriétaire) reste nécessaire pour : l'inscription d'une pharmacie, le job
d'alertes (qui énumère les pharmacies) et les migrations.

### Ordre des opérations

```bash
pnpm db:generate     # client Prisma
pnpm db:push         # ou pnpm db:migrate (migrations versionnées, recommandé en prod)
pnpm db:rls          # ⚠️ à relancer APRÈS CHAQUE migration : les nouvelles tables
                     #   n'ont pas de politique tant que ce script n'a pas tourné.
pnpm db:seed         # facultatif : données de démonstration
```

Contrôle rapide :

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;
```

Toute table métier sans `relrowsecurity = true` est une fuite potentielle.

---

## 2. Supabase Auth

1. *Authentication → Providers* : activer **Email**.
2. Récupérer `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et
   `SUPABASE_SERVICE_ROLE_KEY` (*Project Settings → API*).
3. La clé `service_role` reste **serveur uniquement** : elle crée les comptes et pose le claim
   `app_metadata.pharmacy_id` à l'inscription et à l'acceptation d'une invitation.

L'application ne stocke aucun mot de passe : `User.authUserId` pointe vers `auth.users.id`.

### Stockage des photos de reçus

Créer un bucket **privé** `receipts` (*Storage → New bucket*). Les URL signées sont générées côté
serveur ; `Purchase.receiptImageUrl` garde la trace pour l'audit.

---

## 3. Anthropic (fonctions IA)

```bash
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL_VISION="claude-sonnet-5"   # lecture des reçus (volume)
ANTHROPIC_MODEL_TEXT="claude-opus-5"       # conseils, assistant (raisonnement)
```

Sans cette clé, l'application fonctionne : la lecture de reçu renvoie une erreur explicite (503) et
invite à la saisie manuelle, l'assistant affiche un message d'indisponibilité, et les conseils
d'achat — **qui ne dépendent pas de l'IA** — continuent d'être calculés normalement.

---

## 4. WhatsApp Business Cloud API

1. Créer une app Meta, ajouter le produit *WhatsApp*, récupérer `WHATSAPP_PHONE_NUMBER_ID` et un
   token permanent (`WHATSAPP_TOKEN`).
2. Créer et **faire approuver** un template de message, par exemple `pharmaiq_stock_digest` :

   ```
   🔔 PharmaIQ — {{1}}
   {{2}}
   {{3}}
   👉 Liste de réapprovisionnement : {{4}}
   ```

   L'ordre des paramètres correspond à `buildDigest().templateParams`
   (pharmacie, résumé, détail, lien).
3. En développement, laisser `WHATSAPP_DRY_RUN="true"` : les messages sont journalisés, rien n'est
   envoyé, et le numéro est masqué dans les logs.

Un template est **obligatoire** pour écrire le premier à un utilisateur (hors fenêtre de 24 h) :
`sendText()` n'est utilisable qu'après un message entrant de la pharmacie.

---

## 5. Job d'alertes

`vercel.json` déclare un cron **horaire** sur `/api/alerts/run`. Chaque pharmacie n'est traitée que
si l'heure locale (`Pharmacy.timezone`) correspond à son `alertConfig.sendHour` — indispensable dès
qu'il y a plusieurs fuseaux. Un anti-doublon empêche deux envois le même jour.

```bash
# Déclenchement manuel (ignore créneau et anti-doublon)
curl -X POST "$APP_URL/api/alerts/run?force=1" -H "Authorization: Bearer $CRON_SECRET"

# Une seule pharmacie
curl -X POST "$APP_URL/api/alerts/run?force=1&pharmacyId=<uuid>" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Vercel Cron envoie automatiquement l'en-tête `Authorization: Bearer $CRON_SECRET` si la variable est
définie dans le projet.

---

## 6. Déploiement

### Vercel (front + API)

- *Root directory* : racine du dépôt (le monorepo est géré par `vercel.json`).
- Variables d'environnement : tout `.env.example` **sauf** les commentaires.
- `NEXT_PUBLIC_APP_URL` doit pointer sur le domaine final (utilisé dans les liens WhatsApp et
  d'invitation).

### Migrations en production

```bash
DATABASE_URL="$ADMIN_DATABASE_URL" pnpm --filter @pharmaiq/db run deploy
DATABASE_URL="$ADMIN_DATABASE_URL" pnpm db:rls
```

---

## 7. Import d'un catalogue

```bash
# Contrôle à blanc : rapport d'anomalies, aucune écriture
pnpm import:catalog --pharmacy-id <uuid> --file catalogue.csv --dry-run

# Import réel
pnpm import:catalog --pharmacy-id <uuid> --file catalogue.csv --reorder-level 10
```

- Formats : `.csv` (UTF-8, séparateur `,` ou `;`) et `.xlsx` (nécessite `pnpm add -D -w xlsx`).
- Entêtes reconnues automatiquement en français et en anglais
  ([scripts/lib/catalog-parsing.ts](../scripts/lib/catalog-parsing.ts)).
- Idempotent : relancer le script ne double ni les produits ni le stock.
- Les prix aberrants (facteur ×1000, marges négatives) sont listés avant écriture.

---

## 8. Dépannage

| Symptôme | Cause probable |
|---|---|
| Les listes sont vides alors que la base contient des données | `pnpm db:rls` non exécuté, ou requête hors `withTenant()` |
| `Aucune succursale configurée` | Pharmacie créée sans branche : passer par `/signup` ou `pnpm db:seed` |
| Le test d'isolation est ignoré | `DATABASE_URL` absent de l'environnement |
| Le test d'isolation avertit « rôle BYPASSRLS » | `DATABASE_URL` pointe sur `postgres` : créer et utiliser `pharmaiq_app` |
| `permission denied for table` | `pnpm db:rls` pas relancé après une migration |
| Lecture de reçu en 503 | `ANTHROPIC_API_KEY` absente |
| Alertes « skipped : hors créneau » | Normal : le cron est horaire, l'envoi se fait à `sendHour` |
