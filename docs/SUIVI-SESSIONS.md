# Suivi des sessions de travail

Ce dépôt est modifié depuis plusieurs outils (Claude Code sur le PC, Claude Cowork, conversation Claude). Ce fichier relie chaque lot de travail à la session qui l'a produit, pour le retrouver.

| Versions | Session | Outil | Contenu | Commits |
|---|---|---|---|---|
| 1.7.0 à 1.9.0 | **« Analyse de la facture PayPal »** | Claude Cowork et conversation | Écran de saisie en deux colonnes, marque blanche, écran « Nouvelle facture » sur le modèle PayPal, factures détaillées, plusieurs sociétés émettrices | `ce3fafd`, `91dc5ea`, `fc9c2ed` (PR 21 à 23 du dépôt `app`) |
| 1.10.0 | « ETUDE DE MARCHE GOUV » | Claude Code (PC) | Avis de valeur : enregistrement en ligne, versions conservées, fenêtre « Mes avis & versions », pré-remplissage, sauvegarde automatique de l'étude | branche `avis-refonte` |

## État des branches au 2026-11-15

- `app/main` : la production (`fidi-etude-marche-app.netlify.app`). Un push y déploie.
- `avis-refonte` : travail en cours sur l'avis de valeur, parti de la production 1.9.0.
- `credits-en-attente` : débit des crédits côté serveur (ex-version 1.6.3, commits `609cb93` et `6ca5560`), **jamais mis en ligne**. Les versions 1.7.0 à 1.9.0 ont été construites sans lui. À reprendre sur la production actuelle avant d'activer le péage.
- `main` (local) : même contenu que `credits-en-attente`, en retard sur la production.

## Demandes ouvertes (message du 2026-11-15)

1. Synthèse multi-méthodes (5 ter) : à clarifier, montants supérieurs à la valeur retenue, m² comparables, neuf ou ancien.
2. Stratégie de prix (7 ter) : comparatif acheter dans l'ancien / acheter dans le neuf.
3. Recherche d'annonces similaires : à repenser, périmètre élargi à 1 km.
