// Netlify Function — Sert un PDF partagé en téléchargement direct
// GET /api/download/<id>
// Renvoie le PDF (binaire) si présent et non expiré (7 jours).
// Aucun accès à l'app requis : le destinataire ouvre simplement le lien.

const TTL_MS = 7 * 24 * 3600 * 1000;

async function getShareStore() {
  const mod = await import("@netlify/blobs");
  // Essai 1 : contexte auto-injecté par le runtime Netlify.
  try {
    return mod.getStore({ name: "fidi-shared", consistency: "strong" });
  } catch (e1) {
    // Essai 2 : credentials explicites (mêmes variables que pdf-share).
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
    if (siteID && token) {
      return mod.getStore({ name: "fidi-shared", siteID, token, consistency: "eventual" });
    }
    return null;
  }
}

function htmlError(status, message) {
  return {
    statusCode: status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!doctype html><meta charset="utf-8"><title>Lien indisponible</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#334">` +
      `<h2 style="color:#1a3a6e">Document indisponible</h2><p>${message}</p>` +
      `<p style="font-size:.85rem;color:#888">FIDI Conseil · Étude de marché</p></div>`,
  };
}

export const handler = async (event) => {
  // L'id arrive via le splat de la redirection /api/download/:id
  const path = event.path || "";
  let id = (event.queryStringParameters && event.queryStringParameters.id) || "";
  if (!id) {
    const m = path.match(/\/download\/([a-z0-9]+)/i);
    if (m) id = m[1];
  }
  id = String(id || "").replace(/[^a-z0-9]/gi, "");
  if (!id) return htmlError(400, "Identifiant de document manquant.");

  const store = await getShareStore();
  if (!store) return htmlError(503, "Stockage temporairement indisponible.");

  let res;
  try {
    res = await store.getWithMetadata(id, { type: "text" });
  } catch (e) {
    return htmlError(500, "Erreur de récupération du document.");
  }
  if (!res || !res.data) return htmlError(404, "Ce lien a expiré ou n'existe pas.");

  const meta = res.metadata || {};
  if (meta.ts && Date.now() - meta.ts > TTL_MS) {
    try { await store.delete(id); } catch (e) {}
    return htmlError(410, "Ce lien de partage a expiré (validité 7 jours).");
  }

  const filename = meta.filename || "document.pdf";
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
    body: res.data,        // base64 string
    isBase64Encoded: true, // Netlify décode → PDF binaire
  };
};
