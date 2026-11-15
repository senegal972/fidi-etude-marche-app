// Tests statiques de l'interface — écran de saisie et module « Mise en page ».
// Garantit que les modules restent branchés et que le contrat des identifiants tient.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const html = lire("index.html");

test("index.html charge les modules d'interface", () => {
  for (const f of ["/saisie.css", "/saisie.js", "/marque.css", "/marque.js", "/facture.css", "/facture.js"]) {
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
  for (const f of ["saisie.js", "marque.js", "facture.js"]) assert.ok(!/\balert\s*\(/.test(lire(f)), `${f} utilise alert()`);
});

test("facturation — une seule définition de proposerFacture (facture.js) et helpers de remise conservés", () => {
  assert.ok(!/function proposerFacture\s*\(/.test(html), "proposerFacture doit vivre dans facture.js");
  assert.match(lire("facture.js"), /window\.proposerFacture = proposerFacture/);
  for (const f of ["factAfficherRemise", "factGenDocLink", "factHistoriqueClient"]) {
    assert.ok(new RegExp("function " + f + "\\s*\\(").test(html), f + " a disparu de index.html");
  }
  assert.ok(html.includes("onclick=\"proposerFacture('etude')\""), "bouton Facturer de l'étude");
});
