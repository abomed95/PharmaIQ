# AUDIT — PharmaIQ

Phase 1, lecture seule. Branche `refonte-gcp`. Aucun fichier existant n'a été modifié.

## 1. Stack et architecture

| Couche | Technologie |
|---|---|
| Monorepo | pnpm 9 + Turborepo, TypeScript strict (`noUncheckedIndexedAccess`) |
| Web | Next.js 14.2.15 (App Router), React 18, Tailwind 3, PWA |
| Données | PostgreSQL (Supabase), Prisma 5.22, Row-Level Security (`packages/db/prisma/rls.sql`) |
| Auth | Supabase Auth (cookies), tenant relu en base à chaque requête (`apps/web/lib/auth.ts`) |
| IA | `@anthropic-ai/sdk` 0.32 dans `packages/ai` : lecture de reçus (vision), conseils, assistant |
| Messagerie | WhatsApp Business Cloud API (`packages/whatsapp`) |
| Déploiement actuel | Vercel + Vercel Cron horaire (`vercel.json`) |

Découpage : `packages/core` (règles pures, testées), `packages/db` (client + `withTenant`), `packages/ai`,
`apps/web` (routes minces → services → `jsonOk`). L'architecture est saine et les conventions de `CLAUDE.md`
sont respectées presque partout : toutes les pages de l'espace connecté vérifient la session, aucun
`$queryRawUnsafe`, aucun `dangerouslySetInnerHTML`, aucun `any` hors un cas documenté.

## 2. Points d'entrée

- 16 routes sous `apps/web/app/api/**/route.ts`, toutes enveloppées par `handleRoute()`
- `apps/web/middleware.ts` (rafraîchissement de session, redirections uniquement)
- Cron : `GET|POST /api/alerts/run` protégé par `CRON_SECRET`
- Scripts : `scripts/import-catalog.ts`, `packages/db/prisma/seed.ts`

## 3. Dépendances — `pnpm audit --prod`

| Paquet | Gravité | Détail |
|---|---|---|
| next 14.2.15 | **critique ×4** | Contournement d'autorisation du middleware (corrigé en 14.2.25) ; trois exécutions de code à distance sans authentification, corrigées seulement en **15.5.24 / 15.5.28** |
| next 14.2.15 | haute ×11 | Dénis de service, SSRF |
| zod 3.x | haute | Épuisement mémoire à la validation (corrigé en 4.6.6) |
| postcss, source-map-js | haute | Chaîne de build |

Aucune version 14.x ne corrige les exécutions de code à distance : il faut passer à **Next 15.5.28 ou plus**,
ce qui est une migration majeure (API asynchrones `cookies()`/`params`, React 19 recommandé).

Autres : `@anthropic-ai/sdk ^0.32.1` daté ; identifiants de modèle par défaut `claude-sonnet-5` et
`claude-opus-5` (`packages/ai/src/client.ts:10-12`) — voir « Doutes ».

## 4. Tests existants

68 tests Vitest verts sur 6 fichiers (`core`, caisse, reçus, alertes, import). `tests/tenant-isolation.test.ts`
tourne en CI sur une vraie base avec un rôle `nobypassrls`. Constat local : sans `pnpm db:generate`, ce fichier
**échoue au chargement** au lieu d'être ignoré comme le dit `CLAUDE.md`. Aucun test sur les services
(`sales.ts`, `purchases.ts`, `onboarding.ts`) ni sur les routes. Pas d'étape lint en CI.

## 5. Problèmes

### Critique

| # | Fichier:ligne | Problème |
|---|---|---|
| C1 | `apps/web/package.json:25` | Next 14.2.15 : exécutions de code à distance sans authentification (voir §3). |
| C2 | `packages/db/prisma/rls.sql:108-112` | `grant select, insert, update, delete on all tables` au rôle Supabase `authenticated`. La RLS isole par pharmacie mais **pas par rôle** : avec la clé `anon` publique et sa session, un caissier peut appeler PostgREST directement et modifier `User.role` (se promouvoir propriétaire), le stock, les ventes ou le journal d'audit de sa pharmacie. Les permissions de `packages/core/src/permissions.ts` ne s'appliquent qu'aux routes Next. L'application n'utilise jamais `supabase.from()` : ce droit ne sert à rien. |

### Important

