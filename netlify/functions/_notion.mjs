// Helper Notion partagé pour les fonctions FIDI.
// Le token vient de la variable d'environnement NOTION_TOKEN (intégration interne).
// Les IDs de bases sont surchargeables via env, avec valeurs par défaut.

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

export const DB = {
  avis:         process.env.NOTION_DB_AVIS          || "b26ae2c5-98c4-4da1-80bf-3504ca608de3",
  etude:        process.env.NOTION_DB_ETUDE         || "81d2020d-24fe-4041-8dde-55b5215a6104",
  facture:      process.env.NOTION_DB_FACTURE       || "cc21e698-b480-49ff-964f-b9bb16ce384e",
  etudeAnnees:  process.env.NOTION_DB_ETUDE_ANNEES  || "d719f26110b84560b9bedbf2fa4fe8c5",
  users:        process.env.NOTION_DB_USERS         || "d23a2e167eb44c7f8f7f216535ec40ec",
  offres:       process.env.NOTION_DB_OFFRES        || "391ec67b0b2e4d2eab82921124bf4ea6",
  paiements:    process.env.NOTION_DB_PAIEMENTS     || "0e270b98a8124bec9d7803f12dfea510",
};

export const CORS_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function jsonResp(status, body) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export function hasToken() {
  return !!process.env.NOTION_TOKEN;
}

async function notionFetch(path, method, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    const err = new Error(data?.message || `Notion HTTP ${r.status}`);
    err.status = r.status;
    err.notion = data;
    throw err;
  }
  return data;
}

// ─── Property builders (API 2022-06-28) ───────────────────────────────────────
export const P = {
  title:  (v) => ({ title: [{ text: { content: String(v ?? "").slice(0, 2000) } }] }),
  text:   (v) => ({ rich_text: v == null || v === "" ? [] : [{ text: { content: String(v).slice(0, 2000) } }] }),
  number: (v) => ({ number: (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v) }),
  date:   (v) => ({ date: v ? { start: v } : null }),
  url:    (v) => ({ url: v || null }),
  email:  (v) => ({ email: v || null }),
  select: (v) => ({ select: v ? { name: String(v) } : null }),
  status: (v) => ({ status: v ? { name: String(v) } : null }),
  multi_select: (arr) => ({ multi_select: (Array.isArray(arr) ? arr : []).filter((x) => x != null && x !== "").map((name) => ({ name: String(name).slice(0, 100) })) }),
  relation: (ids) => ({ relation: (Array.isArray(ids) ? ids : []).filter(Boolean).map((id) => ({ id })) }),
  checkbox: (v) => ({ checkbox: !!v }),
};

// ─── Property readers (inverse des builders P.*) ──────────────────────────────
export function readNumber(prop) {
  if (!prop) return null;
  return typeof prop.number === "number" ? prop.number : (prop.number ?? null);
}
export function readText(prop) {
  if (!prop) return "";
  const arr = prop.rich_text || prop.title;
  if (!Array.isArray(arr)) return "";
  return arr.map((t) => t.plain_text ?? t.text?.content ?? "").join("");
}
export function readSelect(prop) {
  return (prop && prop.select && prop.select.name) || null;
}
export function readMultiSelect(prop) {
  return prop && Array.isArray(prop.multi_select) ? prop.multi_select.map((o) => o.name) : [];
}
export function readCheckbox(prop) {
  return !!(prop && prop.checkbox);
}

// Découpe une longue chaîne JSON en plusieurs rich_text blocks (limite 2000 char/segment)
export function bigText(v) {
  const s = String(v ?? "");
  const chunks = [];
  for (let i = 0; i < s.length; i += 1900) chunks.push(s.slice(i, i + 1900));
  return { rich_text: chunks.map((c) => ({ text: { content: c } })) };
}

export function readBigText(prop) {
  if (!prop || !Array.isArray(prop.rich_text)) return "";
  return prop.rich_text.map((t) => t.plain_text ?? t.text?.content ?? "").join("");
}

export async function createPage(databaseId, properties) {
  return notionFetch("/pages", "POST", { parent: { database_id: databaseId }, properties });
}

export async function updatePage(pageId, properties) {
  return notionFetch(`/pages/${pageId}`, "PATCH", { properties });
}

export async function getPage(pageId) {
  return notionFetch(`/pages/${pageId}`, "GET");
}

export async function archivePage(pageId) {
  return notionFetch(`/pages/${pageId}`, "PATCH", { archived: true });
}

export async function queryDatabase(databaseId, body = {}) {
  return notionFetch(`/databases/${databaseId}/query`, "POST", body);
}

// Cherche une page par valeur de titre (Référence) ; renvoie l'id ou null.
export async function findByRef(databaseId, titleProp, ref) {
  const data = await queryDatabase(databaseId, {
    filter: { property: titleProp, title: { equals: String(ref) } },
    page_size: 1,
  });
  return data.results?.[0]?.id || null;
}
