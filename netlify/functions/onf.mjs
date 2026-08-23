// Netlify Function — ONF forêts publiques (via Géoplateforme IGN + fallback ArcGIS Hub)
// GET /api/onf?lat=X&lon=Y&radius=1
// Utilité : détection biens en limite/enclave forêt domaniale (Guyane surtout).
// Renvoie forêts publiques à proximité + distance approximative.

import { CORS, j, fetchTimeout, wfsGetFeature, simplifyGeoJson, arcgisQueryPoint } from "./_ogc.mjs";

// Sources tentées en cascade :
// 1. Géoplateforme IGN (data.geopf.fr) — layer forêt publique IGN (agrégé ONF)
// 2. ArcGIS ONF Hub (geo-onf.opendata.arcgis.com) — feature service forêts domaniales
const GEOPF_WFS = "https://data.geopf.fr/wfs/ows";
const GEOPF_LAYERS = [
  "PROTECTEDAREAS.FORETS.NATIONALES:forets_nationales",
  "AGRICULTURE.FORETS:foret_publique",
];
// ArcGIS Hub ONF — l'org ID publique varie, on tente les feature services connus
const ARCGIS_ONF_SERVICES = [
  "https://services.arcgis.com/hbeGkT5CsuVv2s2u/arcgis/rest/services/Forets_publiques/FeatureServer/0",
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const radius = Math.max(0.2, Math.min(5, parseFloat(q.radius) || 1));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });

  const attempts = [];

  // Tentative 1 : Géoplateforme WFS
  for (const layer of GEOPF_LAYERS) {
    try {
      const fc = await wfsGetFeature(GEOPF_WFS, layer, lat, lon, radius, 10);
      const items = simplifyGeoJson(fc);
      if (items.length) {
        return j(200, {
          ok: true, source: "Géoplateforme IGN (couche ONF)", layer,
          params: { lat, lon, radius_km: radius }, count: items.length, items,
          note: "Forêts publiques (domaniales + communales gérées ONF) intersectant le rayon.",
        });
      }
      attempts.push({ source: "geopf:" + layer, status: "empty" });
    } catch (e) { attempts.push({ source: "geopf:" + layer, error: e.message }); }
  }

  // Tentative 2 : ArcGIS ONF Hub
  for (const svc of ARCGIS_ONF_SERVICES) {
    try {
      const fc = await arcgisQueryPoint(svc, lat, lon);
      const items = simplifyGeoJson(fc);
      if (items.length) {
        return j(200, {
          ok: true, source: "ONF ArcGIS Hub", service: svc,
          params: { lat, lon }, count: items.length, items,
          note: "Point à l'intérieur d'une forêt publique ONF.",
        });
      }
      attempts.push({ source: "arcgis:" + svc.split("/").slice(-3, -1).join("/"), status: "empty" });
    } catch (e) { attempts.push({ source: "arcgis:" + svc.split("/").slice(-3, -1).join("/"), error: e.message }); }
  }

  return j(200, {
    ok: true, source: "ONF (aucune couche ne renvoie de résultat)",
    params: { lat, lon, radius_km: radius },
    count: 0, items: [],
    attempts,
    note: "Aucune forêt publique détectée dans le rayon. Peut signifier absence réelle OU couverture partielle des layers. Vérifier manuellement via geo-onf.opendata.arcgis.com si zone Guyane.",
  });
};
