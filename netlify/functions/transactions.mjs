// Netlify Function — Transactions DVF individuelles
// POST /api/transactions

const TIMEOUT_MS = 10000;
const DVF_YEARS_KEEP = [2021, 2022, 2023, 2024, 2025];
const SECTION_BATCH  = 6;
const IGN_DIVISION_URL = "https://apicarto.ign.fr/api/cadastre/division";
const DVF_ETALAB_BASE  = "https://app.dvf.etalab.gouv.fr/api/mutations3";

const RAYON_MAP = {
  rayon_500m: 0.5, rayon_1km: 1.0, rayon_2km: 2.0,
  rayon_5km: 5.0, rayon_10km: 10.0, rayon_20km: 20.0, rayon_50km: 50.0,
};

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

function deptFolder(code) {
  if (code.startsWith("2A") || code.startsWith("2B")) return code.slice(0, 2);
  if (code.length >= 3 && (code.startsWith("97") || code.startsWith("98"))) return code.slice(0, 3);
  return code.slice(0, 2);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const toRad = (d) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1), dlam = toRad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractSection(idParcelle) {
  if (!idParcelle || idParcelle.length < 10) return "";
  if (idParcelle.length >= 14) return idParcelle.slice(8, 10).trim().toUpperCase();
  const base = idParcelle.replace(/[0-9]+$/, "");
  return base.length >= 2 ? base.slice(-2).trim().toUpperCase() : "";
}

