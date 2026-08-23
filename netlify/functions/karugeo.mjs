// Netlify Function — KaruGéo Guadeloupe (OCS2D + risques)
// GET /api/karugeo?lat=X&lon=Y&radius=0.5
// Source : KaruGéo IDG Guadeloupe (WFS OGC)
// Renvoie couches d'occupation du sol (KaruCover OCS2D) au point demandé.

import { CORS, j, wfsGetFeature, simplifyGeoJson } from "./_ogc.mjs";

// URL WFS KaruGéo — hébergement GeoServer standard IDG
const KARUGEO_WFS_CANDIDATES = [
  "https://www.karugeo.fr/geoserver/wfs",
  "https://carto.karugeo.fr/geoserver/wfs",
  "https://data.karugeo.fr/geoserver/wfs",
];
// Layers OCS2D + risques candidats (nommage GeoServer typique IDG Guadeloupe)
const LAYERS = [
  "OCS:ocs2d_2017",
  "OCS:karucover_2017",
  "OCS:ocsge_derniere",
  "RISQUES:ppr_gp",
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const radius = Math.max(0.1, Math.min(3, parseFloat(q.radius) || 0.5));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });
  // Sanity : Guadeloupe = ~15,5-16,5°N / -61,8-61°W
  if (lat < 15 || lat > 17 || lon > -60 || lon < -62.5) {
    return j(200, {
      ok: true, source: "KaruGéo", count: 0, items: [],
      params: { lat, lon, radius_km: radius },
      note: "Point hors zone Guadeloupe — KaruGéo ne couvre que le 971. Utiliser /api/urbanisme (national) à la place.",
    });
  }

  const attempts = [];
  for (const wfs of KARUGEO_WFS_CANDIDATES) {
    for (const layer of LAYERS) {
      try {
        const fc = await wfsGetFeature(wfs, layer, lat, lon, radius, 15);
        const items = simplifyGeoJson(fc);
        if (items.length) {
          return j(200, {
            ok: true, source: "KaruGéo (IDG Guadeloupe)", wfs, layer,
            params: { lat, lon, radius_km: radius }, count: items.length, items,
            note: "Couches occupation du sol OCS2D + risques dans le rayon.",
          });
        }
        attempts.push({ wfs, layer, status: "empty" });
      } catch (e) { attempts.push({ wfs, layer, error: e.message.slice(0, 120) }); }
    }
  }

  return j(200, {
    ok: true, source: "KaruGéo", count: 0, items: [],
    params: { lat, lon, radius_km: radius },
    attempts: attempts.slice(0, 6),
    note: "Aucune couche accessible avec les URL/layers tentés. Layers peuvent avoir été renommés — consulter https://www.karugeo.fr/accueil/geoservice pour les typeNames à jour.",
  });
};
