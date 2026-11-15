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

### Charte de marque
- `GET /api/marque` · `POST /api/marque` — charte du compte connecté (cookie `fidi_session`).
  `GET` → `{ compte:{ nom }, marque|null }` ; `POST` reçoit `{ enseigne, produit, baseline, logo, couleurs, coordonnees }`,
  l'assainit (`assainirMarque`) et l'enregistre dans Netlify Blobs, store `fidi-marques`, clé = id de la page
  Notion de l'utilisateur. 401 sans session, 503 `{ blobs_error:true }` si le stockage est indisponible.

### Facturation détaillée
- `POST /api/facture` — accepte en plus `facture:{ lignes, mode, prixSaisis, remise }`, `echeance_jours`, `notes`,
  `client_adresse` (écran `facture.js`). **Les totaux sont recalculés côté serveur** (`_facture_calc.mjs`, miroir
  navigateur `window.FidiFactureCalc`) ; le régime de TVA et l'identité de l'émetteur viennent de la charte du compte
  (`fidi-marques` → bloc `facturation`). Sans régime de TVA : 400 `{ need_regime:true }`. Notion reçoit
  Montant HT / TVA / Montant TTC réels ; le détail complet est **figé** dans Blobs `fidi-factures`
  (clé = jeton de livraison), écrit AVANT la page Notion. Un appel sans `facture` garde le comportement historique.
