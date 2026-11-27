// Profils & modules (administrateur), bandeau de l'étude après analyse, quota d'essais par défaut.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test-suffisamment-long-0123456789";
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const T = await import("../netlify/functions/templates.mjs");
const A = await import("../netlify/functions/_auth.mjs");
const page = lire("index.html");

test("modules : chaque module a un groupe, une clé unique, et un bloc de l'écran qui lui répond", () => {
  const cles = T.MODULES.map((m) => m.key);
  assert.equal(new Set(cles).size, cles.length);
  for (const m of T.MODULES) assert.ok(m.groupe && m.label, m.key);
  for (const k of ["synthese", "score", "graphiques", "regles_plu", "potentiel_foncier", "implantation", "enrichir", "pprn", "contexte_local", "batiment", "entreprise", "finance", "permis", "note"]) {
    assert.ok(cles.includes(k), k);
    assert.ok(new RegExp(":'" + k + "'|data-flag=\"" + k + "\"").test(page), "aucun bloc étiqueté « " + k + " »");
  }
});

test("rubrique « Profils & modules » : administrateur seulement, module chargé, sans style en ligne", () => {
  assert.match(page, /data-bs-target="#tabProfils" onclick="FidiProfils\.monter\(\)"/);
  assert.match(page, /\(admin \? '<div class="tab-pane fade" id="tabProfils">'/);
  assert.match(page, /compte-profils\.js/);
  assert.doesNotMatch(lire("compte-profils.js"), /style="/);
  assert.match(lire("netlify/functions/templates.mjs"), /if \(!isAdmin\) return authResp\(403/);
});

test("bandeau de l'étude : identifiants conservés, plus de fenêtre de saisie du navigateur", () => {
  const a = page.indexOf('id="etudeActions"'), bloc = page.slice(a, page.indexOf("<!-- Note / mémo", a));
  for (const id of ["res-titre", "res-contexte", "res-date", "inputDestinataire", "etudeClientsList", "btnActualiserEtude", "btnSaveEtude", "btnShareEtude", "btnFactureEtude", "btnAvisRes", "ddResBar", "etudeNatureClient", "etudeNatureTest", "etudeContactEmail", "etudeContactTel"])
    assert.ok(bloc.includes('id="' + id + '"'), id);
  assert.doesNotMatch(bloc, /etudePickClient|etudeSaveClient/);
  assert.doesNotMatch(lire("etude-actions.js"), /prompt\(|alert\(/);
  assert.match(lire("facture.js"), /window\.fidiEtudeContact/);
  assert.match(lire("etude-actions.css"), /@media print\{\.ea-grille\{display:none!important;\}\}/);
});

test("quota d'essais : 2 par défaut, un champ vide ne donne jamais 0", () => {
  assert.equal(A.DEFAULT_QUOTA, 2);
  const src = lire("netlify/functions/admin-users.mjs");
  assert.match(src, /const nombre = \(v\) => \(v === "" \|\| v == null/);
  assert.match(page, /id="adQuota" min="0" value="2"/);
  assert.doesNotMatch(page, /u\.quota!=null\?u\.quota:5/);
});
