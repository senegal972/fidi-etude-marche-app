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
  **Décotes** : le moteur donne la valeur d'un bien en état courant et libre. Dans le navigateur, `syntheseFinale(data)`
  applique la décote d'état et d'occupation de la rubrique « Valeur vénale retenue » (sur la comparaison ; « Sol + construction »
  porte déjà sa vétusté) : 5 ter, 7 ter et la valeur retenue donnent ainsi le même montant. Toute sortie de prix
  (objectif, présentation, comparatif ancien / neuf) passe par `strategieCalc(data)`, jamais par la synthèse brute.
  L'API `/api/avis-de-valeur` n'applique pas ces décotes. **Neuf / ancien** : `segmentComparable(cp)` ; un comparable de
  l'autre catégorie que le bien (`bien.segment`) est écarté du calcul (vente d'un bien bâti seulement). Tests : `tests/avis-synthese.test.mjs`.
- `POST /api/annonces` — recherche d'annonces similaires, **synchrone**, **connexion exigée** (401 sinon : la route consomme
  la clé payante `SEARCH_API_KEY`, Brave Search). Corps : `{ commune, code_postal, type_bien, surface_hab, lat, lon, rayon_m, portails[] }`.
  Sans clé : `{ statut:"indisponible" }`. Cœur : `_annonces.mjs`. **Les portails refusent la lecture automatique de leurs pages** :
  les annonces sont lues dans les résultats du moteur (`annoncesDuResultat`, titre + extrait), aucune page de portail n'est ouverte.
  `quartiersProches(lat, lon, rayon)` (IGN BD TOPO, sans clé) donne les quartiers du périmètre ; une annonce qui en cite un est
  `proche:true`. Une requête Brave par portail coché, espacées de 1,1 s (palier gratuit). `resultats.motif` explique un résultat vide.
  Liens directs côté navigateur : `veilleLiens()` (Leboncoin avec rayon, Bien'ici commune, autres par recherche web).
  `/api/annonces-background` est retirée (410). Tests : `tests/annonces-recherche.test.mjs` (extraits réels).

### Avis de valeur : accueil, lien avec l'étude, destinataire — `avis-valeur.js`
- **Un avis par étude** : `etudeKeyOf()` (adresse, type, coordonnées — **jamais le destinataire**) → `stableRefForEtude()`.
- `AvisValeur.open(nature|ref)` : s'il n'existe pas encore d'avis pour l'étude affichée (`avisExistePourEtude()`), `accueilAvis(nature,'creation')`
  ouvre `#avAccueilModal` (résumé `resumeEtude()`, Vente / Location, destinataire) puis rappelle `open()` avec `state._accueil`. Plus aucun
  `window.prompt`. Un avis existant sans destinataire (et sans `metadata.sansDestinataire`) ouvre `accueilAvis(…,'destinataire')` par-dessus.
- **Destinataire** : `destinataireEtude()` lit d'abord le champ `#inputDestinataire` de l'étude (souvent rempli après l'analyse), puis
  `__fidiInputs.destinataire`. `poserDestinataireEtude()` reporte le nom de l'avis dans l'étude ; `synchroniserDestinataire()` fait la concordance
  à chaque ouverture ; `appliquerAccueil()` écrit `metadata.client / emailClient / telephoneClient` et **`strategie.destinataireType`** (le calcul
  lit `strategie`, pas `metadata`). Coordonnées d'un client connu : `clientConnu()` sur `listClientsMerged()`.
- **Repris de l'étude à chaque ouverture** (`injectEtudeGeoCadastre`, même étude seulement) : localisation, cadastre, zonage, risques ; plus
  `window.__fidiPluRegle` (`reglePluEtude`, `reglePluTexte` → `cadastre.droitsResiduels` tant que le texte commence par « D'après le règlement
  du PLU », et emprise du règlement pour `shobAutorisee` avant `empriseMedianeZone`), `window.__fidiAleas` (`aleasEtudeTexte` → `loc.ppr`) et
  `metadata.refEtude` (`currentEtudeRef()`), et la fiche descriptive du bien (`bien.fiche`, voir « Valoriser le bien »). Non repris à ce jour :
  `__fidiDaafOnf`, `__fidiImplantation`, note de l'étude.
- **Avancement** : `manquesRubrique(id)` → éléments essentiels vides (`[]` complète, `null` rien d'exigé) ; `majAvancement()` marque les onglets
  (`av-tab-ok` / `av-tab-manque`), les options de `#avSecSelect` et la barre `#avAvancement` (jauge, « Voir ce qui reste », liens `data-av-aller`).
  Appelé par `showSection()` et, à la saisie, par `planifierAvancement()`. Guide seulement : rien n'est bloqué.
- **`bien.prixVente` (« prix de cession / proposé ») n'est jamais pré-rempli** : le document l'énonce comme un fait (« a été cédé / est
  proposé pour un prix de … »). Avis anciens : retiré une fois s'il égale `estimation.valeur_med` (`_prixVerifie`, message). Un avis tiré d'une
  étude part en `bien.statut = 'libre'` ; l'occupation (et sa décote) se choisit à l'accueil (`#avAccStatut`).
- **Deux valeurs dans un même document** : la rubrique 7 imprime `F.retenue`, la 7 ter part de `F.net.synthese`. Si `!F.coherent`, le document
  l'écrit en 5 ter **et** en 7 ter, et `manquesRubrique('calcul')` le liste. Ne jamais masquer cet écart.
- `toast()` est en `pointer-events:none` : l'élément reste dans la page après s'être effacé et bloquait les boutons du bas sur téléphone.
- Tests : `tests/avis-accueil.test.mjs` ; le comportement se vérifie dans un navigateur (création, réouverture, ancien avis, sans destinataire).

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
- **Plusieurs sociétés émettrices** : la charte porte `emetteurs[]` (10 au plus) et `emetteurDefaut`. `POST /api/facture`
  reçoit `emetteur_id` ; la société est lue dans la charte du compte (repli : `charte` transmise), son identité est figée
  dans le détail. **Numérotation par société** : `<préfixe>-<AAAA>-<NNN>` (`nextFactureRef(year, prefixe)`, filtre Notion
  `starts_with`) ; `FIDI-FAC` = suite historique quand aucune société n'est définie. Une prestation déjà facturée par une
  société ne peut pas être ré-éditée au nom d'une autre : 409 `{ autre_emetteur:true }`.
- **Logo par société** : une société émettrice porte `logo` (data URL PNG, réduit à 440 × 128 par `lireLogo` dans `emetteurs.js`, < 200 ko ;
  validé par `assainirEmetteur` des deux côtés). Sur la facture : `e.logo`, sinon le logo de la charte si `avecLogo` (`pourDocument` et
  `emetteurDe` — **même règle dans les deux**). **Mentions par société** : champ `mentions` (240 car.), même règle : `e.mentions`, sinon celles de la charte si `avecLogo`. Le logo de la charte reste celui de
  l'application (écrans, rapports). Charte plafonnée à 2,6 Mo (`TAILLE_MAX`).
- **Service central pour les autres applications** (REA, Fiche découverte, HomeStaging PRO, suivi de chantier) :
  - `facturation-pont.js` (à inclure dans l'application cliente depuis cette app) : `FidiFacturation.ouvrir({ source, type_libelle,
    ref, client, bien, lignes, prixSaisis, mode, notes, lien_document, onCreee, onFermee })` ouvre `/?facturer=1` en fenêtre ;
    données par `postMessage` (`fidi:facture-prete` → `fidi:facture-demande` → `fidi:facture-creee`). Mobile :
    `FidiFacturation.lienDirect(demande)` (données dans le fragment `#facturer=`, effacé à la lecture).
  - `facture-externe.js` (récepteur) : liste blanche d'origines `ORIGINES` — **ajouter ici le domaine de toute nouvelle
    application** ; appelle `proposerFacture('prestation', demande)` une fois connecté ; rien n'est créé sans clic.
  - `POST /api/facture` accepte `kind:"prestation"` (détail `facture` obligatoire, `type_libelle` → Type Notion, `source` figée).
  - `POST /api/facture-auto` (serveur à serveur) : en-tête `X-Fidi-Cle` = `FIDI_FACTURATION_CLE` (≥ 24 car.), facture émise
    au nom du compte `FIDI_FACTURATION_COMPTE`, marquée Payée si `paye !== false` ; idempotente sur `ref`
    (Référence dossier). Sans ces variables : 503.
- **Acompte** : pas de paiement partiel d'une facture. L'acompte est une facture ordinaire ; la facture de solde le déduit par
  `remise:{ type:"eur", valeur, nature:"acompte", reference }` — même calcul qu'une remise en euros (`_facture_calc.mjs` et miroir `facture.js`),
  libellé « Acompte déjà versé (facture n° …) » (`_facture_doc.mjs`). Écran : option « € — acompte déjà versé » du menu de remise (`lireRemise`).
  Une remise et un acompte ne se cumulent pas sur une même facture. Chaque facture est payée en entier : **PayPal encaisse toujours `f.montant`**.
- Hors périmètre à ce jour : paiement partiel d'une même facture ;
  les préfixes ne sont uniques qu'au sein d'un compte (deux comptes d'un même déploiement doivent en choisir de différents).

### Paiement en ligne (PayPal)
- `_paypal.mjs` : `createOrder` (toujours `NO_SHIPPING` + `PAY_NOW` : sans cela le formulaire carte exige une adresse complète),
  `lireCapture(cap)` (**seule une capture `COMPLETED` vaut paiement** : une commande peut revenir `COMPLETED` avec une capture
  `DECLINED` ou `PENDING`), `erreurPaypal(e)` (message français pour le client, `restart` si le moyen est refusé), `journalPaypal`
  (journal des fonctions Netlify : code PayPal et `debug_id`, aucune donnée personnelle). La réponse brute de PayPal n'est jamais renvoyée au navigateur.
- Factures : `POST /api/facture/pay-create { token }` puis `POST /api/facture/pay-capture { token, orderId }` (publics, clé = jeton de remise).
  Crédits : `/api/paypal/create-order`, `/api/paypal/capture-order` (session exigée).
- Page du client `/l/<jeton>` (`livraison.mjs`) : facture impayée sans paiement préalable → documents + bouton `#btnPayer` vers `?pay=1` ;
  le script PayPal est chargé par la page pour afficher un message s'il est bloqué. Le script en ligne est écrit dans un gabarit JavaScript :
  **toute apostrophe y est écrite `\\'`** (vérifié par `tests/paypal.test.mjs`, qui compile le script produit).
- **Documents remis** : `blocDocuments()` (serveur) et `docsHTML()` (script de la page de paiement, même structure) — un bouton `#btnTout` ouvre le
  document (lien) et la facture (`data-fac`, `SCRIPT_DOCS`), **toujours dans un nouvel onglet** : la page du client ne doit jamais être remplacée
  (application installée = pas de bouton retour). Après paiement, `reveal()` masque `#zonePaiement` et passe `#etatBadge` à « Payée ».
  `facture-html` ajoute « ← Retour à mes documents » quand `t` est fourni (`avecRetour`). Le lien du document n'est jamais dans la page avant paiement.
- **Dossier en un seul PDF** : `GET /api/dossier?t=<jeton>[&part=doc]` (`dossier.mjs`, public, mêmes conditions que `/l/<jeton>` : rien avant
  paiement). Facture rendue par Chromium (`rendrePdf` de `pdf-render.mjs`, page de `facture-html`) puis fusionnée avec le document (`pdf-lib`,
  `fusionner`) ; résultat gardé dans Blobs `fidi-dossiers` (`tout/<jeton>/<p|n>`), le document y est recopié sans limite de durée (`doc/<jeton>`,
  le dépôt `fidi-shared` s'efface après 7 jours). Possible seulement si « Lien document » est un dépôt de l'application (`fusionPossible`,
  `idPartage` dans `_facture.mjs`) ; sinon l'ancien bouton à deux onglets. Plafond `MAX_OCTETS` (réponse de fonction ≤ 6 Mo). Tout échec rend une
  page d'explication avec les liens séparés. **Ne pas importer `dossier.mjs` depuis une autre fonction** (il embarque Chromium) : les aides
  partagées sont dans `_facture.mjs`. Tests : `tests/dossier.test.mjs`.
- **Diagnostic** : `GET /api/paypal/diagnostic` (`paypal-diagnostic.mjs`, administrateur) → `diagnosticPaypal()` demande un jeton à PayPal :
  `acces` = `ok | refuse | injoignable | absent`. Bouton « Tester le paiement en ligne » (Facturation → Réglages, `diagnostiquer()`).
  Un `pay-create` en **502** = PayPal refuse l'identifiant / le secret du site (`invalid_client`) : aucun client ne peut payer.
- Variables : `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_ENV` (`live` ou `sandbox` ; absent = `sandbox`).
- **Virement** : une société émettrice porte `iban`, `bic`, `titulaire` (`assainirEmetteur`, `ibanValide` / `bicValide` — en double dans
  `marque.js` et `marque.mjs`). `emetteurDe()` les fige dans `emetteur.banque` ; `_facture_doc.mjs` les affiche tant que la facture n'est pas
  acquittée ; `livraison.mjs` (`banqueDe`, `blocVirement`) les lit dans le détail figé, à défaut dans `FIDI_VIREMENT_IBAN` / `_BIC` / `_TITULAIRE`.
  **Aucun IBAN dans le dépôt.** Un virement ne débloque rien automatiquement : la facture est marquée payée à la main.
- Non couvert : paiement partiel, notification PayPal différée (webhook) pour un paiement resté « en attente », rapprochement bancaire.

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

### Bandeau de l'étude après analyse — `etude-actions.js` / `etude-actions.css`
- Bloc `#etudeActions` en tête de `#results-panel` : titre, puis « Pour qui est cette étude ? » (`etudeNatureClient` / `etudeNatureTest`, nom dans
  `#inputDestinataire`, `etudeContactEmail`, `etudeContactTel`, `etudeContactMemo`) et tuiles `.ea-tuile` (mêmes identifiants et mêmes fonctions
  qu'avant : `btnSaveEtude`, `btnShareEtude`, `btnFactureEtude`, `btnAvisRes`, `ddResBar`, `btnActualiserEtude`). **Toute nouvelle action de
  l'étude est une tuile de ce tableau.** `window.fidiEtudeContact()` → `{ nature, nom, email, telephone }` (lu par `facture.js`) ; « Mémoriser »
  écrit dans `localStorage` `fidi:clients` (liste commune à l'étude, à l'avis et à la facture). « Essai » vide et masque le destinataire.
  Rien n'est imprimé de ce bloc hors le titre. Tests : `tests/profils-bandeau.test.mjs`.

### Potentiel constructible — `implantation.js` (`FidiImplantation`)
- `compute(p)` (pur, testé sur des rectangles) : zone après reculs, emprise, surface de plancher, bâtiments placés. S'y ajoutent :
  **voirie interne** (`p.voirie` : `true` / `false` = choix de l'utilisateur, non défini = proposée d'office si le terrain fait ≥ 50 m de long
  et porte ≥ 3 bâtiments ; bande de `voirieLargeur` m — 5 par défaut — dans la longueur, position gardée = celle qui loge le plus de bâtiments ;
  `res.voirie = { largeur, longueur, surface, runs }`), **espaces verts** (`pleineTerrePct` → `res.pleineTerre_m2` ; des bâtiments sont retirés
  tant que `res.libre_m2` ne les couvre pas, `res.retiresEspaces`), **stationnement** (`placesLogt` × `logtsBati`, 25 m² par place →
  `res.places`, `res.parking_m2`). L'emprise retenue est plafonnée par ces réserves (`limite_par = 'espaces'`).
- `defauts(regles)` lit `pleine_terre.pct` et le nombre de places par logement dans la citation de `stationnement` (`_plu_regles.mjs`).
  **Largeur minimale de voie** : `regleVoirie()` (`_plu_regles.mjs` → `regles.voirie = { m, objet:'voie'|'accès', page, citation }`, voie avant
  accès, valeurs de 2,5 à 20 m seulement) → `voirieLargeur` avec sa page ; sans lecture : 5 m, usage courant. Emprise absente du règlement :
  repli sur `data.emprise_pct`, sinon milieu de la fourchette de `window.__fidiRegleIndicative` (posé par `constructRules` dans `index.html`),
  affiché « indicatif (règles de la zone) ». État par étude : `__fidiData.implantation.valeurs` (dont `voirie`).
- Le stationnement n'est pas dessiné (surface seulement). Tests : `tests/implantation.test.mjs`.

### Valoriser le bien — `valorisation.js` / `valorisation.css` (`FidiValorisation`)
- Bouton `#btnValoriser` de la carte « Estimation vénale » → `ouvrir()` : fenêtre `#valoModal` (composition, surfaces par pièce, annexes, atouts).
  `calculer(fiche, avant, prixM2)` (pur, testé) : **valeur × (1 + Σ % des atouts) + Σ surface × coefficient × prix au m²**, sur les trois bornes ;
  catalogue `ANNEXES` (coefficients 0,2 à 0,5) et `ATOUTS` (pourcentage proposé + fourchette de repère) — repères d'usage, **aucun barème
  officiel**, tout est modifiable à l'écran ; cumul > 35 % signalé, jamais bloqué. `typologie()` : T + pièces principales (ou chambres + 1).
- **Ordre des ajustements** : la valorisation s'applique après la décote d'état ou l'ajustement « ruine » (exclusifs entre eux). `etatApply` et
  `ruineApply` appellent `apresAjustement()` ; une nouvelle analyse appelle `reinitialiser()`. `appliquer()` pose `window.__estBase` s'il est vide
  pour que l'état / la ruine repartent toujours de la valeur d'origine.
- Données : `__fidiData.fiche_bien` (la fiche) et `__fidiData.estimation.valorisation` (`pct`, `annexes_eur`, `lignes`, `avant_med`, `med`) ;
  `estimation.valeur_min / med / max` portent la valeur valorisée (lue par les documents). Rappel à l'écran : `#valoResume`, `#valoAppliedTag`.
- **Rapport A4** : `htmlRapport(d)` (pur, défini avant la partie écran — c'est le seul endroit du module qui porte des styles en ligne, aux
  teintes de référence du rapport) rend le bloc « Fiche descriptive du bien » ; `rapport-a4.js` l'ajoute après l'estimation (même case
  d'impression `estimation`) et rappelle la valorisation dans le bandeau. Sans valorisation appliquée : relevé des éléments cochés, sans chiffre.
- **Conservation** : `notion-save` écrit `{ fiche, valorisation }` dans la propriété « Fiche du bien » de l'étude (JSON, au mieux) ;
  `propsToEtude` les rend dans `data.fiche_bien` et `estimation.valorisation` ; `reopenEtude` appelle `restaurer()` (valeur de départ =
  `valorisation.avant`). Non fait : la décote d'état n'est toujours pas restaurée à la réouverture.
- **Avis de valeur** : `injectEtudeGeoCadastre` copie `fidi.fiche_bien` dans `bien.fiche` à chaque ouverture et complète `bien.nbPieces`,
  `bien.terrasse` (`surfaceExterieure`) et `bien.surfaceCarrez` **seulement s'ils sont vides**. Le document ajoute `htmlAvis(b.fiche)` après la
  rubrique 2 (bien bâti seulement). **La fiche y est descriptive : ni montant ni pourcentage appliqué** — l'avis fixe sa valeur par ses propres
  méthodes, et reporter la valorisation de l'étude afficherait deux valeurs. La fiche se modifie dans l'étude, pas dans l'avis.
  Tests : `tests/valorisation.test.mjs`.

### Mes documents et confidentialité — `_documents.mjs`, `documents.mjs`, `mes-documents.js` / `mes-documents.css`
- **Règle, appliquée côté serveur** (`_documents.mjs`, pur et testé : `peutVoir`, `peutModifier`, `assainirPartage`) : chacun voit ses documents ;
  un compte règle qui voit les siens — `prive`, `groupe` (membres de son groupe = champ « Réseau »), `choisi` (membres désignés du même groupe) —
  dans les propriétés Notion du compte « Partage documents » et « Partage avec » ; **jamais d'un groupe à l'autre**, ni entre comptes sans groupe ;
  l'administrateur voit tout. **Un partage ne donne que la lecture** : seuls le propriétaire et l'administrateur modifient ou suppriment.
- **Deux écosystèmes** (propriété Notion « Écosystème » du compte : `Interne` par défaut, `Public`) : `interne` = cercle de l'administrateur,
  qui en voit toutes les données ; `public` = client ayant acheté une prestation — **l'administrateur n'accède à aucune de ses données**
  (`peutVoir(admin, compte public) === false`, `peutModifierDossier`, `emailsVisibles(admin)` → `exclus`, `dansPortee`) et ne gère que le compte
  (`admin-users`). `memeGroupe` exige le même écosystème. Sans la liste des comptes, l'administrateur ne reçoit rien (503) plutôt que tout.
  Routes concernées : `notion-list` (`does_not_equal` + revérification), `notion-get/save/delete`, `avis-store`, `crm-clients`, `factures-client`,
  `factures-admin`, `facture-cancel`. Écran : `adEcosysteme` / `fcEcosysteme`, `Compte.libellesPartage()`. **Barrière applicative, pas un
  chiffrement** : qui détient les accès Notion / Netlify peut lire les bases en dehors de l'application. Non couvert : les routes d'action sur une
  facture par son numéro (`facture-paiement`, `facture-avoir`, `facture-relance`, `facture-delete`, `contacts`) ne vérifient pas l'écosystème.
- **Propriétaire d'un dossier** : propriété Notion « Propriétaire » (e-mail) sur les bases Études et Avis, posée par `notion-save` à la création ;
  avis en ligne : dossier du compte dans Blobs (`d/<compte>/…`). **Dossier sans propriétaire (antérieur à la 1.50) : administrateur seulement**,
  qui l'attribue (`POST /api/documents { action:"attribuer", kind, ref, email }`).
- Routes : `notion-list` (filtre `or` sur « Propriétaire » dans la requête **et** revérification par dossier ; items annotés `proprietaire`,
  `proprietaire_nom`, `groupe`, `a_moi`, `modifiable`), `notion-get` (404 identique à un dossier absent si le lecteur n'y a pas droit ; `lecture_seule`),
  `notion-delete` et `notion-save` (403 `{ autre_compte:true }` sur le dossier d'un autre), `avis-store` (liste = mes avis + ceux des comptes visibles ;
  `proprio` d'un autre compte : lecture si `peutVoir`, sinon 404 ; l'écriture ne vise jamais le compte d'un autre, sauf administrateur).
  **Toute nouvelle route qui lit ou écrit un dossier passe par ces fonctions.**
- `GET|POST /api/documents` (`documents.mjs`) : réglage du compte connecté (`action:"partage"`) et membres de son groupe ; `ecrirePartage` sert aussi à
  `admin-users` (`create` : `partage` ; `update` : `partage`, `partage_avec`). `moncompte` renvoie `groupe`, `partage`, `partage_avec`.
- Écran : `FidiDocuments.ouvrir()` (bouton `#ddDocs`) — onglets « Les miens », « Mon groupe », « Tous les comptes » (administrateur, par groupe
  puis par personne, dont « Sans propriétaire »), filtre études / avis, recherche, réglage « Qui peut voir mes documents ? ». Une étude se rouvre par
  `reopenEtude(ref)` ; un avis par `AvisDossiers.ouvrir(ref)` (recherche pré-remplie). L'écran présente : il ne décide pas de la confidentialité.
- **Clients et factures, mêmes règles** (`emailsVisibles(lecteur)`, `colonneCompte`) : `/api/crm-clients` ne rend que les contacts dont la colonne
  « Compte application » (`PROP_COMPTE`, posée à la création) est un compte visible — filtre dans la requête et revérification ; le carnet
  d'origine, sans compte, est réservé à l'administrateur. `facture.mjs` pose « Propriétaire » sur toute nouvelle facture (au mieux : sans la
  colonne, la facture est créée quand même) ; `/api/factures/client` filtre sur ce compte ; `/api/facture/cancel` n'agit que pour l'émetteur ou
  l'administrateur (404 sinon). Factures antérieures, sans compte : administrateur. Cache navigateur du carnet : `fidi:crm:cache:clients:v2`.
- **Attribuer une facture** (administrateur) : `POST /api/documents { action:"attribuer", kind:"facture", ref:<numéro>, email }` et
  `{ action:"attribuer_factures", email }` (factures **sans** compte seulement, `LOT_FACTURES` par appel → `{ faites, restantes }`, l'écran rappelle
  tant qu'il en reste). `factures-admin` renvoie `proprietaire`. Écran (`compte-facturation.js`) : action `attribuer` de la fiche, ligne « Compte
  émetteur », bandeau `bandeauSansCompte()` en tête de la liste.
- Non couvert : les contacts mémorisés dans le navigateur (`localStorage` `fidi:clients`) sont propres au poste, pas au compte : deux personnes
  qui partagent un même navigateur les voient tous les deux.
  Tests : `tests/documents.test.mjs`, `tests/notion-session.test.mjs`, `tests/avis-store.test.mjs`.

### Assistance — `assistance.js` / `assistance.css`, `assistance.mjs`
- Bouton `#btnAssistance` (« Aide ») → `FidiAssistance.ouvrir()` : fenêtre en trois étapes (nature → partie concernée et gravité → description),
  captures par fichier ou collage, réduites par `preparerImage` (JPEG, 1 600 px) ; la partie concernée est pré-sélectionnée selon l'écran ouvert.
- `GET|POST /api/assistance` (session exigée) : `signaler` (`assainirSignalement`, pur : nature obligatoire, texte ≥ 10 caractères ou une capture,
  3 captures de 1,4 Mo au plus, PNG / JPEG / WebP) → numéro `A-AAAAMMJJ-XXXXXX` ; Blobs `fidi-assistance` (`t/<n°>`, `c/<n°>/<i>`) **écrits avant**
  l'e-mail à `adresseContact()` (au mieux). Liste, lecture, captures et `etat` (`ouvert` / `traite`) : administrateur. `GET` sans paramètre rend
  l'adresse de contact : **aucune adresse n'est écrite dans le code**.
- Mon compte → Assistance (`tabAssistance`, `#assistanceAdminRoot`, `FidiAssistance.monterAdmin()`). Tests : `tests/assistance.test.mjs`.

### Présentation & tarifs — `presentation.js` / `presentation.css` (`FidiPresentation`, `window.Presentation`)
- `Presentation.open()` (boutons `#btnPresentationDirect`, `#miPresentation`, connexion exigée) : fenêtre `#presModal` — deux grilles (Études de marché,
  Avis de valeur), interrupteur `#presGlobal` (formule globale = module « Cumulatif »), texte par grille (`MODULES`), cartes de prix, aide
  « Lequel choisir ? » (`COMPARATIF` + `conseiller(m, { documents, volume })` : jamais plus de crédits que le besoin d'une année) et calcul de marge
  (`marge(prixVente, prixCredit)`, prix de vente saisi par l'utilisateur). **Les prix viennent de `/api/offres`** (`modele(offres, grille)`, offres
  actives de la grille du compte ; économie recalculée sur les prix affichés) ; `reference()` n'est qu'un repli, signalé à l'écran.
- **Rien ne s'achète ici** : « Choisir » ferme la fenêtre et ouvre Mon compte → Offres (le circuit PayPal n'est pas touché). Le lien partagé
  `/#presentation` ouvre la présentation après connexion (événement `fidi:compte`). **Ni promesse de résultat, ni prix de marché en dur, ni mention
  « confidentiel »** (test). Les crédits forment un solde unique (`Crédits` du compte), quel que soit le module de l'offre achetée : ne pas écrire
  qu'un crédit est réservé à un type de document. Tests : `tests/presentation.test.mjs`.

### Statistiques — `compte-statistiques.js` / `compte-statistiques.css`, `statistiques.mjs`
- `GET /api/statistiques` (administrateur) lit les bases Notion Études et Avis (1 000 dossiers par base au plus) et les comptes, puis
  `agreger(dossiers, comptes, maintenant)` (pur, testé) : totaux et 30 jours, douze mois glissants, jours de la semaine, types de biens, et —
  **cercle interne seulement** — secteurs, groupes, utilisateurs. **Clients publics : des nombres seulement** (`parEcosysteme.public`,
  `secteursPublic` à partir de `SEUIL_PUBLIC` = 3 dossiers), jamais de détail par compte ; les secteurs détaillés excluent les dossiers publics
  pour qu'aucune soustraction ne les révèle. La réponse ne contient ni adresse e-mail, ni client, ni adresse de bien.
- Écran : rubrique `tabStats` / `#statsRoot`, `FidiStatistiques.monter()`. Graphique mensuel en SVG, deux séries (bleu `#257de0`, orange
  `#f47230`, palette validée), légende, détail au survol, **équivalent en tableau** (« Voir en tableau »). Tests : `tests/statistiques.test.mjs`.

### Profils & modules — `compte-profils.js` (rubrique `tabProfils`, administrateur)
- `FidiProfils.monter()` rend dans `#profilsRoot` les profils (`/api/templates` : modèles système + personnalisés dans la base Notion des
  templates) et leurs modules cochables, groupés (`MODULES[].groupe` dans `templates.mjs`). Un compte porte un profil par le champ « Profil
  type » de sa fiche (`Template` dans Notion) ; sans profil ou administrateur : tout est visible. **Tout nouveau bloc de résultats doit avoir une
  clé dans `MODULES` et une étiquette** (`data-flag="<clé>"` dans le HTML, ou `TAG_BY_ID` de `FidiFlags`) — vérifié par le test.
  Le masquage est fait dans le navigateur (`FidiFlags.apply`) ; côté serveur, seules les routes qui appellent `assertModule` refusent le module.

### Entreprises installées autour du bien — `entreprises-proches.js`
- Option `optEntreprise` cochée **sans** SIREN ni nom : `lancerAnalyse()` appelle `FidiEntreprisesProches.charger(data.localisation)` →
  `GET /api/entreprises-adresse?lat=&lon=&radius=0.1` (`entreprises-adresse.mjs`, Recherche d'entreprises / Sirene, établissements actifs, sans clé).
  `classer()` trie par distance (calculée dans le navigateur), écarte doublons et hors rayon ; ≤ `SUR_PLACE_M` (30 m) = « à cette adresse ou tout
  près ». « Fiche légale » → `loadEntrepriseAsync(siren)` puis bouton de retour à la liste. Avec un SIREN ou un nom : comportement historique.
  C'est un relevé déclaratif (la réserve est affichée), pas un constat d'occupation. Santé financière (Pappers) : SIREN toujours exigé.
  Tests : `tests/entreprises-proches.test.mjs`.

### Choisir la parcelle sur la carte — `saisie-carte.js` (styles dans `saisie.css`)
- Bouton `#btnCarteChoix` dans le sélecteur `.saisie-modes` (ce n'est **pas** un troisième `searchMode` : la recherche reste « adresse » ou
  « cadastre »). Il ouvre le panneau `#carteChoix` : ville (`#carteChoixVille`, suggestions `geo.api.gouv.fr`), « Ma position », carte Leaflet
  avec le calque Cadastre, et la fiche de parcelle (`FidiParcelle.attacher` avec `actions`).
- Position de départ, dans l'ordre : commune déjà saisie (`fidiCommuneSaisie()`), géolocalisation de l'appareil, dernière commune utilisée
  (`localStorage` `fidi_carte_derniere` : code, nom et centre de la commune, jamais d'adresse), sinon vue d'ensemble en attendant la ville.
- **Précision de la position** : sans GPS (ordinateur, partage de connexion) le navigateur déduit la position du réseau, à plusieurs kilomètres
  près. `localiser()` écarte une position dont `coords.accuracy` dépasse `PRECISION_MAX` (1 500 m) : pas de « Vous êtes à … », dernière ville
  utilisée à l'ouverture, secteur approximatif (zoom 12) sur clic. `#btnGeoloc` (adresse) refuse au-delà de 500 m. Ne jamais afficher une commune
  ou une adresse déduite d'une position imprécise.
- « Étudier cette parcelle » → `fidiChoisirParcelle({ commune, section, numero })` (index.html) : passe en mode « Réf. cadastrale », pose
  `selectedCommune` et remplit les champs ; `ajouter:true` pousse une parcelle supplémentaire de la même commune dans `__searchParcelles`.
  **L'analyse n'est jamais lancée automatiquement** (elle consomme un essai). Rappel affiché dans `#carteChoixRetenue`.
- **Grand écran** : `#carteChoixGrand` → `grandEcran(actif)` pose `saisie-carte-plein` sur `#carteChoix` (position fixe, `z-index:1040`, **sous** les
  fenêtres Bootstrap pour que « Détail de la parcelle » reste au-dessus) et `saisie-carte-plein-actif` sur `body`. Échap (sauf fenêtre ouverte),
  « Réduire » et `fermer()` en sortent ; la carte est recalculée (`invalidateSize`).

### Fenêtre « Mon compte » — `window.Compte` (index.html) / `compte.css`
- Colonne de navigation `.cpt-cote` (identité + `nav.cpt-nav`, boutons `.nav-link.cpt-lien` pilotés par les onglets Bootstrap) et
  contenu `.cpt-corps` ; une rubrique = un panneau `.tab-pane` avec `header.cpt-titre` puis des blocs `.cpt-carte`.
- **Contrat des identifiants** : `compteModal`, `compteDialog`, `compteTitre`, `compteBody`, `cpEmail`, `cpPwd`, `cpErr` ; panneaux `tabIdent`,
  `tabSolde`, `tabOffres`, `tabSocietes` (sociétés émettrices, tout compte), `tabAdmin` (comptes), `tabTarifs` (grille tarifaire), `tabFactAdmin` (contenu : voir « Mon compte → Facturation ») ;
  `offresBox`, `ppBuyBox`, `adListBody`, `adCreateForm`, `adTarifsBody`, `tfCreateForm`, `tfGroup`, `factAdminRoot`.
  Vérifié par `tests/interface.test.mjs`.
- `Compte.rubrique(id)` ouvre une rubrique ; `Compte.miseEnPage()` ferme la fenêtre puis ouvre « Mise en page ».
- Toute nouvelle rubrique : un bouton dans `nav.cpt-nav` + un panneau ; pas de style en ligne, les classes sont dans `compte.css`
  et les règles ≤ 768 px dans `mobile.css` (barre de rubriques sur une ligne défilante).

### Comptes : création, invitation, mot de passe
- **Un mot de passe n'est jamais relisible** (haché dans Notion). Trois chemins :
  1. l'administrateur crée le compte (Mon compte → Comptes → « Créer un compte ») : mot de passe généré ou saisi, affiché une seule fois ;
     quota d'essais `DEFAULT_QUOTA` = 2, champs Crédits / Essais jamais vides (un champ vide ne vaut jamais 0) ;
  2. invitation : « Copier lien inscription » → `POST /api/signup-link` (administrateur) rend `…/#signup?token=…` (JWT `purpose:"signup"`, 24 h).
     `inscription.js` lit ce fragment, affiche « Créer votre compte » (au-dessus de l'écran de connexion `#authGate`) et appelle
     `POST /api/signup-link { action:"inscrire", token, nom, email, password, reseau? }` (public) : l'invité choisit son mot de passe
     (`motDePasseRefuse` : 10 caractères, une lettre, un chiffre — **en double** dans `inscription.js`). **Un lien = un compte** : son empreinte
     est notée dans Blobs `fidi-invitations` ; stockage indisponible ⇒ 503. Jamais de rôle Administrateur par lien ;
  3. mot de passe perdu : fiche du compte → « Générer un nouveau mot de passe » (`Compte.ficheMotDePasse` → `admin-users` `reset_password`).
     Le mot de passe d'un administrateur ne se change que par le super-administrateur.
  4. **mot de passe oublié** : lien « Mot de passe oublié ? » (`#gateOubli`, `#cpOubli`) → `FidiInscription.oubli()` → `POST /api/auth/oubli { email }`
     (`auth-oubli.mjs`, public). Réponse identique que le compte existe ou non ; un e-mail au plus toutes les 2 minutes par adresse. Le lien
     `…/#reset?token=…` porte un JWT `{ purpose:"reset", email, v }` d'1 h où `v` = empreinte du mot de passe actuel : le lien meurt dès que le
     mot de passe change (usage unique sans stockage). `POST /api/auth/oubli { action:"changer", token, password }` enregistre le nouveau.
     Exige `RESEND_API_KEY` et `RESEND_FROM` (sinon 503 avec renvoi vers l'administrateur). `envoyerEmail` accepte `bouton` (libellé du bouton).
  5. **changement par l'utilisateur lui-même** : Mon compte → Identité, formulaire `#mdpForm` (`compte-motdepasse.js`) →
     `POST /api/auth/mot-de-passe { actuel, nouveau }` (`auth-motdepasse.mjs`) : session exigée, mot de passe actuel revérifié, même règle
     `motDePasseRefuse` (**en triple** : `signup-link.mjs`, `inscription.js`, `compte-motdepasse.js`), 5 essais manqués par quart d'heure et par
     compte (mémoire du conteneur). Tests : `tests/auth-motdepasse.test.mjs`.
- **E-mail de bienvenue** (`_bienvenue.mjs`, `envoyerBienvenue`) : envoyé par `admin-users` `create` (sauf rôle Test ou `sans_email:true`) et par
  `signup-link` `inscrire` ; jamais bloquant, la réponse porte `email_bienvenue` = `envoye | non_configure | echec | non_envoye`. Contenu : identifiant,
  lien de l'application, installation iPhone / Android, et — compte créé par l'administrateur — bouton « Choisir mon mot de passe » : même jeton que
  « mot de passe oublié » (`purpose:"reset"`, `v`), valable 7 jours (`DUREE_LIEN_BIENVENUE`). **Aucun mot de passe par e-mail.** Renvoi :
  `admin-users` action `bienvenue` (`Compte.ficheBienvenue`). **Réglages** : `GET|POST /api/bienvenue` (`bienvenue.mjs`, administrateur ; actions
  `enregistrer`, `ajouter_piece`, `retirer_piece`, `essai`), Blobs `fidi-bienvenue` (`reglages`, `f/<id>`), communs au déploiement : mot d'accueil,
  liens https (6), pièces jointes (3 × 4 Mo ; PDF, PowerPoint, Word, image — une vidéo se met en lien). Écran : `compte-bienvenue.js`
  (`FidiBienvenue.basculer()`, `#bienvenueRoot` dans `tabAdmin`, styles `.bv-*` de `compte.css`). `envoyerEmail` accepte `liens`, `titreLiens`,
  `appel`. **Copie** (`copie`) : l'administrateur connecté (`me.user.email`), à défaut `adresseCopieDefaut()` (adresse de réponse, sinon
  `SUPER_ADMIN_EMAIL`) pour une inscription par lien ; second e-mail « [Copie] … » **sans le lien de mot de passe** (usage unique), jamais bloquant,
  pas de copie pour un essai. Consignes d'installation : iPhone, Android, Chrome / Edge, Safari Mac. Tests : `tests/bienvenue.test.mjs`.
- **Session liée au mot de passe** : la connexion pose `pv` = `empreinteMdp(hash)` dans le jeton (7 jours) ; `currentUser()` refuse un jeton dont
  `pv` ne correspond plus (mot de passe changé) et tout jeton portant `purpose` (lien de réinitialisation, invitation). Les jetons sans `pv`
  (connexions antérieures à la 1.35.1, appel interne de `facture-auto`) restent admis jusqu'à leur expiration.

### Application installable
- `manifest.webmanifest` (servi en `application/manifest+json`, voir `netlify.toml`) + `icones/` : `icone-192.png`, `icone-512.png`,
  `icone-masque-512.png` (fond plein, dessin à 80 % pour Android), `apple-touch-icon.png` (180 px, sans transparence). Elles sont tirées de
  `favicon.svg` : à régénérer si le logo change. Pas de service worker : l'application ne fonctionne pas hors ligne.

### Mon compte → Facturation — `compte-facturation.js` / `compte-facturation.css`
- `window.FidiFactures.charger()` (appelé par `Compte.loadFactAdmin()`) rend dans `#factAdminRoot` quatre vues : vue d'ensemble, factures
  (liste + fiche), encaissement pour compte, réglages. État dans `etat` ; tout est redessiné par `afficher()` ; clics par délégation (`data-fa-*`).
- Situation d'une facture : `situation(f)` → `payee | annulee | brouillon | attente | retard | critique` (seuils J+ dans `localStorage`,
  clés `fidi:relance:seuilA` / `seuilB`).
- **Paiement manuel** : `POST /api/facture/paiement` (`facture-paiement.mjs`, administrateur) — `action:"enregistrer"` (moyen, date, montant,
  référence, note, justificatif ou `sans_justificatif`, `recu_remis`, `ecart_accepte`) et `action:"annuler_paiement"`. `validerPaiement()` est pur
  et testé. Notion porte statut / date / moyen / montant / `ID transaction` = `MANUEL — <référence>` ; la note, l'auteur et le justificatif sont dans
  Blobs `fidi-paiements` (`p/<numéro>`, `j/<numéro>`), **écrits avant** de marquer la facture payée. Un paiement encaissé en ligne (`ID transaction`
  sans préfixe `MANUEL`) ne se modifie ni ne s'annule ici. `GET ?ref=&justificatif=1` rend le fichier (types : JPEG, PNG, WebP, PDF ; 3 Mo).
- Plafond des espèces (`PLAFOND_ESPECES`, 1 000 €) : avertissement, jamais de blocage — **en double** dans le module et dans `facture-paiement.mjs`.
- **Avoir** : `POST /api/facture/avoir { ref, motif, remboursement }` (`facture-avoir.mjs`, administrateur) sur une facture **Payée** seulement.
  Numéro `<préfixe de la facture>-AV-<AAAA>-<NNN>` (`prefixeAvoir`, `nextFactureRef` exporté par `facture.mjs`) ; détail figé dans `fidi-factures`
  (copie du détail de la facture + `avoir:{ de, dateFacture, motif, remboursement }`) **avant** la page Notion (Type et Statut « Avoir », montants
  négatifs, « Référence dossier » = facture annulée) ; la facture passe « Annulée » avec `ID transaction` = `AVOIR <n°> — <motif>`. Idempotent.
  `_facture_doc.mjs` rend le mode avoir (titre, montants « − », ni échéance ni RIB). `factures-admin` renvoie `avoir`, `est_avoir`,
  `facture_annulee` ; `situation()` → `avoir` (hors totaux). `facture-delete` refuse toute pièce liée à un avoir, même avec `force`.
  **Aucun appel à PayPal** : le remboursement est manuel. Tests : `tests/facture-avoir.test.mjs`.
- `POST /api/facture/cancel` exige une session. `factures-admin.mjs` renvoie `date_paiement`, `moyen`, `montant_paye`, `paiement_manuel`.
- **Fiche contact** : `GET|POST /api/contacts` (`contacts.mjs`, administrateur) — fiche d'un client dans Blobs `fidi-contacts` (clé `cleContact(nom)`) :
  `emails[]` (8 au plus, la première est la principale), téléphone, adresse, note. Le client est identifié par le nom porté par ses factures
  (non modifiable). L'enregistrement reporte l'adresse principale et le téléphone sur toutes les factures du client dans Notion (« Email client »
  sert aux relances). Sans fiche, `GET` relève les coordonnées sur les factures (`provisoire:true`). Dans le module : `etat.contacts`, `emailsDe(f)`,
  panneau `contact` (`formulaireContact`, `data-fa-email`), panneau `renvoyer` (cases `.fa-dest`, `#faDestAutre`) : **un e-mail par destinataire**.
- `/api/crm-clients` et `/api/factures/client` exigent une session (401 sinon) et sont cloisonnés par compte (voir « Mes documents et
  confidentialité »). Tests : `tests/contacts.test.mjs`, `tests/clients-cloisonnes.test.mjs`.
- Identifiants conservés : `factAdminRoot`, `factStatsBox`, `factAlertsBox`, `factListBody`, `factCollabBody`, `factSeuilA`, `factSeuilB`.
- Non couvert : paiement partiel ou en plusieurs fois, avoir partiel, remboursement automatique, rapprochement bancaire, renommer un client, fusionner deux fiches.

### Écran de facturation — `facture.js` / `facture.css`
- `window.proposerFacture(kind)` ouvre « Nouvelle facture » : client, articles (montant / quantité / heures, prix TTC ou HT,
  grille tarifaire), remise, note ; colonne d'options (échéance, paiement préalable, canaux, émetteur) ; aperçu.
- Les mentions de l'émetteur manquantes (raison sociale, adresse, SIREN, régime de TVA) se complètent dans la fenêtre
  et sont enregistrées dans la charte via `Marque.maj()` (le panneau « Mise en page » ne peut pas s'ouvrir par-dessus).
- **Document remis** : `factGenDocLink(ctx)` fabrique d'abord le document mis en page par `fidiAutoPdfFile()` (rapport A4 `FidiRapport.buildHTML()`
  pour l'étude, `ctx.htmlString` pour l'avis ; rendu `/api/pdf-render`, même `doc` que le crédit déjà consommé = ré-édition gratuite), puis le
  dépose par `/api/pdf-share`. La capture d'écran `html2pdf` n'est plus qu'un repli (`window.__factDocMode` = `mis-en-page | capture`).
- Après création, la page de remise reste celle d'`index.html` : `factAfficherRemise`, `factGenDocLink`,
  `factHistoriqueClient` (identifiants conservés : `factureModal`, `factBody`, `factStatus`, `factClient`, `factEmail`,
  `factTel`, `factAdresse`, `factPayReq`, `factCanEmail`, `factCanWa`, `factBtnOk`, `factTarifsBox`).

### Sociétés émettrices — `emetteurs.js` (styles dans `facture.css`)
- `window.FidiEmetteurs.monter(conteneur, { selection, onChange })` : choix de la société, recherche par SIRET / SIREN,
  nom ou dirigeant (`POST /api/entreprise`, API Recherche d'entreprises : INSEE Sirene + RNE/INPI), complément Pappers
  facultatif (capital, greffe, n° TVA ; `POST /api/pappers`), fiche modifiable, enregistrement par `Marque.maj()`.
- Pré-remplissage : forme juridique (catégorie INSEE → `FORMES`), siège, SIREN/SIRET, « RCS <SIREN> » (ville du greffe à
  compléter), préfixe proposé (`prefixePropose`, unique dans le compte). Le régime de TVA n'est jamais deviné ; le n° de
  TVA intracommunautaire est calculé depuis le SIREN (`tvaIntra`) seulement pour une société assujettie.
- `pourDocument(e)` produit l'émetteur au format de `_facture_doc.mjs` — mêmes règles que `emetteurDe()` (facture.mjs).
- **Mon compte → Mes sociétés** (`compte-societes.js`, `window.FidiSocietes.monter()`, panneau `tabSocietes` / `#societesRoot`, **tout compte**,
  pas seulement l'administrateur) : cartes des sociétés (par défaut, RIB réglé ou non, mentions manquantes) + le même module `monter()` pour ajouter
  ou modifier. Le module utilise des identifiants fixes (`emSelect`, `emEditeur`, `em_*`) : **un seul exemplaire monté à la fois** (la rubrique vide
  `#fxEmetteurs` ; « Nouvelle facture » remonte le sien à chaque ouverture). La liste suit l'événement `marque:change`. `Compte.loadSocietes()`.
- Migration : les mentions uniques de la v1.8.0 (bloc `facturation`) deviennent la première société à l'ouverture.

### Qui signe quoi : société qui agit, produit, fabricant
- **Société qui agit** = société émettrice par défaut du compte (`emetteurDefaut`), à défaut la charte. Serveur : `_identite.mjs`
  (`identiteDeCharte`, `identiteCompte(event, me)`, `identiteFacture(event, jeton)` — détail figé —, ne lèvent jamais). Navigateur :
  `Marque.document()` (charte avec nom, coordonnées et logo de la société par défaut), `Marque.nomDoc()`, `Marque.enTeteDoc()`, `fidiSociete()`.
  Les **écrans** gardent la charte (`Marque.get()`), les **documents et envois** prennent `Marque.document()`.
- **E-mails** : `envoyerEmail({ …, identite })` → `gabaritEmail` (bandeau au nom de la société, couleur de la charte, logo PNG/JPEG intégré en
  `cid:logo-societe`), expéditeur `"<société>" <adresse de RESEND_FROM>` (`expediteur`), réponses vers l'e-mail de la société. La route
  `/api/send-email` **impose** l'identité du compte (`identite` et `corpsHtml` reçus sont ignorés) ; `corpsHtml` est réservé au serveur.
- **Logiciel** : produit « Étude de marché & Avis de valeur », fabricant « Optimmo Dom » (`PRODUIT`, `FABRICANT`, `Marque.signatureLogiciel()`),
  en pied des e-mails, de la page `/l/<jeton>` et de la couverture du rapport. **Ne jamais écrire « FIDI Conseil » ni « ImmoData »** dans un
  écran, un envoi ou une page client (`tests/identite.test.mjs`). L'ancien modèle de facture (`facture-html.mjs`, factures sans détail) garde
  l'identité d'origine : ce sont des pièces déjà émises.

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
- Barre du haut : `.marque-produit` passe à la ligne sous l'enseigne à partir de 769 px (`marque.css`) ; `.marque-sep` (« · ») ne sert que sur téléphone, où le titre tient sur une ligne.
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

### Avis : sauvegarde complète — `avis-dossiers.js`
- « Tout sauvegarder » (`construireSauvegarde`) lit un par un les avis en ligne et leurs versions diffusées (`/api/avis-store`) et télécharge
  un fichier `{ format:"fidi-avis-sauvegarde", version:1, date, avis:[{ ref, resume, maj, data, versions[] }] }`. Aucune route serveur dédiée
  (une fonction ne peut pas renvoyer plus de 6 Mo). « Restaurer » (`lireSauvegarde`) ne ré-enregistre qu'un avis absent (404) : **jamais d'écrasement**.
  Les versions ne sont pas recréées (le serveur les date lui-même). Pas de sauvegarde automatique : c'est un geste de l'utilisateur.

## Variables d'environnement (Netlify)
- `SEARCH_API_KEY` — clé **Brave Search API** pour la veille d'annonces (`/api/annonces`).
  Absente ⇒ veille indisponible, dégradation propre vers la saisie manuelle.
- `ANTHROPIC_API_KEY` — *optionnelle*, mode enrichi IA de la veille (non activé par défaut ; facturation à l'usage).
- `ANNONCES_MODEL` — *optionnelle*, modèle utilisé si le mode IA est activé.
- `ANNONCES_MAX_SEARCHES` — *optionnelle*, borne le nombre de requêtes de recherche.
- `FIDI_FACTURATION_CLE`, `FIDI_FACTURATION_COMPTE` — *optionnelles*, factures automatiques de serveur à serveur
  (`/api/facture-auto`, ex. achats de crédits REA). Même clé à poser dans l'application appelante.
- `FIDI_VIREMENT_IBAN`, `FIDI_VIREMENT_BIC`, `FIDI_VIREMENT_TITULAIRE` — *optionnelles*, coordonnées bancaires affichées sur la page
  du client quand la société émettrice de la facture n'en porte pas (factures antérieures à la 1.19.0).
- **Adresses e-mail — aucune dans le code** (dépôt public ; garde-fou : `tests/resend-reply-to.test.mjs`) :
  `SUPER_ADMIN_EMAIL` (seul compte pouvant supprimer un compte ou nommer un administrateur ; absente ⇒ personne),
  `RESEND_FROM` (expéditeur, domaine vérifié chez Resend ; absente ⇒ 503, aucun envoi), `RESEND_REPLY_TO` (réponses des clients ;
  à défaut `FIDI_CONTACT_EMAIL`), `FIDI_CONTACT_EMAIL` (contact affiché en pied des e-mails et de l'ancien modèle de facture ;
  absente ⇒ rien n'est affiché). Lecture : `adresseContact()` / `adresseReponse()` dans `send-email.mjs`.
- `NOTION_TOKEN`, `NOTION_DB_*` — intégration Notion (CRM, templates, dossiers).

**Aucune clé API en dur dans le code.** Si les clés sont absentes, l'application se dégrade proprement.

## Tests
- `npm test` — suite `node --test` : endpoints (ESM, CORS, OPTIONS, repli sans secret), charte de marque
  (`marque.test.mjs`), contrat de l'interface (`interface.test.mjs`), facturation détaillée
  (`facture-calc.test.mjs`, `facture-detaillee.test.mjs`, `facturation-centrale.test.mjs` — dont plusieurs sociétés et numérotation par société), unités veille
  (dédoublonnage, similarité, bien sujet, extraction JSON-LD/regex), et fixture Marigot du moteur de calcul.
- `tests/auth-motdepasse.test.mjs` charge **toutes** les fonctions de `netlify/functions` : une faute de syntaxe dans une seule fait échouer tout le
  déploiement Netlify sans autre signe qu'une version qui ne change pas en production (incident de la 1.35.1).
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

## Téléphone (mobile.css)

`mobile.css` est chargé **en dernier** et porte toutes les règles ≤ 768 px. Règle : sur un petit écran, chaque barre (haut, rubriques, bas)
tient sur une ligne et laisse la place au contenu ; un seul défilement par fenêtre ; champs à 16 px au moins (sinon le téléphone zoome).
- Avis de valeur : `.av-tabs` est masqué, remplacé par `.av-nav-mobile` (liste `#avSecSelect` + flèches, `navMobileHTML()`). Les boutons
  secondaires du bas portent `av-m-masque` et sont repris dans le menu « Plus » (`av-m-seul`) : **toute nouvelle action du bas doit y figurer**.
  L'aperçu remplace la saisie (`estMobile()`, `majBoutonApercu()`).
- Barre du haut : libellés masquables dans `<span class="nav-lbl">`.
- Vérifier tout changement d'interface à 360 px de large (aucun élément hors écran, aucune barre sur plusieurs lignes). Garde-fous : `tests/mobile.test.mjs`.

## Carte : fiche de parcelle — `carte-parcelle.js` (module autonome `FidiParcelle`)

Chargé avant l'écran (`<script src="/carte-parcelle.js">`, sans `defer`). Dépend de Leaflet et, pour la fenêtre de détail, de Bootstrap 5.
- `FidiParcelle.attacher({ carte, clicFond, origine, parcellePrincipale, zonePrincipale, ventes, urlRisques, couleurZone, actions, surParcelle })`
  renvoie une instance `{ auClic, fermer, courante, contourAffiche }`. **Plusieurs cartes** peuvent être attachées (carte de l'étude dans
  `renderMap()`, carte de choix dans `saisie-carte.js`) : chaque carte a son état ; les fonctions globales (`detail`, `fermer`, `action`) visent
  la carte du dernier clic, et les noms historiques visent la première attachée. `actions(p)` → `[{ libelle, icone, principal, auClic(p) }]`
  ajoute des boutons dans la bulle.
- **Tout calque décoratif qui couvre la carte doit être `interactive:false`** (cercle du périmètre `radiusCircle`) : cliquable, il intercepte
  chaque clic et aucune fiche ne s'ouvre — c'était la panne de la 1.16 à la 1.25. `clicFond:true` pose le clic sur le fond de carte (les éléments `.leaflet-interactive`, les commandes et les bulles gardent
  leur comportement). `FidiParcelle.auClic(latlng, zoneConnue?)` s'appelle depuis un calque qui capte le clic : **tout nouveau calque de
  polygones qui couvre la carte doit l'appeler** (comme le zonage), sinon il masque la fiche. Les noms historiques `ficheParcelleAuClic`,
  `ficheParcFermer`, `ficheParcDetail` restent définis.
- **Carte principale** : `attacher({ principale:true })` désigne la carte visée par les noms historiques, quel que soit l'ordre d'attache.
  Les calques de la carte de l'étude (zonage, contour, parcelles ajoutées) appellent `ficheEtudeAuClic()` → `window.__ficheEtude.auClic()` :
  **jamais `ficheParcelleAuClic` directement** — de la 1.26 à la 1.34.0, la carte de choix ouverte avant l'analyse recevait ces clics et la
  fiche s'ouvrait sur une carte masquée (zonage actif = aucun clic utile).
- Bulle Leaflet sur ordinateur, panneau `#ficheParcPanneau` sous la carte à 768 px et moins ; contour de la parcelle non cliquable ; un clic plus
  récent annule l'affichage du précédent ; chaque lecture d'un service public est retentée une fois (`lire`).
- `FidiParcelle.detail()` : cadastre (`apicarto.ign.fr/api/cadastre/parcelle`), adresse la plus proche (`api-adresse.data.gouv.fr/reverse`),
  zone PLU, prescriptions et servitudes (`/api/gpu/zone-urba`, `prescription-surf`, `info-surf`, `assiette-sup-s` ; libellés des servitudes
  courantes dans `SERVITUDES`), ventes de la parcelle (`app.dvf.etalab.gouv.fr/api/mutations3/<insee>/<section>`, regroupées par vente dans
  `ventesDeLaParcelle` — DVF rend une ligne par lot), risques (`options.urlRisques`, facultatif). Aucune clé. Le propriétaire n'est pas public.
- **Réutilisation sur une autre interface** : copier `carte-parcelle.js`, charger Leaflet et Bootstrap, appeler `attacher({ carte, clicFond:true })`.
  Les options sont toutes facultatives sauf `carte` ; sans `urlRisques`, la rubrique Risques n'apparaît pas.
- Fenêtre de détail : bouton `.fiche-parc-fermer` en pied, plein écran à 768 px et moins. **iPhone, application installée** (`black-translucent` +
  `viewport-fit=cover`) : le haut de l'écran est sous la barre d'état ; `mobile.css` écarte toute `.modal` par `env(safe-area-inset-*)`.
- **Une seule fenêtre de détail** : `detail()` ignore un second appui dans les 1,2 s et `retirerDetail()` retire fenêtre et voile ; deux fenêtres
  superposées (double appui) figeaient l'écran de la 1.26 à la 1.45.
- Tests : `tests/carte-parcelle.test.mjs` (branchements, regroupement des ventes, bulle). Le comportement réel se vérifie dans un navigateur.
