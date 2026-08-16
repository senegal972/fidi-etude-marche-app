// Netlify Function — Boîte de réception des comparables (extension FIDI ACM)
// API Functions v2 (Web-standard Request/Response) : le contexte Blobs est
// automatiquement injecté par Netlify. Aucun NETLIFY_SITE_ID/TOKEN requis.
//
// POST   /api/comparables-inbox  Header X-FIDI-Token = <token utilisateur>
//                                Body { source, url, prix, surface, pieces, ... }
// GET    /api/comparables-inbox  Header X-FIDI-Token → liste des items reçus
// DELETE /api/comparables-inbox  Header X-FIDI-Token → vide l'inbox

import { getStore } from "@netlify/blobs";

const TTL_MS = 30 * 24 * 3600 * 1000; // 30 jours
const MAX_ITEMS = 200;

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-FIDI-Token",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
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

export default async (req) => {
  if (req.method === "OPTIONS") return json(200, {});

  const token = sanitizeToken(req.headers.get("x-fidi-token") || "");
  if (!token) return json(401, { error: "Header X-FIDI-Token requis" });

  // getStore() est auto-injecté en Functions v2 sur Netlify (contexte Blobs
  // implicite via NETLIFY_BLOBS_CONTEXT). Pas besoin de SITE_ID/AUTH_TOKEN.
  let store;
  try { store = getStore({ name: "fidi-comparables-inbox", consistency: "strong" }); }
  catch (e) { return json(503, { error: "Blobs indisponible : " + e.message }); }

  const key = "inbox_" + token + ".json";

  if (req.method === "GET") {
    try {
      const raw = await store.get(key);
      let list = raw ? JSON.parse(raw) : [];
      const cutoff = Date.now() - TTL_MS;
      list = list.filter((it) => it.ts && it.ts > cutoff);
      return json(200, { ok: true, count: list.length, items: list });
    } catch (e) {
      return json(500, { error: "Lecture impossible : " + e.message });
    }
  }

  if (req.method === "DELETE") {
    try { await store.delete(key); return json(200, { ok: true, cleared: true }); }
    catch (e) { return json(500, { error: "Suppression impossible : " + e.message }); }
  }

  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return json(400, { error: "JSON invalide" }); }
    const item = normalize(b);
    if (!item.url && !item.titre) return json(400, { error: "url ou titre requis" });
    try {
      const raw = await store.get(key);
      let list = raw ? JSON.parse(raw) : [];
      if (item.url) list = list.filter((it) => it.url !== item.url);
      list.unshift(item);
      if (list.length > MAX_ITEMS) list = list.slice(0, MAX_ITEMS);
      await store.set(key, JSON.stringify(list));
      return json(200, { ok: true, count: list.length, saved: item });
    } catch (e) {
      return json(500, { error: "Enregistrement impossible : " + e.message });
    }
  }

  return json(405, { error: "Méthode non autorisée" });
};

export const config = { path: "/api/comparables-inbox" };
