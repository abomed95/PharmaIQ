# Feuille de route

État au moment de la mise en place du dépôt. Les phases suivent le cahier des charges (§10).

## Phase 0 — Fondations (multi-tenant + auth) ✅

- [x] Schéma Prisma complet (16 modèles), `pharmacyId` sur chaque table métier
- [x] Row-Level Security `FORCE` + résolution du tenant par GUC ou claim JWT
- [x] `withTenant()` : tenant posé au niveau base dans chaque transaction
- [x] Test d'isolation sur base réelle, exécuté en CI
- [x] Auth Supabase, rôles, garde de route, permissions serveur
- [x] Inscription d'une pharmacie, invitation d'employés (e-mail **ou** lien partageable)
- [x] Import de catalogue CSV/XLSX idempotent, avec rapport d'anomalies

## Phase 1 — MVP opérationnel ✅

- [x] Catalogue : recherche, catégories, marges, seuils de réapprovisionnement
- [x] Stock par lot avec péremption, tri FEFO, ajustements tracés
- [x] Caisse : recherche, panier, remise, taxe, modes de paiement locaux, monnaie, ticket partageable
- [x] `SaleItem` détaillé + coût réel du lot servi (bénéfice exact)
- [x] Idempotence de la caisse (`clientRef`) — réseau instable
- [x] Historique des ventes filtrable, totaux par mode de paiement
- [x] Tableau de bord : KPI, courbe CA/bénéfice, top produits, compteurs d'alertes

## Phase 2 — Les trois fonctions phares ✅

- [x] Photo de reçu → extraction (sortie contrainte + validation zod)
- [x] Rapprochement flou avec le catalogue (trigramme PostgreSQL + score Dice)
- [x] Écran de vérification humaine obligatoire, création de produits à la volée
- [x] Alertes WhatsApp groupées (un message par pharmacie et par jour), journalisées
- [x] Réglages par pharmacie : numéro, heure d'envoi, paliers de péremption, activation par type
- [x] Conseils d'achat : vitesse de vente, couverture, quantité suggérée, capital dormant, risque de péremption, marges
- [x] Bons de commande regroupés par fournisseur, envoyables par WhatsApp

## Phase 3 — IA avancée (en cours)

- [x] Assistant conversationnel sur les données de la pharmacie (FR/So/Ar/En)
- [x] Détection d'anomalies de prix (facteur ×1000, marges négatives, prix manquants)
- [x] Explication IA des conseils d'achat (facultative, l'app fonctionne sans)
- [ ] Prévision de la demande à 30 jours (moyenne mobile + saisonnalité, puis modèle plus fin)
- [ ] Réapprovisionnement automatique hebdomadaire (bon de commande prêt à envoyer)
- [ ] Substitution générique par DCI
- [ ] Détection d'interactions médicamenteuses à la vente
- [ ] Recherche et commande vocales
- [ ] Reconnaissance d'un produit par photo de la boîte
- [ ] Conseil de délivrance imprimé sur le ticket

## Phase 4 — Effet de réseau & SaaS

- [ ] Benchmark anonymisé inter-pharmacies (agrégé, avec consentement explicite)
- [ ] Détection de tendances régionales
- [ ] Score de santé de la pharmacie (rotation, marge, ruptures, péremptions)
- [ ] Facturation des abonnements (Stripe / mobile money local)
- [ ] Transferts de stock entre succursales
- [ ] Export PDF des rapports et des bons de commande
- [ ] Mode hors-ligne complet de la caisse (file d'attente + synchronisation)

## Dette technique connue

- **Migrations Prisma non versionnées** : le dépôt fournit le schéma et `db:push`. Générer la
  première migration (`pnpm db:migrate --name init`) avant la mise en production, pour disposer d'un
  historique reproductible.
- **Lockfile absent** : à générer au premier `pnpm install`, puis committer.
- **Traductions partielles** : le français est complet ; somali, arabe et anglais couvrent la
  navigation et la caisse. Les clés manquantes retombent sur le français (jamais d'identifiant brut
  à l'écran).
- **Rapports PDF** : seul l'export texte/WhatsApp des bons de commande existe.
- **Transferts inter-succursales** : le type de mouvement `transfer` existe au schéma, l'écran non.
