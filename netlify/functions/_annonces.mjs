// Veille annonces (mode SANS IA) — Brave Search API. Depuis la v1.15, les annonces sont lues dans
// les résultats du moteur (voir « Recherche par les résultats du moteur » plus bas) : les portails
// refusent la lecture automatique de leurs pages. L'extraction JSON-LD / og: reste pour une page fournie.
// Aucune image ni texte complet stocké : uniquement données factuelles + URL source.
// Garde-fous : robots.txt, 1 req/s/domaine, User-Agent identifié, erreurs silencieuses.
import crypto from "node:crypto";

const UA = "OPTIMMO-DOM-Veille/1.0 (+avis de valeur)";
const FETCH_MS = 9000;            // certaines pages portails sont lentes ; < 26 s au total via MAX_FETCH
const MAX_FETCH = 12;             // pages max récupérées (temps) — mode synchrone < 26 s
const TARGET_ITEMS = 10;          // objectif d'annonces exploitables (variable ; on s'arrête dès atteint)

// Portails immobiliers, par ordre de PRIORITÉ (les « stars » d'abord, puis DOM, puis élargissement).
// Extensible : ajouter ici les domaines fournis par l'utilisateur (diffusion de ses biens).
const PORTAILS = [
  "seloger.com", "leboncoin.fr", "bienici.com", "logic-immo.com", "pap.fr",
  "immobilier.lefigaro.fr", "avendrealouer.fr", "paruvendu.fr", "ouestfrance-immo.com",
  "explorimmo.com", "superimmo.com", "green-acres.fr", "bellesdemeures.com",
  "lux-residence.com", "properstar.fr", "immobilier.notaires.fr", "figaro-immobilier.fr",
  // DOM / Antilles / Saint-Barth
  "cyphoma.com", "stbarthimmo.com", "immo972.com", "immodom.com", "karib-immo.com", "domimmo.com",
];
const PORTAIL_SET = new Set(PORTAILS);
// Domaine appartenant à un portail (gère sous-domaines : www déjà retiré par host()).
function estPortail(u) { const h = host(u); return PORTAIL_SET.has(h) || PORTAILS.some((p) => h === p || h.endsWith("." + p)); }
// Rang de priorité (plus petit = plus prioritaire ; 999 = hors liste).
function rangPortail(u) { const h = host(u); let best = 999; PORTAILS.forEach((p, i) => { if ((h === p || h.endsWith("." + p)) && i < best) best = i; }); return best; }

// URL de FICHE d'annonce (vs page d'accueil / catégorie de portail).
// Heuristique : chemin ≥ 2 segments ET (identifiant chiffré long OU mot-clé de fiche).
function estFicheAnnonce(u) {
  let path = "";
  try { path = new URL(u).pathname || "/"; } catch { return false; }
  const segs = path.split("/").filter(Boolean);
  if (segs.length < 2) return false;                                  // "/" ou "/categorie/" = pas une fiche
  const hasId = /\d{5,}/.test(path) || segs.some((s) => /\d{5,}/.test(s));
  const kw = /(annonce|detail|bien|propriet|property|a-vendre|\/vente[s]?\/|listing|ref[-_=]|\/ad\/|offre)/i.test(path);
  return hasId || kw;
}

export function sha1(s) { return crypto.createHash("sha1").update(String(s)).digest("hex"); }

async function fetchTimeout(url, ms = FETCH_MS, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "fr", ...(opts.headers || {}) }, ...opts }); }
  finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/[^\d.,]/g, "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : null; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// ── Brave Search ───────────────────────────────────────────────────────────
