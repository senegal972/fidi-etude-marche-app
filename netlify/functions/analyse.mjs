// Netlify Function — Analyse principale FIDI
// POST /api/analyse
// Body JSON : { adresse, type_bien, surface, perimetre }

import { cacheGet, cacheSet, cacheTag } from "./_cache.mjs";
import { cleanMutations } from "./_dvf.mjs";
import { currentUser, paywallOn, loginRequired, costEtude, setCredits } from "./_auth.mjs";

const TIMEOUT_MS = 8000;
const DVF_YEARS_KEEP = [2021, 2022, 2023, 2024, 2025];
const SECTION_BATCH  = 5;

const BAN_URL          = "https://api-adresse.data.gouv.fr/search/";
const GEO_COMMUNES     = "https://geo.api.gouv.fr/communes";
const IGN_DIVISION_URL = "https://apicarto.ign.fr/api/cadastre/division";
const CADASTRE_GEOJSON  = "https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes";
const DVF_ETALAB_BASE  = "https://app.dvf.etalab.gouv.fr/api/mutations3";
const DVF_ANNEES_URL   = "https://opendata.caissedesdepots.fr/api/explore/v2.1/catalog/datasets/donnees-valeurs-foncieres-a-la-commune-annee-par-annee/records";
const DVF_PERIODES_URL = "https://opendata.caissedesdepots.fr/api/explore/v2.1/catalog/datasets/donnees-valeurs-foncieres-a-la-commune-par-periode/records";
const VALORIS_URL      = "https://www.valoris-immo.fr/api/v1/prix-median";
const DPE_URL          = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe-france/lines";
const DPE_V2_URL       = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines";
const GEORISQUES_URL   = "https://georisques.gouv.fr/api/v1";