- `GET /api/facture-html?…&t=<jeton>` — rend la facture détaillée figée (`_facture_doc.mjs`) ; sans détail :
  rendu historique à une ligne (factures antérieures inchangées). `POST /api/facture-html` — aperçu (connexion requise,
  rien n'est enregistré). `factureHtmlUrl()` ajoute `t` automatiquement.
- Arrondis : l'écart de centime est reporté sur la dernière ligne pour que Σ lignes HT − remise HT = total HT
  (testé par balayage dans `tests/facture-calc.test.mjs`). Les prix de la grille (`/api/tarifs`) sont TTC.
- Hors périmètre à ce jour : paiement partiel / acompte (le paiement en ligne encaisse toujours le TTC),
  numérotation `FIDI-FAC-` commune à tous les émetteurs d'un même déploiement.

## Modules d'interface

L'interface est découpée en modules chargés par `index.html`. **Toute évolution de l'écran de saisie
ou de l'habillage passe par ces fichiers, pas par du code ajouté dans `index.html`.**

### Écran de saisie — `saisie.js` / `saisie.css`
- Deux colonnes : le bien (adresse ou référence cadastrale), ses caractéristiques et les vérifications
  à gauche ; périmètre, récapitulatif en direct et bouton d'analyse à droite.
- **Contrat des identifiants** (lus par `lancerAnalyse()`, la recherche cadastrale et `fidiResetSearchFields`) :
  `inputAdresse`, `autocompleteList`, `btnGeoloc`, `lblRecherche`, `modeAdresse`/`modeCadastre` (`name="searchMode"`),
  `cadastreFields`, `inputCommune`, `communeList`, `inputSection`, `inputParcelle`, `extraParcelles`,
  `btnAddParcelle`, `communeMeta`, `selectType`, `inputSurface`, `selectPerimetre`, `btnAnalyse`,
  `optEntreprise`, `entrepriseQueryWrap`, `inputEntrepriseQ`, `optFinance`, `financeQueryWrap`,
  `inputFinanceSiren`, `optPermis`. Vérifié par `tests/interface.test.mjs`.
- La liste `#selectType` (optgroups Résidentiel / Terrain / Professionnel) n'est jamais reconstruite :
  les familles masquent des options. Libellés de surface : `SURFACES` ; modèles : `MODELES_BASE`.
- Sources du récapitulatif : `SOURCES` — **à tenir à jour** quand l'analyse interroge une nouvelle source.
- Aucun brouillon restauré à l'ouverture : les champs restent vidés par `fidiResetSearchFields`.
  Seuls les modèles de critères sont stockés (`localStorage` `fidi_em_modeles`, jamais d'adresse).
- Le contrôle de saisie (adresse ou commune/section/parcelle vides) intercepte le clic et la touche Entrée
  en phase de capture, avant `lancerAnalyse()`.
- Le formulaire se replie en résumé quand `#results-panel` devient visible (MutationObserver) ;
  « Nouvelle étude » demande un second clic si `FidiGuard.isDirty()`.

### Écran de facturation — `facture.js` / `facture.css`
- `window.proposerFacture(kind)` ouvre « Nouvelle facture » : client, articles (montant / quantité / heures, prix TTC ou HT,
  grille tarifaire), remise, note ; colonne d'options (échéance, paiement préalable, canaux, émetteur) ; aperçu.
- Les mentions de l'émetteur manquantes (raison sociale, adresse, SIREN, régime de TVA) se complètent dans la fenêtre
  et sont enregistrées dans la charte via `Marque.maj()` (le panneau « Mise en page » ne peut pas s'ouvrir par-dessus).
- Après création, la page de remise reste celle d'`index.html` : `factAfficherRemise`, `factGenDocLink`,
  `factHistoriqueClient` (identifiants conservés : `factureModal`, `factBody`, `factStatus`, `factClient`, `factEmail`,
  `factTel`, `factAdresse`, `factPayReq`, `factCanEmail`, `factCanWa`, `factBtnOk`, `factTarifsBox`).

### Mise en page / marque blanche — `marque.js` / `marque.css` / `marque.json`
- L'application est destinée à être commercialisée : **aucune enseigne, couleur ou coordonnée client
  ne doit être écrite en dur** dans les écrans et documents imprimés. (« FIDI » reste le nom de la plateforme
  dans l'administration, la facturation et les références `FIDI-EM-…` / `FIDI-AV-…`, qui pilotent les crédits.)
- Priorité : défauts de `marque.js` < `marque.json` (charte du déploiement) < réglages du panneau
  « Mise en page » (menu Compte). Connecté : réglages lus et enregistrés via `/api/marque`, la charte du compte
  remplace celle du navigateur ; sinon `localStorage` `fidi_marque_perso`. Resynchronisation sur l'événement
  `fidi:compte`, émis par `Compte.refresh()`.
- Règles de validation en double — `assainir()` (marque.js) et `assainirMarque()` (marque.mjs) :
  **toute évolution des champs se fait dans les deux**.
- Couleurs : variables CSS `--fidi-blue`, `--fidi-blue-light`, `--fidi-accent`, `--fidi-accent-hover`,
  `--fidi-on-accent`, `--fidi-gold`, `--fidi-on-gold`, `--av-*`. En JavaScript : `Marque.couleur()`,
  `Marque.rgba()`, `Marque.teinte()`, `Marque.encre()`.
- Documents imprimés (rapport A4, récapitulatif, potentiel constructible, avis de valeur, export Word) :
  écrits avec les teintes de référence `#1a3a6e` / `#2652a0` / `#eaf0f8` / `#b8860b`, puis passés à
  `Marque.recolorer(html, { secondaire:false })` (le doré `#b8860b` sert aussi d'alerte orange dans le corps :
  il n'est remplacé que dans les feuilles de style). Identité : `Marque.get()`, `Marque.nomDoc()`, `Marque.enTeteDoc(date)`.
- `marque.json` est versionné dans un dépôt public : **ni téléphone ni adresse personnelle**.
- Reste à faire : modèles de saisie et signataire de l'avis encore stockés par navigateur ; la marque blanche
  n'est rattachée à aucun template ni formule.

## Variables d'environnement (Netlify)
- `SEARCH_API_KEY` — clé **Brave Search API** pour la veille d'annonces (`/api/annonces`).
  Absente ⇒ veille indisponible, dégradation propre vers la saisie manuelle.
- `ANTHROPIC_API_KEY` — *optionnelle*, mode enrichi IA de la veille (non activé par défaut ; facturation à l'usage).
- `ANNONCES_MODEL` — *optionnelle*, modèle utilisé si le mode IA est activé.
- `ANNONCES_MAX_SEARCHES` — *optionnelle*, borne le nombre de requêtes de recherche.
- `NOTION_TOKEN`, `NOTION_DB_*` — intégration Notion (CRM, templates, dossiers).

**Aucune clé API en dur dans le code.** Si les clés sont absentes, l'application se dégrade proprement.

## Tests
- `npm test` — suite `node --test` : endpoints (ESM, CORS, OPTIONS, repli sans secret), charte de marque
  (`marque.test.mjs`), contrat de l'interface (`interface.test.mjs`), facturation détaillée
  (`facture-calc.test.mjs`, `facture-detaillee.test.mjs`), unités veille
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