// ─── DVF via Etalab API (sections IGN + mutations3) ───────────────────────────
async function getSections(codeCommune) {
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

async function getSectionAtPoint(lat, lon) {
  try {
    const url = "https://apicarto.ign.fr/api/cadastre/parcelle";
    const params = new URLSearchParams({ geom: JSON.stringify({ type: "Point", coordinates: [lon, lat] }) });
    const r = await fetchTimeout(`${url}?${params}`, TIMEOUT_MS);
    if (!r.ok) return "";
    const data = await r.json();
    if (data && data.features && data.features.length) {
      return ((data.features[0].properties || {}).section || "").trim().toUpperCase();
    }
  } catch (e) {}
  return "";
}

async function getIrisAtPoint(lat, lon) {
  try {
    const url = `https://pyris.datajazz.io/api/coords?lat=${lat}&lon=${lon}`;
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return ["", ""];
    const data = await r.json();
    return [data.complete_code || "", data.name || ""];
  } catch (e) { return ["", ""]; }
}

async function getTransactions(codeCommune, latRef, lonRef, mode, rayonKm,
                               codePostalRef, sectionRef, irisRef) {
  const mutations = await fetchAllMutations(codeCommune);
  const transactions = [];
  const irisCache = new Map();

  for (const r of mutations) {
    if (r.nature_mutation !== "Vente") continue;
    const year = parseInt((r.date_mutation || "").slice(0, 4));
    if (!year || !DVF_YEARS_KEEP.includes(year)) continue;

    const latS = parseFloatSafe(r.latitude);
    const lonS = parseFloatSafe(r.longitude);
    let distM = null;
    if (latS !== null && lonS !== null) {
      distM = Math.round(haversineKm(latRef, lonRef, latS, lonS) * 1000);
    }

    // Filtre selon mode
    if (mode === "rayon") {
      if (distM === null) continue;
      if (rayonKm > 0 && distM > rayonKm * 1000) continue;
    } else if (mode === "code_postal") {
      if (!codePostalRef) continue;
      if ((r.code_postal || "").trim() !== codePostalRef.trim()) continue;
    } else if (mode === "section") {
      if (!sectionRef) continue;
      if (extractSection(r.id_parcelle || "") !== sectionRef.toUpperCase()) continue;
    } else if (mode === "iris") {
      if (!irisRef || latS === null || lonS === null) continue;
      const key = `${latS.toFixed(4)},${lonS.toFixed(4)}`;
      if (!irisCache.has(key)) {
        const [code] = await getIrisAtPoint(latS, lonS);
        irisCache.set(key, code);
      }
      if (irisCache.get(key) !== irisRef) continue;
    }
    // mode == "commune" → pas de filtre

    const val = parseFloatSafe(r.valeur_fonciere);
    const surf = parseFloatSafe(r.surface_reelle_bati);
    const prixM2 = (val && surf && surf >= 5) ? Math.round(val / surf) : null;

    const num = (r.adresse_numero || "").trim();
    const suffx = (r.adresse_suffixe || "").trim();
    const voie = (r.adresse_nom_voie || "").trim();
    const adresseStr = [num, suffx, voie].filter(Boolean).join(" ") || "—";

    const surfTerrain = parseFloatSafe(r.surface_terrain) || 0;
    const pieces = parseInt(r.nombre_pieces_principales);

    transactions.push({
      date: (r.date_mutation || "").slice(0, 10),
      adresse: adresseStr,
      code_postal: r.code_postal || "",
      id_parcelle: r.id_parcelle || "",
      section: extractSection(r.id_parcelle || ""),
      type_local: r.type_local || r.nature_culture || "",
      surface_bati: surf ? Math.round(surf) : null,
      nb_pieces: Number.isFinite(pieces) && pieces > 0 ? pieces : null,
      surface_terrain: surfTerrain ? Math.round(surfTerrain) : null,
      valeur: val ? Math.round(val) : null,
      prix_m2: prixM2,
      lat: latS,
      lon: lonS,
      distance_m: distM,
      nature_culture: r.nature_culture || "",
    });
  }

  transactions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (mode === "rayon") {
    transactions.sort((a, b) => {
      const da = a.distance_m === null ? 99999999 : a.distance_m;
      const db = b.distance_m === null ? 99999999 : b.distance_m;
      return da - db;
    });
  }
  return transactions;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const codeInsee = (body.code_insee || "").trim();
  const lat = parseFloat(body.lat) || 0;
  const lon = parseFloat(body.lon) || 0;
  const postcode = (body.postcode || "").trim();
  const perimetre = body.perimetre || "rayon_1km";

  if (!codeInsee || !lat || !lon) return jsonResp(400, { error: "code_insee, lat, lon requis" });

  let mode, rayonKm;
  if (RAYON_MAP[perimetre] !== undefined) {
    mode = "rayon"; rayonKm = RAYON_MAP[perimetre];
  } else if (["commune", "code_postal", "section", "iris"].includes(perimetre)) {
    mode = perimetre; rayonKm = 0;
  } else {
    mode = "rayon"; rayonKm = 1.0;
  }

  let sectionRef = "", irisRef = "", irisName = "";
  const perimetreMeta = {};

  if (mode === "section") {
    sectionRef = await getSectionAtPoint(lat, lon);
    perimetreMeta.section = sectionRef;
    perimetreMeta.section_source = sectionRef ? "apicarto IGN" : "indisponible";
    if (!sectionRef) {
      return jsonResp(422, { error: "Section cadastrale introuvable. Essayez rayon, code postal ou commune." });
    }
  }

  if (mode === "iris") {
    [irisRef, irisName] = await getIrisAtPoint(lat, lon);
    perimetreMeta.iris_code = irisRef;
    perimetreMeta.iris_name = irisName;
    if (!irisRef) {
      return jsonResp(422, { error: "Code IRIS indisponible. Essayez rayon, code postal ou commune." });
    }
  }

  const codePostalRef = mode === "code_postal" ? postcode : "";
  if (mode === "code_postal") perimetreMeta.code_postal = codePostalRef;

  const transactions = await getTransactions(
    codeInsee, lat, lon, mode, rayonKm,
    codePostalRef, sectionRef, irisRef,
  );

  return jsonResp(200, {
    transactions,
    rayon_km: rayonKm,
    perimetre_mode: mode,
    perimetre_meta: perimetreMeta,
    count: transactions.length,
  });
};
