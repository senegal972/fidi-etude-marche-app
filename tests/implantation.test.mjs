// Kit d'implantation : calculs vérifiés sur des formes dont le résultat se calcule à la main.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// implantation.js est un script navigateur : chargé ici avec un window minimal.
const src = readFileSync(new URL("../implantation.js", import.meta.url), "utf8");
const window = {};
new Function("window", "document", src)(window, undefined);
const { compute, defauts, grouper, agreger, partsZones, pointInterieur, svg, planParcelles } = window.FidiImplantation;

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

test("parcelles côte à côte : l'ensemble gagne la bande de recul que chaque parcelle perd seule", () => {
  const regles = { emprisePct: 60, reculVoie: 3, reculLimites: 3, niveaux: 2, coef: 1, batiLong: 12, batiLarg: 10, ecart: 4 };
  const a = rect(15.5, 30, 0, 0), b = rect(15.5, 30, 15.5, 0);
  const seuleA = compute({ ...regles, geoms: [a], contenance: 465 });
  const seuleB = compute({ ...regles, geoms: [b], contenance: 465 });
  const ens = compute({ ...regles, geoms: [a, b], contenance: 930 });
  proche(seuleA.constructible_m2, 9.5 * 24, 8, "parcelle seule");
  proche(ens.constructible_m2, 25 * 24, 12, "ensemble");
  assert.equal(seuleA.nb, 0, "un bâtiment de 10 m n'entre pas dans 9,5 m");
  assert.equal(seuleB.nb, 0);
  assert.equal(ens.nb, 2, "le terrain réuni porte 2 bâtiments");
  const somme = agreger([seuleA, seuleB]);
  assert.equal(somme.nb, 0);
  proche(somme.emprise_m2, seuleA.emprise_m2 + seuleB.emprise_m2, 0.01);
});

test("côté partagé sur une partie seulement : seule cette partie n'est plus une limite", () => {
  const r = compute({ geoms: [rect(20, 40, 0, 0), rect(20, 20, 20, 0)], contenance: 1200, emprisePct: 50, reculVoie: 3, reculLimites: 3, niveaux: 1 });
  const internes = r.cotes.filter((c) => c.interne);
  proche(internes.reduce((s, c) => s + c.long, 0), 40, 0.5, "20 m de chaque côté");
  // Le long du côté commun, la zone constructible passe ; plus loin, le recul reste dû.
  proche(r.constructible_m2, 14 * 34 + 20 * 14, 20);
});

test("unités foncières : contiguës et même zone seulement", () => {
  const a = { ref: "A", zone: "U1", geom: rect(20, 20, 0, 0) };
  const b = { ref: "B", zone: "U1", geom: rect(20, 20, 20, 0) };
  const c = { ref: "C", zone: "U1", geom: rect(20, 20, 200, 0) };
  const d = { ref: "D", zone: "U2", geom: rect(20, 20, 0, 20) };
  const noms = (gs) => gs.map((g) => g.map((p) => p.ref).join("+"));
  assert.deepEqual(noms(grouper([a, b])), ["A+B"]);
  assert.deepEqual(noms(grouper([a, c])), ["A", "C"], "séparées");
  assert.deepEqual(noms(grouper([a, d])), ["A", "D"], "zones différentes");
  assert.deepEqual(noms(grouper([a, b, c, d])), ["A+B", "C", "D"]);
  assert.deepEqual(noms(grouper([a, { ref: "S", zone: "U1", geom: null }])), ["A", "S"], "sans contour");
  const coin = { ref: "E", zone: "U1", geom: rect(20, 20, 20, 20) };
  assert.deepEqual(noms(grouper([a, coin])), ["A", "E"], "un point de contact ne suffit pas");
});

test("somme : une emprise inconnue rend le total incomplet, sans rien inventer", () => {
  const ok = compute({ geoms: [rect(40, 25)], contenance: 1000, emprisePct: 30, reculVoie: 3, reculLimites: 3, niveaux: 2, coef: 1 });
  const inconnu = compute({ geoms: [rect(40, 25, 100, 0)], contenance: 1000, emprisePct: "", reculVoie: 3, reculLimites: 3, niveaux: 3 });
  const t = agreger([ok, inconnu]);
  assert.equal(t.incomplet, true);
  assert.equal(t.surface, 2000);
  assert.equal(t.emprise_m2, 300);
  assert.equal(t.niveaux, 2);
  const rien = agreger([inconnu]);
  assert.equal(rien.emprise_m2, null);
  assert.equal(rien.sdp, undefined);
});