async function braveSearch(query, key, count = 8) {
  const url = "https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(query) + "&count=" + count + "&country=fr&search_lang=fr";
  try {
    const r = await fetchTimeout(url, 10000, { headers: { "X-Subscription-Token": key, "Accept": "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.web?.results || []).map((x) => ({ url: x.url, title: x.title, desc: x.description }));
  } catch { return []; }
}

// ── robots.txt (mémoïsé par domaine) ─────────────────────────────────────────
const robotsCache = {};
async function allowedByRobots(u) {
  const h = host(u); if (!h) return false;
  if (robotsCache[h] === undefined) {
    try {
      const r = await fetchTimeout("https://" + h + "/robots.txt", 6000);
      robotsCache[h] = r.ok ? await r.text() : "";
    } catch { robotsCache[h] = ""; }
  }
  const txt = robotsCache[h] || "";
  // Analyse simple : blocs User-agent: * et OPTIMMO — Disallow: / => interdit.
  const path = (() => { try { return new URL(u).pathname || "/"; } catch { return "/"; } })();
  const lines = txt.split(/\r?\n/).map((l) => l.trim());
  let applies = false, disallows = [];
  for (const l of lines) {
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") applies = (v === "*" || /optimmo/i.test(v));
    else if (k === "disallow" && applies) disallows.push(v);
  }
  return !disallows.some((d) => d && path.startsWith(d));
}

// ── Extraction depuis une page HTML ──────────────────────────────────────────
function pickJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      (Array.isArray(parsed) ? parsed : [parsed]).forEach((o) => { if (o && o["@graph"]) out.push(...o["@graph"]); else out.push(o); });
    } catch { /* ignore */ }
  }
  return out.filter(Boolean);
}
function ogTags(html) {
  const o = {};
  const re = /<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi;
  let m; while ((m = re.exec(html))) o[m[1].toLowerCase()] = m[2];
  return o;
}
function extractFromHtml(url, html, desc) {
  const REAL = ["RealEstateListing", "Offer", "Product", "SingleFamilyResidence", "House", "Residence", "Apartment", "Accommodation"];
  const ld = pickJsonLd(html);
  const og = ogTags(html);
  let prix = null, surfaceHab = null, surfaceTerrain = null, chambres = null, pieces = null, type = null, titre = og["og:title"] || "";
  for (const o of ld) {
    const t = [].concat(o["@type"] || []).join(",");
    if (!REAL.some((x) => t.includes(x))) continue;
    const offer = o.offers || o;
    prix = prix || num(offer.price || offer.lowPrice || o.price);
    surfaceHab = surfaceHab || num((o.floorSize && (o.floorSize.value || o.floorSize)) || o.livingArea);
    chambres = chambres || num(o.numberOfBedrooms || o.numberOfRooms);
    pieces = pieces || num(o.numberOfRooms);
    type = type || o["@type"];
  }
  const body = (og["og:description"] || desc || "") + " " + titre + " " + html.replace(/<[^>]+>/g, " ").slice(0, 6000);
  // Regex de repli (prix, surface habitable, terrain, chambres, piscine, vue).
  if (prix == null) { const m = body.match(/([\d][\d\s.,]{3,})\s*(?:€|EUR)/i); if (m) prix = num(m[1]); }
  if (surfaceHab == null) { const m = body.match(/(\d[\d\s.,]{0,6})\s*m²(?!\s*(?:de\s*)?terrain)/i); if (m) surfaceHab = num(m[1]); }
  if (surfaceTerrain == null) { const m = body.match(/terrain[^\d]{0,15}(\d[\d\s.,]{1,7})\s*m²/i) || body.match(/(\d[\d\s.,]{2,7})\s*m²\s*de\s*terrain/i); if (m) surfaceTerrain = num(m[1]); }
  if (chambres == null) { const m = body.match(/(\d{1,2})\s*chambres?/i); if (m) chambres = num(m[1]); }
  const piscine = /piscine/i.test(body);
  const vue_mer = /vue\s*mer|sea\s*view|ocean\s*view/i.test(body);
  const pieds_dans_eau = /pieds?\s*dans\s*l['’ ]?eau|beachfront|bord\s*de\s*mer/i.test(body);
  const estTerrain = /terrain\s*(?:à\s*b[âa]tir|constructible)/i.test(body) || (surfaceTerrain && !surfaceHab);
  return {
    id: sha1(url), nature: estTerrain ? "terrain" : "annonce", source: host(url), agence: null, url,
    date_releve: new Date().toISOString().slice(0, 10),
    type: type || (estTerrain ? "terrain" : "bien"),
    prix, prix_mode: "inconnu",
    surface_hab: surfaceHab, surface_terrain: surfaceTerrain, shon_autorisee: null,
    chambres, pieces, piscine, vue_mer, pieds_dans_eau, annee_construction: null,
    prix_m2: (prix && surfaceHab) ? Math.round(prix / surfaceHab) : null,
    prix_m2_terrain: (estTerrain && prix && surfaceTerrain) ? Math.round(prix / surfaceTerrain) : null,
    description_courte: (og["og:description"] || desc || "").slice(0, 220),
    confiance: ld.length ? 0.8 : 0.5,
  };
}

// ── Post-traitement ──────────────────────────────────────────────────────────
export { dedup, similarite, estBienSujet, stats, extractFromHtml, pickJsonLd };
// Normalise une URL pour comparer (retire protocole, www, query, slash final).
function urlKey(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/+$/, "").toLowerCase(); }
  catch { return String(u || "").toLowerCase(); }
}
function dedup(items) {
  const out = []; const urlSeen = new Set();
  for (const a of items) {
    // Une page de résultats de portail porte plusieurs annonces : la clé ajoute alors prix et surface.
    const uk = urlKey(a.url) + (a.page_resultats ? "|" + (a.prix || "") + "|" + (a.surface_hab || a.surface_terrain || "") : "");
    if (uk && urlSeen.has(uk)) continue;            // même annonce (URL identique) → doublon
    const dup = out.find((b) =>
      (a.prix && b.prix && a.source === b.source && Math.abs(a.prix - b.prix) / a.prix < 0.001) ||
      (a.surface_terrain && b.surface_terrain && Math.abs(a.surface_terrain - b.surface_terrain) / a.surface_terrain <= 0.02 &&
        a.quartier && a.quartier === b.quartier && a.prix && b.prix && Math.abs(a.prix - b.prix) / a.prix <= 0.10) ||
      // même bien multi-diffusé : prix identique + même surface (hab ou terrain), sources différentes
      (a.prix && b.prix && Math.abs(a.prix - b.prix) / a.prix < 0.005 &&
        ((a.surface_hab && b.surface_hab && Math.abs(a.surface_hab - b.surface_hab) <= 2) ||
         (a.surface_terrain && b.surface_terrain && Math.abs(a.surface_terrain - b.surface_terrain) <= 5))));
    if (!dup) { out.push(a); if (uk) urlSeen.add(uk); }
  }
  return out;
}
function similarite(a, c) {
  let s = 0;
  const eS = (x, y) => (x && y) ? Math.max(0, 1 - Math.abs(x - y) / y) : 0.5;
  s += 30 * eS(a.surface_hab, c.surface_hab);
  s += 20 * eS(a.surface_terrain, c.surface_terrain);
  s += 15 * ((a.quartier && c.quartier && a.quartier === c.quartier) ? 1 : (a.commune === c.commune ? 0.6 : 0.3));
  s += 10 * ((a.piscine === c.piscine) ? 1 : 0.4);
  s += 10 * ((a.vue_mer === c.vue_mer) ? 1 : 0.5);
  s += 8 * ((a.chambres && c.chambres) ? Math.max(0, 1 - Math.abs(a.chambres - c.chambres) / Math.max(c.chambres, 1)) : 0.5);
  s += 7 * ((a.prix && c.budget_indicatif) ? Math.max(0, 1 - Math.abs(a.prix - c.budget_indicatif) / c.budget_indicatif) : 0.5);
  return Math.round(s);
}
function estBienSujet(a, c) {
  if (!c.surface_terrain || !a.surface_terrain) return false;
  const terrainProche = Math.abs(a.surface_terrain - c.surface_terrain) / c.surface_terrain <= 0.03;
  const memeQuartier = a.quartier && c.quartier && a.quartier === c.quartier;
  const surfProche = c.surface_hab && a.surface_hab && Math.abs(a.surface_hab - c.surface_hab) / c.surface_hab <= 0.10;
  return terrainProche && memeQuartier && (surfProche || (a.shon_autorisee && a.shon_autorisee === c.shon_autorisee));
}
function stats(items, key) {
  const vals = items.map((x) => x[key]).filter((v) => v > 0).sort((a, b) => a - b);
  if (!vals.length) return null;
  const med = vals[Math.floor(vals.length / 2)];
  const moy = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  return { min: vals[0], mediane: med, moyenne: moy, max: vals[vals.length - 1], n: vals.length };
}

