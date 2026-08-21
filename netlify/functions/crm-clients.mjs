// Netlify Function — CRM clients (lecture Notion optionnelle)
// GET /api/crm-clients
// - Si NOTION_DB_CRM_CLIENTS non défini : renvoie items:[] + configured:false
// - Sinon : query la database, mappe propriétés vers schéma standard client FIDI
//
// Schéma attendu dans la database Notion (adaptable via env NOTION_CRM_PROP_*) :
//   Nom (title), Email (email), Téléphone (phone_number), Adresse (rich_text),
//   Ville (rich_text), Code postal (rich_text), Type (select), Notes (rich_text)

import { hasToken, queryDatabase } from "./_notion.mjs";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "private, max-age=300",
};

function j(status, body) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

const CRM_DB = process.env.NOTION_DB_CRM_CLIENTS || "";
const PROP = {
  nom:       process.env.NOTION_CRM_PROP_NOM       || "Nom",
  email:     process.env.NOTION_CRM_PROP_EMAIL     || "Email",
  telephone: process.env.NOTION_CRM_PROP_TELEPHONE || "Téléphone",
  adresse:   process.env.NOTION_CRM_PROP_ADRESSE   || "Adresse",
  ville:     process.env.NOTION_CRM_PROP_VILLE     || "Ville",
  cp:        process.env.NOTION_CRM_PROP_CP        || "Code postal",
  type:      process.env.NOTION_CRM_PROP_TYPE      || "Type",
  notes:     process.env.NOTION_CRM_PROP_NOTES     || "Notes",
};

function readTitle(p) { return (p?.title || []).map((t) => t.plain_text).join("").trim(); }
function readRichText(p) { return (p?.rich_text || []).map((t) => t.plain_text).join("").trim(); }
function readEmail(p) { return p?.email || ""; }
function readPhone(p) { return p?.phone_number || ""; }
function readSelect(p) { return p?.select?.name || ""; }

function toClient(page) {
  const props = page.properties || {};
  const nom = readTitle(props[PROP.nom]) || readRichText(props[PROP.nom]) || "";
  const email = readEmail(props[PROP.email]);
  const tel = readPhone(props[PROP.telephone]);
  const adresse = readRichText(props[PROP.adresse]);
  const ville = readRichText(props[PROP.ville]);
  const cp = readRichText(props[PROP.cp]);
  const type = readSelect(props[PROP.type]);
  const notes = readRichText(props[PROP.notes]);
  const adressePlain = [adresse, [cp, ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    id: "crm:" + page.id,
    label: nom || email || "(sans nom)",
    nom, email, telephone: tel,
    adresse: adressePlain, ville, cp,
    type, notes, source: "crm",
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });

  if (!CRM_DB || !hasToken()) {
    return j(200, {
      ok: true,
      configured: false,
      items: [],
      hint: "Pour activer : définir NOTION_TOKEN + NOTION_DB_CRM_CLIENTS (id database Notion Contacts/Clients). Propriétés attendues : Nom, Email, Téléphone, Adresse, Ville, Code postal, Type, Notes. Nommage adaptable via NOTION_CRM_PROP_*.",
    });
  }

  try {
    const pages = [];
    let cursor;
    for (let i = 0; i < 5; i++) {
      const r = await queryDatabase(CRM_DB, {
        page_size: 100,
        start_cursor: cursor,
      });
      pages.push(...(r.results || []));
      if (!r.has_more) break;
      cursor = r.next_cursor;
    }
    const items = pages.map(toClient).filter((c) => c.nom || c.email);
    return j(200, { ok: true, configured: true, count: items.length, items });
  } catch (e) {
    return j(e.status || 500, { error: e.message, notion: e.notion || null, configured: true });
  }
};
