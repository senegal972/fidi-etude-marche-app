// Netlify Function — GéoMartinique (PPR + risques + urbanisme)
// GET /api/geomartinique?lat=X&lon=Y&radius=0.5
// Source : IDG Martinique (WFS OGC)
// Renvoie PPR cyclonique/sismique fins + zonages spécifiques 972.

import { CORS, j, wfsGetFeature, simplifyGeoJson } from "./_ogc.mjs";

const GM_WFS_CANDIDATES = [
  "https://www.geomartinique.fr/geoserver/wfs",
  "https://carto.geomartinique.fr/geoserver/wfs",
  "https://data.geomartinique.fr/geoserver/wfs",
];
const LAYERS = [
  "RISQUES:ppr_mouvement_terrain",
  "RISQUES:ppr_cyclone",
  "RISQUES:ppr_seisme",
  "RISQUES:zonage_sismique",
  "URBANISME:plu_972",
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const radius = Math.max(0.1, Math.min(3, parseFloat(q.radius) || 0.5));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });
  // Sanity : Martinique = ~14,3-14,9°N / -61,3-60,8°W
  if (lat < 14 || lat > 15 || lon > -60.5 || lon < -61.5) {
    return j(200, {
      ok: true, source: "GéoMartinique", count: 0, items: [],
      params: { lat, lon, radius_km: radius },
      note: "Point hors zone Martinique — GéoMartinique ne couvre que le 972.",
    });
  }

  const groups = {};
  const attempts = [];
  for (const wfs of GM_WFS_CANDIDATES) {
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
    // Si au moins un layer a répondu sur cette WFS, on arrête
    if (Object.keys(groups).length) break;
  }

  const totalCount = Object.values(groups).reduce((a, g) => a + g.count, 0);
  if (totalCount === 0) {
    return j(200, {
      ok: true, source: "GéoMartinique", count: 0, groups: {},
      params: { lat, lon, radius_km: radius },
      attempts: attempts.slice(0, 6),
      note: "Aucune couche accessible avec les URL/layers tentés. Consulter https://www.geomartinique.fr/accueil/acces_aux_donnees pour les typeNames à jour.",
    });
  }
  return j(200, {
    ok: true, source: "GéoMartinique (IDG 972)",
    params: { lat, lon, radius_km: radius },
    total_count: totalCount,
    groups,
    note: "PPR cyclonique/sismique + zonage PLU 972.",
  });
};