// Garde-fou anti-extraction aberrante (pages d'accueil, agrégats de chiffres parasites).
function plausible(a) {
  if (a.prix != null && (a.prix < 1000 || a.prix > 200000000)) return false;         // < 1 k€ ou > 200 M€
  if (a.surface_hab != null && (a.surface_hab < 5 || a.surface_hab > 3000)) return false;
  if (a.surface_terrain != null && (a.surface_terrain < 10 || a.surface_terrain > 500000)) return false;
  if (a.prix_m2 != null && a.prix_m2 > 200000) return false;                          // > 200 k€/m² = erreur
  if (a.prix_m2_terrain != null && a.prix_m2_terrain > 300000) return false;
  if (a.chambres != null && a.chambres > 30) return false;
  return true;
}

// ── Recherche par les résultats du moteur (v1.15) ───────────────────────────────
// Constat : les grands portails (SeLoger, Leboncoin, Bien'ici…) refusent la lecture
// automatique de leurs pages ; l'ancienne recherche, qui ouvrait chaque fiche, ne
// ramenait donc rien. Les annonces sont désormais lues dans les RÉSULTATS du moteur de
// recherche (titre + extrait), où les portails publient déjà type, surface et prix.
// Aucune page de portail n'est ouverte. Limite assumée : l'extrait est court, la liste
// n'est pas exhaustive, et le lien mène à la page de résultats du portail, pas à la fiche.

