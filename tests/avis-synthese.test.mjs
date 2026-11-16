// Avis de valeur — cohérence entre la synthèse des méthodes (5 ter), la stratégie de prix (7 ter)
// et la valeur retenue (rubriques 5 et 7) ; distinction neuf / ancien ; comparatif ancien / neuf.
// avis-valeur.js est un script de navigateur : il est chargé ici dans un contexte minimal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function charger() {
  const memoire = new Map();
  const localStorage = {
    getItem: (k) => (memoire.has(k) ? memoire.get(k) : null), setItem: (k, v) => memoire.set(k, String(v)),
    removeItem: (k) => memoire.delete(k), key: (i) => [...memoire.keys()][i] ?? null, get length() { return memoire.size; },
  };
  const noeud = () => ({ addEventListener() {}, appendChild() {}, setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } });
  const document = { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: noeud, body: noeud(), head: noeud(), documentElement: noeud() };
  const window = { localStorage, document, addEventListener() {}, location: { search: "", hash: "", href: "http://localhost/" }, navigator: { userAgent: "test" } };
  window.window = window;
  const ctx = vm.createContext({ window, document, localStorage, navigator: window.navigator, location: window.location,
    console, setTimeout, clearTimeout, setInterval() {}, clearInterval() {}, fetch: () => Promise.reject(new Error("réseau coupé")) });
  vm.runInContext(readFileSync(new URL("../avis-valeur.js", import.meta.url), "utf8"), ctx, { filename: "avis-valeur.js" });
  return window.AvisValeur;
}
const AV = charger();

// Le cas du dossier réel : appartement ancien de 78 m², deux annonces de 42 et 25 m²,
// vétusté 25 %, étude de marché à 2 623 €/m².
function appartement(over) {
  const d = AV._defaut();
  Object.assign(d.bien, { type: "Appartement", cp: "97200", commune: "Fort-de-France", surfaceCarrez: 78, statut: "libre" });
  d.etat.vetusteManuel = 25;
  d.marche.moyenneBas = 2200; d.marche.moyenneMoyen = 2623; d.marche.moyenneHaut = 3000;
  d.comparables = [
    { nature: "annonce", source: "SeLoger", type: "T2", surface: 42, prix: 139000, inclus: true, ajustementPct: "" },
    { nature: "annonce", source: "SeLoger", type: "T1", surface: 25, prix: 82000, inclus: true, ajustementPct: "" },
  ];
  d.methodes.capitalisation.on = false;
  if (over) over(d);
  return d;
}

test("la synthèse applique la décote d'état : même valeur que la rubrique « Valeur vénale retenue »", () => {
  const d = appartement();
  const F = AV._synthese(d), c = AV._compute(d);
  assert.equal(F.dEtat, 25);
  assert.ok(F.brut.synthese.central > 250000, "avant décote, la synthèse reste celle des méthodes");
  assert.equal(F.net.synthese.central, Math.round(F.brut.synthese.brut.central * 0.75 / 1000) * 1000);
  assert.ok(F.net.synthese.central >= c.voccBas && F.net.synthese.central <= c.voccHaut,
    `central ${F.net.synthese.central} hors de la fourchette retenue ${c.voccBas}–${c.voccHaut}`);
  assert.equal(F.coherent, true);
});

test("la stratégie de prix part de la valeur après décotes, plus de la valeur brute", () => {
  const d = appartement();
  const S = AV._strategie(d), c = AV._compute(d);
  assert.equal(S.objectif, S.F.net.synthese.central);
  assert.ok(S.objectif <= c.voccHaut, "l'objectif de signature ne dépasse pas la valeur retenue");
  assert.equal(S.prixPres, Math.round(S.objectif * 1.085 / 1000) * 1000);
  assert.ok(S.prixPres < S.F.brut.synthese.central, "le prix de présentation ne repart pas de la valeur avant décote");
});

test("sans décote, rien ne change : synthèse avant = après", () => {
  const d = appartement((x) => { x.etat.vetusteManuel = 0; });
  const F = AV._synthese(d);
  assert.deepEqual(F.net.synthese, F.brut.synthese);
});

