// Tests statiques de l'interface — écran de saisie et module « Mise en page ».
// Garantit que les modules restent branchés et que le contrat des identifiants tient.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const html = lire("index.html");

test("index.html charge les modules d'interface", () => {
  for (const f of ["/saisie.css", "/saisie.js", "/marque.css", "/marque.js", "/facture.css", "/facture.js", "/emetteurs.js"]) {
    assert.ok(html.includes(f), `${f} n'est pas chargé par index.html`);
  }
  // marque.js doit être lu avant le premier affichage (pas de defer) pour éviter un flash de couleurs.
  assert.match(html, /<script src="\/marque\.js"><\/script>\s*<\/head>/);
});

test("écran de saisie — identifiants lus par lancerAnalyse() et la recherche cadastrale, une seule fois", () => {
  const ids = ["inputAdresse", "autocompleteList", "btnGeoloc", "lblRecherche", "modeAdresse", "modeCadastre",
    "cadastreFields", "inputCommune", "communeList", "inputSection", "inputParcelle", "extraParcelles",
    "btnAddParcelle", "communeMeta", "selectType", "inputSurface", "selectPerimetre", "btnAnalyse",
    "optEntreprise", "entrepriseQueryWrap", "inputEntrepriseQ", "optFinance", "financeQueryWrap",
    "inputFinanceSiren", "optPermis"];
  for (const id of ids) {
    const n = html.split(`id="${id}"`).length - 1;
    assert.equal(n, 1, `id="${id}" attendu 1 fois, trouvé ${n}`);
  }
  assert.equal(html.split('name="searchMode" id=').length - 1, 2, "les deux modes de recherche doivent exister");
});

test("nature du bien — liste d'origine intacte (13 natures + « Tous types »)", () => {
  const sel = html.slice(html.indexOf('id="selectType"'), html.indexOf("</select>", html.indexOf('id="selectType"')));
  assert.equal(sel.split("<option").length - 1, 14);
  for (const g of ["Résidentiel", "Terrain", "Professionnel"]) assert.ok(sel.includes(`<optgroup label="${g}">`));
});