export const PORTAILS_CHOIX = [
  { id: "leboncoin", nom: "Leboncoin", domaine: "leboncoin.fr" },
  { id: "seloger", nom: "SeLoger", domaine: "seloger.com" },
  { id: "bienici", nom: "Bien'ici", domaine: "bienici.com" },
  { id: "logicimmo", nom: "Logic-Immo", domaine: "logic-immo.com" },
  { id: "pap", nom: "PAP", domaine: "pap.fr" },
  { id: "figaro", nom: "Figaro Immo", domaine: "immobilier.lefigaro.fr" },
  { id: "domimmo", nom: "DomImmo", domaine: "domimmo.com" },
];
const PORTAILS_DEFAUT = ["leboncoin", "seloger", "bienici", "logicimmo", "domimmo"];

const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cleTexte = (s) => sansAccent(s).replace(/[^a-z0-9]+/g, " ").trim();

// Famille de bien recherchée, à partir du type saisi dans l'avis.
export function familleBien(type) {
  const t = sansAccent(type);
  if (/terrain/.test(t)) return "terrain";
  if (/appart|studio|duplex|loft/.test(t)) return "appartement";
  if (/maison|villa|pavillon/.test(t)) return "maison";
  if (/immeuble/.test(t)) return "immeuble";
  if (/local|commerce|bureau/.test(t)) return "local";
  return "bien";
}
function familleMot(mot) {
  const m = sansAccent(mot);
  if (/terrain/.test(m)) return "terrain";
  if (/appart|studio|duplex|loft|^t\d|^f\d/.test(m)) return "appartement";
  if (/maison|villa|pavillon/.test(m)) return "maison";
  if (/immeuble/.test(m)) return "immeuble";
  if (/local|commerce|bureau|fonds/.test(m)) return "local";
  return "";
}

