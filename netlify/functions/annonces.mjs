// Netlify Function — Recherche d'annonces similaires (synchrone, < 26 s).
// POST /api/annonces  { commune, code_postal, type_bien, surface_hab, lat, lon, rayon_m, portails[] }
//   → { statut:"termine", resultats } ; sans clé de recherche : { statut:"indisponible" } (pas d'erreur 500).
// Connexion exigée, vérifiée avant tout le reste : la route consomme une clé de recherche payante
// (SEARCH_API_KEY). Ouverte à tous, elle laisserait n'importe qui épuiser le quota.
import { sha1, rechercherAnnonces } from "./_annonces.mjs";
import { sessionRequise } from "./_auth.mjs";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const j = (s, b) => ({ statusCode: s, headers: CORS, body: JSON.stringify(b) });

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});

  const acces = await sessionRequise(event);
  if (acces.refus) return acces.refus;

  // Compat : l'ancien client interrogeait ?job_id=. Il n'y a plus de tâche de fond.
  if (event.httpMethod === "GET") {
    const id = (event.queryStringParameters || {}).job_id || "";
    if (!id) return j(400, { error: "job_id requis" });
    return j(200, { statut: "inconnu", note: "Mode synchrone : résultats renvoyés directement par le POST." });
  }

  if (event.httpMethod !== "POST") return j(405, { error: "GET ou POST requis" });

  let criteres; try { criteres = JSON.parse(event.body || "{}"); } catch { return j(400, { error: "JSON invalide" }); }
  if (!criteres || typeof criteres !== "object" || !String(criteres.commune || "").trim()) return j(400, { error: "Commune requise" });

  if (!process.env.SEARCH_API_KEY) {
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
