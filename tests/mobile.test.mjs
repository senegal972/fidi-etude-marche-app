// Version téléphone — garde les points d'accroche de mobile.css.
// Le rendu lui-même se vérifie dans un navigateur à 360 px de large (voir CLAUDE.md, « Téléphone »).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const html = lire("index.html"), css = lire("mobile.css"), avis = lire("avis-valeur.js"), dossiers = lire("avis-dossiers.js");

test("mobile.css est chargé en dernier, après les autres feuilles de style", () => {
  const feuilles = [...html.matchAll(/<link href="(\/[a-z-]+\.css)" rel="stylesheet"\/>/g)].map((m) => m[1]);
  assert.equal(feuilles.at(-1), "/mobile.css");
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0/);
});

test("barre du haut : les libellés masqués sur téléphone sont balisés, les menus gardent leur icône", () => {
  for (const t of ['<span class="nav-lbl">Mes documents</span>', '<span class="nav-lbl">Actions</span>', '<span class="nav-lbl"> crédits</span>']) {
    assert.ok(html.includes(t), `libellé non balisé : ${t}`);
  }
  assert.match(css, /\.navbar-fidi\{flex-wrap:nowrap!important/);
  assert.match(css, /\.navbar-fidi \.nav-lbl:not\(#btnCompteLabel\)\{display:none;\}/);
  // Les boutons techniques invisibles ne doivent jamais occuper de place.
  assert.match(css, /#btnPresentation,#btnCompte,#btnEtudesLib,#btnAvisLib,#btnAvis,#btnPdf,#btnPrint\{display:none!important;\}/);
});

test("avis : une liste de rubriques et deux flèches remplacent les onglets sur téléphone", () => {
  assert.ok(avis.includes('<div class="av-nav-mobile">'), "barre de rubriques absente de la fenêtre");
  assert.ok(avis.includes('id="avSecSelect"'));
  assert.match(avis, /if \(el\.id === 'avSecSelect'\) \{ if \(e\.type === 'change'\) showSection\(el\.value\); return; \}/);
  assert.match(css, /#avisModal \.av-tabs\{display:none;\}/);
  assert.match(css, /#avisModal \.av-nav-mobile\{display:flex/);
  // Hors téléphone, la barre mobile et le menu « Plus » n'existent pas.
  assert.match(css, /^\.av-nav-mobile,\.av-m-seul\{display:none;\}/m);
});

test("avis : le menu « Plus » reprend toutes les actions masquées sur téléphone", () => {
  const debut = avis.indexOf('class="dropup av-m-seul"');
  const bloc = avis.slice(debut, debut + 2600);
  for (const a of ["prefill", "new", "partager", "facturer", "pdf", "export-json", "import-json"]) {
    assert.ok(bloc.includes(`data-action="${a}"`), `action « ${a} » absente du menu Plus`);
  }
  // Les actions principales restent des boutons visibles.
  for (const a of ["dossiers", "save", "toggle-preview", "pdf-server"]) {
    const i = avis.indexOf(`data-action="${a}"`);
    assert.ok(i > 0);
    const balise = avis.slice(avis.lastIndexOf("<button", i), i);
    assert.ok(!balise.includes("av-m-masque"), `« ${a} » ne doit pas être masqué sur téléphone`);
  }
});

test("avis : un seul défilement, aperçu à la place de la saisie, champs sans zoom", () => {
  assert.match(css, /#avisModal \.av-form\{max-height:none;overflow:visible/);
  assert.match(css, /#avisModal \.av-layout\.av-with-preview \.av-form\{display:none;\}/);
  assert.match(css, /font-size:16px;min-height:42px;/);
  assert.match(avis, /if \(estMobile\(\)\) state\.preview = false;/);
  assert.match(avis, /function estMobile\(\) \{ try \{ return window\.matchMedia\('\(max-width: 768px\)'\)\.matches;/);
});

test("mes avis & versions : un choix amène au volet suivant quand les volets sont empilés", () => {
  assert.match(dossiers, /allerVers\('\.avd-versions'\)/);
  assert.match(dossiers, /allerVers\('\.avd-apercu'\)/);
  assert.match(dossiers, /data-avd-action="retour-liste"/);
});

test("mobile.css : accolades équilibrées", () => {
  assert.equal(css.split("{").length, css.split("}").length);
});

test("avis : sauvegarde complète et restauration présentes, pied sur une ligne sur téléphone", () => {
  assert.ok(dossiers.includes('data-avd-action="sauvegarder"') && dossiers.includes('data-avd-action="restaurer"'));
  assert.ok(dossiers.includes("format: FORMAT_SAUV") && dossiers.includes("j.format !== FORMAT_SAUV"));
  // La restauration ne remplace jamais un avis déjà en ligne : elle n'enregistre que sur un 404.
  assert.match(dossiers, /if \(r\.ok\) \{ presents\+\+; return; \}\s*if \(r\.code !== 404\) \{ echecs\+\+; return; \}/);
  assert.match(css, /#avisDossiersModal \.avd-pied\{flex-wrap:nowrap/);
  assert.match(css, /#avisDossiersModal \.avd-pied-note\{display:none;\}/);
});
