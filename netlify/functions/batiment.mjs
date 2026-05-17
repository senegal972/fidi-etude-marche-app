// Netlify Function — Caractéristiques bâti (BDNB-like via ADEME DPE V2)
// POST /api/batiment  body: { code_insee, lat, lon, postcode, perimetre }
// Retourne la liste des diagnostics DPE V2 (depuis juillet 2021) pour la
// commune, enrichis avec : surface habitable, année/période de construction,
// type de bâtiment, étiquette DPE et GES, conso énergie finale, type d'énergie
// principale de chauffage, type de ventilation, qualité isolation, distance
// depuis l'adresse analysée.

const TIMEOUT_MS = 10000;
const DPE_V2_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines";
const DPE_NEUF_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/g3cgx7jb3cmys5voxz1mrm22/lines";
const MAX_RESULTS = 200;

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
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

function parseFloatSafe(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const toRad = (d) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1), dlam = toRad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// _geopoint = "x_lambert,y_lambert" mais certains datasets exposent lat/lon BAN
function extractLatLon(rec) {
  // Champs lat/lon BAN si présents
  const lat = parseFloatSafe(rec.latitude_ban || rec.latitude);
  const lon = parseFloatSafe(rec.longitude_ban || rec.longitude);
  if (lat !== null && lon !== null) return [lat, lon];
  return [null, null];
}

const SELECT_FIELDS = [
  "_id",
  "adresse_ban",
  "code_postal_ban",
  "code_insee_ban",
  "nom_commune_ban",
  "type_batiment",
  "surface_habitable_logement",
  "periode_construction",
  "etiquette_dpe",
  "etiquette_ges",
  "conso_5_usages_par_m2_ef",
  "emission_ges_5_usages_par_m2",
  "type_energie_principale_chauffage",
  "type_ventilation",
  "qualite_isolation_enveloppe",
  "qualite_isolation_murs",
  "qualite_isolation_menuiseries",
  "nombre_niveau_logement",
  "hauteur_sous_plafond",
  "classe_inertie_batiment",
  "zone_climatique",
  "date_etablissement_dpe",
  "date_fin_validite_dpe",
  "numero_dpe",
  "_geopoint",
].join(",");

async function fetchDpeRecords(datasetUrl, codeInsee) {
  const url = new URL(datasetUrl);
  url.searchParams.set("size", String(MAX_RESULTS));
  url.searchParams.set("select", SELECT_FIELDS);
  url.searchParams.set("q", codeInsee);
  url.searchParams.set("q_fields", "code_insee_ban");
  url.searchParams.set("sort", "-date_etablissement_dpe");
  try {
    const r = await fetchTimeout(url.toString(), TIMEOUT_MS);
    if (!r.ok) return [];
    const data = await r.json();
    return data.results || [];
  } catch (e) { return []; }
}

function normalize(r, latRef, lonRef) {
  const [lat, lon] = extractLatLon(r);
  let distM = null;
  if (lat !== null && lon !== null && latRef !== null && lonRef !== null) {
    distM = Math.round(haversineKm(latRef, lonRef, lat, lon) * 1000);
  }
  return {
    id: r._id,
    adresse: r.adresse_ban || "—",
    code_postal: r.code_postal_ban || "",
    commune: r.nom_commune_ban || "",
    type_batiment: r.type_batiment || "—",
    surface: parseFloatSafe(r.surface_habitable_logement),
    periode_construction: r.periode_construction || "—",
    etiquette_dpe: r.etiquette_dpe || null,
    etiquette_ges: r.etiquette_ges || null,
    conso_ef_m2: parseFloatSafe(r.conso_5_usages_par_m2_ef),
    ges_m2: parseFloatSafe(r.emission_ges_5_usages_par_m2),
    energie_chauffage: r.type_energie_principale_chauffage || "—",
    ventilation: r.type_ventilation || "—",
    isolation_enveloppe: r.qualite_isolation_enveloppe || "—",
    isolation_murs: r.qualite_isolation_murs || "—",
    isolation_menuiseries: r.qualite_isolation_menuiseries || "—",
    nb_niveaux: r.nombre_niveau_logement || null,
    hauteur_plafond: parseFloatSafe(r.hauteur_sous_plafond),
    classe_inertie: r.classe_inertie_batiment || "—",
    zone_climatique: r.zone_climatique || "—",
    date_dpe: r.date_etablissement_dpe || null,
    date_fin: r.date_fin_validite_dpe || null,
    numero_dpe: r.numero_dpe || "",
    distance_m: distM,
  };
}

function summarize(items) {
  if (!items.length) return null;
  const dpeDist = {};
  const gesDist = {};
  const periodes = {};
  const types = {};
  const energies = {};
  let totalSurface = 0, surfCount = 0;
  let totalConso = 0, consoCount = 0;
  for (const it of items) {
    if (it.etiquette_dpe) dpeDist[it.etiquette_dpe] = (dpeDist[it.etiquette_dpe] || 0) + 1;
    if (it.etiquette_ges) gesDist[it.etiquette_ges] = (gesDist[it.etiquette_ges] || 0) + 1;
    if (it.periode_construction && it.periode_construction !== "—") {
      periodes[it.periode_construction] = (periodes[it.periode_construction] || 0) + 1;
    }
    if (it.type_batiment && it.type_batiment !== "—") {
      types[it.type_batiment] = (types[it.type_batiment] || 0) + 1;
    }
    if (it.energie_chauffage && it.energie_chauffage !== "—") {
      energies[it.energie_chauffage] = (energies[it.energie_chauffage] || 0) + 1;
    }
    if (it.surface) { totalSurface += it.surface; surfCount++; }
    if (it.conso_ef_m2) { totalConso += it.conso_ef_m2; consoCount++; }
  }
  return {
    count: items.length,
    dpe_distribution: dpeDist,
    ges_distribution: gesDist,
    periodes_construction: periodes,
    types_batiment: types,
    energies_chauffage: energies,
    surface_moyenne: surfCount ? Math.round(totalSurface / surfCount) : null,
    conso_ef_m2_moyenne: consoCount ? Math.round(totalConso / consoCount) : null,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const codeInsee = (body.code_insee || "").trim();
  if (!codeInsee) return jsonResp(400, { error: "code_insee requis" });
  const lat = parseFloat(body.lat);
  const lon = parseFloat(body.lon);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lon);

  // Fetch DPE existant + neuf en parallèle
  const [existing, neuf] = await Promise.all([
    fetchDpeRecords(DPE_V2_URL, codeInsee),
    fetchDpeRecords(DPE_NEUF_URL, codeInsee),
  ]);
  const allRaw = [...existing, ...neuf];
  const items = allRaw.map((r) => normalize(r, hasGeo ? lat : null, hasGeo ? lon : null));

  // Tri : distance si géo dispo, sinon date DPE descendante
  if (hasGeo && items.some((i) => i.distance_m !== null)) {
    items.sort((a, b) => {
      const da = a.distance_m === null ? Infinity : a.distance_m;
      const db = b.distance_m === null ? Infinity : b.distance_m;
      return da - db;
    });
  } else {
    items.sort((a, b) => (b.date_dpe || "").localeCompare(a.date_dpe || ""));
  }

  return jsonResp(200, {
    code_insee: codeInsee,
    count: items.length,
    summary: summarize(items),
    items,
    source: "ADEME DPE V2 (logements existants + logements neufs)",
  });
};
