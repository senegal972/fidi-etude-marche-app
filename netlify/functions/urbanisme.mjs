// Netlify Function — Urbanisme : zonage PLU + servitudes d'utilité publique
// GET /api/urbanisme?lat=X&lon=Y   ou   ?insee=97209&section=A&numero=0123
// Source : API Carto IGN (module GPU + module Cadastre) — open data
// Couvre France entière y compris DOM (Martinique/Guadeloupe/Guyane/Réunion/Mayotte)

const TIMEOUT_MS = 10000;
const APICARTO = "https://apicarto.ign.fr/api";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=3600",
};

function j(status, body) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

async function fetchJSON(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "FIDI-Etude-Marche/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function pointGeom(lat, lon) {
  return encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
}

async function getZonage(lat, lon) {
  try {
    const g = pointGeom(lat, lon);
    const url = `${APICARTO}/gpu/zone-urba?geom=${g}`;
    const r = await fetchJSON(url);
    return (r.features || []).map((f) => ({
      libelle: f.properties?.libelle || f.properties?.libelong || "",
      type_zone: f.properties?.typezone || "",
      code: f.properties?.libelle || "",
      partition: f.properties?.partition || "",
      insee: f.properties?.insee || "",
      commune: f.properties?.nom_com || "",
    }));
  } catch (e) { return []; }
}

async function getSecteursUrbains(lat, lon) {
  try {
    const g = pointGeom(lat, lon);
    const url = `${APICARTO}/gpu/secteur-cc?geom=${g}`;
    const r = await fetchJSON(url);
    return (r.features || []).map((f) => ({
      libelle: f.properties?.libelle || "",
      type_secteur: f.properties?.typesect || "",
      commune: f.properties?.nom_com || "",
    }));
  } catch (e) { return []; }
}

async function getServitudes(lat, lon) {
  try {
    const g = pointGeom(lat, lon);
    const url = `${APICARTO}/gpu/assiette-sup-p?geom=${g}`;
    const r = await fetchJSON(url);
    return (r.features || []).map((f) => ({
      libelle: f.properties?.libelle || f.properties?.nomsuplitt || "",
      categorie: f.properties?.categorie || "",
      code: f.properties?.suptype || "",
    }));
  } catch (e) { return []; }
}

async function getParcelle(lat, lon) {
  try {
    const g = pointGeom(lat, lon);
    const url = `${APICARTO}/cadastre/parcelle?geom=${g}&_limit=1`;
    const r = await fetchJSON(url);
    const f = (r.features || [])[0];
    if (!f) return null;
    return {
      id: f.properties?.id || f.id || "",
      insee: f.properties?.code_insee || "",
      commune: f.properties?.nom_com || "",
      section: f.properties?.section || "",
      numero: f.properties?.numero || "",
      surface_m2: f.properties?.contenance || null,
    };
  } catch (e) { return null; }
}

async function getPrescriptions(lat, lon) {
  try {
    const g = pointGeom(lat, lon);
    // Prescriptions surfaciques (EBC, emplacements réservés, etc.)
    const url = `${APICARTO}/gpu/prescription-surf?geom=${g}`;
    const r = await fetchJSON(url);
    return (r.features || []).map((f) => ({
      libelle: f.properties?.libelle || "",
      type_prescription: f.properties?.typepsc || "",
      categorie: f.properties?.categorie || "",
    }));
  } catch (e) { return []; }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });

  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat);
  const lon = parseFloat(q.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return j(400, { error: "lat + lon requis (WGS84, ex : 14.6099, -61.0862 pour Fort-de-France)" });
  }

  try {
    const [parcelle, zonage, secteurs, servitudes, prescriptions] = await Promise.all([
      getParcelle(lat, lon),
      getZonage(lat, lon),
      getSecteursUrbains(lat, lon),
      getServitudes(lat, lon),
      getPrescriptions(lat, lon),
    ]);

    // Synthèse constructibilité
    const zonePrincipale = zonage[0] || null;
    let constructibilite = "indéterminée";
    if (zonePrincipale) {
      const t = (zonePrincipale.type_zone || "").toUpperCase();
      if (t.startsWith("U")) constructibilite = "zone urbaine (constructible)";
      else if (t.startsWith("AU")) constructibilite = "zone à urbaniser";
      else if (t.startsWith("A")) constructibilite = "zone agricole (constructibilité restreinte)";
      else if (t.startsWith("N")) constructibilite = "zone naturelle (constructibilité restreinte)";
    }

    return j(200, {
      ok: true,
      params: { lat, lon },
      parcelle,
      zonage,
      zone_principale: zonePrincipale,
      constructibilite,
      secteurs_urbains: secteurs,
      servitudes_utilite_publique: servitudes,
      prescriptions,
      counts: {
        zones: zonage.length,
        servitudes: servitudes.length,
        prescriptions: prescriptions.length,
      },
      source: "API Carto IGN (GPU + Cadastre)",
      note: "Couverture nationale y compris DOM. Le GPU dépend du chargement des documents d'urbanisme par les collectivités : certaines communes peuvent ne pas encore avoir versé leur PLU/CC.",
    });
  } catch (e) {
    return j(500, { error: e.message });
  }
};
