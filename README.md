# PharmaIQ

**Plateforme SaaS multi-pharmacies de gestion de stock, ventes et intelligence commerciale.**
Chaque pharmacie a son espace privé ; la caisse encaisse en quelques secondes ; le stock se met à
jour **en photographiant un reçu fournisseur** ; les alertes arrivent **sur WhatsApp** ; et les
conseils d'achat sont calculés sur **les ventes réelles de la pharmacie**.

> Contexte : Djibouti. Devise `DJF`, paiements `Cash`, `Waafi`, `CAC pay`, `D money`, `Saba pay`,
> `banque`. Interface mobile-first, FR / Soomaali / العربية (RTL) / EN.

---

## Les trois fonctions qui font la différence

| Fonction | Où c'est implémenté |
|---|---|
| 📷 **Stock mis à jour par photo de reçu** — Claude lit la facture, rapproche chaque ligne du catalogue, l'employé vérifie puis valide | [packages/ai/src/extractReceipt.ts](packages/ai/src/extractReceipt.ts), [api/receipts/analyze](apps/web/app/api/receipts/analyze/route.ts), [ReceiptImport.tsx](apps/web/components/purchases/ReceiptImport.tsx) |
| 🔔 **Alertes WhatsApp** — un seul message récapitulatif par jour et par pharmacie (ruptures, stocks bas, péremptions) | [packages/whatsapp](packages/whatsapp/src/client.ts), [services/alerts.ts](apps/web/lib/services/alerts.ts), [api/alerts/run](apps/web/app/api/alerts/run/route.ts) |
| 🧠 **Conseils d'achat** — vitesse de vente, jours de couverture, quantité à commander, capital dormant, risque de péremption | [packages/core/src/suggestions.ts](packages/core/src/suggestions.ts), [services/suggestions.ts](apps/web/lib/services/suggestions.ts), [/suggestions](apps/web/app/(app)/suggestions/page.tsx) |

---

## Isolation des données : la contrainte n°1

*Chaque donnée appartient à une pharmacie et une seule.* Cette règle est appliquée à **trois
niveaux**, volontairement redondants :

1. **Base de données** — Row-Level Security PostgreSQL `FORCE` sur toutes les tables métier
   ([packages/db/prisma/rls.sql](packages/db/prisma/rls.sql)). Le tenant courant est résolu par
   `app.current_pharmacy_id()`, qui lit soit le GUC posé par l'application, soit le claim JWT
   Supabase.
2. **Accès applicatif** — toute requête passe par
   [`withTenant()`](packages/db/src/tenant.ts) : une transaction qui exécute
   `SET LOCAL app.pharmacy_id`. Même un `SELECT` en SQL brut sans clause `where` ne renvoie que les
   lignes du tenant.
3. **Session** — `pharmacyId` est **toujours** relu en base à partir de l'identité Supabase vérifiée
   ([lib/auth.ts](apps/web/lib/auth.ts)). Aucun schéma d'entrée n'accepte `pharmacyId` du client.

Le tout est couvert par [tests/tenant-isolation.test.ts](tests/tenant-isolation.test.ts) —
lecture, écriture, suppression, injection d'un `pharmacyId` étranger, SQL brut, fuite entre
transactions. **Ce test tourne en CI sur une vraie base** (voir
[.github/workflows/ci.yml](.github/workflows/ci.yml)).

---

## Démarrage

### Prérequis

