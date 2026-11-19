// Recherche d'annonces similaires (v1.15) : lecture des résultats du moteur de recherche,
// quartiers dans le périmètre, connexion exigée. Aucun appel réseau réel : fetch est simulé.
// Les extraits ci-dessous sont de vrais extraits de résultats relevés en novembre 2026.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";

const { signJWT } = await import("../netlify/functions/_auth.mjs");
const { annoncesDuResultat, quartiersProches, rechercherAnnonces, familleBien, distanceM } = await import("../netlify/functions/_annonces.mjs");
const { handler } = await import("../netlify/functions/annonces.mjs");
const { handler: fond } = await import("../netlify/functions/annonces-background.mjs");

const ctx = { famille: "appartement", commune: "Fort-de-France", cp: "97200", quartiers: ["Clairière", "Bergeral", "Terres Sainville"] };
const R = {
  bieniciT3: { url: "https://www.bienici.com/recherche/achat/fort-de-france-97200/appartement/3-pieces", title: "96 appartements T3 à vendre à Fort-de-France - Bien'ici",
    desc: "Appartement 3 pièces 75 m² 97200 Fort-de-France. 362 000 €4 809 €/m². Logé dans le quartier CLAIRIERE- SAINTE CATHERINE, Cette résidence surplombe la baie, ..." },
  bieniciMixte: { url: "https://www.bienici.com/recherche/achat/fort-de-france-97200", title: "Achat immobilier Fort-de-France (97)",
    desc: "316 biens à vendre à Fort-de-France ; Maison 16 pièces 305 m² · 699 000 €2 292 €/m² ; Appartement 4 pièces 93 m² · 329 000 €3 538 €/m² ; Maison 9 pièces 350 m² · 630 ..." },
  bieniciDeux: { url: "https://www.bienici.com/recherche/achat/fort-de-france-97200/appartement?dernier-etage=oui", title: "Achat appartement Fort-de-France (97) (dernier étage)",
    desc: "40 appartements à vendre à Fort-de-France ; Appartement 2 pièces 43 m² · 139 000 €3 233 €/m² ; Appartement 5 pièces 110 m² · 318 000 €2 891 €/m² ; Appartement 4 ..." },
  selogerBergeral: { url: "https://www.seloger.com/recherche/achat/appartement/piece-4/martinique/fort-de-france-97200/ad08mq9", title: "Appartements 4 pièces ou T4 à vendre Fort-de-France ...",
    desc: "64 Appartements 4 pièces (T4/F4) en vente Fort-de-France 97200. Appartement à vendre 277 985 € 4 pièces 3 chambres 87,2 m² Étage 2 BERGERAL" },
  selogerAutreCommune: { url: "https://www.seloger.com/recherche/achat/appartement/piscine/martinique/fort-de-france-97200/ad08mq9", title: "Appartements avec piscine à vendre Fort-de-France ...",
    desc: "10 Appartements avec piscine en vente Fort-de-France 97200 · Appartement à vendre 289 000 € 4 pièces 3 chambres 109 m² RDC Schœlcher 97233 · Résidence senior à ..." },
  leboncoin: { url: "https://www.leboncoin.fr/cl/_immobilier_/cp_fort-de-france/p-3", title: "Immobilier: Fort-de-France (97200) - page 3",
    desc: "Immobilier Fort-de-France (97200). Appartement, 4 pièces, 92 mètres carrés. 260 000 € Prix: 260 000 €. 168 270 € Prix: Maison, 6 pièces, 163 mètres carrés. ..." },
  prixMoyen: { url: "https://www.seloger.com/prix-de-l-immo/vente/departements-d-outre-mer/martinique/fort-de-france/972209.htm", title: "Prix m2 immobilier Fort-de-France (972)",
    desc: "Les appartements ont un prix moyen de 2 052 €/m², variant de 1 764 € pour les plus accessibles à 2 542 €." },
  location: { url: "https://www.leboncoin.fr/cl/locations/cp_fort-de-france_97200", title: "Location appartement Fort-de-France (97200)", desc: "Appartement 3 pièces 70 m² 950 € par mois" },
};
const resume = (l) => l.map((a) => `${a.pieces}p ${a.surface_hab}m² ${a.prix}€`).join(" | ");

