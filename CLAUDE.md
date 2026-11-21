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
- Le logo et les mentions de la charte ne sont apposés que sur les factures des sociétés cochées « avecLogo ».
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
- Hors périmètre à ce jour : paiement partiel / acompte (le paiement en ligne encaisse toujours le TTC) ;
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

### Choisir la parcelle sur la carte — `saisie-carte.js` (styles dans `saisie.css`)
- Bouton `#btnCarteChoix` dans le sélecteur `.saisie-modes` (ce n'est **pas** un troisième `searchMode` : la recherche reste « adresse » ou
  « cadastre »). Il ouvre le panneau `#carteChoix` : ville (`#carteChoixVille`, suggestions `geo.api.gouv.fr`), « Ma position », carte Leaflet
  avec le calque Cadastre, et la fiche de parcelle (`FidiParcelle.attacher` avec `actions`).
- Position de départ, dans l'ordre : commune déjà saisie (`fidiCommuneSaisie()`), géolocalisation de l'appareil, dernière commune utilisée
  (`localStorage` `fidi_carte_derniere` : code, nom et centre de la commune, jamais d'adresse), sinon vue d'ensemble en attendant la ville.
- « Étudier cette parcelle » → `fidiChoisirParcelle({ commune, section, numero })` (index.html) : passe en mode « Réf. cadastrale », pose
  `selectedCommune` et remplit les champs ; `ajouter:true` pousse une parcelle supplémentaire de la même commune dans `__searchParcelles`.
  **L'analyse n'est jamais lancée automatiquement** (elle consomme un essai). Rappel affiché dans `#carteChoixRetenue`.

### Fenêtre « Mon compte » — `window.Compte` (index.html) / `compte.css`
- Colonne de navigation `.cpt-cote` (identité + `nav.cpt-nav`, boutons `.nav-link.cpt-lien` pilotés par les onglets Bootstrap) et
  contenu `.cpt-corps` ; une rubrique = un panneau `.tab-pane` avec `header.cpt-titre` puis des blocs `.cpt-carte`.
- **Contrat des identifiants** : `compteModal`, `compteDialog`, `compteTitre`, `compteBody`, `cpEmail`, `cpPwd`, `cpErr` ; panneaux `tabIdent`,
  `tabSolde`, `tabOffres`, `tabAdmin` (comptes), `tabTarifs` (grille tarifaire), `tabFactAdmin` (contenu : voir « Mon compte → Facturation ») ;
  `offresBox`, `ppBuyBox`, `adListBody`, `adCreateForm`, `adTarifsBody`, `tfCreateForm`, `tfGroup`, `factAdminRoot`.
  Vérifié par `tests/interface.test.mjs`.
- `Compte.rubrique(id)` ouvre une rubrique ; `Compte.miseEnPage()` ferme la fenêtre puis ouvre « Mise en page ».
- Toute nouvelle rubrique : un bouton dans `nav.cpt-nav` + un panneau ; pas de style en ligne, les classes sont dans `compte.css`
  et les règles ≤ 768 px dans `mobile.css` (barre de rubriques sur une ligne défilante).

### Comptes : création, invitation, mot de passe
- **Un mot de passe n'est jamais relisible** (haché dans Notion). Trois chemins :
  1. l'administrateur crée le compte (Mon compte → Comptes → « Créer un compte ») : mot de passe généré ou saisi, affiché une seule fois ;
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
- Non couvert : changement de son propre mot de passe par un utilisateur connecté.

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
- `POST /api/facture/cancel` exige une session. `factures-admin.mjs` renvoie `date_paiement`, `moyen`, `montant_paye`, `paiement_manuel`.
- **Fiche contact** : `GET|POST /api/contacts` (`contacts.mjs`, administrateur) — fiche d'un client dans Blobs `fidi-contacts` (clé `cleContact(nom)`) :
  `emails[]` (8 au plus, la première est la principale), téléphone, adresse, note. Le client est identifié par le nom porté par ses factures
  (non modifiable). L'enregistrement reporte l'adresse principale et le téléphone sur toutes les factures du client dans Notion (« Email client »
  sert aux relances). Sans fiche, `GET` relève les coordonnées sur les factures (`provisoire:true`). Dans le module : `etat.contacts`, `emailsDe(f)`,
  panneau `contact` (`formulaireContact`, `data-fa-email`), panneau `renvoyer` (cases `.fa-dest`, `#faDestAutre`) : **un e-mail par destinataire**.
- `/api/crm-clients` et `/api/factures/client` exigent une session (401 sinon). Tests : `tests/contacts.test.mjs`.
- Identifiants conservés : `factAdminRoot`, `factStatsBox`, `factAlertsBox`, `factListBody`, `factCollabBody`, `factSeuilA`, `factSeuilB`.
- Non couvert : paiement partiel ou en plusieurs fois, avoir sur une facture payée, rapprochement bancaire, renommer un client, fusionner deux fiches.

### Écran de facturation — `facture.js` / `facture.css`
- `window.proposerFacture(kind)` ouvre « Nouvelle facture » : client, articles (montant / quantité / heures, prix TTC ou HT,
  grille tarifaire), remise, note ; colonne d'options (échéance, paiement préalable, canaux, émetteur) ; aperçu.
- Les mentions de l'émetteur manquantes (raison sociale, adresse, SIREN, régime de TVA) se complètent dans la fenêtre
  et sont enregistrées dans la charte via `Marque.maj()` (le panneau « Mise en page » ne peut pas s'ouvrir par-dessus).
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
- Migration : les mentions uniques de la v1.8.0 (bloc `facturation`) deviennent la première société à l'ouverture.

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
- Bulle Leaflet sur ordinateur, panneau `#ficheParcPanneau` sous la carte à 768 px et moins ; contour de la parcelle non cliquable ; un clic plus
  récent annule l'affichage du précédent ; chaque lecture d'un service public est retentée une fois (`lire`).
- `FidiParcelle.detail()` : cadastre (`apicarto.ign.fr/api/cadastre/parcelle`), adresse la plus proche (`api-adresse.data.gouv.fr/reverse`),
  zone PLU, prescriptions et servitudes (`/api/gpu/zone-urba`, `prescription-surf`, `info-surf`, `assiette-sup-s` ; libellés des servitudes
  courantes dans `SERVITUDES`), ventes de la parcelle (`app.dvf.etalab.gouv.fr/api/mutations3/<insee>/<section>`, regroupées par vente dans
  `ventesDeLaParcelle` — DVF rend une ligne par lot), risques (`options.urlRisques`, facultatif). Aucune clé. Le propriétaire n'est pas public.
- **Réutilisation sur une autre interface** : copier `carte-parcelle.js`, charger Leaflet et Bootstrap, appeler `attacher({ carte, clicFond:true })`.
  Les options sont toutes facultatives sauf `carte` ; sans `urlRisques`, la rubrique Risques n'apparaît pas.
- Tests : `tests/carte-parcelle.test.mjs` (branchements, regroupement des ventes, bulle). Le comportement réel se vérifie dans un navigateur.
