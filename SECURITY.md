# SECURITY — PharmaIQ

État après la phase 4 (revue OWASP Top 10). Chaque ligne indique ce qui a été **corrigé**, ce qui était
**déjà en place**, et le **risque résiduel** que tu dois connaître.

## Signaler une faille

Écris au mainteneur du dépôt en privé (pas d'issue publique). Indique les étapes de reproduction et la pharmacie
de test utilisée.

## 1. Contrôle d'accès (A01)

| Sujet | État |
|---|---|
| Isolation entre pharmacies | **Déjà en place** : RLS PostgreSQL + `withTenant()` + filtre explicite, prouvée par `tests/tenant-isolation.test.ts` sur une vraie base. |
| Accès direct par l'API REST de Supabase | **Corrigé.** Les rôles `authenticated` et `anon` avaient tous les droits d'écriture : un caissier pouvait se promouvoir propriétaire sans passer par l'application. Ils n'ont plus aucun droit (`rls.sql`), ce qu'un test vérifie. |
| Identifiants d'une autre pharmacie (client, succursale) | **Corrigé.** Vérifiés avant écriture ; les clés étrangères ne passent pas par la RLS. |
| Redirection ouverte après connexion | **Corrigé.** `?next=` n'accepte qu'un chemin interne. |
| CSRF | **Corrigé.** Toute écriture dont l'en-tête `Origin` n'est pas celui de l'application est refusée (403). |
| Permissions par rôle | **Déjà en place** sur chaque route (`requirePermission`). |

**Risque résiduel.** Le caissier garde `stock.update` (ajustement libre du stock) et peut encaisser à un prix
différent du catalogue ; l'écart est tracé dans le journal d'audit (`sale.price_override`) mais pas bloqué. C'est
une décision métier à confirmer.

## 2. Authentification et sessions (A07)

| Sujet | État |
|---|---|
| Sessions | **Déjà en place** : Supabase Auth, cookies, jeton revalidé à chaque requête (`getUser`), tenant relu en base. |
| Inscription et acceptation d'invitation | **Corrigé.** Limitées à 5 par heure et 10 par 10 minutes, par adresse IP. L'IP est lue à droite de `X-Forwarded-For` (la partie gauche est falsifiable). |
| Invitation | **Corrigé.** L'acceptation échouait dès que l'e-mail partait ; le jeton reste haché en base et expire en 7 jours. |

**Risques résiduels.**
- La limitation est en mémoire, donc par instance (× nombre d'instances). Barrière réelle : Cloud Armor.
- L'inscription marque l'e-mail comme confirmé sans vérification : quelqu'un peut créer une pharmacie avec
  l'adresse d'un tiers. À traiter si l'inscription devient publique (envoi d'un lien de confirmation).
- Politique de mot de passe : 8 caractères minimum, pas de contrôle de mots de passe compromis ni de second
  facteur. Réglable dans Supabase → Authentication.
- Le bruteforce de la connexion est géré par Supabase, pas par l'application : vérifie ses limites.

## 3. Injections (A03)

| Sujet | État |
|---|---|
| SQL | **Déjà en place** : Prisma et `Prisma.sql` paramétré partout ; aucun `$queryRawUnsafe`. |
| XSS | **Déjà en place** : React échappe tout ; aucun `dangerouslySetInnerHTML`. **Ajouté** : `Content-Security-Policy`. |
| URL stockées | **Corrigé.** Seules les URL `http(s)` sont acceptées (`javascript:` et `data:` passaient). |
| Commandes système | Sans objet : aucun appel au shell. |

**Risque résiduel.** La CSP autorise `'unsafe-inline'` pour les scripts : Next injecte des scripts d'amorçage en
ligne, et une CSP à nonce demande de rendre toutes les pages dynamiques via le middleware. Elle bloque quand même
le chargement de scripts externes, l'encadrement (`frame-ancestors 'none'`) et l'envoi de formulaires ailleurs.

## 4. Validation des entrées et téléversement (A04)

- **Corrigé.** Corps de requête refusé au-delà de 8 Mo avant lecture ; image de reçu bornée ; quantités, montants
  et sortie brute du modèle bornés.
- **Déjà en place** : schémas zod stricts, aucun `pharmacyId` accepté du client, type d'image limité à
  JPEG/PNG/WebP/GIF.
- Les photos de reçus ne sont **pas stockées** : elles vont au modèle puis sont oubliées. Pas de surface de
  téléversement de fichiers à ce jour.

## 5. En-têtes et transport (A05)

**Ajouté** : `Content-Security-Policy`, `Strict-Transport-Security` (2 ans), retrait de `X-Powered-By`.
**Déjà en place** : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`Permissions-Policy`. CORS : aucune origine tierce autorisée (comportement par défaut de Next).

## 6. Modèle de langage

| Risque | Traitement |
|---|---|
| Coût | **Corrigé.** Plafond journalier par pharmacie, compté en base : 200 questions, 100 reçus, 30 conseils (`AI_DAILY_LIMIT_*`). |
| Injection de consignes | **Atténué.** Les prompts déclarent données, noms de produits, contexte et historique comme de la donnée ; le contexte du reçu est ramené à une ligne. |
| Sortie non fiable | **Déjà en place** : sortie contrainte par outil, validée par zod, puis **validation humaine obligatoire** avant toute écriture. L'IA n'entre pas dans le calcul des recommandations. |
| Fuite entre pharmacies | **Déjà en place** : l'instantané envoyé au modèle est construit sous `withTenant()`. |

**Risques résiduels.**
- L'injection de consignes ne se supprime pas, elle se contient. Ici le modèle n'a aucun outil d'écriture et ne
  voit que les données de la pharmacie qui l'interroge : le pire cas est une réponse fausse ou la divulgation de
  la consigne système.
- L'historique de l'assistant vient du navigateur : un utilisateur peut y glisser de faux messages. Il ne peut
  tromper que sa propre session.
- Les réponses de l'assistant ne sont pas filtrées ; elles sont affichées comme du texte (jamais comme du HTML).

## 7. Dépendances (A06)

| Paquet | Avant | Après |
|---|---|---|
| next | 14.2.15 — 4 avis critiques (dont exécution de code à distance), 11 hauts | 15.5.29 — aucun avis |
| postcss, source-map-js | hauts | corrigés par surcharge pnpm |
| zod 3.x | haut (épuisement mémoire sur entrée démesurée) | **non corrigé** |

**Risque résiduel : zod.** Le correctif n'existe qu'en version 4 (changement majeur de l'API). L'exposition est
réduite par la limite de 8 Mo sur le corps et par les bornes de longueur ajoutées aux schémas. Migration à
planifier. Relance `pnpm audit --prod` à chaque mise à jour.

## 8. Secrets

- Recherche par motifs dans le code **et** dans tout l'historique git : aucun secret trouvé. Limite : ce n'est
  pas un outil spécialisé ; active le *secret scanning* de GitHub sur le dépôt.
- `.env` est ignoré par git et par Docker. En production, les secrets viennent de Secret Manager (`DEPLOY.md`).
- `SUPABASE_SERVICE_ROLE_KEY` et `ADMIN_DATABASE_URL` contournent la RLS : ils ne doivent exister que côté
  serveur. L'application écrit une erreur dans les journaux si `ADMIN_DATABASE_URL` manque en production.

## 9. Journalisation (A09)

Une ligne JSON par événement, sans secret ni donnée de santé. Les opérations sensibles (prix modifié, annulation
de vente, achat confirmé, invitation, réglages) alimentent la table `AuditLog`.

**Risque résiduel.** `AuditLog` est modifiable par le rôle applicatif (pas de `REVOKE UPDATE, DELETE`). Un
attaquant ayant compromis l'application pourrait l'altérer.

## 10. Non vérifié

- Aucun test d'intrusion ni analyse dynamique n'a été mené.
- Les parcours connectés n'ont pas été exercés contre un vrai projet Supabase (je n'en ai pas) : la configuration
  de Supabase elle-même (politiques d'auth, URL autorisées, limites) reste à relire de ton côté.
