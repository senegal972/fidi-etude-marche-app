// Accès au store des PDF partagés, commun à pdf-share (dépôt) et pdf-get (téléchargement).
//
// Ces fonctions sont des « handler » classiques : Netlify leur passe l'accès à Blobs dans
// event.blobs et il faut l'activer avec connectLambda, sinon getStore n'a aucun contexte.
// Ce contexte ne fournit pas l'adresse non mise en cache exigée par consistency:"strong" :
// on reste donc en cohérence « eventual », sous peine d'erreur à chaque requête.

export const SHARE_STORE = "fidi-shared";

export async function getShareStore(event) {
  const mod = await import("@netlify/blobs");
  if (event && event.blobs) {
    try { mod.connectLambda(event); }
    catch (e) { console.error("[blobs] connectLambda impossible :", e.message); }
  }
  // Essai 1 : contexte du runtime Netlify (cas normal en prod).
  try {
    return mod.getStore({ name: SHARE_STORE });
  } catch (e1) {
    // Essai 2 : credentials explicites via variables d'environnement.
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
    if (siteID && token) return mod.getStore({ name: SHARE_STORE, siteID, token });
    throw new Error("Blobs context indisponible : " + e1.message +
      (siteID ? "" : " — NETLIFY_SITE_ID manquant"));
  }
}