- Node.js ≥ 20.11, pnpm 9
- PostgreSQL 14+ (local ou [Supabase](https://supabase.com))
- Facultatif : clé API Anthropic (fonctions IA), compte WhatsApp Business (alertes réelles)

### Mise en route

```bash
pnpm install
cp .env.example .env        # puis remplir DATABASE_URL, Supabase, etc.

pnpm db:generate           # client Prisma
pnpm db:push               # schéma (ou pnpm db:migrate pour des migrations versionnées)
pnpm db:rls                # ⚠️ indispensable : active la Row-Level Security
pnpm db:seed               # deux pharmacies de démonstration

pnpm dev                   # http://localhost:3000
```

Créer une vraie pharmacie : `/signup`. Puis importer un catalogue :

```bash
pnpm import:catalog --pharmacy-id <uuid> --file data/seed/Shifa_Medicaments_Nettoye.csv --dry-run
pnpm import:catalog --pharmacy-id <uuid> --file data/seed/Shifa_Medicaments_Nettoye.csv
```

Le fichier d'amorçage fourni contient 1 340 médicaments réels
([data/seed](data/seed/Shifa_Medicaments_Nettoye.csv)). L'import est idempotent et signale les
anomalies de prix avant d'écrire.

Détails d'installation, rôle PostgreSQL applicatif, Supabase, WhatsApp et déploiement :
**[docs/SETUP.md](docs/SETUP.md)**.

---

## Structure

```
pharmaiq/
├── apps/web/                  Next.js 14 (App Router) — écrans + API
│   ├── app/(marketing)/       page publique
│   ├── app/(auth)/            connexion, création de pharmacie
│   ├── app/(app)/             espace connecté (dashboard, pos, stock…)
│   ├── app/api/               routes serveur
│   └── lib/                   auth, tenant, analytics, services métier
├── packages/
│   ├── db/                    schéma Prisma, RLS, withTenant()
│   ├── core/                  logique métier PURE (FEFO, conseils, permissions)
│   ├── ai/                    appels Claude (vision, conseils, assistant)
│   └── whatsapp/              client Meta Cloud API
├── scripts/import-catalog.ts  import Excel/CSV → produits + stock
├── tests/                     vitest (dont l'isolation multi-tenant)
└── data/seed/                 catalogue d'amorçage
```

`packages/core` n'a **aucune dépendance runtime** : toute la logique de décision (FEFO, vitesse de
vente, priorités, permissions, anomalies) est testable sans base ni réseau. L'IA n'entre jamais
dans le calcul — elle explique, elle ne décide pas.

---

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | Serveur de développement |
| `pnpm build` | Build de production |
| `pnpm typecheck` | Vérification TypeScript du monorepo |
| `pnpm test` | Tous les tests |
| `pnpm test:rls` | Uniquement le test d'isolation (nécessite une base) |
| `pnpm db:push` / `db:migrate` | Schéma |
| `pnpm db:rls` | (Ré)active la RLS — **après chaque migration** |
| `pnpm db:seed` | Données de démonstration |
| `pnpm import:catalog` | Import d'un catalogue CSV/XLSX |

---

## Alertes WhatsApp

Le cron Vercel appelle `/api/alerts/run` **chaque heure** ; chaque pharmacie n'est traitée que si
l'heure locale correspond à son `alertConfig.sendHour` (les pharmacies peuvent être dans des fuseaux
différents). Un envoi par jour maximum, un seul message récapitulatif, journalisé dans `Alert`.

Sans identifiants Meta, `WHATSAPP_DRY_RUN=true` journalise le message au lieu de l'envoyer : le
parcours complet est testable sans compte WhatsApp.

```bash
curl -X POST "http://localhost:3000/api/alerts/run?force=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Feuille de route

- [x] **Phase 0 — Fondations** : multi-tenant + RLS + test d'isolation, auth, invitations, import de catalogue.
- [x] **Phase 1 — MVP** : produits, stock par lot (FEFO), caisse avec détail ligne par ligne, rapports, tableau de bord.
- [x] **Phase 2 — Les 3 fonctions phares** : photo de reçu, alertes WhatsApp, conseils d'achat.
- [~] **Phase 3 — IA avancée** : assistant conversationnel ✅, anomalies de prix ✅ ; prévision de la demande, substitution générique, interactions médicamenteuses à faire.
- [ ] **Phase 4 — Effet de réseau & SaaS** : benchmark anonymisé, tendances régionales, score de santé, facturation Stripe / mobile money.

Détail : [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Licence

Apache 2.0 — voir [LICENSE](LICENSE).