// Distance en mètres entre deux points (lat, lon en degrés).
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Quartiers et lieux-dits habités autour du bien (IGN, BD TOPO, sans clé).
// Retourne [{ nom, distance_m }] du plus proche au plus lointain ; [] si indisponible.
export async function quartiersProches(lat, lon, rayonM = 1000) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon) || (!lat && !lon)) return [];
  const dLat = rayonM / 111320, dLon = rayonM / (111320 * Math.cos(lat * Math.PI / 180));
  // BBOX en CRS84 : longitude d'abord.
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(6)).join(",");
  const url = "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:zone_d_habitation" +
    "&OUTPUTFORMAT=application/json&COUNT=80&SRSNAME=EPSG:4326&BBOX=" + bbox + ",urn:ogc:def:crs:OGC:1.3:CRS84";
  let j;
  try {
    const r = await fetchTimeout(url, 6000);
    if (!r.ok) return [];
    j = await r.json();
  } catch { return []; }
  const vus = new Set(), out = [];
  for (const f of (j && j.features) || []) {
    const p = f.properties || {}, nom = String(p.toponyme || "").trim();
    // « fictif » = contour approximatif autour du nom (cas courant outre-mer) : le nom reste valable.
    if (!nom) continue;
    // Les résidences et immeubles nommés ne sont pas des quartiers.
    if (/^(r[ée]sidence|imm\.?|immeuble|tour|cit[ée]|lotissement|b[âa]t)\b/i.test(nom)) continue;
    const k = cleTexte(nom);
    if (!k || vus.has(k)) continue;
    // Point le plus proche du contour : un quartier qui touche le rayon compte.
    let dMin = Infinity;
    // L'ordre des coordonnées dépend du service (lon,lat ou lat,lon) : les deux lectures sont essayées,
    // la mauvaise donne un point à des milliers de kilomètres.
    const parcourir = (c) => {
      if (typeof c[0] === "number") { const d = Math.min(distanceM(lat, lon, c[1], c[0]), distanceM(lat, lon, c[0], c[1])); if (d < dMin) dMin = d; }
      else c.forEach(parcourir);
    };
    try { parcourir((f.geometry && f.geometry.coordinates) || []); } catch { /* géométrie illisible */ }
    if (dMin > rayonM) continue;
    vus.add(k);
    out.push({ nom, distance_m: Math.round(dMin), importance: Number(p.importance) || 9 });
  }
  return out.sort((a, b) => a.distance_m - b.distance_m || a.importance - b.importance).slice(0, 12)
    .map(({ nom, distance_m }) => ({ nom, distance_m }));
}

// ── Lecture d'un résultat de recherche ────────────────────────────────────────
const RE_PRIX = /(\d{1,3}(?:[   .]\d{3})+|\d{5,8})\s*(?:€|euros?\b|EUR\b)(?!\s*(?:\/|par)\s*(?:m|mois))/gi;
// Surface : « 75 », « 87,2 » ou, pour un terrain, « 1 200 » (milliers séparés par une espace).
const RE_SURF = /(\d{1,3}(?:[   ]\d{3})+|\d{1,5}(?:[.,]\d{1,2})?)\s*(?:m²|m2\b|m²|mètres?\s*carrés?)/gi;
const RE_TYPE = /\b(appartements?|maisons?|villas?|studios?|duplex|lofts?|terrains?|immeubles?|pavillons?|locaux|local|fonds de commerce|[TF][1-7])\b/gi;
const RE_LOCATION = /\b(location|locations|à louer|a louer|louer|loyer|colocation)\b|\/mois|par mois|€\s*cc\b/i;

