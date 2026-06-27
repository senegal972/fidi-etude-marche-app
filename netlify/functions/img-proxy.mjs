// Netlify Function — Proxy d'image same-origin (cartes IGN)
// GET /api/img-proxy?url=<url encodée>
//
// But : html2canvas/html2pdf échoue ("Unsupported image type") sur les images
// cross-origin (carte IGN data.geopf.fr) qui « tachent » le canvas. En servant
// l'image depuis notre propre domaine, le canvas reste exportable en PDF.
//
// Sécurité : liste blanche stricte de domaines (anti open-proxy).

const ALLOWED_HOSTS = new Set([
  "data.geopf.fr",
  "wxs.ign.fr",
]);
const TIMEOUT_MS = 12000;

function errResp(status, msg) {
  return {
    statusCode: status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
    body: msg,
  };
}

export const handler = async (event) => {
  const raw = (event.queryStringParameters && event.queryStringParameters.url) || "";
  if (!raw) return errResp(400, "url requise");

  let target;
  try { target = new URL(raw); } catch { return errResp(400, "url invalide"); }
  if (target.protocol !== "https:") return errResp(400, "https requis");
  if (!ALLOWED_HOSTS.has(target.hostname)) return errResp(403, "domaine non autorisé");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(target.toString(), { signal: ctrl.signal, headers: { "User-Agent": "FIDI-Etude/1.0" } });
  } catch (e) {
    clearTimeout(t);
    return errResp(502, "échec de récupération : " + e.message);
  }
  clearTimeout(t);

  if (!r.ok) return errResp(r.status, "source HTTP " + r.status);

  const ct = r.headers.get("content-type") || "image/png";
  if (!ct.startsWith("image/")) return errResp(415, "contenu non image");

  const buf = Buffer.from(await r.arrayBuffer());
  return {
    statusCode: 200,
    headers: {
      "Content-Type": ct,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
    body: buf.toString("base64"),
    isBase64Encoded: true,
  };
};
