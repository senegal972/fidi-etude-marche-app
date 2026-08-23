// Netlify Function — GéoGuyane (PPRI, Parc Amazonien, urbanisme)
// GET /api/geoguyane?lat=X&lon=Y&radius=0.5
// Source : IDG Guyane (WFS OGC — datacarto.geoguyane.fr)

import { CORS, j, wfsGetFeature, simplifyGeoJson } from "./_ogc.mjs";

const GG_WFS_CANDIDATES = [
  "https://datacarto.geoguyane.fr/wfs",
  "https://www.geoguyane.fr/geoserver/wfs",
  "https://carto.geoguyane.fr/geoserver/wfs",
];
const LAYERS = [
  "URBANISME:plu_pos",
  "URBANISME:carte_communale",
  "RISQUES:ppri",
  "ENVIRONNEMENT:parc_amazonien_zonage",
  "ENVIRONNEMENT:reserves_naturelles",
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const radius = Math.max(0.1, Math.min(5, parseFloat(q.radius) || 0.5));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });
  // Sanity : Guyane = ~2,1-5,8°N / -54,7-51,6°W
  if (lat < 2 || lat > 6 || lon > -51 || lon < -55) {
    return j(200, {
      ok: true, source: "GéoGuyane", count: 0, items: [],
      params: { lat, lon, radius_km: radius },
      note: "Point hors zone Guyane — GéoGuyane ne couvre que le 973.",
    });
  }

  const groups = {};
  const attempts = [];
  for (const wfs of GG_WFS_CANDIDATES) {
    for (const layer of LAYERS) {
      try {
        const fc = await wfsGetFeature(wfs, layer, lat, lon, radius, 10);
        const items = simplifyGeoJson(fc);
        if (items.length) {
          const key = layer.split(":").pop();
          groups[key] = { wfs, layer, count: items.length, items: items.slice(0, 5) };
        } else attempts.push({ wfs, layer, status: "empty" });
      } catch (e) { attempts.push({ wfs, layer, error: e.message.slice(0, 120) }); }
    }
    if (Object.keys(groups).length) break;
  }

  const totalCount = Object.values(groups).reduce((a, g) => a + g.count, 0);
  if (totalCount === 0) {
    return j(200, {
      ok: true, source: "GéoGuyane", count: 0, groups: {},
      params: { lat, lon, radius_km: radius },
      attempts: attempts.slice(0, 6),
      note: "Aucune couche accessible avec les URL/layers tentés. Consulter https://www.geoguyane.fr/accueil/ressources/aide_en_ligne pour les typeNames à jour.",
    });
  }
  return j(200, {
    ok: true, source: "GéoGuyane (IDG 973)",
    params: { lat, lon, radius_km: radius },
    total_count: totalCount,
    groups,
    note: "Documents urbanisme + PPRI + zonages Parc Amazonien / réserves naturelles.",
  });
};
