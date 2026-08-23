// Netlify Function — Géorisques par ADRESSE (point lat/lon), pas par commune
// GET /api/georisques-adresse?lat=X&lon=Y&insee=97209
// Source : https://www.georisques.gouv.fr/api/v1 (open, sans clé)
// Retourne : PPR, radon, retrait-gonflement argiles, mouvements terrain, cavités, catnat.

import { CORS, j, fetchTimeout } from "./_ogc.mjs";

const API = "https://www.georisques.gouv.fr/api/v1";

async function safe(url) {
  try {
    const r = await fetchTimeout(url, 7000);
    if (!r.ok) return { ok: false, http: r.status };
    return { ok: true, data: await r.json() };
  } catch (e) { return { ok: false, error: e.message }; }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const insee = String(q.insee || "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });

  const latlon = `${lat},${lon}`;
  const rayon = q.rayon || "1000"; // m
  const queries = {
    ppr:       `${API}/gaspar/ppr?latlon=${latlon}&rayon=${rayon}&page_size=20`,
    mvt:       `${API}/mvt?latlon=${latlon}&rayon=${rayon}&page_size=20`,
    cavites:   `${API}/cavites?latlon=${latlon}&rayon=${rayon}&page_size=20`,
    argiles:   `${API}/rga?latlon=${latlon}`,
    radon:     insee ? `${API}/radon?code_insee=${insee}` : null,
    catnat:    insee ? `${API}/gaspar/catnat?code_insee=${insee}&page_size=50` : `${API}/gaspar/catnat?latlon=${latlon}&rayon=${rayon}&page_size=50`,
    installations_classees: `${API}/installations_classees?latlon=${latlon}&rayon=${rayon}&page_size=20`,
    sites_pollues: `${API}/ssp?latlon=${latlon}&rayon=${rayon}&page_size=20`,
  };

  try {
    const entries = Object.entries(queries).filter(([, u]) => u);
    const results = await Promise.all(entries.map(async ([k, u]) => [k, await safe(u)]));
    const out = {};
    let totalRisques = 0;
    for (const [k, r] of results) {
      if (r.ok && r.data) {
        const items = r.data.data || r.data.results || (Array.isArray(r.data) ? r.data : [r.data]);
        out[k] = {
          count: Array.isArray(items) ? items.length : (items ? 1 : 0),
          items: Array.isArray(items) ? items.slice(0, 10) : [items],
        };
        totalRisques += out[k].count;
      } else {
        out[k] = { count: 0, error: r.error || `HTTP ${r.http}`, items: [] };
      }
    }
    return j(200, {
      ok: true,
      source: "Géorisques (BRGM/MTE)",
      params: { lat, lon, rayon_m: parseInt(rayon), insee },
      total_risques: totalRisques,
      details: out,
      note: "PPR, argiles, radon (par INSEE), catnat, cavités, mouvements de terrain, ICPE, sites pollués. Rayon par défaut 1 000 m.",
    });
  } catch (e) {
    return j(500, { error: e.message });
  }
};