test("marque blanche — points d'accroche présents et charte de déploiement valide", () => {
  for (const id of ["marqueTitre", "marqueBaseline", "btnMarque"]) assert.ok(html.includes(`id="${id}"`), `id="${id}" manquant`);
  const m = JSON.parse(lire("marque.json"));
  for (const k of ["principale", "accent", "secondaire"]) assert.match(m.couleurs[k], /^#[0-9a-fA-F]{6}$/);
  // Dépôt public : ni téléphone ni adresse dans le fichier versionné.
  assert.equal(m.coordonnees.telephone, "");
  assert.equal(m.coordonnees.adresse, "");
});

test("documents imprimés — aucune identité personnelle en dur, charte lue", () => {
  for (const f of ["avis-valeur.js", "rapport-a4.js"]) {
    const src = lire(f);
    assert.ok(!/Franck|sextantfrance|Coridun/i.test(src), `${f} contient une identité en dur`);
    assert.ok(!/FIDI CONSEIL/.test(src), `${f} affiche encore « FIDI CONSEIL »`);
    assert.ok(/window\.Marque/.test(src), `${f} ne lit pas la charte de marque`);
  }
  assert.ok(!/Franck FIDI/.test(html), "index.html contient une identité en dur dans un document");
});

test("modules d'interface — pas de alert() pour les contrôles de saisie", () => {
  for (const f of ["saisie.js", "marque.js", "facture.js", "emetteurs.js"]) assert.ok(!/\balert\s*\(/.test(lire(f)), `${f} utilise alert()`);
});

test("facturation — une seule définition de proposerFacture (facture.js) et helpers de remise conservés", () => {
  assert.ok(!/function proposerFacture\s*\(/.test(html), "proposerFacture doit vivre dans facture.js");
  assert.match(lire("facture.js"), /window\.proposerFacture = proposerFacture/);
  for (const f of ["factAfficherRemise", "factGenDocLink", "factHistoriqueClient"]) {
    assert.ok(new RegExp("function " + f + "\\s*\\(").test(html), f + " a disparu de index.html");
  }
  assert.ok(html.includes("onclick=\"proposerFacture('etude')\""), "bouton Facturer de l'étude");
});

test("avis de valeur — fenêtre « Mes avis & versions » branchée, versions figées à chaque diffusion", () => {
  for (const f of ["/avis-dossiers.css", "/avis-dossiers.js"]) assert.ok(html.includes(f), `${f} n'est pas chargé`);
  assert.ok(html.indexOf('src="/avis-valeur.js"') < html.indexOf('src="/avis-dossiers.js"'));
  const avis = lire("avis-valeur.js"), dossiers = lire("avis-dossiers.js");
  // Bas de l'avis : le bouton d'accès et l'enregistrement ; plus de liste déroulante ni de bouton Notion.
  const pied = avis.slice(avis.indexOf("av-pied-groupes"), avis.indexOf("avisPrintRoot"));
  for (const a of ["dossiers", "new", "prefill", "save", "export-json", "import-json", "partager", "facturer", "pdf-server", "pdf"]) {
    assert.ok(pied.includes(`data-action="${a}"`), `bouton ${a} absent du bas de l'avis`);
  }
  assert.ok(!pied.includes('data-action="cloud"') && !pied.includes("avSavedSelect"));
  // Chaque sortie remise à un tiers fige une version.
  for (const m of ["impression", "partage", "facture", "word"]) assert.ok(avis.includes(`figerVersion('${m}')`), `version non figée : ${m}`);
  assert.ok(avis.includes("enregistrerEnLigne({ motif: 'pdf' }"), "version non figée : pdf");
  // Contrat entre les deux modules.
  for (const f of ["lireLocal", "supprimerLocal", "charger", "resume", "documentHTML", "imprimerDonnees", "listAvis"]) {
    assert.ok(new RegExp("\\b" + f + "\\s*:").test(avis.slice(avis.indexOf("window.AvisValeur ="))), `AvisValeur.${f} manquant`);
    assert.ok(dossiers.includes("AvisValeur." + f), `AvisValeur.${f} inutilisé`);
  }
  // L'historique local d'un avis n'est pas un avis.
  assert.match(avis, /indexOf\(AVIS_PREFIX\) === 0 && k\.indexOf\('::'\) < 0/);
});

test("étude — sauvegarde automatique sans alerte, et sans toucher au bouton", () => {
  assert.ok(html.split("planifierSauvegardeEtude()").length - 1 >= 3, "déclencheurs de la sauvegarde automatique");
  const f = html.slice(html.indexOf("async function saveEtudeCloud"), html.indexOf("async function openEtudesRecentes"));
  assert.ok(f.includes("payload.auto = true"));
  assert.ok(f.includes("const btn = auto ? null"));
});

test("sociétés émettrices — emetteurs.js chargé avant facture.js", () => {
  assert.ok(html.indexOf('src="/emetteurs.js"') < html.indexOf('src="/facture.js"'));
});

// ─── Fenêtre « Mon compte » ────────────────────────────────────────────────────
test("Mon compte : identifiants conservés, rubriques séparées, feuille de style dédiée", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../compte.css", import.meta.url), "utf8");
  const mob = readFileSync(new URL("../mobile.css", import.meta.url), "utf8");
  const a = page.indexOf("window.Compte = (function(){"), b = page.indexOf("</script>", a);
  const code = page.slice(a, b);
  new Function(code); // le script du compte reste syntaxiquement valide
  for (const id of ["compteModal", "compteDialog", "compteTitre", "compteBody", "cpEmail", "cpPwd", "cpErr", "tabIdent", "tabSolde", "tabOffres",
    "tabAdmin", "tabTarifs", "tabFactAdmin", "offresBox", "ppBuyBox", "adListBody", "adCreateForm", "adEmail", "adFilterQ", "adFilterReseau",
    "adTarifsBody", "tfCreateForm", "tfGroup", "tfNom", "factCollabBody", "factListBody", "factStatsBox", "factAlertsBox", "factSeuilA", "factSeuilB"]) {
    assert.ok(code.includes('id="' + id + '"'), "identifiant absent : " + id);
  }
  for (const cible of ["tabIdent", "tabSolde", "tabOffres", "tabAdmin", "tabTarifs", "tabFactAdmin"]) {
    assert.ok(code.includes('data-bs-target="#' + cible + '"'), "rubrique sans bouton : " + cible);
  }
  // Comptes et grille tarifaire ne partagent plus le même panneau.
  assert.ok(code.indexOf('id="tabTarifs"') < code.indexOf('id="adTarifsBody"'));
  assert.ok(code.indexOf('id="adListBody"') < code.indexOf('id="tabTarifs"'));
  assert.match(code, /return \{ open, rubrique, miseEnPage,/);
  assert.match(page, /<link href="\/compte\.css" rel="stylesheet"\/>\n<link href="\/mobile\.css"/);
  assert.match(css, /\.cpt\{display:grid/);
  assert.match(mob, /#compteModal \.cpt-nav\{flex-direction:row;flex-wrap:nowrap;overflow-x:auto/);
  assert.match(mob, /#compteModal input,#compteModal select\{font-size:16px;\}/);
});
