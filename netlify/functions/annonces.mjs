// Netlify Function — Veille annonces (mode SYNCHRONE, sans Netlify Blobs).
// POST /api/annonces  { commune, quartier, type_bien, surface_hab, ... }
//   → exécute la recherche et renvoie directement { statut:"termine", resultats } (< 26 s).
//   → sans clé de recherche : { statut:"indisponible" } (pas d'erreur 500).
// GET conservé pour compat client (polling) : renvoie l'état si un id est fourni, sinon 400.
import { sha1, rechercherAnnonces } from "./_annonces.mjs";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const j = (s, b) => ({ statusCode: s, headers: CORS, body: JSON.stringify(b) });

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});

  // Compat : l'ancien client pouvait interroger ?job_id=. En mode synchrone il n'y a plus de
  // job persistant ; on répond "inconnu" pour que le client bascule sur le résultat direct du POST.
  if (event.httpMethod === "GET") {
    const id = (event.queryStringParameters || {}).job_id || "";
    if (!id) return j(400, { error: "job_id requis" });
    return j(200, { statut: "inconnu", note: "Mode synchrone : résultats renvoyés directement par le POST." });
  }

  if (event.httpMethod !== "POST") return j(405, { error: "GET ou POST requis" });

  let criteres; try { criteres = JSON.parse(event.body || "{}"); } catch { return j(400, { error: "JSON invalide" }); }

  if (!process.env.SEARCH_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return j(200, { statut: "indisponible", raison: "Aucune clé de recherche configurée (SEARCH_API_KEY).", job_id: null });
  }

  const id = sha1(JSON.stringify(criteres));
  try {
    const resultats = await rechercherAnnonces(criteres);
    return j(200, { statut: resultats.statut || "termine", job_id: id, resultats });
  } catch (e) {
    return j(200, { statut: "erreur", job_id: id, erreur: String((e && e.message) || e) });
  }
};