test("un extrait de portail donne type, pièces, surface, prix et quartier", () => {
  const [a] = annoncesDuResultat(R.bieniciT3, ctx);
  assert.equal(a.prix, 362000);
  assert.equal(a.surface_hab, 75);
  assert.equal(a.pieces, 3);
  assert.equal(a.prix_m2, Math.round(362000 / 75));     // le « 4 809 €/m² » de l'extrait n'est pas pris pour un prix
  assert.equal(a.quartier, "Clairière");
  assert.equal(a.proche, true);
  assert.equal(a.source, "bienici.com");
  assert.equal(a.page_resultats, true);
  const [b] = annoncesDuResultat(R.selogerBergeral, ctx);
  assert.deepEqual([b.prix, b.surface_hab, b.pieces, b.quartier], [277985, 87.2, 4, "Bergeral"]);
});

test("plusieurs annonces dans un même extrait : chacune avec sa surface et son prix", () => {
  assert.equal(resume(annoncesDuResultat(R.bieniciDeux, ctx)), "2p 43m² 139000€ | 5p 110m² 318000€");
});

test("seul le type de bien recherché est gardé (les maisons sortent d'une recherche d'appartements)", () => {
  assert.equal(resume(annoncesDuResultat(R.bieniciMixte, ctx)), "4p 93m² 329000€");
  assert.equal(resume(annoncesDuResultat(R.leboncoin, ctx)), "4p 92m² 260000€");   // prix répété compté une fois
  const maisons = annoncesDuResultat(R.bieniciMixte, { ...ctx, famille: "maison" });
  assert.equal(resume(maisons), "16p 305m² 699000€");
});

test("écartés : annonce d'une autre commune, page de prix moyens, location, autre commune", () => {
  assert.equal(annoncesDuResultat(R.selogerAutreCommune, ctx).length, 0);
  assert.equal(annoncesDuResultat(R.prixMoyen, ctx).length, 0);
  assert.equal(annoncesDuResultat(R.location, ctx).length, 0);
  assert.equal(annoncesDuResultat(R.bieniciT3, { ...ctx, commune: "Le Lamentin", cp: "97232" }).length, 0);
});

test("terrain : surface de terrain et prix au m² de terrain", () => {
  const r = { url: "https://www.bienici.com/recherche/achat/ducos-97224/terrain", title: "Achat terrain Ducos (97224)", desc: "12 terrains à vendre à Ducos ; Terrain 850 m² · 148 000 €174 €/m² ; Terrain 1 200 m² · 199 000 €" };
  const l = annoncesDuResultat(r, { famille: "terrain", commune: "Ducos", cp: "97224", quartiers: [] });
  assert.equal(l.length, 2);
  assert.deepEqual([l[1].surface_terrain, l[1].prix], [1200, 199000]);
  assert.deepEqual([l[0].nature, l[0].surface_terrain, l[0].prix, l[0].prix_m2_terrain, l[0].surface_hab], ["terrain", 850, 148000, 174, null]);
});

test("famille de bien et distance", () => {
  assert.equal(familleBien("Appartement"), "appartement");
  assert.equal(familleBien("Villa"), "maison");
  assert.equal(familleBien("Terrain à bâtir"), "terrain");
  const d = distanceM(14.6037, -61.0731, 14.6127, -61.0731);
  assert.ok(d > 990 && d < 1010, `1 km attendu, obtenu ${d}`);
});

