// Netlify Function — Recherche Entreprises (data.gouv.fr / RNE)
// POST /api/entreprise  body: { q }  q = SIREN, SIRET ou raison sociale
// Source : recherche-entreprises.api.gouv.fr (open data, sans auth)

const TIMEOUT_MS = 6000;
const RE_URL = "https://recherche-entreprises.api.gouv.fr/search";

const CORS_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function fetchTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

function normalize(e) {
  if (!e) return null;
  const dirigeants = (e.dirigeants || []).map((d) => ({
    nom: [d.prenoms, d.nom].filter(Boolean).join(" ").trim() || d.denomination || "—",
    qualite: d.qualite || "—",
    annee_naissance: d.annee_de_naissance || null,
    nationalite: d.nationalite || "",
  }));
  const beneficiaires = (e.beneficiaires_effectifs || []).map((b) => ({
    nom: [b.prenoms, b.nom].filter(Boolean).join(" ").trim() || "—",
    annee_naissance: b.annee_de_naissance || null,
    nationalite: b.nationalite || "",
    pourcentage_parts: b.pourcentage_parts || null,
    pourcentage_votes: b.pourcentage_votes || null,
  }));
  const siege = e.siege || {};
  return {
    siren: e.siren,
    siret_siege: siege.siret || null,
    nom: e.nom_complet || e.nom_raison_sociale || "—",
    forme_juridique: e.nature_juridique || "—",
    activite_principale: e.activite_principale || "—",
    date_creation: e.date_creation || null,
    tranche_effectif: e.tranche_effectif_salarie || null,
    etat_administratif: e.etat_administratif || "—",
    economie_sociale: e.est_economie_sociale_solidaire || false,
    siege_adresse: siege.adresse || siege.geo_adresse || "—",
    siege_commune: siege.libelle_commune || "",
    siege_code_postal: siege.code_postal || "",
    nb_etablissements: e.nombre_etablissements || null,
    nb_etablissements_ouverts: e.nombre_etablissements_ouverts || null,
    dirigeants,
    beneficiaires,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const q = (body.q || "").trim();
  if (!q) return jsonResp(400, { error: "Paramètre 'q' requis (SIREN, SIRET ou raison sociale)" });

  try {
    const url = `${RE_URL}?q=${encodeURIComponent(q)}&page=1&per_page=10`;
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return jsonResp(502, { error: `API Recherche Entreprises indisponible (${r.status})` });
    const data = await r.json();
    const results = (data.results || []).map(normalize).filter(Boolean);
    return jsonResp(200, {
      query: q,
      total: data.total_results || results.length,
      results,
    });
  } catch (e) {
    return jsonResp(504, { error: `Timeout ou erreur réseau : ${e.message}` });
  }
};
