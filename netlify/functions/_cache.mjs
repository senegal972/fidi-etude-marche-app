// Cache wrapper Netlify Blobs avec TTL applicatif.
// Si @netlify/blobs n'est pas disponible (dev local, sandbox), no-op gracieux.

const TTL_MS = 24 * 3600 * 1000; // 24h
let storeRef = undefined;

async function getStoreSafe() {
  if (storeRef !== undefined) return storeRef;
  try {
    const mod = await import("@netlify/blobs");
    // Contexte Blobs auto-injecté par le bundler Netlify par défaut (pas d'esbuild/external).
    // Config manuelle (siteID+token) seulement si explicitement fournie via l'env dédiée Blobs.
    const opts = { name: "fidi-cache", consistency: "strong" };
    if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
      opts.siteID = process.env.BLOBS_SITE_ID; opts.token = process.env.BLOBS_TOKEN;
    }
    storeRef = mod.getStore(opts);
  } catch (e) {
    console.error("[_cache] getStore FAILED:", e && (e.message || e));
    storeRef = null;
  }
  return storeRef;
}

export async function cacheGet(key) {
  const s = await getStoreSafe();
  if (!s) return null;
  try {
    const raw = await s.get(key, { type: "json" });
    if (!raw || typeof raw !== "object" || !raw.ts) return null;
    if (Date.now() - raw.ts > TTL_MS) return null;
    return raw.data;
  } catch (e) { return null; }
}

export async function cacheSet(key, data) {
  const s = await getStoreSafe();
  if (!s) { console.error("[_cache] cacheSet no store for", key); return; }
  try { await s.setJSON(key, { ts: Date.now(), data }); }
  catch (e) { console.error("[_cache] setJSON FAILED for", key, ":", e && (e.message || e)); }
}

export function cacheTag(...parts) {
  return parts.filter(Boolean).join(":");
}
