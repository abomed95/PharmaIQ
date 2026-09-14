# Conventions du dépôt PharmaIQ

À lire avant toute modification. Les règles marquées ⛔ ne se négocient pas.

## ⛔ Isolation des données

1. **Toute** lecture ou écriture métier passe par `withTenant(ctx, tx => …)`
   ([packages/db/src/tenant.ts](packages/db/src/tenant.ts)). Jamais `prisma.<model>` directement
   dans une route ou une page.
2. `pharmacyId` vient **toujours** de la session serveur (`requireSession()` /
   `requirePermission()`), jamais du corps d'une requête, d'une query string ou d'un en-tête. Aucun
   schéma zod d'entrée ne doit contenir `pharmacyId`.
3. Ajouter un `where: { ...tenantScope(ctx) }` explicite **en plus** de la RLS. La redondance est
   volontaire : la RLS protège la donnée, le `where` documente l'intention.
4. Toute nouvelle table métier doit :
   - porter `pharmacyId` ;
   - être ajoutée au tableau `tenant_tables` de
     [packages/db/prisma/rls.sql](packages/db/prisma/rls.sql) ;
   - déclencher un `pnpm db:rls` après migration.
5. `prismaAdmin` contourne la RLS. Trois usages autorisés (inscription, résolution de session,
   énumération des pharmacies par le cron). Tout ajout se justifie en revue.
6. Ne jamais affaiblir [tests/tenant-isolation.test.ts](tests/tenant-isolation.test.ts). S'il
   échoue, c'est le code qui est faux, pas le test.

## ⛔ Sorties d'IA

- Toute sortie de modèle est validée par un schéma zod avant usage
  ([packages/ai/src/schemas.ts](packages/ai/src/schemas.ts)).
- Aucune écriture en base à partir d'une sortie d'IA sans **validation humaine** à l'écran. Le
  chemin reste : `/api/receipts/analyze` (lecture seule) → écran de vérification →
  `/api/purchases/confirm` (écriture).
- L'IA n'entre pas dans le calcul des recommandations. Les chiffres viennent de SQL +
  `packages/core`. Si l'IA est indisponible, la fonctionnalité doit rester utilisable.

## Où écrire quoi

| Nature du code | Emplacement |
|---|---|
| Règle de décision, calcul, formatage métier | `packages/core` — **sans dépendance runtime**, avec test |
| Requête SQL d'analyse | `apps/web/lib/analytics.ts` |
| Transaction métier (vente, achat, ajustement) | `apps/web/lib/services/*.ts` |
| Validation d'entrée HTTP | `apps/web/lib/validation.ts` |
| Route HTTP | `apps/web/app/api/**/route.ts` — mince : auth → validation → service → `jsonOk` |
| Appel Claude | `packages/ai` uniquement (jamais d'appel direct depuis `apps/web`) |

Une route qui contient de la logique métier est mal placée : elle appartient à un service ou à
`core`.

## Conventions de code

- TypeScript strict, `noUncheckedIndexedAccess` activé : indexer un tableau donne `T | undefined`,
  il faut le gérer.
- Toutes les routes sont enveloppées dans `handleRoute()` : les erreurs métier
  (`ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`) deviennent des codes HTTP,
  et rien de technique ne fuit au client.
- Montants : `Decimal(12,2)` en base, `number` en mémoire, arrondis avec `round2()`. Ne jamais
  additionner des flottants sans arrondir.
- Dates de péremption : `@db.Date` (pas de fuseau), comparaisons via `daysUntil()`.
- Commentaires : expliquer **pourquoi**, pas **quoi**. Ils sont en français, comme le reste du
  projet.
- Interface : mobile-first, cibles tactiles ≥ 44 px (`min-h-touch`), textes via `getDictionary()` —
  pas de chaîne en dur dans un composant partagé.

## Tests

```bash
pnpm test                                        # tout
pnpm vitest run tests/suggestions.test.ts        # un fichier
pnpm test:rls                                    # isolation (nécessite DATABASE_URL)
```

- Toute règle métier ajoutée à `core` vient avec son test.
- Le test d'isolation est ignoré sans `DATABASE_URL` ; il tourne en CI sur une vraie base avec un
  rôle `nobypassrls`.

## Pièges connus

- **Après chaque migration**, relancer `pnpm db:rls` : une table sans politique est une fuite.
- `DATABASE_URL` doit pointer sur un rôle **sans** `BYPASSRLS` en production, sinon la RLS ne
  protège rien (le test d'isolation émet un avertissement dans ce cas).
- Les listes vides sont le symptôme normal d'une requête hors `withTenant()` : c'est la RLS qui
  fait son travail.
- Le cron d'alertes tourne **chaque heure** ; c'est `alertConfig.sendHour` comparé à l'heure locale
  de la pharmacie qui décide de l'envoi.
- Ne jamais mettre en cache une réponse `/api/*` dans le service worker : une quantité périmée
  ferait vendre à découvert.
