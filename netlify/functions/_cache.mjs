// Cache wrapper Netlify Blobs avec TTL applicatif.
// Si @netlify/blobs n'est pas disponible (dev local, sandbox), no-op gracieux.

const TTL_MS = 24 * 3600 * 1000; // 24h
let storeRef = undefined;

async function getStoreSafe() {
  if (storeRef !== undefined) return storeRef;
  try {
    const mod = await import("@netlify/blobs");
    storeRef = mod.getStore({ name: "fidi-cache", consistency: "strong" });
  } catch (e) {
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
  if (!s) return;
  try { await s.setJSON(key, { ts: Date.now(), data }); } catch (e) {}
}

export function cacheTag(...parts) {
  return parts.filter(Boolean).join(":");
}