// ── Réseau simulé ─────────────────────────────────────────────────────────────
const vraiFetch = globalThis.fetch;
let appels = [], etatBrave = 200;
const carre = (lat, lon) => [[[[lon, lat], [lon + 0.0002, lat], [lon + 0.0002, lat + 0.0002], [lon, lat]]]];
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  appels.push(u);
  if (u.includes("api.notion.com")) {
    const corps = JSON.parse(options.body || "{}");
    const email = corps?.filter?.title?.equals || corps?.filter?.rich_text?.equals || corps?.filter?.email?.equals || "";
    return new Response(JSON.stringify({ results: email === "agent@exemple.fr" ? [{ id: "u1", properties: {
      "Email": { title: [{ plain_text: email }] }, "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: "Collaborateur" } } } }] : [] }), { status: 200 });
  }
  if (u.includes("data.geopf.fr")) {
    return new Response(JSON.stringify({ features: [
      { properties: { toponyme: "Clairière", importance: "2", fictif: true }, geometry: { type: "MultiPolygon", coordinates: carre(14.6094, -61.0802) } },
      { properties: { toponyme: "Fort-de-France", importance: "1" }, geometry: { type: "MultiPolygon", coordinates: carre(14.605, -61.072) } },
      { properties: { toponyme: "Résidence Karamel", importance: "6" }, geometry: { type: "MultiPolygon", coordinates: carre(14.604, -61.074) } },
      { properties: { toponyme: "Schœlcher", importance: "1" }, geometry: { type: "MultiPolygon", coordinates: carre(14.6279, -61.1178) } },
    ] }), { status: 200 });
  }
  if (u.includes("api.search.brave.com")) {
    if (etatBrave !== 200) return new Response("{}", { status: etatBrave });
    const q = decodeURIComponent(u.split("q=")[1].split("&")[0]);
    const res = q.includes("bienici.com") ? [R.bieniciT3, R.bieniciDeux] : q.includes("seloger.com") ? [R.selogerBergeral, R.selogerAutreCommune, R.prixMoyen]
      : q.includes("leboncoin.fr") ? [R.leboncoin, R.location] : [];
    return new Response(JSON.stringify({ web: { results: res.map((r) => ({ url: r.url, title: r.title, description: r.desc })) } }), { status: 200 });
  }
  throw new Error("appel réseau non prévu : " + u);
};
after(() => { globalThis.fetch = vraiFetch; });

test("quartiers dans le périmètre : contours approximatifs gardés, résidences et lieux lointains écartés", async () => {
  const q = await quartiersProches(14.6037, -61.0731, 1000);
  assert.deepEqual(q.map((x) => x.nom).sort(), ["Clairière", "Fort-de-France"]);
  assert.ok(q.every((x) => x.distance_m <= 1000));
  assert.deepEqual(await quartiersProches(null, null, 1000), []);
});

const criteres = { commune: "Fort-de-France", code_postal: "97200", type_bien: "Appartement", surface_hab: 78, lat: 14.6037, lon: -61.0731, rayon_m: 1000, portails: ["leboncoin", "seloger", "bienici"] };

test("recherche complète : annonces des trois portails, aucune page de portail ouverte, proches en premier", async () => {
  process.env.SEARCH_API_KEY = "cle-de-test"; etatBrave = 200; appels = [];
  const r = await rechercherAnnonces(criteres);
  assert.equal(r.statut, "termine");
  assert.equal(r.comparables.length, 5);
  assert.equal(r.comparables[0].proche, true, "une annonce d'un quartier du périmètre passe en tête");
  assert.equal(r.stats.nb_proches, 1);
  assert.deepEqual(Object.keys(r.diag.portails).sort(), ["bienici.com", "leboncoin.fr", "seloger.com"]);
  assert.equal(r.rayon_m, 1000);
  assert.equal(r.motif, "");
  // Seuls le moteur de recherche et l'IGN sont appelés : les portails ne sont jamais lus.
  assert.ok(appels.every((u) => u.includes("api.search.brave.com") || u.includes("data.geopf.fr")), appels.join("\n"));
  // Une requête par portail choisi, plus celle du quartier proche.
  const requetes = appels.filter((u) => u.includes("brave")).map((u) => decodeURIComponent(u.split("q=")[1].split("&")[0]));
  assert.equal(requetes.filter((q) => q.startsWith("site:")).length, 3);
  assert.ok(requetes.some((q) => q.includes('"Clairière"')));
});

test("aucun résultat : le motif est dit en clair (limite de requêtes, clé refusée)", async () => {
  process.env.SEARCH_API_KEY = "cle-de-test";
  etatBrave = 429;
  let r = await rechercherAnnonces({ ...criteres, portails: ["bienici"], lat: null, lon: null });
  assert.equal(r.comparables.length, 0);
  assert.match(r.motif, /limite de requêtes/);
  etatBrave = 401;
  r = await rechercherAnnonces({ ...criteres, portails: ["bienici"], lat: null, lon: null });
  assert.match(r.motif, /clé du service de recherche est refusée/);
  etatBrave = 200;
});

test("route /api/annonces : connexion exigée avant tout, même sans clé de recherche", async () => {
  const corps = JSON.stringify(criteres);
  appels = [];
  for (const cle of ["cle-de-test", ""]) {
    if (cle) process.env.SEARCH_API_KEY = cle; else delete process.env.SEARCH_API_KEY;
    const r = await handler({ httpMethod: "POST", headers: {}, body: corps });
    assert.equal(r.statusCode, 401);
  }
  assert.ok(!appels.some((u) => u.includes("brave")), "aucune recherche payante sans connexion");
  const session = { cookie: "fidi_session=" + signJWT({ email: "agent@exemple.fr" }) };
  let r = await handler({ httpMethod: "POST", headers: session, body: corps });
  assert.equal(JSON.parse(r.body).statut, "indisponible");          // connecté, sans clé : pas d'erreur 500
  process.env.SEARCH_API_KEY = "cle-de-test";
  r = await handler({ httpMethod: "POST", headers: session, body: corps });
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).resultats.comparables.length, 5);
  r = await handler({ httpMethod: "POST", headers: session, body: "{}" });
  assert.equal(r.statusCode, 400);
  assert.equal((await handler({ httpMethod: "OPTIONS", headers: {} })).statusCode, 200);
});

test("l'ancienne route de fond, appelable sans connexion, ne lance plus rien", async () => {
  appels = [];
  const r = await fond({ httpMethod: "POST", headers: {}, body: JSON.stringify({ job_id: "x", criteres }) });
  assert.equal(r.statusCode, 410);
  assert.equal(appels.length, 0);
});

// ── Côté navigateur : liens directs et ajout aux comparables ───────────────────
function chargerAvis() {
  const memoire = new Map();
  const localStorage = { getItem: (k) => (memoire.has(k) ? memoire.get(k) : null), setItem: (k, v) => memoire.set(k, String(v)),
    removeItem: (k) => memoire.delete(k), key: (i) => [...memoire.keys()][i] ?? null, get length() { return memoire.size; } };
  const noeud = () => ({ addEventListener() {}, appendChild() {}, setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } });
  const document = { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: noeud, body: noeud(), head: noeud(), documentElement: noeud() };
  const window = { localStorage, document, addEventListener() {}, location: { search: "", hash: "", href: "http://localhost/" }, navigator: { userAgent: "test" }, matchMedia: () => ({ matches: false }) };
  window.window = window;
  const c = vm.createContext({ window, document, localStorage, navigator: window.navigator, location: window.location, console, setTimeout, clearTimeout, setInterval() {}, clearInterval() {}, fetch: () => Promise.reject(new Error("réseau coupé")) });
  vm.runInContext(readFileSync(new URL("../avis-valeur.js", import.meta.url), "utf8"), c, { filename: "avis-valeur.js" });
  return window.AvisValeur;
}

test("liens directs : Leboncoin avec le rayon autour du bien, Bien'ici sur la commune, les autres par recherche web", () => {
  const AV = chargerAvis();
  const liens = AV._veilleLiens({ commune: "Fort-de-France", code_postal: "97200", type_bien: "Appartement", lat: 14.6037, lon: -61.0731 });
  const par = Object.fromEntries(liens.map((l) => [l.id, l]));
  assert.equal(par.leboncoin.url, "https://www.leboncoin.fr/recherche?category=9&locations=Fort-de-France_97200__14.60370_-61.07310_1000&real_estate_type=2");
  assert.equal(par.leboncoin.precision, "rayon 1 km");
  assert.equal(par.bienici.url, "https://www.bienici.com/recherche/achat/fort-de-france-97200/appartement");
  assert.match(par.seloger.url, /^https:\/\/www\.google\.com\/search\?q=site%3Aseloger\.com/);
  assert.equal(par.seloger.precision, "recherche web");
  // Sans position du bien : Leboncoin sur la commune.
  const sans = AV._veilleLiens({ commune: "Le François", code_postal: "97240", type_bien: "Maison" });
  assert.equal(sans.find((l) => l.id === "leboncoin").url, "https://www.leboncoin.fr/cl/ventes_immobilieres/cp_le-francois_97240/real_estate_type:1");
});
