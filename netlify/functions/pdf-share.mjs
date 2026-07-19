// Netlify Function — Héberge un PDF partageable (Netlify Blobs, TTL 7j)
// POST /api/pdf-share  body: { pdf_b64, filename }
// Retour : { ok, id, url }  → url = lien public de téléchargement direct du PDF
//
// Le PDF est généré côté client (html2pdf.js) puis envoyé ici en base64.
// On le stocke dans un store dédié "fidi-shared" et on renvoie un lien
// /api/download/<id> que le destinataire peut ouvrir SANS accès à l'app.

const TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours
const MAX_BYTES = 9 * 1024 * 1024;   // garde-fou : 9 Mo de PDF max (études avec graphiques)

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

async function getShareStore() {
  const mod = await import("@netlify/blobs");
  // Essai 1 : contexte auto-injecté par le runtime Netlify (cas normal en prod)
  try {
    const store = mod.getStore({ name: "fidi-shared", consistency: "strong" });
    return store;
  } catch (e1) {
    // Essai 2 : credentials explicites via variables d'environnement
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
    if (siteID && token) {
      return mod.getStore({ name: "fidi-shared", siteID, token, consistency: "eventual" });
    }
    throw new Error("Blobs context indisponible : " + e1.message +
      (siteID ? "" : " — NETLIFY_SITE_ID manquant"));
  }
}

function makeId() {
  // 16 caractères alphanumériques imprévisibles
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function sanitizeFilename(name) {
  const base = String(name || "document").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return base.toLowerCase().endsWith(".pdf") ? base : base + ".pdf";
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }

  let pdf = (b.pdf_b64 || "").trim();
  if (!pdf) return jsonResp(400, { error: "pdf_b64 requis" });
  // Tolère un éventuel préfixe data URL
  const comma = pdf.indexOf(",");
  if (pdf.startsWith("data:") && comma >= 0) pdf = pdf.slice(comma + 1);

  // Garde-fou taille
  const approxBytes = Math.floor(pdf.length * 0.75);
  if (approxBytes > MAX_BYTES) {
    return jsonResp(413, { error: "PDF trop volumineux (max 5 Mo)" });
  }

  let store;
  try { store = await getShareStore(); }
  catch (e) { return jsonResp(503, { error: "Stockage Blobs indisponible : " + e.message, blobs_error: true }); }

  const filename = sanitizeFilename(b.filename);
  const id = makeId();

  try {
    await store.set(id, pdf, {
      metadata: { ts: Date.now(), filename, ct: "application/pdf" },
    });
  } catch (e) {
    return jsonResp(500, { error: "Échec d'enregistrement : " + e.message });
  }

  const origin = (event.headers && (event.headers["x-forwarded-host"] || event.headers.host))
    ? `https://${event.headers["x-forwarded-host"] || event.headers.host}`
    : "";
  const url = `${origin}/api/download/${id}`;

  return jsonResp(200, { ok: true, id, url, filename, expire_jours: 7 });
};

export { TTL_MS };
