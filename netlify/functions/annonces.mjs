// Netlify Function — Veille annonces (orchestrateur).
// POST /api/annonces      { commune, quartier, code_insee, type_bien, surface_hab, ... }
//   → lance le job de fond, renvoie { job_id, statut }. Cache 24 h sur les mêmes critères.
// GET  /api/annonces?job_id=XXX
//   → { statut: "en_cours"|"termine"|"erreur"|"indisponible", resultats }
import { cacheGet, cacheSet } from "./_cache.mjs";
import { sha1 } from "./_annonces.mjs";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const j = (s, b) => ({ statusCode: s, headers: CORS, body: JSON.stringify(b) });
const jobKey = (id) => "annonces:job:" + id;

function reqOrigin(event) {
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host;
  const proto = h["x-forwarded-proto"] || "https";
  return host ? `${proto}://${host}` : "";
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});

  if (event.httpMethod === "GET") {
    const id = (event.queryStringParameters || {}).job_id || "";
    if (!id) return j(400, { error: "job_id requis" });
    const state = await cacheGet(jobKey(id));
    if (!state) return j(200, { statut: "inconnu", note: "Job expiré ou introuvable." });
    return j(200, state);
  }

  if (event.httpMethod !== "POST") return j(405, { error: "GET ou POST requis" });

  let criteres; try { criteres = JSON.parse(event.body || "{}"); } catch { return j(400, { error: "JSON invalide" }); }

  // Repli propre : sans clé de recherche, on ne lance rien (l'UI proposera la saisie manuelle).
  if (!process.env.SEARCH_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return j(200, { statut: "indisponible", raison: "Aucune clé de recherche configurée (SEARCH_API_KEY / ANTHROPIC_API_KEY).", job_id: null });
  }

  const id = sha1(JSON.stringify(criteres));
  // Cache 24 h : job déjà terminé pour les mêmes critères.
  const existing = await cacheGet(jobKey(id));
  if (existing && (existing.statut === "termine" || existing.statut === "en_cours")) {
    return j(200, { job_id: id, statut: existing.statut, cache: existing.statut === "termine" });
  }

  await cacheSet(jobKey(id), { statut: "en_cours", job_id: id, criteres, demarre_le: new Date().toISOString() });

  // Déclenche la Background Function (jusqu'à 15 min). On n'attend pas sa fin.
  try {
    const origin = reqOrigin(event);
    await fetch(`${origin}/.netlify/functions/annonces-background`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: id, criteres }),
    });
  } catch { /* le job de fond s'exécute côté Netlify ; on renvoie le job_id à interroger */ }

  return j(202, { job_id: id, statut: "en_cours" });
};
