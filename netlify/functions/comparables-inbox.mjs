// Netlify Function — Boîte de réception des comparables (extension FIDI ACM)
// Reçoit les annonces poussées par l'extension Chrome/Firefox depuis SeLoger,
// LeBonCoin, DomImmo. L'app FIDI récupère et importe dans les comparables.
//
// POST   /api/comparables-inbox  Header X-FIDI-Token = <token utilisateur>
//                                Body { source, url, prix, surface, pieces,
//                                       adresse, titre, ... }
// GET    /api/comparables-inbox  Header X-FIDI-Token → liste des items reçus
// DELETE /api/comparables-inbox  Header X-FIDI-Token → vide l'inbox

const TTL_MS = 30 * 24 * 3600 * 1000; // 30 jours
const MAX_ITEMS = 200;

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-FIDI-Token",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

async function getStore() {
  const mod = await import("@netlify/blobs");
  try {
    return mod.getStore({ name: "fidi-comparables-inbox", consistency: "strong" });
  } catch (e) {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
    if (siteID && token) return mod.getStore({ name: "fidi-comparables-inbox", siteID, token, consistency: "eventual" });
    throw new Error("Blobs indisponible : " + e.message);
  }
}

function sanitizeToken(t) {
  return String(t || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function normalize(b) {
  const n = (v) => {
    if (v == null) return null;
    const num = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(num) ? num : null;
  };
  return {
    ts: Date.now(),
    source: String(b.source || "inconnu").slice(0, 30),
    url: String(b.url || "").slice(0, 500),
    titre: String(b.titre || "").slice(0, 200),
    type: String(b.type || "").slice(0, 40),
    prix: n(b.prix),
    surface: n(b.surface),
    pieces: n(b.pieces),
    chambres: n(b.chambres),
    surface_terrain: n(b.surface_terrain),
    dpe: String(b.dpe || "").slice(0, 5),
    ges: String(b.ges || "").slice(0, 5),
    adresse: String(b.adresse || "").slice(0, 200),
    commune: String(b.commune || "").slice(0, 100),
    cp: String(b.cp || "").slice(0, 10),
    description: String(b.description || "").slice(0, 1000),
    photo: String(b.photo || "").slice(0, 500),
    ref: String(b.ref || "").slice(0, 60),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  const headers = event.headers || {};
  const token = sanitizeToken(headers["x-fidi-token"] || headers["X-FIDI-Token"] || "");
  if (!token) return jsonResp(401, { error: "Header X-FIDI-Token requis" });

  let store;
  try { store = await getStore(); }
  catch (e) { return jsonResp(503, { error: e.message }); }

  const key = "inbox_" + token + ".json";

  if (event.httpMethod === "GET") {
    try {
      const raw = await store.get(key);
      let list = raw ? JSON.parse(raw) : [];
      // Purge des items expirés
      const cutoff = Date.now() - TTL_MS;
      list = list.filter((it) => it.ts && it.ts > cutoff);
      return jsonResp(200, { ok: true, count: list.length, items: list });
    } catch (e) {
      return jsonResp(500, { error: "Lecture impossible : " + e.message });
    }
  }

  if (event.httpMethod === "DELETE") {
    try {
      await store.delete(key);
      return jsonResp(200, { ok: true, cleared: true });
    } catch (e) {
      return jsonResp(500, { error: "Suppression impossible : " + e.message });
    }
  }

  if (event.httpMethod === "POST") {
    let b; try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }
    const item = normalize(b);
    if (!item.url && !item.titre) return jsonResp(400, { error: "url ou titre requis" });
    try {
      const raw = await store.get(key);
      let list = raw ? JSON.parse(raw) : [];
      // Dédup par URL
      if (item.url) list = list.filter((it) => it.url !== item.url);
      list.unshift(item);
      if (list.length > MAX_ITEMS) list = list.slice(0, MAX_ITEMS);
      await store.set(key, JSON.stringify(list));
      return jsonResp(200, { ok: true, count: list.length, saved: item });
    } catch (e) {
      return jsonResp(500, { error: "Enregistrement impossible : " + e.message });
    }
  }

  return jsonResp(405, { error: "Méthode non autorisée" });
};
