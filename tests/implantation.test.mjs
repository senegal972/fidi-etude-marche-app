// Kit d'implantation : calculs vérifiés sur des formes dont le résultat se calcule à la main.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// implantation.js est un script navigateur : chargé ici avec un window minimal.
const src = readFileSync(new URL("../implantation.js", import.meta.url), "utf8");
const window = {};
new Function("window", "document", src)(window, undefined);
const { compute, defauts } = window.FidiImplantation;

// Rectangle de w × h mètres autour de l'équateur (1 m ≈ constantes du module).
function rect(w, h, ox = 0, oy = 0) {
  const kx = 111320, ky = 110540;
  const pts = [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h], [ox, oy]];
  return { type: "Polygon", coordinates: [pts.map(([x, y]) => [x / kx, y / ky])] };
}
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} attendu ${b} ±${tol}`);

test("terrain 40 × 25 m, recul 3 m, emprise 30 % : l'emprise limite", () => {
  const r = compute({ geoms: [rect(40, 25)], contenance: 1000, emprisePct: 30, reculVoie: 3, reculLimites: 3, niveaux: 2, coef: 0.85, batiLong: 12, batiLarg: 10, ecart: 4 });
  proche(r.aireGeom, 1000, 2, "aire");
  proche(r.constructible_m2, 34 * 19, 12, "zone après reculs");
  assert.equal(r.emprise_max_m2, 300);
  assert.equal(r.emprise_m2, 300);
  assert.equal(r.limite_par, "emprise");
  proche(r.sdp, 300 * 2 * 0.85, 0.001, "plancher");
  proche(r.sdp_min, 300 * 2 * 0.80, 0.001);
  proche(r.sdp_max, 300 * 2 * 0.90, 0.001);
  assert.equal(r.nb, 2, "300 m² / 120 m² = 2 bâtiments, et ils tiennent");
});

test("terrain étroit : les reculs limitent l'emprise et le nombre de bâtiments", () => {
  const r = compute({ geoms: [rect(60, 10)], contenance: 600, emprisePct: 80, reculVoie: 3, reculLimites: 3, niveaux: 1, coef: 1, batiLong: 12, batiLarg: 10, ecart: 4 });
  proche(r.constructible_m2, 54 * 4, 8, "bande de 4 m");
  assert.equal(r.limite_par, "reculs");
  assert.equal(r.nb, 0, "un bâtiment de 10 m de large n'entre pas dans 4 m");
});

test("sans côté marqué : le plus grand recul s'applique partout ; marqué : recul par côté", () => {
  const base = { geoms: [rect(40, 40)], contenance: 1600, emprisePct: 50, reculVoie: 10, reculLimites: 2, niveaux: 1 };
  const sans = compute(base);
  assert.equal(sans.voieInconnue, true);
  proche(sans.constructible_m2, 20 * 20, 8);
  const cote = sans.cotes.findIndex((c) => Math.abs(c.a[1] - c.b[1]) < 0.01);
  const avec = compute({ ...base, voieCotes: [cote] });
  assert.equal(avec.voieInconnue, false);
  proche(avec.constructible_m2, 36 * 28, 15);
});

test("deux parcelles contiguës : le côté commun ne compte pas comme limite", () => {
  const r = compute({ geoms: [rect(20, 20, 0, 0), rect(20, 20, 20, 0)], contenance: 800, emprisePct: 50, reculVoie: 3, reculLimites: 3, niveaux: 1 });
  assert.equal(r.cotes.filter((c) => c.interne).length, 2);
  proche(r.constructible_m2, 34 * 14, 10, "un seul bloc, sans bande au milieu");
});

test("emprise inconnue : aucune surface inventée", () => {
  const r = compute({ geoms: [rect(40, 25)], contenance: 1000, emprisePct: "", reculVoie: 3, reculLimites: 3, niveaux: 2 });
  assert.equal(r.emprise_m2, null);
  assert.equal(r.sdp, undefined);
  assert.equal(r.nb, 0);
});

test("emprise non réglementée : seuls les reculs limitent", () => {
  const r = compute({ geoms: [rect(40, 25)], contenance: 1000, emprisePct: "", empriseNonReglementee: true, reculVoie: 3, reculLimites: 3, niveaux: 2 });
  assert.equal(r.limite_par, "reculs");
  proche(r.emprise_m2, 34 * 19, 12);
});

test("zone agricole sans saisie : pas de surface de plancher", () => {
  const r = compute({ geoms: [rect(40, 25)], contenance: 1000, emprisePct: "", empriseNonReglementee: true, constructible: false, reculVoie: 3, reculLimites: 3, niveaux: 2 });
  assert.equal(r.emprise_m2, null);
  assert.equal(r.nb, 0);
});

test("sans géométrie : pas de plantage, surface issue du cadastre", () => {
  const r = compute({ geoms: [], contenance: 1000, emprisePct: 30, reculVoie: 3, reculLimites: 3, niveaux: 2 });
  assert.equal(r.polys, null);
  assert.equal(r.emprise_m2, 300);
  assert.equal(r.nb, 0);
});

test("défauts tirés du règlement : Fort-de-France UGf1", () => {
  const d = defauts({
    emprise: { pct: 30, page: 75, citation: "c" }, hauteur: { egout_m: 7, total_m: 9, page: 75 },
    recul_voie: { m: 3, page: 73 }, recul_limites: { m: 3, en_limite: true, page: 74 }, entre_batiments: null,
  });
  assert.equal(d.emprisePct, 30);
  assert.equal(d.niveaux, 2, "7 m à l'égout = 2 niveaux");
  assert.equal(d.reculVoie, 3);
  assert.equal(d.srcVoie.page, 73);
  assert.equal(d.enLimitePossible, true);
  assert.equal(d.srcEcart, null, "écart = hypothèse");
});

test("défauts : H/2 appliqué, plafond ignoré, rien de lu = hypothèse signalée", () => {
  const h2 = defauts({ hauteur: { egout_m: 12 }, recul_limites: { m: 3, formule: "H/2", page: 1 } });
  assert.equal(h2.reculLimites, 6);
  const max = defauts({ recul_voie: { m: null, maximum: true, page: 2 } });
  assert.equal(max.reculVoie, 0);
  const vide = defauts(null);
  assert.equal(vide.emprisePct, "");
  assert.equal(vide.srcVoie, null);
  assert.equal(vide.srcNiveaux, null);
});