| # | Fichier:ligne | Problème |
|---|---|---|
| I1 | `apps/web/lib/services/onboarding.ts:218` | `inviteUserByEmail` crée déjà le compte Supabase ; à l'acceptation, `createUser` (`:268`) échoue donc avec « déjà enregistré ». **L'invitation est inutilisable dès que l'e-mail part.** |
| I2 | `apps/web/lib/services/sales.ts:195-196` | `unitPrice` et `discount` viennent du client et ne sont pas comparés au prix du catalogue (`sellingPrice` est lu ligne 123 puis ignoré). Un caissier peut vendre à 0. |
| I3 | `packages/core/src/fefo.ts:51-60`, `sales.ts:148-156` | Les lots **périmés** sont servis en premier : rien n'exclut `expiryDate < aujourd'hui`. |
| I4 | `apps/web/lib/services/sales.ts:338-347` | L'annulation recrée un lot sans date de péremption ni numéro de lot d'origine : le stock retourné sort des alertes et passe en dernier dans le FEFO. Points de fidélité non repris. |
| I5 | `apps/web/lib/analytics.ts:46-54,250-258` | Les lignes de ventes **annulées** restent comptées (unités vendues, meilleurs produits, conseils d'achat, instantané de l'assistant) : seule la table `Sale` filtre sur le statut. |
| I6 | routes `assistant`, `receipts/analyze`, `suggestions?explain=1`, `signup-pharmacy` | Aucune limitation de débit ni plafond de coût par pharmacie. L'assistant envoie tout l'instantané + 10 tours d'historique au modèle le plus cher à chaque question. Inscription ouverte, e-mail marqué confirmé sans vérification (`onboarding.ts:127`). |
| I7 | `packages/db/src/admin.ts:18-19`, `.env.example` | `prismaAdmin` retombe sur `DATABASE_URL` si `ADMIN_DATABASE_URL` manque, variable absente de `.env.example` et de `turbo.json`. Avec le rôle RLS, la session ne se résout plus (tout le monde déconnecté) ; avec un superutilisateur, la RLS ne protège plus rien. |
| I8 | `packages/db/prisma/` | Aucune migration versionnée : la CI fait `db push`. Pas d'historique de schéma pour une base de production. |
| I9 | `apps/web/lib/services/purchases.ts:53` | Pas de clé d'idempotence (la vente en a une) : un renvoi réseau double l'entrée en stock. |
| I10 | `apps/web/app/(auth)/login/page.tsx:49` | `router.push(searchParams.get('next'))` sans contrôle : redirection ouverte après connexion. |
| I11 | `apps/web/next.config.mjs:13-18` | Pas de `Content-Security-Policy` ni de HSTS. |
| I12 | `receipts/analyze/route.ts:120-134`, `purchases.ts:98-200` | 2 requêtes par ligne à l'analyse, 6 à la confirmation, dans une transaction limitée à 20 s : un reçu de 300 lignes échoue. |
| I13 | `apps/web/lib/http.ts:105-108` | Les erreurs Prisma (doublon de nom de produit, UUID invalide dans `products/[id]/route.ts:17`) sortent en 500 au lieu de 409/400. |

### Mineur

| # | Fichier:ligne | Problème |
|---|---|---|
| M1 | `sales.ts:55`, `purchases.ts:24` | `resolveBranchId` dupliqué à l'identique. |
| M2 | `stock.ts:31-33`, `sales.ts:246`, `onboarding.ts:179` | `branchId` / `customerId` reçus du client et écrits sans vérifier qu'ils appartiennent à la pharmacie (les clés étrangères ne passent pas par la RLS). |
| M3 | `sales.ts:220` | `paid = 0` est remplacé par le total : vente à crédit impossible à saisir. |
| M4 | `sales.ts:326` | `cancelSale` n'est appelé par aucune route : fonctionnalité inatteignable. Double annulation concurrente possible. |
| M5 | `products/route.ts:91` | Filtre `inStock` appliqué après pagination : pages incomplètes, total faux. |
| M6 | `purchases.ts:111-124` | Un produit déjà existant est compté dans `createdProducts`. |
| M7 | `services/alerts.ts:104` | Quatrième usage de `prismaAdmin`, non listé dans `CLAUDE.md` (règle 5). |
| M8 | `analytics.ts:219-221` | `current_date` suit le fuseau de la base, pas celui de la pharmacie : « aujourd'hui » décalé de 3 h à Djibouti. |
| M9 | `validation.ts:46,86,88,117,120` | `quantityDelta` sans borne ; `imageBase64` sans maximum ; `z.string().url()` accepte `javascript:` ; `aiRaw` illimité. |
| M10 | `packages/whatsapp/src/client.ts:54` | `fetch` sans délai. |
| M11 | `.env.example:23` | `SUPABASE_RECEIPTS_BUCKET` déclaré, jamais utilisé : les photos de reçus ne sont pas conservées. |
| M12 | `settings/route.ts:18` | Fuseau horaire non validé (repli silencieux sur UTC). |
| M13 | `permissions.ts:71-80` | Le caissier a `stock.update` : il peut ajuster le stock librement. À confirmer comme voulu. |
| M14 | partout | Logs par `console.*`, non structurés. |

## 6. Secrets

Code et historique complet : **aucun secret trouvé**. `.env.example` ne contient que des valeurs factices.

## 7. Plan priorisé proposé

1. **C2** : retirer les droits du rôle `authenticated` dans `rls.sql`, test d'isolation étendu (sans l'affaiblir).
2. **C1** : migration Next 15.5.28+ — chantier le plus risqué, à faire seul dans sa série de commits.
3. **I1, I7** : réparer l'invitation ; rendre `ADMIN_DATABASE_URL` obligatoire en production.
4. **Intégrité métier** (I2-I5, I9) : règles dans `packages/core` avec tests, puis services.
5. **Coût et abus** (I6) : limitation de débit et plafond IA par pharmacie.
6. **I8, I10-I13** : migrations Prisma, redirection sûre, en-têtes, erreurs Prisma, requêtes groupées.
7. Refactoring (M1), logs JSON, bornes de validation.

## 8. Doutes

- **I2** : le prix libre en caisse est-il voulu (remise négociée au comptoir) ? Si oui, je propose une tolérance
  configurable et une entrée d'audit plutôt qu'un blocage.
- **I3** : bloquer la vente d'un lot périmé, ou seulement avertir ? Je recommande de bloquer.
- **Identifiants de modèle** : `claude-sonnet-5` et `claude-opus-5` ne figurent pas parmi les identifiants que
  je connais pour la famille Claude 5 (`claude-sonnet-5-5`, `claude-opus-5-5`). À vérifier dans ta console
  Anthropic avant que je touche aux valeurs par défaut.
- **Supabase et GCP** : la phase 5 doit trancher entre garder Supabase (auth + base) avec Cloud Run devant, ou
  migrer la base vers Cloud SQL. L'auth Supabase n'a pas d'équivalent direct sans réécriture.
