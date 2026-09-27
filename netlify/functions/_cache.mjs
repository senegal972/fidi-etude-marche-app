// Cache wrapper Netlify Blobs avec TTL applicatif.
// Si @netlify/blobs n'est pas disponible (dev local, sandbox), no-op gracieux.

const TTL_MS = 24 * 3600 * 1000; // 24h
let storeRef = undefined;

async function getStoreSafe() {
  if (storeRef !== undefined) return storeRef;
  try {
    const mod = await import("@netlify/blobs");
    const opts = { name: "fidi-cache", consistency: "strong" };
    // Config manuelle : le contexte Blobs auto n'est pas injecté quand la fonction est
    // bundlée avec esbuild + external_node_modules. On fournit siteID + token depuis l'env.
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.BLOBS_TOKEN;
    if (siteID && token) { opts.siteID = siteID; opts.token = token; }
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
