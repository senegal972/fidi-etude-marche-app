// Netlify Function — PPRN Martinique (préfecture 972) : détail réglementaire au point.
// GET /api/pprn972?lat=X&lon=Y
// Source officielle : WMS MapServer http://mapserv.pprn972.fr (mapfile pprn.map).
// Interroge GetFeatureInfo (zone_reglementaire + aléas) au point → détail des aléas
// et du zonage réglementaire opposable (Martinique uniquement, EPSG:32620).

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=1800",
};
const j = (s, b) => ({ statusCode: s, headers: CORS, body: JSON.stringify(b) });

const MAPSERV = "http://mapserv.pprn972.fr/mapserv?map=/var/www/pprn/mapfile/pprn.map";
const ALEA_LAYERS = [
  "alea_inondation", "alea_seisme", "alea_submersion2010", "alea_submersion2100",
  "alea_tsunami", "alea_volcan", "alea_mouvement", "alea_liquefaction",
  "alea_faille", "alea_houle", "alea_erosion",
];
// Libellés lisibles par couche d'aléa.
const ALEA_LABEL = {
  alea_inondation: "Inondation", alea_seisme: "Séisme",
  alea_submersion2010: "Submersion marine (2010)", alea_submersion2100: "Submersion marine (2100)",
  alea_tsunami: "Tsunami", alea_volcan: "Éruption volcanique", alea_mouvement: "Mouvement de terrain",
  alea_liquefaction: "Liquéfaction", alea_faille: "Faille", alea_houle: "Houle", alea_erosion: "Érosion",
};
// Niveau d'aléa (valeur MapServer → libellé). Convention PPRN : 1 faible … 4 très fort.
const NIVEAU = { "1": "Faible", "2": "Moyen", "3": "Fort", "4": "Très fort" };

// Conversion WGS84 lon/lat → UTM 20N (EPSG:32620), zone Martinique.
function lonLatToUtm20N(lon, lat) {
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const lon0 = -63 * Math.PI / 180; // méridien central zone 20
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), rad = Math.PI / 180;
  const phi = lat * rad, lam = lon * rad;
  const sinp = Math.sin(phi), cosp = Math.cos(phi), tanp = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinp * sinp);
  const T = tanp * tanp, C = ep2 * cosp * cosp, A = cosp * (lam - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const e = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const n = k0 * (M + N * tanp * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return { e, n };
}

// Parse la réponse GetFeatureInfo text/plain de MapServer en { layer: {champ: valeur} }.
function parsePlain(txt) {
  const out = {};
  let cur = null;
  for (const line of String(txt || "").split(/\r?\n/)) {
    const ml = line.match(/Layer '([^']+)'/);
    if (ml) { cur = ml[1]; out[cur] = out[cur] || {}; continue; }
    const mf = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*'?([^']*)'?\s*$/);
    if (mf && cur) out[cur][mf[1]] = mf[2];
  }
  return out;
}

async function getFeatureInfo(e, n) {
  const half = 200; // ± 200 m autour du point
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetFeatureInfo",
    LAYERS: ["zone_reglementaire", ...ALEA_LAYERS].join(","),
    QUERY_LAYERS: ["zone_reglementaire", ...ALEA_LAYERS].join(","),
    CRS: "EPSG:32620",
    BBOX: `${e - half},${n - half},${e + half},${n + half}`,
    WIDTH: "201", HEIGHT: "201", I: "100", J: "100",
    INFO_FORMAT: "text/plain", STYLES: "", FORMAT: "image/png",
  });
  const url = `${MAPSERV}&${params}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "FIDI-Etude-Marche/1.0" } });
    const txt = await r.text();
    if (!r.ok) throw new Error("WMS HTTP " + r.status);
    return parsePlain(txt);
  } finally { clearTimeout(t); }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });
  // Martinique seulement.
  const isMq = lat >= 14 && lat <= 15 && lon <= -60.5 && lon >= -61.6;
  if (!isMq) return j(200, { ok: true, mq: false, note: "Hors Martinique — utiliser Géorisques." });

  try {
    const { e, n } = lonLatToUtm20N(lon, lat);
    const info = await getFeatureInfo(e, n);
    const zr = info["zone_reglementaire"] || null;
    // Zonage réglementaire opposable
    const zonage = zr ? {
      code: zr.ZONAGEREGL || "", enjeux: zr.ENJEUX2012 || "",
      flags: {
        inondation: zr.ZON_INO === "1", submersion: zr.ZON_SUBM === "1", mouvement: zr.ZON_MVT === "1",
        seisme: zr.ZON_SEIS === "1" || zr.ZON_SEISME === "1", tsunami: zr.ZON_TSU === "1",
        volcan: zr.ZON_VOLC === "1", liquefaction: zr.ZON_LIQ === "1", faille: zr.ZON_FAILLE === "1",
        houle: zr.ZON_HOULE === "1", erosion: zr.ZON_ERO === "1",
      },
    } : null;
    // Aléas : chaque couche présente dans la réponse = point concerné ; niveau = 1er champ numérique.
    const aleas = [];
    for (const lyr of ALEA_LAYERS) {
      const f = info[lyr];
      if (!f) continue;
      let niv = "";
      for (const k of Object.keys(f)) { const v = f[k]; if (/^[1-4]$/.test(String(v).trim())) { niv = String(v).trim(); break; } }
      aleas.push({ type: lyr, label: ALEA_LABEL[lyr] || lyr, niveau: niv, niveau_label: NIVEAU[niv] || (niv ? "Niveau " + niv : "Concerné") });
    }
    return j(200, {
      ok: true, mq: true, source: "PPRN Martinique (préfecture 972) — WMS mapserv.pprn972.fr",
      point: { lat, lon }, utm: { e: Math.round(e), n: Math.round(n) },
      zonage, aleas, count: aleas.length,
      reglemente: !!(zonage && zonage.code && zonage.code !== "0"),
      note: "Détail au point indiqué. Un PPR approuvé est une servitude d'utilité publique opposable ; seul le document original approuvé fait foi.",
    });
  } catch (err) {
    return j(200, { ok: true, mq: true, error: err.message, aleas: [], zonage: null,
      note: "Service PPRN Martinique momentanément indisponible — réessayer. Source : mapserv.pprn972.fr." });
  }
};
