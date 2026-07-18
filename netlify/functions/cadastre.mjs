// Netlify Function — Proxy cadastre (contourne le CORS de apicarto.ign.fr côté navigateur)
// GET /api/cadastre?code_insee=97204&section=C&numero=250
// Renvoie le centroïde de la parcelle : { found, lat, lon, section, numero }

const APICARTO = "https://apicarto.ign.fr/api/cadastre/parcelle";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const resp = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

// Centroïde (moyenne des sommets du 1er anneau) d'une géométrie Polygon/MultiPolygon.
function centroid(geom) {
  try {
    const ring = geom.type === "Polygon" ? geom.coordinates[0]
      : geom.type === "MultiPolygon" ? geom.coordinates[0][0] : null;
    if (!ring || !ring.length) return null;
    let sx = 0, sy = 0;
    for (const pt of ring) { sx += pt[0]; sy += pt[1]; }
    return { lon: sx / ring.length, lat: sy / ring.length };
  } catch { return null; }
}

async function tryFetch(insee, section, numero) {
  const url = `${APICARTO}?code_insee=${encodeURIComponent(insee)}`
    + `&section=${encodeURIComponent(section)}&numero=${encodeURIComponent(numero)}`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && Array.isArray(d.features) && d.features.length) ? d.features[0] : null;
  } catch { return null; }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resp(200, {});
  const q = event.queryStringParameters || {};
  const insee = (q.code_insee || "").trim();
  if (!insee) return resp(400, { error: "code_insee requis" });

  const rawSec = (q.section || "").trim().toUpperCase().replace(/\s+/g, "");
  const rawNum = (q.numero || "").trim().replace(/\D+/g, "");
  if (!rawSec || !rawNum) return resp(400, { error: "section et numero requis" });

  // Formats tolérés : section sur 2 car. (préfixée de 0), numéro sur 4 chiffres.
  const secVariants = [...new Set([rawSec, rawSec.padStart(2, "0")])];
  const numVariants = [...new Set([rawNum.padStart(4, "0"), rawNum, String(parseInt(rawNum, 10))])];

  for (const sec of secVariants) {
    for (const num of numVariants) {
      const feat = await tryFetch(insee, sec, num);
      if (feat) {
        const c = centroid(feat.geometry);
        if (c) return resp(200, { found: true, lat: c.lat, lon: c.lon, section: sec, numero: num,
                                  idu: (feat.properties && feat.properties.idu) || null });
      }
    }
  }
  return resp(404, { found: false, error: "Parcelle introuvable" });
};