test("côté sur voie : marqué sur une vue, reconnu sur les autres", () => {
  const a = rect(20, 20, 0, 0), b = rect(20, 20, 20, 0);
  const base = { emprisePct: 50, reculVoie: 10, reculLimites: 2, niveaux: 1 };
  const ens = compute({ ...base, geoms: [a, b] });
  const nord = ens.cotes.find((c) => !c.interne && c.p === 0 && Math.abs(c.a[1] - c.b[1]) < 0.01);
  const seule = compute({ ...base, geoms: [a], voieCles: [nord.cle] });
  assert.equal(seule.voieInconnue, false);
  assert.equal(seule.cotes.filter((c) => c.voie).length, 1);
  assert.match(svg(seule), new RegExp('data-cle="' + nord.cle + '"'));
});

test("zones du PLU : parts de la parcelle et point intérieur", () => {
  const g = rect(40, 20, 0, 0);
  const z1 = { properties: { libelle: "U1" }, geometry: rect(30, 40, -5, -10) };
  const z2 = { properties: { libelle: "N" }, geometry: rect(30, 40, 25, -10) };
  const parts = partsZones(g, [z2, z1]);
  assert.equal(parts[0].feature.properties.libelle, "U1");
  proche(parts[0].part, 0.625, 0.08, "25 m sur 40 m");
  const q = pointInterieur(g);
  assert.ok(q[0] > 0 && q[0] < 40 / 111320 && q[1] > 0 && q[1] < 20 / 110540);
});

test("projet commun : les bâtiments à cheval sur une limite sont repérés", () => {
  const r = compute({ geoms: [rect(10, 30, 0, 0), rect(10, 30, 10, 0)], noms: ["A", "B"], contenance: 600, emprisePct: 60, reculVoie: 3, reculLimites: 3, niveaux: 1 });
  assert.ok(r.nb >= 1);
  assert.ok(r.aCheval.length >= 1, "un bâtiment de 12 × 10 m ne tient qu'à cheval sur la limite");
  assert.equal(r.batiments[r.aCheval[0] - 1].parcelles.length, 2);
  const seule = compute({ geoms: [rect(40, 25)], contenance: 1000, emprisePct: 30, reculVoie: 3, reculLimites: 3, niveaux: 1 });
  assert.deepEqual(seule.aCheval, []);
});

test("plan par parcelle : limites, couleurs et bâtiments de chacune, dans le même repère", () => {
  const regles = { emprisePct: 60, reculVoie: 3, reculLimites: 3, niveaux: 1 };
  const a = compute({ ...regles, geoms: [rect(30, 30, 0, 0)], contenance: 900 });
  const b = compute({ ...regles, geoms: [rect(30, 30, 30, 0)], contenance: 900 });
  const entries = [{ ref: "A 1", res: a, couleur: "#111111" }, { ref: "B <2>", res: b, couleur: "#222222" }];
  const s = planParcelles(entries);
  assert.ok(s.includes("A 1"));
  assert.ok(s.includes("B &lt;2&gt;"), "nom échappé");
  assert.ok(s.includes('fill="#111111"') && s.includes('fill="#222222"'));
  // 2 × 4 côtés, dont 2 confondus (limite commune) : seuls 6 restent cliquables.
  assert.equal((s.match(/class="impl-cote/g) || []).length, 6);
  assert.equal((s.match(/stroke="#1f2937"/g) || []).length, 2, "limite commune dessinée sur les 2 parcelles");
  // Numérotation à la suite.
  assert.equal(entries[0].premier, 1);
  assert.equal(entries[1].premier, a.nb + 1);
  assert.equal(entries[1].dernier, a.nb + b.nb);
  // Les bâtiments de A restent dans la moitié ouest du plan, ceux de B dans la moitié est.
  const paths = [...s.matchAll(/<path d="M([\d.]+) ([\d.]+)[^"]*" fill="(#\d+)" fill-opacity="\.85"/g)];
  assert.equal(paths.length, a.nb + b.nb);
  paths.forEach((m) => { assert.ok(m[3] === "#111111" ? Number(m[1]) < 320 : Number(m[1]) > 320, m[0].slice(0, 40)); });
});

test("plan par parcelle : côté sur voie marqué sur une parcelle", () => {
  const regles = { emprisePct: 60, reculVoie: 5, reculLimites: 3, niveaux: 1 };
  const g = rect(30, 30, 0, 0);
  const sans = compute({ ...regles, geoms: [g], contenance: 900 });
  const cle = sans.cotes[0].cle;
  const avec = compute({ ...regles, geoms: [g], contenance: 900, voieCles: [cle] });
  const s = planParcelles([{ ref: "A", res: avec, couleur: "#111111" }]);
  assert.equal((s.match(/stroke="#fd7e14"/g) || []).length, 1);
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
