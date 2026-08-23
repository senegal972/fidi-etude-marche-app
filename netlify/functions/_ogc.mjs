// Helper commun pour appels WFS/OGC (GetFeature bbox) et ArcGIS FeatureServer.
// Réponse standardisée pour tous les endpoints régionaux DOM + ONF + Géorisques.

const TIMEOUT_MS = 9000;

export const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=1800",
};

export function j(status, body) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

export async function fetchTimeout(url, ms = TIMEOUT_MS, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "FIDI-Etude-Marche/1.0", "Accept": "application/json", ...(opts.headers || {}) },
    });
  } finally { clearTimeout(t); }
}

// Bbox autour d'un point (rayon en km, défaut 0.5 km ≈ ±0.0045°)
export function bboxAround(lat, lon, radiusKm = 0.5) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

// WFS 2.0.0 GetFeature JSON par bbox EPSG:4326
export async function wfsGetFeature(baseUrl, typeName, lat, lon, radiusKm = 0.5, count = 20) {
  const b = bboxAround(lat, lon, radiusKm);
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: typeName,
    srsName: "EPSG:4326",
    outputFormat: "application/json",
    count: String(count),
    bbox: `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon},EPSG:4326`,
  });
  const url = `${baseUrl}?${params}`;
  const r = await fetchTimeout(url);
  if (!r.ok) { const t = await r.text(); throw new Error(`WFS HTTP ${r.status} : ${t.slice(0, 200)}`); }
  const ct = r.headers.get("content-type") || "";
  if (!/json/i.test(ct)) { const t = await r.text(); throw new Error(`WFS réponse non-JSON (${ct}) : ${t.slice(0, 200)}`); }
  return await r.json();
}

// ArcGIS FeatureServer query par point
export async function arcgisQueryPoint(serviceUrl, lat, lon, outFields = "*") {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "false",
    f: "geojson",
  });
  const url = `${serviceUrl}/query?${params}`;
  const r = await fetchTimeout(url);
  if (!r.ok) { const t = await r.text(); throw new Error(`ArcGIS HTTP ${r.status} : ${t.slice(0, 200)}`); }
  return await r.json();
}

// Simplifie GeoJSON en tableau de {properties} minimal
export function simplifyGeoJson(fc) {
  if (!fc || !Array.isArray(fc.features)) return [];
  return fc.features.map((f) => f.properties || {});
}