test("décote d'occupation : appliquée à la comparaison quand le bien est occupé", () => {
  const d = appartement((x) => { x.bien.statut = "occupe"; x.calcul.decoteOccupation = 10; });
  const F = AV._synthese(d);
  assert.equal(F.dOcc, 10);
  assert.equal(F.net.synthese.central, Math.round(F.brut.synthese.brut.central * 0.75 * 0.9 / 1000) * 1000);
});

test("sol + construction porte déjà sa vétusté : la décote d'état ne la frappe pas deux fois", () => {
  const d = appartement((x) => {
    x.bien.type = "Maison"; x.cadastre.contenance = 600; x.cadastre.shobAutorisee = 100;
    x.methodesV2.solConstruction.chargeFonciere = { bas: 80000, central: 90000, haut: 100000 };
  });
  const F = AV._synthese(d);
  assert.equal(F.brut.actives.solConstruction, true);
  assert.equal(Math.round(F.net.solConstruction.central), Math.round(F.brut.solConstruction.central));
  assert.equal(Math.round(F.net.comparaison.central), Math.round(F.brut.comparaison.central * 0.75));
});

test("un comparable neuf est écarté du calcul d'un bien ancien, et signalé", () => {
  const base = AV._lecture(appartement());
  const d = appartement((x) => { x.comparables.push({ nature: "annonce", source: "SeLoger", type: "T3", surface: 70, prix: 350000, inclus: true, segment: "neuf" }); });
  const L = AV._lecture(d);
  assert.equal(L.n, 2);
  assert.equal(L.ecartes.length, 1);
  assert.equal(L.m2Med, base.m2Med, "le €/m² retenu ne bouge pas");
  assert.equal(L.m2NeufMed, 5000);
  assert.equal(AV._compute(d).acmCount, 2);
  assert.ok(AV._remarques(d, L).some((t) => /neuf écarté du calcul/.test(t)));
  // État « Neuf » vaut neuf ; une vente DVF vaut ancien ; le reste est « non précisé ».
  const d2 = appartement((x) => { x.comparables[0].etat = "Neuf"; x.comparables.push({ nature: "vendu", source: "DVF", surface: 80, prix: 200000, inclus: true }); });
  const L2 = AV._lecture(d2);
  assert.equal(L2.ecartes.length, 1);
  assert.equal(L2.anciens, 1);
  assert.equal(L2.nonPrecises, 1);
});

test("bien neuf : ce sont les comparables anciens qui sortent du calcul", () => {
  const d = appartement((x) => { x.bien.segment = "neuf"; x.comparables.push({ nature: "vendu", source: "DVF", surface: 80, prix: 200000, inclus: true }); });
  const L = AV._lecture(d);
  assert.equal(L.ecartes.length, 1);
  assert.equal(L.ecartes[0].segment, "ancien");
});

test("terrain et location : pas de distinction neuf / ancien", () => {
  const t = appartement((x) => { x.bien.type = "Terrain à bâtir"; x.comparables[0].segment = "neuf"; });
  assert.equal(AV._lecture(t).ecartes.length, 0);
  assert.equal(AV._comparatif(t), null);
  const l = appartement((x) => { x.metadata.nature = "location"; x.comparables[0].segment = "neuf"; });
  assert.equal(AV._lecture(l).ecartes.length, 0);
});

