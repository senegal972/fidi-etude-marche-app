# Suivi des sessions de travail

Ce dépôt est modifié depuis plusieurs outils (Claude Code sur le PC, Claude Cowork, conversation Claude). Ce fichier relie chaque lot de travail à la session qui l'a produit, pour le retrouver.

| Versions | Session | Outil | Contenu | Commits |
|---|---|---|---|---|
| 1.7.0 à 1.9.0 | **« Analyse de la facture PayPal »** | Claude Cowork et conversation | Écran de saisie en deux colonnes, marque blanche, écran « Nouvelle facture » sur le modèle PayPal, factures détaillées, plusieurs sociétés émettrices | `ce3fafd`, `91dc5ea`, `fc9c2ed` (PR 21 à 23 du dépôt `app`) |
| 1.10.0 | « ETUDE DE MARCHE GOUV » | Claude Code (PC) | Avis de valeur : enregistrement en ligne, versions conservées, fenêtre « Mes avis & versions », pré-remplissage, sauvegarde automatique de l'étude | `877398a` |
| 1.11.0 | Claude Cowork (branche `facturation-centrale`) | Claude Cowork | Facturation : service central pour les autres applications | `3177796` (PR 24 du dépôt `app`) |
| 1.12.0 | « ETUDE DE MARCHE GOUV » | Claude Code (PC) | Avis de valeur : décotes appliquées à la synthèse et à la stratégie, 5 ter réécrit, neuf / ancien, comparatif ancien / neuf | `97b8271` |
| 1.13.0 | « ETUDE DE MARCHE GOUV » | Claude Code (PC) | Version téléphone refaite (`mobile.css`) : barres sur une ligne, liste de rubriques, menu « Plus » | `0fd5252` |
| 1.14.0 | « ETUDE DE MARCHE GOUV » | Claude Code (PC) | Crédits : débit côté serveur après rendu (ex-1.6.3 reportée), péage désactivé | `6610789` |
| 1.15.0 | « ETUDE DE MARCHE GOUV » | Claude Code (PC) | Recherche d'annonces similaires refaite (résultats du moteur, périmètre 1 km, liens portails) | `c0bbe1a` |
| 1.16.0 | « ETUDE DE MARCHE GOUV » | Claude Code (PC) | Carte : fiche de chaque parcelle au clic (bulle, détail, ventes) | `dd4aaea` |
| 1.17.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | Paiement PayPal : diagnostic et corrections (page du client, commande sans adresse, capture vérifiée, messages) | `f839ca9` |
| 1.18.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | Fenêtre « Mon compte » refaite (`compte.css`, rubriques séparées, version téléphone) | `6b3524c` |
| 1.19.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | Règlement par virement (IBAN par société, page du client, facture) ; adresse retirée du pied de page public | `456282d` |
| 1.20.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | Avis : « Tout sauvegarder » et « Restaurer » (copie locale du stockage en ligne) | `9a154c5` |
| 1.21.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | Adresses e-mail sorties du code, passées en variables Netlify | `24cecca` (PR 25, fusionnée) |
| 1.22.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | Mon compte → Facturation repensée ; paiements enregistrés à la main (espèces, virement, chèque) avec justificatif ; annulation de facture sous session | `2cad12b` |
| 1.23.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | Icônes d'installation (iPhone, Android) ; inscription par lien d'invitation ; nouveau mot de passe depuis la fiche d'un compte | `11f809f` |
| 1.24.0 | Suite « PC éteint » du 2026-11-19 | Claude Code (cloud) | « Mot de passe oublié » par e-mail (lien d'une heure, usage unique) | voir `git log` |

## État des branches au 2026-11-16

- `app/main` : la production (`fidi-etude-marche-app.netlify.app`). Un push y déploie.
- `avis-refonte` : travail sur l'avis de valeur, suit la production.
- `credits-en-attente`, `credits-report`, `main` (local) : anciennes bases du débit des crédits, publié en 1.14.0. Ne plus en partir.

## Demandes ouvertes (message du 2026-11-15)

1. ~~Synthèse multi-méthodes (5 ter)~~ : fait en 1.12.0.
2. ~~Stratégie de prix (7 ter), comparatif ancien / neuf~~ : fait en 1.12.0.
3. ~~Recherche d'annonces similaires~~ : refaite en 1.15.0. À vérifier connecté en production (clé Brave).
4. ~~Débit des crédits~~ : publié en 1.14.0, péage désactivé. Avant `PAYWALL_ENABLED=true` : vérifications de `docs/CONCEPTION-DEBIT-PDF.md`.
5. ~~Carte : bulle détaillée au clic sur une parcelle~~ : fait en 1.16.0.
