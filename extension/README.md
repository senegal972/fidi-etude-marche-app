# FIDI ACM — Extension navigateur

Extension Chrome/Edge/Brave qui envoie les annonces immobilières visitées vers votre app FIDI (section Comparables de l'Avis de valeur).

## Sites supportés

- **SeLoger** (`www.seloger.com`)
- **LeBonCoin** (`www.leboncoin.fr` — annonces immobilières)
- **DomImmo** (`www.domimmo.com` — portail Antilles)

## Installation

1. Télécharge/copie ce dossier `extension/` sur ton disque.
2. Ouvre Chrome/Edge → `chrome://extensions/`
3. Active le mode **Développeur** (coin haut droit).
4. Clique **Charger l'extension non empaquetée** → sélectionne le dossier `extension/`.
5. L'icône FIDI apparaît dans la barre d'outils.

## Configuration (une fois)

Clique l'icône FIDI dans la barre :
- **URL** : `https://fidi-etude-marche-app.netlify.app` (ou ton URL FIDI)
- **Token** : choisis une chaîne unique (ex. `franck-fidi-2026`). À reporter dans l'app FIDI.
- Bouton **Enregistrer**.

## Usage

1. Va sur une fiche d'annonce SeLoger / LBC / DomImmo.
2. Un bouton flottant bleu **📥 Envoyer à FIDI** apparaît en bas à droite.
3. Clique → l'annonce est envoyée vers ton inbox FIDI (toast de confirmation).
4. Dans l'app FIDI, ouvre un Avis → section Comparables → **Importer depuis l'extension**.

## Détails techniques

- **Manifest V3** (moderne, compatible Chrome 100+ / Edge / Brave).
- Utilise ta **session logée** du navigateur — pas de scraping automatisé.
- Extrait par priorité : JSON-LD → OpenGraph → NEXT_DATA (LBC) → fallback DOM.
- Endpoint FIDI : `POST /api/comparables-inbox` (protégé par ton token).
- Stockage : Netlify Blobs, TTL 30 jours, max 200 items.
- Dédoublonnage par URL.

## Ajustement des sélecteurs

Si un site change son DOM, édite les fichiers `content-<site>.js`. Chaque fichier a une section **SÉLECTEURS AJUSTABLES** en haut. Recharge l'extension après édition (bouton refresh sur `chrome://extensions/`).

## Firefox

Compatible via `about:debugging` → **Charger un module complémentaire temporaire**. Sélectionne `manifest.json`.
