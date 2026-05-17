// Netlify Function — Pappers (santé financière, ratios, comptes annuels)
// POST /api/pappers  body: { siren }
// Nécessite la variable d'environnement PAPPERS_API_KEY (api.pappers.fr)

const TIMEOUT_MS = 8000;
const PAPPERS_URL = "https://api.pappers.fr/v2/entreprise";

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

function pickRatios(e) {
  // Pappers expose comptes_sociaux[] avec ratios par exercice
  const comptes = (e.comptes_sociaux || []).slice(0, 5).map((c) => ({
    annee: c.date_cloture_exercice ? c.date_cloture_exercice.slice(0, 4) : null,
    duree_exercice: c.duree_exercice || null,
    chiffre_affaires: c.chiffre_affaires || null,
    resultat: c.resultat || null,
    effectif: c.effectif || null,
    marge_brute: c.marge_brute || null,
    excedent_brut_exploitation: c.excedent_brut_exploitation || null,
    capacite_autofinancement: c.capacite_autofinancement || null,
    fonds_propres: c.fonds_propres || null,
    endettement: c.endettement || null,
    ratio_endettement: c.ratio_endettement || null,
    rentabilite: c.rentabilite || null,
    bfr: c.besoin_en_fonds_de_roulement || null,
    tresorerie: c.tresorerie || null,
  }));
  return comptes;
}

function normalize(e) {
  if (!e) return null;
  return {
    siren: e.siren,
    nom: e.denomination || e.nom_entreprise || "—",
    forme_juridique: e.forme_juridique || "—",
    code_naf: e.code_naf || "",
    libelle_naf: e.libelle_code_naf || "",
    capital: e.capital || null,
    devise_capital: e.devise_capital || "EUR",
    date_creation: e.date_creation || null,
    effectif: e.effectif || null,
    tranche_effectif: e.tranche_effectif || null,
    chiffre_affaires_dernier: e.chiffre_affaires || null,
    resultat_dernier: e.resultat || null,
    siege: {
      siret: e.siege?.siret,
      adresse: e.siege?.adresse_ligne_1 || "",
      ville: e.siege?.ville || "",
      cp: e.siege?.code_postal || "",
    },
    procedures_collectives: e.procedures_collectives || [],
    comptes_sociaux: pickRatios(e),
    score_solvabilite: e.score_solvabilite || null,
    statut_rcs: e.statut_rcs || "—",
    derniere_mise_a_jour: e.derniere_mise_a_jour_rne || null,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  const apiKey = process.env.PAPPERS_API_KEY;
  if (!apiKey) {
    return jsonResp(503, {
      error: "Pappers non configuré. Définir la variable d'environnement PAPPERS_API_KEY (api.pappers.fr, plan payant).",
      configured: false,
    });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const siren = (body.siren || "").replace(/\s+/g, "").trim();
  if (!/^\d{9}$/.test(siren)) {
    return jsonResp(400, { error: "Paramètre 'siren' requis (9 chiffres)" });
  }

  try {
    const url = `${PAPPERS_URL}?api_token=${encodeURIComponent(apiKey)}&siren=${siren}&format_publications_bodacc=json`;
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (r.status === 401 || r.status === 403) {
      return jsonResp(401, { error: "Clé API Pappers invalide ou quota dépassé" });
    }
    if (r.status === 404) {
      return jsonResp(404, { error: `SIREN ${siren} introuvable chez Pappers` });
    }
    if (!r.ok) {
      return jsonResp(502, { error: `Pappers API erreur HTTP ${r.status}` });
    }
    const data = await r.json();
    return jsonResp(200, { siren, entreprise: normalize(data) });
  } catch (e) {
    return jsonResp(504, { error: `Timeout ou erreur réseau : ${e.message}` });
  }
};
