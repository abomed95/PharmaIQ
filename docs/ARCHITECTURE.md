# Architecture

## Vue d'ensemble

```
Navigateur (PWA, mobile-first)
        │
        │  cookies de session Supabase
        ▼
Next.js 14 App Router ─────────────────────────────┐
  Server Components  │  Route Handlers (/api/*)    │
        │            │                             │
        │  requireSession() / requirePermission()   │
        ▼                                          │
  lib/auth.ts ──► pharmacyId RELU EN BASE          │
        │          (jamais depuis le client)       │
        ▼                                          │
  withTenant(ctx) ──► transaction + SET LOCAL app.pharmacy_id
        │                                          │
        ▼                                          │
  PostgreSQL + Row-Level Security FORCE            │
                                                   │
  packages/core   logique pure (décide)            │
  packages/ai     Claude (explique, lit les reçus) │
  packages/whatsapp  Meta Cloud API ◄──────────────┘  cron horaire
```

## Choix structurants

### 1. Le tenant est posé dans la base, pas dans le code

`withTenant()` ouvre une transaction et exécute `SET LOCAL app.pharmacy_id = '<uuid>'`. Toutes les
requêtes de la transaction — Prisma **et** SQL brut — sont filtrées par la politique RLS.

Conséquence pratique : un `where` oublié devient un bug de fonctionnalité (liste vide), jamais une
fuite de données. `SET LOCAL` meurt avec la transaction, donc rien ne fuit entre deux requêtes qui
partagent une connexion du pool.

### 2. `pharmacyId` dénormalisé sur les tables filles

`SaleItem` et `PurchaseItem` portent `pharmacyId` alors qu'on pourrait le déduire du parent. C'est
un choix assumé : la politique RLS reste une comparaison d'égalité sans sous-requête `EXISTS`, ce qui
la rend rapide et impossible à mal écrire. `SaleItem.soldAt` est recopié pour la même raison : les
analyses de vitesse de vente n'ont pas besoin de joindre `Sale`.

### 3. La logique de décision ne dépend de rien

`packages/core` est sans dépendance runtime : FEFO, vitesse de vente, jours de couverture, quantité
à commander, priorités, permissions, détection d'anomalies, totaux de caisse. D'où :

- des tests rapides et déterministes, sans base ni réseau ;
- des recommandations **reproductibles** — deux exécutions donnent le même résultat ;
- l'IA cantonnée à ce qu'elle fait mieux qu'un algorithme : lire un reçu manuscrit, formuler un
  conseil dans la langue du pharmacien.

### 4. L'IA ne décide jamais seule

| Usage | Garde-fou |
|---|---|
| Extraction de reçu | Sortie contrainte par un schéma d'outil, revalidée par zod, **écran de vérification humaine obligatoire** avant écriture |
| Conseils d'achat | Les chiffres viennent du SQL et de `core` ; le modèle ne fait que hiérarchiser et rédiger |
| Assistant | Contexte construit sous `withTenant()` : seules les données du tenant y entrent |

Si `ANTHROPIC_API_KEY` est absente, l'application reste utilisable : saisie manuelle des achats,
conseils d'achat toujours calculés.

### 5. Stock par lot, FEFO systématique

Une sortie de stock (vente, casse, transfert) sert toujours les lots qui périment le plus tôt, les
lots sans date en dernier. Le coût d'achat moyen pondéré des unités servies est enregistré dans
`SaleItem.unitCost` et `Sale.costTotal` : le bénéfice affiché est le bénéfice réel, pas une
estimation au prix catalogue.

Le décrément utilise `updateMany` avec la garde `quantity >= n` : deux caisses qui vendent le même
dernier lot en même temps ne peuvent pas passer toutes les deux.

### 6. Écritures idempotentes là où le réseau est instable

- La caisse envoie une `clientRef` ; le serveur reconnaît un rejeu et renvoie la vente existante au
  lieu d'en créer une seconde.
- L'import de catalogue fait des `upsert` et remet le lot « IMPORT » à la quantité du fichier.
- Le job d'alertes vérifie qu'aucun récapitulatif n'a déjà été envoyé le jour même.

### 7. Numérotation des factures

Séquence par pharmacie **et par mois**, via la table `Counter` (`upsert` + `increment` dans la
transaction de vente) : `INV-202609-000042`. Pas de collision entre tenants, pas de trou en cas
d'échec puisque le compteur vit dans la même transaction que la vente.

## Chemins qui contournent volontairement la RLS

`prismaAdmin` utilise un rôle capable de contourner la RLS. Trois usages, et pas un de plus :

| Chemin | Pourquoi | Protection |
|---|---|---|
| `signupPharmacy()` | Aucun tenant n'existe encore | Aucune donnée client n'est lue ; en cas d'échec de création du compte, la pharmacie est supprimée |
| `getSessionUser()` | Lire l'utilisateur avant de connaître son tenant | Filtré par l'`authUserId` **vérifié** par Supabase ; le claim est recoupé avec la base |
| `runStockAlerts()` | Énumérer les pharmacies à traiter | Le travail par pharmacie repart dans `withTenant()` |

Toute nouvelle utilisation de `prismaAdmin` doit être justifiée en revue.

## Modèle de données

16 modèles, tous porteurs de `pharmacyId` sauf `Pharmacy` (le tenant lui-même) :

- **Tenant** : `Pharmacy`, `Branch`, `User`, `Invitation`
- **Catalogue et stock** : `Category`, `Product`, `Stock` (par lot), `StockMovement` (journal immuable)
- **Achats** : `Supplier`, `Purchase`, `PurchaseItem`
- **Ventes** : `Sale`, `SaleItem` (détail ligne par ligne — base des conseils d'achat), `Customer`
- **Intelligence** : `Alert`, `Recommendation`
- **Technique** : `Counter` (séquences), `AuditLog` (actions sensibles)

Voir [packages/db/prisma/schema.prisma](../packages/db/prisma/schema.prisma).

## Rôles et permissions

La matrice du cahier des charges (§9) est encodée dans
[packages/core/src/permissions.ts](../packages/core/src/permissions.ts) et vérifiée **côté serveur**
à chaque route (`requirePermission`). Le filtrage de la navigation n'est que du confort d'affichage.

Point notable : `receipts.scan` est accordé à **tous** les rôles — c'est le cœur de la promesse
« n'importe quel employé met le stock à jour en photographiant un reçu ». À l'inverse, un caissier
n'accède ni aux marges ni aux rapports financiers (`dashboard.view_limited`).
