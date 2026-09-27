# FIDI · Étude de Marché — repères techniques

Application vanilla (HTML/CSS/JS, SPA) + Netlify Functions ESM (`.mjs`) + Notion + auth JWT maison.
Déployée sur Netlify. Toutes les valeurs chiffrées « métier » sont des **hypothèses à valider** (ni notaire ni expert).

## Endpoints (Netlify Functions → `/api/*`)

Les redirections `/api/<nom>` sont déclarées dans `netlify.toml`.

### Avis de valeur v2
- `GET /api/territoire?insee=|cp=|all=1` — profil territorial (droits de mutation, notaire, TVA honoraires,
  taux de capitalisation, coûts de construction, prime de rareté, note fiscale). Source : `_territoires.mjs`.
- `POST /api/avis-de-valeur` — calcul multi-méthodes **en fourchette** (bas/central/haut).
  Corps : `{ bien, cadastre, methodesV2, strategie, annonces, terrains, territoire }`.
  Réponse : `{ valeur:{ methodes[], synthese }, cout_acquisition, strategie, vigilances, constat_marche }`.
  **Rétro-compatible** : un corps minimal ne provoque pas d'erreur. Logique pure dans `_avis_calcul.mjs`
  (miroir navigateur : `window.FidiAvisCalcV2` dans `avis-valeur.js`).
- `POST /api/annonces` — lance la veille d'annonces (job de fond), renvoie `{ job_id, statut }`.
  `GET /api/annonces?job_id=…` — état + résultats. Sans clé de recherche : `{ statut: "indisponible" }`
  (pas d'erreur 500 ; l'UI propose la saisie manuelle). Cœur : `_annonces.mjs`. Job de fond :
  `annonces-background.mjs` (Background Function, jusqu'à 15 min). Cache : `_cache.mjs` (Netlify Blobs).

## Variables d'environnement (Netlify)
- `SEARCH_API_KEY` — clé **Brave Search API** pour la veille d'annonces (`/api/annonces`).
  Absente ⇒ veille indisponible, dégradation propre vers la saisie manuelle.
- `ANTHROPIC_API_KEY` — *optionnelle*, mode enrichi IA de la veille (non activé par défaut ; facturation à l'usage).
- `ANNONCES_MODEL` — *optionnelle*, modèle utilisé si le mode IA est activé.
- `ANNONCES_MAX_SEARCHES` — *optionnelle*, borne le nombre de requêtes de recherche.
- `NOTION_TOKEN`, `NOTION_DB_*` — intégration Notion (CRM, templates, dossiers).

**Aucune clé API en dur dans le code.** Si les clés sont absentes, l'application se dégrade proprement.

## Tests
- `npm test` — suite `node --test` : endpoints (ESM, CORS, OPTIONS, repli sans secret), unités veille
  (dédoublonnage, similarité, bien sujet, extraction JSON-LD/regex), et fixture Marigot du moteur de calcul.
- `npm run test:marigot` — fixture seule (`tests/avis-marigot.test.mjs`, synthèse 4,70 / 5,30 / 6,00 M€).

## Déontologie
L'avis de valeur est un **document d'aide à la décision**. Il ne constitue ni une expertise judiciaire,
ni un acte notarié. La veille respecte `robots.txt`, limite à 1 requête/seconde/domaine, s'identifie
(`User-Agent: OPTIMMO-DOM-Veille/1.0`) et ne stocke ni image ni texte intégral — seulement des données
factuelles et l'URL source.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
