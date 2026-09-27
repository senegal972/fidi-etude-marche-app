// Veille annonces (mode SANS IA) — Brave Search API + extraction JSON-LD / og: / regex.
// Aucune image ni texte complet stocké : uniquement données factuelles + URL source.
// Garde-fous : robots.txt, 1 req/s/domaine, User-Agent identifié, erreurs silencieuses.
import crypto from "node:crypto";

const UA = "OPTIMMO-DOM-Veille/1.0 (+avis de valeur)";
const FETCH_MS = 12000;
const MAX_URLS = 14;              // borne de sécurité (temps + volume)

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
function dedup(items) {
  const out = [];
  for (const a of items) {
    const dup = out.find((b) =>
      (a.prix && b.prix && a.source === b.source && Math.abs(a.prix - b.prix) / a.prix < 0.001) ||
      (a.surface_terrain && b.surface_terrain && Math.abs(a.surface_terrain - b.surface_terrain) / a.surface_terrain <= 0.02 &&
        a.quartier && a.quartier === b.quartier && a.prix && b.prix && Math.abs(a.prix - b.prix) / a.prix <= 0.10));
    if (!dup) out.push(a);
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

// ── Point d'entrée ────────────────────────────────────────────────────────────
export async function rechercherAnnonces(criteres) {
  const key = process.env.SEARCH_API_KEY || "";
  if (!key) return { statut: "indisponible", raison: "SEARCH_API_KEY absente (Brave Search).", comparables: [], terrains: [], bien_sujet_expose: [], stats: {} };

  const commune = criteres.commune || "";
  const quartier = criteres.quartier || "";
  const type = criteres.type_bien || "maison";
  const requetes = [
    `${type} à vendre ${quartier} ${commune}`.trim(),
    `villa ${quartier} ${commune} à vendre`.trim(),
    `${commune} ${quartier} immobilier prix vente`.trim(),
    ...(criteres.inclure_terrains ? [`terrain constructible ${quartier} ${commune} à vendre`.trim()] : []),
  ];

  // 1) Récupère les URLs via Brave (dédupliquées).
  const seen = new Set(); const urls = [];
  for (const q of requetes) {
    for (const r of await braveSearch(q, key, 8)) {
      if (r.url && !seen.has(r.url)) { seen.add(r.url); urls.push(r); }
      if (urls.length >= MAX_URLS) break;
    }
    if (urls.length >= MAX_URLS) break;
  }

  // 2) Fetch + extraction, en respectant robots.txt et 1 req/s/domaine.
  const items = []; const lastHit = {};
  for (const r of urls.slice(0, MAX_URLS)) {
    try {
      if (!(await allowedByRobots(r.url))) continue;
      const h = host(r.url);
      const wait = 1000 - (Date.now() - (lastHit[h] || 0));
      if (wait > 0) await sleep(wait);
      lastHit[h] = Date.now();
      const resp = await fetchTimeout(r.url);
      if (!resp.ok) continue;
      const ct = resp.headers.get("content-type") || "";
      if (!/html/i.test(ct)) continue;
      const html = await resp.text();
      const a = extractFromHtml(r.url, html, r.desc);
      a.commune = commune; a.quartier = quartier;
      if (a.prix || a.surface_hab || a.surface_terrain) items.push(a);
    } catch { /* source KO ignorée */ }
  }

  // 3) Post-traitement.
  const uniques = dedup(items);
  const bienSujet = []; const reste = [];
  for (const a of uniques) { (estBienSujet(a, criteres) ? bienSujet : reste).push(a); }
  reste.forEach((a) => {
    a.similarite = similarite(a, criteres);
    a.hors_cible = !!(a.pieds_dans_eau || (criteres.budget_indicatif && a.prix && a.prix > 3 * criteres.budget_indicatif));
  });
  reste.sort((x, y) => (y.similarite || 0) - (x.similarite || 0));
  const comparables = reste.filter((a) => a.nature === "annonce");
  const terrains = reste.filter((a) => a.nature === "terrain");
  bienSujet.forEach((a) => { a.est_bien_sujet = true; });

  return {
    statut: "termine",
    comparables, terrains, bien_sujet_expose: bienSujet,
    stats: {
      prix_m2: stats(comparables.filter((a) => !a.hors_cible), "prix_m2"),
      prix_m2_terrain: stats(terrains, "prix_m2_terrain"),
      nb_comparables: comparables.length, nb_terrains: terrains.length,
    },
    criteres, genere_le: new Date().toISOString(),
  };
}