// Page de résultats d'un portail (liste d'annonces), par opposition à la fiche d'une annonce.
function estPageDeResultats(u) {
  let p = ""; try { p = new URL(u).pathname + new URL(u).search; } catch { return true; }
  if (/\/(annonce|annonces-immobilieres|ad|detail|fiche)\/[^/]+/i.test(p) && !/\/(recherche|search)\//i.test(p)) return false;
  return true;
}

function tous(re, texte) {
  const out = []; re.lastIndex = 0; let m;
  while ((m = re.exec(texte))) out.push({ i: m.index, fin: m.index + m[0].length, brut: m[0], v: m[1] });
  return out;
}

// Annonces lisibles dans un résultat { url, title, desc }. ctx : { famille, commune, cp, quartiers:[noms] }.
export function annoncesDuResultat(r, ctx = {}) {
  const url = r.url || "", titre = String(r.title || ""), desc = String(r.desc || r.description || "");
  // Une page de location ne donne pas de prix de vente.
  if (RE_LOCATION.test(titre) || /\/(location|locations|louer)\b/i.test(url)) return [];
  const texte = (titre + " · " + desc).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const prix = tous(RE_PRIX, texte).map((p) => ({ ...p, n: num(p.v.replace(/[   .]/g, "")) })).filter((p) => p.n >= 10000 && p.n <= 200000000)
    // Leboncoin répète le prix (« 115 000 € Prix: 115 000 € ») : une seule mention est gardée.
    .filter((p, k, l) => !(k > 0 && l[k - 1].n === p.n && p.i - l[k - 1].fin <= 25));
  const surfs = tous(RE_SURF, texte).map((s) => ({ ...s, n: num(s.v) })).filter((s) => s.n >= 8 && s.n <= 500000);
  const types = tous(RE_TYPE, texte);
  const pieces = tous(/(\d{1,2})\s*(?:pièces?|p\b)/gi, texte);
  const familleCible = ctx.famille || "bien";
  const cleCommune = cleTexte(ctx.commune), cp = String(ctx.cp || "");
  const cleGlobale = cleTexte(texte + " " + url);
  // Le résultat doit parler de la commune du bien (nom ou code postal).
  const surCommune = (cleCommune && cleGlobale.includes(cleCommune)) || (cp && cleGlobale.includes(cp));
  if ((cleCommune || cp) && !surCommune) return [];

  const out = [], prisSurf = new Set(), vus = new Set();
  for (const p of prix) {
    // Surface la plus proche du prix (avant ou après), à 90 caractères au plus, non encore utilisée.
    let best = null, bd = 91;
    surfs.forEach((s, k) => {
      if (prisSurf.has(k)) return;
      const d = s.i >= p.fin ? s.i - p.fin : p.i - s.fin;
      if (d >= 0 && d < bd) { bd = d; best = k; }
    });
    if (best == null) continue;
    const s = surfs[best];
    const debut = Math.min(p.i, s.i), fin = Math.max(p.fin, s.fin);
    // Type : le mot de type qui précède de plus près (120 caractères), sinon celui du titre.
    // Type : le mot écrit entre le prix et la surface s'il y en a un (« 168 270 € Prix: Maison, 163 m² »),
    // sinon celui qui précède de plus près.
    let mot = "";
    for (const t of types) { if (t.i > debut + 2 && t.fin <= fin) mot = t.brut; }
    if (!mot) for (const t of types) { if (t.i <= debut + 2 && debut - t.i <= 120) mot = t.brut; }
    if (!mot) { const t0 = tous(RE_TYPE, titre)[0]; if (t0) mot = t0.brut; }
    const fam = familleMot(mot) || (familleCible !== "bien" ? "" : "bien");
    const autour = texte.slice(Math.max(0, debut - 60), Math.min(texte.length, fin + 80));
    const estTerrain = fam === "terrain" || /surface du terrain|terrain de/i.test(texte.slice(Math.max(0, s.i - 30), s.fin + 25));
    const famille = estTerrain ? "terrain" : (fam || "bien");
    // Autre commune citée juste après l'annonce (page départementale) : hors sujet.
    // Les portails écrivent le lieu dans l'annonce ou juste après : lecture de son début à 70 caractères après sa fin.
    const zoneLieu = texte.slice(debut, Math.min(texte.length, fin + 70));
    const cpProche = (zoneLieu.match(/\b\d{5}\b(?! ?€)/g) || []).filter((c) => /^(0[1-9]|[1-8]\d|9[0-5]|97|98)\d{3}$/.test(c));
    if (cp && cpProche.length && !cpProche.includes(cp)) continue;
    if (familleCible !== "bien" && famille !== "bien" && famille !== familleCible) continue;
    const m2 = Math.round(p.n / s.n);
    if (famille === "terrain" ? (m2 < 2 || m2 > 6000) : (m2 < 300 || m2 > 40000)) continue;
    const cle = p.n + "|" + s.n;
    if (vus.has(cle)) continue;
    vus.add(cle); prisSurf.add(best);
    let nbPieces = null;
    // Nombre de pièces : la mention la plus proche de l'annonce (60 caractères avant, 40 après).
    let dp = Infinity;
    for (const pc of pieces) {
      const d = pc.fin <= debut ? debut - pc.fin : (pc.i >= fin ? pc.i - fin : 0);
      if ((pc.fin <= debut ? d <= 60 : d <= 40) && d < dp) { dp = d; nbPieces = num(pc.v); }
    }
    // Quartier cité près de l'annonce (ou dans le résultat s'il n'en contient qu'une).
    let quartier = "";
    const cleAutour = cleTexte(autour);
    for (const q of ctx.quartiers || []) { const kq = cleTexte(q); if (kq.length >= 4 && cleAutour.includes(kq)) { quartier = q; break; } }
    out.push({
      id: sha1(url + "|" + cle), nature: famille === "terrain" ? "terrain" : "annonce", source: host(url), agence: null, url,
      date_releve: new Date().toISOString().slice(0, 10),
      type: mot ? mot.charAt(0).toUpperCase() + mot.slice(1).toLowerCase() : (famille === "terrain" ? "Terrain" : "Bien"),
      prix: p.n, prix_mode: "affiché",
      surface_hab: famille === "terrain" ? null : s.n, surface_terrain: famille === "terrain" ? s.n : null, shon_autorisee: null,
      chambres: null, pieces: nbPieces, piscine: /piscine/i.test(autour), vue_mer: /vue\s*mer/i.test(autour), pieds_dans_eau: false,
      annee_construction: null,
      neuf: /\b(neuf|neuve|programme|vefa|sur plan|livraison)\b/i.test(autour),
      prix_m2: famille === "terrain" ? null : m2, prix_m2_terrain: famille === "terrain" ? m2 : null,
      description_courte: autour.trim().slice(0, 200),
      quartier, proche: !!quartier, page_resultats: estPageDeResultats(url), confiance: 0.6,
    });
  }
  if (out.length > 1) return out;
  // Résultat ne contenant qu'une annonce : le quartier peut être cité n'importe où dans l'extrait.
  if (out.length === 1 && !out[0].quartier) {
    for (const q of ctx.quartiers || []) { const kq = cleTexte(q); if (kq.length >= 4 && cleGlobale.includes(kq)) { out[0].quartier = q; out[0].proche = true; break; } }
  }
  return out;
}

// Recherche Brave avec état : { ok, statut, resultats }. Le palier gratuit limite à 1 requête par seconde.
async function braveRecherche(query, key) {
  const url = "https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(query) + "&count=20&country=fr&search_lang=fr";
  for (let essai = 0; essai < 2; essai++) {
    try {
      const r = await fetchTimeout(url, 9000, { headers: { "X-Subscription-Token": key, "Accept": "application/json" } });
      if (r.status === 429 && essai === 0) { await sleep(1300); continue; }
      if (!r.ok) return { ok: false, statut: r.status, resultats: [] };
      const j = await r.json();
      return { ok: true, statut: 200, resultats: ((j.web && j.web.results) || []).map((x) => ({ url: x.url, title: x.title, desc: [x.description].concat(x.extra_snippets || []).filter(Boolean).join(" · ") })) };
    } catch { return { ok: false, statut: 0, resultats: [] }; }
  }
  return { ok: false, statut: 429, resultats: [] };
}

const MOT_RECHERCHE = { appartement: "appartement", maison: "maison", terrain: "terrain", immeuble: "immeuble", local: "local commercial", bien: "immobilier" };

// ── Point d'entrée ────────────────────────────────────────────────────────────
export async function rechercherAnnonces(criteres) {
  const key = process.env.SEARCH_API_KEY || "";
  if (!key) return { statut: "indisponible", raison: "SEARCH_API_KEY absente (Brave Search).", comparables: [], terrains: [], bien_sujet_expose: [], stats: {} };

  const commune = String(criteres.commune || "").trim();
  const cp = String(criteres.code_postal || "").trim();
  const famille = criteres.inclure_terrains && !criteres.surface_hab ? "terrain" : familleBien(criteres.type_bien || "maison");
  const mot = MOT_RECHERCHE[famille] || "immobilier";
  const rayon = Math.min(5000, Math.max(300, Number(criteres.rayon_m) || 1000));
  const choisis = (Array.isArray(criteres.portails) && criteres.portails.length ? criteres.portails : PORTAILS_DEFAUT)
    .map((id) => PORTAILS_CHOIX.find((p) => p.id === id)).filter(Boolean).slice(0, 6);
  const debut = Date.now();

  // 1) Quartiers dans le rayon (au mieux ; la recherche continue sans eux).
  const quartiers = await quartiersProches(criteres.lat, criteres.lon, rayon);
  const nomsQuartiers = quartiers.map((q) => q.nom).filter((n) => cleTexte(n) !== cleTexte(commune));
  if (criteres.quartier && !nomsQuartiers.some((n) => cleTexte(n) === cleTexte(criteres.quartier))) nomsQuartiers.unshift(String(criteres.quartier));

  // 2) Requêtes : une par portail choisi, puis jusqu'à deux par quartier proche.
  const lieu = [commune, cp].filter(Boolean).join(" ");
  const requetes = choisis.map((p) => ({ q: `site:${p.domaine} ${mot} vente ${lieu}`.trim(), portail: p.id }));
  nomsQuartiers.slice(0, 2).forEach((q) => requetes.push({ q: `${mot} à vendre "${q}" ${commune}`.trim(), portail: "" }));

  const diag = { requetes: 0, resultats: 0, refus: {}, portails: {}, duree_ms: 0 };
  const ctx = { famille, commune, cp, quartiers: nomsQuartiers };
  const items = [], urls = new Set();
  let dernier = 0;
  for (const rq of requetes) {
    if (Date.now() - debut > 19000) break;                 // la fonction doit répondre avant 26 s
    const attente = 1100 - (Date.now() - dernier);
    if (attente > 0 && dernier) await sleep(attente);
    dernier = Date.now();
    const br = await braveRecherche(rq.q, key);
    diag.requetes++;
    if (!br.ok) { diag.refus[br.statut] = (diag.refus[br.statut] || 0) + 1; continue; }
    for (const r of br.resultats) {
      if (!r.url || urls.has(r.url)) continue;
      urls.add(r.url); diag.resultats++;
      for (const a of annoncesDuResultat(r, ctx)) {
        a.commune = commune;
        a.portail = estPortail(r.url);
        if (plausible(a)) { items.push(a); diag.portails[a.source] = (diag.portails[a.source] || 0) + 1; }
      }
    }
  }
  diag.duree_ms = Date.now() - debut;
  try { console.log("[veille] diag", JSON.stringify(diag)); } catch (e) { /* journal facultatif */ }

  // 3) Post-traitement : doublons, bien sujet, similarité, proches d'abord.
  const uniques = dedup(items);
  const bienSujet = [], reste = [];
  for (const a of uniques) (estBienSujet(a, criteres) ? bienSujet : reste).push(a);
  reste.forEach((a) => {
    a.similarite = similarite(a, criteres);
    a.hors_cible = !!(criteres.budget_indicatif && a.prix && a.prix > 3 * criteres.budget_indicatif);
  });
  reste.sort((x, y) => (Number(y.proche) - Number(x.proche)) || ((y.similarite || 0) - (x.similarite || 0)));
  const comparables = reste.filter((a) => a.nature === "annonce");
  const terrains = reste.filter((a) => a.nature === "terrain");
  bienSujet.forEach((a) => { a.est_bien_sujet = true; });

  // Motif en clair quand rien ne sort.
  let motif = "";
  if (!uniques.length) {
    if (diag.refus[429]) motif = "Le service de recherche a atteint sa limite de requêtes. Réessayez dans une minute.";
    else if (diag.refus[401] || diag.refus[403]) motif = "La clé du service de recherche est refusée (SEARCH_API_KEY à vérifier dans Netlify).";
    else if (!diag.resultats) motif = "Le moteur de recherche n'a renvoyé aucun résultat pour cette commune.";
    else motif = "Les résultats trouvés ne contenaient pas de prix et de surface lisibles pour ce type de bien.";
  }

  return {
    statut: "termine",
    comparables, terrains, bien_sujet_expose: bienSujet,
    stats: {
      prix_m2: stats(comparables.filter((a) => !a.hors_cible), "prix_m2"),
      prix_m2_terrain: stats(terrains, "prix_m2_terrain"),
      nb_comparables: comparables.length, nb_terrains: terrains.length,
      nb_proches: uniques.filter((a) => a.proche).length,
      nb_portails: uniques.filter((a) => a.portail).length,
      nb_elargissement: uniques.filter((a) => !a.portail).length,
    },
    quartiers, rayon_m: rayon, portails: choisis.map((p) => p.id), motif, diag,
    criteres, genere_le: new Date().toISOString(),
  };
}
