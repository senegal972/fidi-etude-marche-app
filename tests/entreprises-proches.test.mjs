// Entreprises installées autour du bien (option « Vérifications légales d'entreprise » cochée sans SIREN ni nom).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const win = {}; vm.runInNewContext(lire("entreprises-proches.js"), { window: win, document: { getElementById: () => null } });
const E = win.FidiEntreprisesProches;
const P = { lat: 14.6037, lon: -61.0694 };

test("classer : du plus proche au plus loin, doublons et hors rayon écartés", () => {
  const l = E.classer([
    { siret: "2", siren: "b", nom: "Loin", lat: "14.6044", lon: "-61.0694" },
    { siret: "1", siren: "a", nom: "Sur place", lat: "14.6037", lon: "-61.06941" },
    { siret: "1", siren: "a", nom: "Sur place", lat: "14.6037", lon: "-61.06941" },
    { siret: "3", siren: "c", nom: "Hors rayon", lat: "14.61", lon: "-61.0694" },
    { siret: "4", siren: "d", nom: "Sans position", lat: null, lon: null },
  ], P, 100);
  assert.deepEqual(Array.from(l, (e) => e.nom), ["Sur place", "Loin", "Sans position"]);
  assert.ok(l[0].distance <= 2); assert.ok(l[1].distance > 70 && l[1].distance < 85); assert.equal(l[2].distance, null);
});

test("rendre : compte, mention « à cette adresse », réserve sur la source, texte échappé", () => {
  const h = E.rendre(E.classer([{ siret: "1", siren: "123456789", nom: "A <b>", enseigne: "", adresse: "1 rue X", lat: "14.6037", lon: "-61.0694", est_siege: true }], P, 100));
  assert.match(h, /1 établissement actif/); assert.match(h, /à cette adresse ou tout près/); assert.match(h, /data-ep-fiche="123456789"/);
  assert.match(h, /A &lt;b&gt;/); assert.match(h, /à confirmer sur place/);
  assert.match(E.rendre([]), /Aucun établissement actif/);
});

test("branchements : analyse, écran de saisie, script chargé", () => {
  const page = lire("index.html"), saisie = lire("saisie.js");
  assert.match(page, /else if\(window\.FidiEntreprisesProches\) FidiEntreprisesProches\.charger\(data\.localisation/);
  assert.match(page, /entreprises-proches\.js/);
  assert.doesNotMatch(saisie, /Indiquez un SIREN, un SIRET ou une raison sociale/, "la case sans SIREN n'est plus une anomalie");
  assert.match(saisie, /Sirene \(INSEE\)/);
});
