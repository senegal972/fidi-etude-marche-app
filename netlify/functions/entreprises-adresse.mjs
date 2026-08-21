// Netlify Function — Sirene par adresse (locaux commerciaux, immeubles mixtes)
// GET /api/entreprises-adresse?lat=X&lon=Y&radius=0.15   (radius en km, défaut 150 m)
// ou   /api/entreprises-adresse?commune=97200&voie=...
// Source : recherche-entreprises.api.gouv.fr (open data, sans clé)

const TIMEOUT_MS = 8000;
const RE_URL = "https://recherche-entreprises.api.gouv.fr/near_point";
const RE_SEARCH = "https://recherche-entreprises.api.gouv.fr/search";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=1800",
};

function j(status, body) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

async function fetchTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "FIDI-Etude-Marche/1.0" } }); }
  finally { clearTimeout(t); }
}

function normalizeEtab(e) {
  const siege = e.siege || {};
  const matchings = e.matching_etablissements || [];
  const etabs = matchings.length ? matchings : [siege];
  return etabs.map((et) => ({
    siret: et.siret || null,
    siren: e.siren || null,
    nom: e.nom_complet || e.nom_raison_sociale || "—",
    enseigne: et.enseigne || et.liste_enseignes?.[0] || "",
    activite: et.activite_principale || e.activite_principale || "—",
    activite_libelle: et.libelle_activite_principale || "",
    adresse: et.adresse || et.geo_adresse || "—",
    commune: et.libelle_commune || "",
    code_postal: et.code_postal || "",
    est_siege: !!et.est_siege,
    etat: et.etat_administratif || "A",
    tranche_effectif: et.tranche_effectif_salarie || null,
    distance_m: typeof et.distance === "number" ? Math.round(et.distance * 1000) : null,
    lat: et.latitude || null,
    lon: et.longitude || null,
  }));
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });

  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat);
  const lon = parseFloat(q.lon);
  const radius = Math.max(0.05, Math.min(5, parseFloat(q.radius) || 0.15)); // km, 50m à 5km
  const commune = String(q.commune || "").trim();
  const voie = String(q.voie || "").trim();

  try {
    let url, mode;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      url = `${RE_URL}?lat=${lat}&long=${lon}&radius=${radius}&page=1&per_page=25`;
      mode = "geo";
    } else if (commune || voie) {
      const query = [voie, commune].filter(Boolean).join(" ");
      url = `${RE_SEARCH}?q=${encodeURIComponent(query)}&page=1&per_page=25`;
      mode = "text";
    } else {
      return j(400, { error: "lat+lon (recommandé) ou commune/voie requis" });
    }

    const r = await fetchTimeout(url);
    if (!r.ok) return j(502, { error: `API Recherche Entreprises indisponible (${r.status})`, mode });
    const data = await r.json();
    const results = (data.results || []).flatMap(normalizeEtab).filter((x) => x.etat === "A");

    // Segmentation utile pour analyse d'immeuble mixte
    const commerces = results.filter((x) => /^47|^56|^96/.test(x.activite || ""));
    const services = results.filter((x) => /^6[8-9]|^7[0-9]|^8[0-6]/.test(x.activite || ""));
    const artisans = results.filter((x) => /^43|^33|^45/.test(x.activite || ""));

    return j(200, {
      ok: true,
      mode,
      params: { lat, lon, radius, commune, voie },
      count: results.length,
      results,
      segments: {
        commerces: commerces.length,
        services: services.length,
        artisans: artisans.length,
      },
      source: "recherche-entreprises.api.gouv.fr",
    });
  } catch (e) {
    return j(504, { error: `Timeout ou erreur réseau : ${e.message}` });
  }
};
