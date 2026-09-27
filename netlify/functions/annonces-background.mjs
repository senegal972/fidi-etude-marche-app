// Netlify Background Function — exécute la veille annonces (jusqu'à 15 min) et
// écrit le résultat dans le cache (clé annonces:job:<id>). Invoquée par annonces.mjs.
import { cacheGet, cacheSet } from "./_cache.mjs";
import { rechercherAnnonces } from "./_annonces.mjs";

const jobKey = (id) => "annonces:job:" + id;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "{}" };
  let b; try { b = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "bad json" }; }
  const id = b.job_id, criteres = b.criteres || {};
  if (!id) return { statusCode: 400, body: "job_id requis" };

  try {
    const resultats = await rechercherAnnonces(criteres);
    await cacheSet(jobKey(id), { statut: resultats.statut || "termine", job_id: id, resultats, fini_le: new Date().toISOString() });
  } catch (e) {
    await cacheSet(jobKey(id), { statut: "erreur", job_id: id, erreur: String(e && e.message || e), fini_le: new Date().toISOString() });
  }
  // Background function : la réponse HTTP n'est pas consommée (202).
  return { statusCode: 202, body: "ok" };
};
