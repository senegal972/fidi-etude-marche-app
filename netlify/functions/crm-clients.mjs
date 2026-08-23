// Netlify Function — CRM clients (lecture Notion optionnelle)
// GET /api/crm-clients
// - Si NOTION_DB_CRM_CLIENTS non défini : renvoie items:[] + configured:false
// - Sinon : query la database, mappe propriétés vers schéma standard client FIDI
//
// Schéma attendu dans la database Notion (adaptable via env NOTION_CRM_PROP_*) :
//   Nom (title), Email (email), Téléphone (phone_number), Adresse (rich_text),
//   Ville (rich_text), Code postal (rich_text), Type (select), Notes (rich_text)

import { hasToken, queryDatabase, createPage } from "./_notion.mjs";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "private, max-age=60",
};

function j(status, body) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

// Defaults calés sur la DB « Contacts CRM » du hub Optimmo Dom.
// Chaque nom peut être surchargé via env NOTION_CRM_PROP_* si la DB diffère.
const CRM_DB = process.env.NOTION_DB_CRM_CLIENTS || "cbb61ceb-5059-440d-b4c2-e18ca8fb1dab";
const PROP = {
  nom:       process.env.NOTION_CRM_PROP_NOM       || "Nom complet",  // title
  email:     process.env.NOTION_CRM_PROP_EMAIL     || "Email",
  telephone: process.env.NOTION_CRM_PROP_TELEPHONE || "Téléphone",
  adresse:   process.env.NOTION_CRM_PROP_ADRESSE   || "Adresse",
  ville:     process.env.NOTION_CRM_PROP_VILLE     || "Localisation bien",
  cp:        process.env.NOTION_CRM_PROP_CP        || "",              // pas de champ dédié CP
  type:      process.env.NOTION_CRM_PROP_TYPE      || "Statut",       // vendeur/acquéreur/bailleur
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

function toNotionProps(client) {
  const p = {};
  const nom = String(client.nom || client.label || "").trim();
  if (nom) p[PROP.nom] = { title: [{ text: { content: nom.slice(0, 200) } }] };
  const email = String(client.email || "").trim();
  if (email) p[PROP.email] = { email };
  const tel = String(client.telephone || "").trim();
  if (tel) p[PROP.telephone] = { phone_number: tel };
  const adresse = String(client.adresse || "").trim();
  if (adresse) p[PROP.adresse] = { rich_text: [{ text: { content: adresse.slice(0, 2000) } }] };
  const ville = String(client.ville || "").trim();
  if (ville) p[PROP.ville] = { rich_text: [{ text: { content: ville.slice(0, 200) } }] };
  const cp = String(client.cp || "").trim();
  if (cp) p[PROP.cp] = { rich_text: [{ text: { content: cp.slice(0, 20) } }] };
  const type = String(client.type || "").trim();
  if (type) p[PROP.type] = { select: { name: type.slice(0, 100) } };
  const notes = String(client.notes || "").trim();
  if (notes) p[PROP.notes] = { rich_text: [{ text: { content: notes.slice(0, 2000) } }] };
  return p;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});

  if (event.httpMethod === "POST") {
    if (!CRM_DB || !hasToken()) {
      return j(503, {
        error: "CRM non configuré",
        configured: false,
        hint: "Définir NOTION_TOKEN + NOTION_DB_CRM_CLIENTS dans Netlify pour activer la création côté CRM.",
      });
    }
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return j(400, { error: "JSON invalide" }); }
    if (!body.nom && !body.email) return j(400, { error: "nom ou email requis" });
    try {
      const props = toNotionProps(body);
      const page = await createPage(CRM_DB, props);
      return j(200, { ok: true, created: true, id: page.id, client: toClient(page) });
    } catch (e) {
      return j(e.status || 500, { error: e.message, notion: e.notion || null });
    }
  }

  if (event.httpMethod !== "GET") return j(405, { error: "GET ou POST requis" });

  if (!CRM_DB || !hasToken()) {
    return j(200, {
      ok: true,
      configured: false,
      items: [],
      hint: "Pour activer : définir NOTION_TOKEN + NOTION_DB_CRM_CLIENTS (id database Notion Contacts/Clients). Propriétés attendues : Nom, Email, Téléphone, Adresse, Ville, Code postal, Type, Notes. Nommage adaptable via NOTION_CRM_PROP_*.",
    });
  }

  try {
    // Filtre : ne remonter QUE les vrais clients (Statut OU Qualité contact renseignés).
    // Sinon la base Contacts CRM contient 6000+ leads Gmail bruts non qualifiés.
    // Surchargeable via env NOTION_CRM_FILTER_JSON pour cas particuliers.
    let filter;
    try {
      filter = process.env.NOTION_CRM_FILTER_JSON ? JSON.parse(process.env.NOTION_CRM_FILTER_JSON) : {
        or: [
          { property: "Statut", select: { is_not_empty: true } },
          { property: "Qualité contact", select: { is_not_empty: true } },
          { property: "Étape pipeline", number: { is_not_empty: true } },
        ],
      };
    } catch { filter = undefined; }

    const pages = [];
    let cursor;
    for (let i = 0; i < 5; i++) {
      const r = await queryDatabase(CRM_DB, {
        page_size: 100,
        start_cursor: cursor,
        ...(filter ? { filter } : {}),
      });
      pages.push(...(r.results || []));
      if (!r.has_more) break;
      cursor = r.next_cursor;
    }
    const items = pages.map(toClient).filter((c) => c.nom || c.email);
    return j(200, {
      ok: true, configured: true, count: items.length, items,
      filter_applied: !!filter,
      note: "Filtre : contacts avec Statut / Qualité / Étape pipeline renseignés. Surchargeable via NOTION_CRM_FILTER_JSON ou changer la DB via NOTION_DB_CRM_CLIENTS (ex : 11b1edbd9fd04319ba3a708cdb0db6c4 pour Acquéreurs Optimmo).",
    });
  } catch (e) {
    return j(e.status || 500, { error: e.message, notion: e.notion || null, configured: true });
  }
};