test("les remarques disent ce que sont les comparables : annonces, base étroite, petites surfaces, écart à l'étude", () => {
  const d = appartement();
  const r = AV._remarques(d, AV._lecture(d)).join(" | ");
  assert.match(r, /tous des annonces/);
  assert.match(r, /Base étroite : 2 comparables/);
  assert.match(r, /plus petits que le bien/);
  assert.match(r, /supérieur de \d+ % au €\/m² de l'étude de marché/);
  assert.match(r, /non précisé pour 2 comparables/);
});

test("comparatif ancien / neuf : absent sans prix du neuf, complet dès qu'il est connu", () => {
  const d = appartement();
  assert.deepEqual({ ...AV._comparatif(d) }, { manque: "neuf", surf: 78, seg: "ancien" });
  d.strategie.comparatif.neufPrixM2 = 4500;
  const K = AV._comparatif(d), S = AV._strategie(d);
  assert.equal(K.ancien.estLeBien, true);
  assert.equal(K.ancien.prix, S.objectif);
  assert.equal(K.neuf.prix, 351000);
  // Ancien : droits + notaire du territoire, honoraires TTC à la charge de l'acquéreur, travaux = décote d'état.
  assert.equal(Math.round(K.ancien.frais), Math.round(S.cObj.droits + S.cObj.notaire));
  assert.equal(Math.round(K.ancien.hono), Math.round(S.cObj.honoTTC));
  assert.equal(K.ancien.travaux, Math.round(S.F.brut.comparaison.central * 0.25 / 1000) * 1000);
  assert.equal(K.ancien.travauxEstime, true);
  assert.equal(Math.round(K.ancien.total), Math.round(K.ancien.prix + K.ancien.hono + K.ancien.frais + K.ancien.travaux));
  // Neuf : frais réduits, pas de travaux, honoraires inclus dans le prix.
  assert.equal(K.neuf.fraisPct, 2.5);
  assert.equal(Math.round(K.neuf.frais), 8775);
  assert.equal(K.neuf.travaux, 0);
  assert.equal(K.neuf.honoInclus, true);
  assert.equal(Math.round(K.ecart), Math.round(K.neuf.total - K.ancien.total));
  // Travaux saisis à 0 : respectés (0 n'est pas « vide »).
  d.strategie.comparatif.travaux = 0;
  assert.equal(AV._comparatif(d).ancien.travaux, 0);
  assert.equal(AV._comparatif(d).ancien.travauxEstime, false);
});

test("comparatif : le prix du neuf vient des comparables neufs quand il y en a", () => {
  const d = appartement((x) => { x.comparables.push({ nature: "annonce", source: "SeLoger", surface: 70, prix: 350000, inclus: true, segment: "neuf" }); });
  const K = AV._comparatif(d);
  assert.equal(K.neuf.prix, 78 * 5000);
  assert.equal(K.neuf.source, "médiane des comparables neufs");
});

test("document : 5 ter suit la rubrique 5, annonce la valeur après décote, et 7 ter porte le comparatif", () => {
  const d = appartement((x) => { x.strategie.comparatif.neufPrixM2 = 4500; });
  const html = AV.documentHTML(d);
  const i5 = html.indexOf("5. Détermination de la valeur vénale"), i5t = html.indexOf("5 ter."), i7 = html.indexOf("<h1>7. Avis de valeur"), i7t = html.indexOf("7 ter.");
  assert.ok(i5 > 0 && i5 < i5t && i5t < i7 && i7 < i7t, "ordre des rubriques : 5, 5 ter, 7, 7 ter");
  const S = AV._strategie(d);
  const euros = (n) => n.toLocaleString("fr-FR") + " €";
  const ter = html.slice(i5t, i7), strat = html.slice(i7t);
  assert.ok(ter.includes("Annonce (prix demandé)"));
  assert.ok(ter.includes("VALEUR APRÈS DÉCOTES"));
  assert.ok(ter.includes(euros(S.objectif)));
  assert.ok(strat.includes("Objectif de signature</td><td class=\"center\">" + euros(S.objectif)));
  assert.ok(!strat.includes(euros(S.F.brut.synthese.central)), "la valeur avant décote n'est plus un objectif de prix");
  assert.ok(strat.includes("Acheter dans l'ancien ou dans le neuf") || strat.includes("Acheter dans l\\'ancien ou dans le neuf"));
  assert.ok(strat.includes("COÛT TOTAL"));
  // Sans prix du neuf : pas de comparatif dans le document.
  assert.ok(!AV.documentHTML(appartement()).includes("COÛT TOTAL</td>"));
});