const CORS_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function fetchTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function safeGetJson(url, params) {
  try {
    const u = new URL(url);
    if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const r = await fetchTimeout(u.toString(), TIMEOUT_MS);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function parseFloatSafe(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Champ DVF prix au m² selon le type de bien demandé
function fieldForType(typeBien) {
  const t = (typeBien || "").toLowerCase();
  if (t.includes("maison")) return "prix_m2_maison";
  if (t.includes("terrain")) return "prix_m2_terrain";
  if (t.includes("local")) return "prix_m2_local";
  return "prix_m2_appart";
}

function deptFolder(code) {
  if (code.startsWith("2A") || code.startsWith("2B")) return code.slice(0, 2);
  if (code.length >= 3 && (code.startsWith("97") || code.startsWith("98"))) return code.slice(0, 3);
  return code.slice(0, 2);
}

// Minimal CSV parser handling quoted fields
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => (row[h] = cells[j] !== undefined ? cells[j] : ""));
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function prixM2List(transactions) {
  const out = [];
  for (const t of transactions) {
    const val = parseFloatSafe(t.valeur_fonciere);
    const surf = parseFloatSafe(t.surface_reelle_bati);
    if (val && surf && surf >= 10 && val >= 5000) out.push(val / surf);
  }
  return out;
}

// Prix au m² de terrain : ventes sans bâti, sur la surface de terrain
function terrainM2List(transactions) {
  const out = [];
  for (const t of transactions) {
    const val = parseFloatSafe(t.valeur_fonciere);
    const sb = parseFloatSafe(t.surface_reelle_bati);
    const st = parseFloatSafe(t.surface_terrain);
    if (val && st && !sb && st >= 50 && val >= 1000) out.push(val / st);
  }
  return out;
}

// ─── Géocodage BAN ────────────────────────────────────────────────────────────
async function geocodeAdresse(adresse) {
  const data = await safeGetJson(BAN_URL, { q: adresse, limit: 1 });
  if (!data || !data.features || !data.features.length) return null;
  const feat = data.features[0];
  const props = feat.properties;
  const [lon, lat] = feat.geometry.coordinates;
  const citycode = props.citycode || "";
  let dept = citycode.slice(0, 2);
  if ((dept === "97" || dept === "98") && citycode.length >= 3) dept = citycode.slice(0, 3);
  return {
    label: props.label,
    city: props.city,
    postcode: props.postcode,
    citycode,
    departement: dept,
    lon, lat,
    score_geo: Math.round((props.score || 0) * 1000) / 10,
    context: props.context || "",
  };
}

// Localisation fournie directement par le client (recherche cadastrale).
function geoFromDirect(body, adresse) {
  const citycode = String(body.citycode || "");
  let dept = citycode.slice(0, 2);
  if ((dept === "97" || dept === "98") && citycode.length >= 3) dept = citycode.slice(0, 3);
  return {
    label: adresse,
    city: body.city || "",
    postcode: body.postcode || "",
    citycode,
    departement: dept,
    lon: parseFloat(body.lon),
    lat: parseFloat(body.lat),
    score_geo: 100,
    context: body.context || "",
  };
}

// ─── Commune info ─────────────────────────────────────────────────────────────
async function getCommuneInfo(codeInsee) {
  return await safeGetJson(`${GEO_COMMUNES}/${codeInsee}`, {
    fields: "nom,population,codeRegion,codeDepartement,codesPostaux,superficie,centre",
  }) || {};
}

// ─── DVF via Etalab API (sections IGN + mutations3) ───────────────────────────
// files.data.gouv.fr/geo-dvf bloque les IPs Lambda (403). On utilise donc
// l'API publique app.dvf.etalab.gouv.fr en énumérant les sections cadastrales
// via cadastre.data.gouv.fr (source primaire, plus complète) avec fallback IGN.
async function _fetchSectionsCadastre(codeCommune) {
  const dept = deptFolder(codeCommune);
  const url  = `${CADASTRE_GEOJSON}/${dept}/${codeCommune}/cadastre-${codeCommune}-sections.json.gz`;
  try {
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return [];
    const decompressed = r.body.pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(decompressed).text();
    const data = JSON.parse(text);
    const set = new Set();
    for (const f of data.features || []) {
      const p = f.properties || {};
      const prefixe = String(p.prefixe || "000").padStart(3, "0");
      // cadastre.data.gouv.fr expose le code section dans .code (ex: "AB") ou .section
      const code    = String(p.code || p.section || "").padStart(2, "0");
      if (code && code !== "00") set.add(prefixe + code);
    }
    return [...set];
  } catch (e) { return []; }
}

async function _fetchSectionsIGN(codeCommune) {
  try {
    const r = await fetchTimeout(
      `${IGN_DIVISION_URL}?code_insee=${encodeURIComponent(codeCommune)}`,
      TIMEOUT_MS,
    );
    if (!r.ok) return [];
    const data = await r.json();
    const set = new Set();
    for (const f of data.features || []) {
      const p = f.properties || {};
      const prefixe = String(p.code_arr || p.prefixe || "000").padStart(3, "0");
      const section = String(p.section || "").padStart(2, "0");
      if (section) set.add(prefixe + section);
    }
    return [...set];
  } catch (e) { return []; }
}

async function getSections(codeCommune) {
  const a = await _fetchSectionsCadastre(codeCommune);
  if (a.length) return a;
  return await _fetchSectionsIGN(codeCommune);
}

async function fetchEtalabSection(codeCommune, sectionCode) {
  try {
    const r = await fetchTimeout(
      `${DVF_ETALAB_BASE}/${encodeURIComponent(codeCommune)}/${encodeURIComponent(sectionCode)}`,
      TIMEOUT_MS,
    );
    if (!r.ok) return [];
    const data = await r.json();
    return data.mutations || [];
  } catch (e) { return []; }
}

async function fetchAllMutations(codeCommune) {
  const sections = await getSections(codeCommune);
  if (!sections.length) return [];
  const all = [];
  for (let i = 0; i < sections.length; i += SECTION_BATCH) {
    const batch = sections.slice(i, i + SECTION_BATCH);
    const results = await Promise.all(
      batch.map((s) => fetchEtalabSection(codeCommune, s))
    );
    for (const rows of results) all.push(...rows);
  }
  return all;
}

async function getDvfData(codeInsee) {
  const cacheKey = cacheTag("dvf", codeInsee);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const result = await _computeDvfData(codeInsee);
  if (result && (result.dvf_annees || []).length > 0) {
    await cacheSet(cacheKey, result);
  }
  return result;
}

async function _computeDvfData(codeInsee) {
  const rawMutations = await fetchAllMutations(codeInsee);
  if (!rawMutations.length) {
    // Tentative fallback Caisse des Dépôts (dataset historique, peut être down)
    return {
      dvf_annees: await dvfAnneesFallback(codeInsee),
      dvf_periodes: await dvfPeriodesFallback(codeInsee),
    };
  }

  // Regroupe les lignes DVF par mutation (1 vente propre) puis par année.
  // Les €/m² sont déjà fiables (mono-type, total ÷ surface agrégée) côté _dvf.
  const ventesAll = cleanMutations(rawMutations)
    .filter((v) => v.year && DVF_YEARS_KEEP.includes(v.year));

  const byYear = {};
  for (const v of ventesAll) (byYear[v.year] ||= []).push(v);

  // Collecteurs d'échantillons €/m² fiables, par type
  const pm2 = (ventes, type) => ventes.filter((v) => v.type === type && v.prix_m2 != null).map((v) => v.prix_m2);
  const pm2Terrain = (ventes) => ventes.filter((v) => v.type === "Terrain" && v.prix_m2_terrain != null).map((v) => v.prix_m2_terrain);
  const pm2All = (ventes) => ventes.filter((v) => v.prix_m2 != null).map((v) => v.prix_m2);

  const annees = [];
  const yearsFound = [];
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);

  for (const year of years) {
    const ventes = byYear[year];
    const maisons = ventes.filter((v) => v.type === "Maison");
    const apparts = ventes.filter((v) => v.type === "Appartement");
    const locaux  = ventes.filter((v) => v.type === "Local");
    const terrains = ventes.filter((v) => v.type === "Terrain");
    const pmM = pm2(ventes, "Maison");
    const pmA = pm2(ventes, "Appartement");
    const pmL = pm2(ventes, "Local");
    const pmTer = pm2Terrain(ventes);
    annees.push({
      annee: year,
      nb_maison: maisons.length,
      nb_appart: apparts.length,
      nb_local: locaux.length,
      nb_terrain: terrains.length,
      nb_total: ventes.length,
      prix_m2_maison: pmM.length ? Math.round(median(pmM)) : null,
      prix_m2_appart: pmA.length ? Math.round(median(pmA)) : null,
      prix_m2_local: pmL.length ? Math.round(median(pmL)) : null,
      prix_m2_terrain: pmTer.length ? Math.round(median(pmTer)) : null,
    });
    yearsFound.push(year);
  }

  let periodes = [];
  let valorisLocal = {};
  if (yearsFound.length) {
    const nbMaison = ventesAll.filter((v) => v.type === "Maison").length;
    const nbAppart = ventesAll.filter((v) => v.type === "Appartement").length;
    const nbTerrain = ventesAll.filter((v) => v.type === "Terrain").length;
    const pmM = pm2(ventesAll, "Maison");
    const pmA = pm2(ventesAll, "Appartement");
    const pmL = pm2(ventesAll, "Local");
    const pmTer = pm2Terrain(ventesAll);
    const pmT = pm2All(ventesAll);
    periodes = [{
      periode: `${Math.min(...yearsFound)}–${Math.max(...yearsFound)}`,
      nb_maison: nbMaison,
      nb_appart: nbAppart,
      nb_terrain: nbTerrain,
      nb_total: ventesAll.length,
      prix_m2_maison: pmM.length ? Math.round(median(pmM)) : null,
      prix_m2_appart: pmA.length ? Math.round(median(pmA)) : null,
      prix_m2_local: pmL.length ? Math.round(median(pmL)) : null,
      prix_m2_terrain: pmTer.length ? Math.round(median(pmTer)) : null,
    }];
    // Médianes locales DVF (l'API valoris-immo.fr est morte)
    if (pmM.length) valorisLocal.maison      = { prix_median_m2: Math.round(median(pmM)), nb: pmM.length, source: "DVF local" };
    if (pmA.length) valorisLocal.appartement = { prix_median_m2: Math.round(median(pmA)), nb: pmA.length, source: "DVF local" };
    if (pmL.length) valorisLocal.local       = { prix_median_m2: Math.round(median(pmL)), nb: pmL.length, source: "DVF local" };
    if (pmTer.length) valorisLocal.terrain   = { prix_median_m2: Math.round(median(pmTer)), nb: pmTer.length, source: "DVF local (terrain)" };
    if (pmT.length) valorisLocal.tous        = { prix_median_m2: Math.round(median(pmT)), nb: pmT.length, source: "DVF local" };
  }

  return { dvf_annees: annees, dvf_periodes: periodes, valoris_local: valorisLocal };
}

async function dvfAnneesFallback(codeInsee) {
  const data = await safeGetJson(DVF_ANNEES_URL, {
    where: `code_commune="${codeInsee}"`, limit: 10, order_by: "annee asc",
  });
  if (!data || !data.results) return [];
  return data.results.filter((r) => pick(r, "annee", "year") !== null).map((r) => ({
    annee: parseInt(pick(r, "annee", "year")),
    nb_maison: pick(r, "nbre_mutation_maison", "nb_mutations_maison"),
    nb_appart: pick(r, "nbre_mutation_appartement", "nb_mutations_appartement"),
    nb_total: pick(r, "nbre_mutation_total", "nb_mutations_total"),
    prix_m2_maison: pick(r, "prix_m2_median_maison", "mediane_prix_m2_maison", "px_med_m2_maison"),
    prix_m2_appart: pick(r, "prix_m2_median_appartement", "mediane_prix_m2_appartement", "px_med_m2_appart"),
  }));
}

async function dvfPeriodesFallback(codeInsee) {
  const data = await safeGetJson(DVF_PERIODES_URL, {
    where: `code_commune="${codeInsee}"`, limit: 5, order_by: "periode desc",
  });
  if (!data || !data.results) return [];
  return data.results.map((r) => ({
    periode: pick(r, "periode", "libelle_periode") || "—",
    nb_maison: pick(r, "nbre_mutation_maison", "nb_mutations_maison"),
    nb_appart: pick(r, "nbre_mutation_appartement", "nb_mutations_appartement"),
    nb_total: pick(r, "nbre_mutation_total", "nb_mutations_total"),
    prix_m2_maison: pick(r, "prix_m2_median_maison", "mediane_prix_m2_maison", "px_med_m2_maison"),
    prix_m2_appart: pick(r, "prix_m2_median_appartement", "mediane_prix_m2_appartement", "px_med_m2_appart"),
  }));
}

// ─── VALORIS ──────────────────────────────────────────────────────────────────
async function getValoris(codeInsee, departement) {
  if (!departement) return {};
  const out = {};
  for (const t of ["maison", "appartement", "tous"]) {
    let d = await safeGetJson(VALORIS_URL, { dept: departement, commune: codeInsee, type_bien: t, annee: 2024 });
    if (!d) d = await safeGetJson(VALORIS_URL, { dept: departement, commune: codeInsee, type_bien: t });
    if (d && d.success !== false) out[t] = d;
  }
  if (!Object.keys(out).length) {
    for (const t of ["maison", "appartement", "tous"]) {
      const d = await safeGetJson(VALORIS_URL, { dept: departement, type_bien: t, annee: 2023 });
      if (d && d.success !== false) out[t] = d;
    }
  }
  return out;
}

// ─── DPE ──────────────────────────────────────────────────────────────────────
function parseDpeLines(lines, labelField) {
  const dist = {};
  for (const item of lines) {
    const label = ((item[labelField] || "NC") + "").trim().toUpperCase();
    if (["A", "B", "C", "D", "E", "F", "G"].includes(label)) {
      dist[label] = (dist[label] || 0) + 1;
    }
  }
  return dist;
}

async function getDpe(codeInsee, postcode, communeName) {
  let dist = {};
  // Legacy DPE (avant juillet 2021) — recherche par code postal
  if (postcode) {
    const dataOld = await safeGetJson(DPE_URL, {
      size: 1000, select: "Etiquette_DPE,Code_postal_BAN",
      q: postcode, q_fields: "Code_postal_BAN",
    });
    if (dataOld && dataOld.results) dist = parseDpeLines(dataOld.results, "Etiquette_DPE");
  }
  // DPE V2 (depuis juillet 2021) — filtre prioritaire par code_insee_ban (plus fiable)
  if (codeInsee) {
    const dataV2 = await safeGetJson(DPE_V2_URL, {
      size: 1000, select: "etiquette_dpe,code_insee_ban",
      q: codeInsee, q_fields: "code_insee_ban",
    });
    if (dataV2 && dataV2.results) {
      const d2 = parseDpeLines(dataV2.results, "etiquette_dpe");
      for (const [k, v] of Object.entries(d2)) dist[k] = (dist[k] || 0) + v;
    }
  }
  return dist;
}

// ─── Géorisques ───────────────────────────────────────────────────────────────
// Endpoints corrects : zonage_sismique (param code_insee), radon (code_insee),
// gaspar/risques (synthèse), installations_classees (code_insee).
async function getRisques(lat, lon, codeInsee) {
  const risques = {};
  const [sismo, radon, gaspar, icpe] = await Promise.all([
    safeGetJson(`${GEORISQUES_URL}/zonage_sismique`, { code_insee: codeInsee }),
    safeGetJson(`${GEORISQUES_URL}/radon`, { code_insee: codeInsee }),
    safeGetJson(`${GEORISQUES_URL}/gaspar/risques`, { code_insee: codeInsee }),
    safeGetJson(`${GEORISQUES_URL}/installations_classees`, { code_insee: codeInsee, rayon: 3000 }),
  ]);

  // Sismicité → { zone, libelle }
  const sd = sismo && sismo.data && sismo.data[0];
  if (sd) {
    risques.sismicite = {
      zone: sd.code_zone || (sd.zone_sismicite || "").split(" ")[0] || "",
      libelle: sd.zone_sismicite || "",
    };
  }

  // Radon → { classe }
  const rd = radon && radon.data && radon.data[0];
  if (rd) {
    risques.radon = { classe: String(rd.classe_potentiel || "").trim() };
  }

  // Synthèse des risques (gaspar) → liste de libellés uniques
  const gd = gaspar && gaspar.data && gaspar.data[0];
  if (gd && Array.isArray(gd.risques_detail)) {
    const set = [];
    for (const r of gd.risques_detail) {
      const lib = r.libelle_risque_long || r.libelle_risque || "";
      if (lib && set.indexOf(lib) === -1) set.push(lib);
    }
    risques.synthese = set;
  }

  // ICPE (installations classées) → comptage local
  if (icpe && icpe.data) {
    risques.icpe = { count: icpe.results || icpe.data.length || 0, data: (icpe.data || []).slice(0, 10) };
  }

  return risques;
}

// ─── Score ────────────────────────────────────────────────────────────────────
function noteActivite(dvfPeriodes, dvfAnnees) {
  let nb = null;
  if (dvfPeriodes.length) nb = dvfPeriodes[0].nb_total;
  if (nb === null && dvfAnnees.length) nb = dvfAnnees[dvfAnnees.length - 1].nb_total;
  if (nb === null || nb === undefined) return [10, "Données non disponibles"];
  nb = parseInt(nb);
  if (nb >= 500) return [20, `Marché très actif (${nb} transactions)`];
  if (nb >= 200) return [17, `Marché actif (${nb} transactions)`];
  if (nb >= 100) return [14, `Marché dynamique (${nb} transactions)`];
  if (nb >= 50)  return [11, `Marché modéré (${nb} transactions)`];
  if (nb >= 20)  return [8,  `Marché peu actif (${nb} transactions)`];
  return [4, `Marché peu liquide (${nb} transactions)`];
}

function noteTendance(dvfAnnees, typeBien) {
  const field = fieldForType(typeBien);
  const prices = dvfAnnees.filter((r) => r[field]).map((r) => [r.annee, r[field]]);
  if (prices.length < 2) return [10, "Tendance non calculable"];
  prices.sort((a, b) => a[0] - b[0]);
  const p0 = parseFloat(prices[0][1]);
  const pn = parseFloat(prices[prices.length - 1][1]);
  if (!p0 || !pn) return [10, "Tendance non calculable"];
  const evol = ((pn - p0) / p0) * 100;
  const r = Math.round(evol);
  if (evol >= 30)  return [20, `Forte hausse +${r}%`];
  if (evol >= 15)  return [17, `Hausse significative +${r}%`];
  if (evol >= 5)   return [14, `Hausse modérée +${r}%`];
  if (evol >= 0)   return [12, `Prix stables (+${r}%)`];
  if (evol >= -5)  return [9,  `Légère baisse ${r}%`];
  if (evol >= -15) return [6,  `Baisse des prix ${r}%`];
  return [3, `Forte baisse ${r}%`];
}

function noteAttractivite(communeInfo) {
  const pop = communeInfo.population || 0;
  const fmt = pop.toLocaleString("fr-FR");
  if (pop >= 200000) return [20, `Métropole (${fmt} hab.)`];
  if (pop >= 100000) return [18, `Grande ville (${fmt} hab.)`];
  if (pop >= 50000)  return [16, `Ville importante (${fmt} hab.)`];
  if (pop >= 20000)  return [14, `Ville moyenne (${fmt} hab.)`];
  if (pop >= 10000)  return [12, `Ville (${fmt} hab.)`];
  if (pop >= 5000)   return [10, `Bourg (${fmt} hab.)`];
  if (pop >= 2000)   return [8,  `Village (${fmt} hab.)`];
  if (pop > 0)       return [5,  `Commune rurale (${fmt} hab.)`];
  return [10, "Population non disponible"];
}

function noteDpe(dist) {
  if (!dist || !Object.keys(dist).length) return [10, "Données DPE non disponibles"];
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (!total) return [10, "Données DPE insuffisantes"];
  const bons = ["A", "B", "C"].reduce((a, l) => a + (dist[l] || 0), 0);
  const mauvais = ["F", "G"].reduce((a, l) => a + (dist[l] || 0), 0);
  const pctBon = (bons / total) * 100;
  const pctMauvais = (mauvais / total) * 100;
  if (pctBon >= 70)     return [20, `Excellent parc énergétique (${Math.round(pctBon)}% A-C)`];
  if (pctBon >= 50)     return [16, `Bon parc énergétique (${Math.round(pctBon)}% A-C)`];
  if (pctBon >= 35)     return [13, `Parc énergétique moyen (${Math.round(pctBon)}% A-C)`];
  if (pctMauvais >= 50) return [6,  `Parc très énergivore (${Math.round(pctMauvais)}% F-G)`];
  return [10, `Parc mixte (${Math.round(pctBon)}% A-C, ${Math.round(pctMauvais)}% F-G)`];
}

function noteRisques(risques) {
  let note = 20;
  const details = [];
  const sismo = risques.sismicite;
  if (sismo && sismo.zone) {
    const z = String(sismo.zone).replace("zone", "").trim();
    if (z === "4" || z === "5") { note -= 8; details.push(`Sismicité élevée (zone ${z})`); }
    else if (z === "3") { note -= 5; details.push(`Sismicité modérée (zone ${z})`); }
    else if (z === "1" || z === "2") { note -= 2; details.push(`Sismicité faible (zone ${z})`); }
  }
  const radon = risques.radon;
  if (radon && radon.classe) {
    const c = String(radon.classe).trim();
    if (c === "3") { note -= 4; details.push("Radon élevé (cat. 3)"); }
    else if (c === "2") { note -= 2; details.push("Radon modéré (cat. 2)"); }
  }
  // Pénalité légère selon le nombre de risques recensés (gaspar)
  const syn = Array.isArray(risques.synthese) ? risques.synthese : [];
  if (syn.length >= 4) { note -= 4; details.push(`${syn.length} risques recensés`); }
  else if (syn.length >= 2) { note -= 2; details.push(`${syn.length} risques recensés`); }
  if (!details.length) details.push("Aucun risque majeur identifié");
  return [Math.max(0, note), details.join(" | ")];
}

function calculateScore(results, typeBien) {
  const axes = {};
  let [n, d] = noteActivite(results.dvf_periodes, results.dvf_annees);
  axes.activite = { note: n, max: 20, label: "Activité du marché", detail: d };
  [n, d] = noteTendance(results.dvf_annees, typeBien);
  axes.tendance = { note: n, max: 20, label: "Tendance des prix", detail: d };
  [n, d] = noteAttractivite(results.commune_info);
  axes.attractivite = { note: n, max: 20, label: "Attractivité", detail: d };
  [n, d] = noteDpe(results.dpe);
  axes.dpe = { note: n, max: 20, label: "Parc énergétique", detail: d };
  [n, d] = noteRisques(results.risques);
  axes.risques = { note: n, max: 20, label: "Risques naturels", detail: d };
  const total = Object.values(axes).reduce((a, x) => a + x.note, 0);
  let verdict, couleur;
  if (total >= 80)      { verdict = "Excellent"; couleur = "#198754"; }
  else if (total >= 65) { verdict = "Très bon";  couleur = "#0d6efd"; }
  else if (total >= 50) { verdict = "Bon";       couleur = "#0dcaf0"; }
  else if (total >= 35) { verdict = "Moyen";     couleur = "#ffc107"; }
  else                  { verdict = "Faible";    couleur = "#dc3545"; }
  return { total, verdict, couleur, axes };
}

function estimateBien(valoris, dvfAnnees, dvfPeriodes, typeBien, surface) {
  let prixM2 = null;
  const v = valoris[typeBien] || valoris.tous;
  if (v) prixM2 = v.prix_median_m2;
  if (prixM2 === null || prixM2 === undefined) {
    const field = fieldForType(typeBien);
    for (let i = dvfAnnees.length - 1; i >= 0; i--) {
      if (dvfAnnees[i][field]) { prixM2 = parseFloat(dvfAnnees[i][field]); break; }
    }
  }
  if (prixM2 === null || prixM2 === undefined || surface <= 0) return null;
  prixM2 = parseFloat(prixM2);
  const valeur = prixM2 * surface;
  return {
    prix_m2: Math.round(prixM2),
    surface,
    valeur_med: Math.round(valeur / 1000) * 1000,
    valeur_min: Math.round((valeur * 0.85) / 1000) * 1000,
    valeur_max: Math.round((valeur * 1.20) / 1000) * 1000,
  };
}

// Estimation vénale à partir d'un €/m² médian
function estFromRate(prixM2, surface) {
  if (!prixM2 || !surface || surface <= 0) return null;
  const v = prixM2 * surface;
  return {
    prix_m2: Math.round(prixM2),
    surface,
    valeur_med: Math.round(v / 1000) * 1000,
    valeur_min: Math.round((v * 0.85) / 1000) * 1000,
    valeur_max: Math.round((v * 1.20) / 1000) * 1000,
  };
}

// Surfaces standard par type (immobilier) — utilisées pour les types NON saisis,
// car la surface saisie ne vaut que pour le type recherché (ex : 400 m² de
// terrain ne doit pas servir à estimer une maison).
const SURFACE_STD = { maison: 100, appartement: 70, terrain: 500 };

// Trois estimations (maison / appartement / terrain).
// Le type effectivement recherché utilise la surface saisie ; les autres types
// utilisent une surface standard cohérente avec leur nature.
function estimateAllTypes(valoris, surface, typeBien) {
  const sel = (typeBien || "").toLowerCase();
  const out = {};
  const m = valoris.maison, a = valoris.appartement, t = valoris.terrain;
  const surfFor = (key) => {
    const isSel = sel.includes(key);
    if (isSel && surface > 0) return surface;
    return SURFACE_STD[key];
  };
  if (m && m.prix_median_m2) out.maison      = { ...estFromRate(m.prix_median_m2, surfFor("maison")),      nb: m.nb, standard: !(sel.includes("maison") && surface > 0) };
  if (a && a.prix_median_m2) out.appartement = { ...estFromRate(a.prix_median_m2, surfFor("appartement")), nb: a.nb, standard: !(sel.includes("appartement") && surface > 0) };
  if (t && t.prix_median_m2) out.terrain     = { ...estFromRate(t.prix_median_m2, surfFor("terrain")),     nb: t.nb, standard: !(sel.includes("terrain") && surface > 0) };
  return out;
}

function nowFr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const adresse = (body.adresse || "").trim();
  const typeBien = (body.type_bien || "maison").toLowerCase();
  const surface = parseFloat(body.surface) || 0;

  if (!adresse) return jsonResp(400, { error: "Adresse requise" });

  // Localisation déjà résolue côté client (recherche cadastrale : parcelle ou
  // commune → lat/lon + code INSEE) : on saute le géocodage BAN.
  const geo = (body.lat != null && body.lon != null && body.citycode)
    ? geoFromDirect(body, adresse)
    : await geocodeAdresse(adresse);
  if (!geo) return jsonResp(404, { error: `Adresse introuvable : « ${adresse} »` });

  // Péage (actif seulement si PAYWALL_ENABLED=true) : connexion + crédit requis.
  // Un 404 (adresse introuvable, ci-dessus) ne coûte rien. Débit sur succès.
  let payer = null;
  if (loginRequired()) {
    const found = await currentUser(event).catch(() => null);
    if (!found) return jsonResp(401, { error: "Connexion requise pour lancer une analyse.", need_auth: true });
    // Le décompte de crédits ne s'applique qu'avec le péage actif, et jamais aux admins.
    if (paywallOn() && found.user.role !== "Administrateur") {
      const cost = costEtude();
      if (found.user.credits < cost) {
        return jsonResp(402, { error: "Crédits épuisés.", credits: found.user.credits, need_credits: true });
      }
      payer = { id: found.page.id, credits: found.user.credits, cost };
    }
  }

  const codeInsee = geo.citycode;
  const departement = geo.departement;
  const { lat, lon } = geo;

  const [dvf, communeInfo, dpe, risques] = await Promise.all([
    getDvfData(codeInsee).catch(() => ({})),
    getCommuneInfo(codeInsee).catch(() => ({})),
    getDpe(codeInsee, geo.postcode, geo.city).catch(() => ({})),
    getRisques(lat, lon, codeInsee).catch(() => ({})),
  ]);

  const dvfAnnees = (dvf && dvf.dvf_annees) || [];
  const dvfPer    = (dvf && dvf.dvf_periodes) || [];
  // Valoris est désormais calculé localement depuis DVF (API valoris-immo.fr morte)
  const valoris   = (dvf && dvf.valoris_local) || {};

  const allResults = {
    dvf_annees: dvfAnnees,
    dvf_periodes: dvfPer,
    commune_info: communeInfo || {},
    valoris,
    dpe: dpe || {},
    risques: risques || {},
  };

  const score = calculateScore(allResults, typeBien);
  const estimation = estimateBien(allResults.valoris, dvfAnnees, dvfPer, typeBien, surface);
  // Estimations 3 types : surface saisie pour le type recherché, surface standard pour les autres
  const estimations = estimateAllTypes(allResults.valoris, surface, typeBien);

  // Débit du crédit sur étude réussie (relit le solde à jour côté serveur).
  let creditsRestants;
  if (payer) {
    creditsRestants = Math.max(0, payer.credits - payer.cost);
    await setCredits(payer.id, creditsRestants).catch(() => {});
  }

  return jsonResp(200, {
    credits_restants: creditsRestants,
    localisation: geo,
    commune_info: allResults.commune_info,
    dvf_annees: dvfAnnees,
    dvf_periodes: dvfPer,
    valoris: allResults.valoris,
    dpe: allResults.dpe,
    risques: allResults.risques,
    score,
    estimation,
    estimations,
    type_bien: typeBien,
    surface,
    generated_at: nowFr(),
  });
};
