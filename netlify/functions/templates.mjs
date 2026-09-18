// Netlify Function — Templates (profils types) & feature flags par client.
// GET  /api/templates            → modules + templates (système + custom Notion si configuré)
// POST /api/templates {action}   → admin : save (upsert custom), delete
//
// Persistance custom : base Notion optionnelle NOTION_DB_TEMPLATES (propriétés :
//   Nom (title), Slug (rich_text), Flags (rich_text = JSON), Systeme (checkbox)).
// Sans cette base : seuls les templates SYSTÈME sont servis (déjà exploitables).
//
// ⬇️ COUCHE D'ABSTRACTION DONNÉES : tout l'I/O template est ici. Le jour de la
// migration Supabase, remplacer ce corps par supabase.from('templates')… sans
// toucher au frontend (qui ne consomme que la forme JSON ci-dessous).

import { hasToken, queryDatabase, createPage, updatePage, archivePage, ensureProperty, P, readText, readSelect, readCheckbox } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";

// Modules de l'application (source unique de vérité, alignée sur le frontend).
export const MODULES = [
  { key: "dvf", label: "Transactions DVF" },
  { key: "estimation_venale", label: "Estimation vénale (bornes)" },
  { key: "georisques", label: "Géorisques" },
  { key: "pprn", label: "Zonage réglementaire PPRN" },
  { key: "dpe", label: "DPE / ADEME" },
  { key: "urbanisme", label: "Géoportail de l'Urbanisme" },
  { key: "cadastre", label: "Cadastre / parcelle" },
  { key: "potentiel_foncier", label: "Potentiel foncier (décote, promoteur)" },
  { key: "loyers_marche", label: "Loyers de marché" },
  { key: "delais_vente", label: "Délais de vente" },
  { key: "avis_valeur", label: "Avis de valeur" },
  { key: "export_pdf", label: "Export PDF / récap" },
  { key: "enrichir", label: "Enrichissement (Géorisques/ONF/IDG)" },
];
const KEYS = MODULES.map((m) => m.key);
const allFlags = (v) => Object.fromEntries(KEYS.map((k) => [k, v]));
const withOn = (base, on) => ({ ...base, ...Object.fromEntries(on.map((k) => [k, true])) });

// Templates SYSTÈME (non supprimables).
const SYSTEM = [
  { slug: "complet", name: "Complet (Agent immobilier)", is_system: true, flags: allFlags(true) },
  { slug: "banque", name: "Banque", is_system: true,
    flags: withOn(allFlags(false), ["estimation_venale", "dvf", "georisques", "pprn", "dpe", "export_pdf", "avis_valeur", "enrichir"]) },
  { slug: "promoteur", name: "Bureau d'études / Promoteur", is_system: true,
    flags: withOn(allFlags(false), ["urbanisme", "cadastre", "potentiel_foncier", "dvf", "estimation_venale", "georisques", "pprn", "export_pdf"]) },
];

const DB_TPL = process.env.NOTION_DB_TEMPLATES || "";

function tplFromPage(pg) {
  const p = pg.properties || {};
  let flags = {};
  try { flags = JSON.parse(readText(p["Flags"]) || "{}"); } catch { flags = {}; }
  // Normalise : toutes les clés connues présentes (défaut true si absent).
  const norm = allFlags(true);
  for (const k of KEYS) if (typeof flags[k] === "boolean") norm[k] = flags[k];
  return { id: pg.id, slug: readText(p["Slug"]) || "", name: readText(p["Nom"]) || "", is_system: false, flags: norm };
}

async function customTemplates() {
  if (!DB_TPL) return [];
  const out = [];
  let cursor;
  do {
    const r = await queryDatabase(DB_TPL, { page_size: 100, start_cursor: cursor });
    out.push(...(r.results || []).map(tplFromPage));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out.filter((t) => t.slug);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Auth non configurée." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });
  const isAdmin = me.user.role === "Administrateur";

  try {
    if (event.httpMethod === "GET") {
      const custom = hasToken() ? await customTemplates() : [];
      return authResp(200, { ok: true, modules: MODULES, templates: [...SYSTEM, ...custom], custom_store: !!DB_TPL });
    }

    if (event.httpMethod === "POST") {
      if (!isAdmin) return authResp(403, { error: "Réservé aux administrateurs." });
      if (!hasToken()) return authResp(503, { error: "Notion non configuré." });
      if (!DB_TPL) return authResp(503, { error: "Templates custom non configurés : définir NOTION_DB_TEMPLATES (base Notion : Nom, Slug, Flags, Systeme)." });
      let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
      const action = String(b.action || "save").toLowerCase();

      if (action === "delete") {
        if (!b.id) return authResp(400, { error: "id requis" });
        await archivePage(b.id);
        return authResp(200, { ok: true, deleted: b.id });
      }
      // save (upsert)
      const slug = String(b.slug || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40);
      const name = String(b.name || "").trim().slice(0, 100);
      if (!slug || !name) return authResp(400, { error: "name + slug requis" });
      if (SYSTEM.some((s) => s.slug === slug)) return authResp(400, { error: "Slug réservé (template système)." });
      const flags = {};
      for (const k of KEYS) flags[k] = !!(b.flags && b.flags[k]);
      await ensureProperty(DB_TPL, "Slug", { rich_text: {} });
      await ensureProperty(DB_TPL, "Flags", { rich_text: {} });
      await ensureProperty(DB_TPL, "Systeme", { checkbox: {} });
      const props = {
        "Nom": P.title(name),
        "Slug": P.text(slug),
        "Flags": P.text(JSON.stringify(flags)),
        "Systeme": P.checkbox(false),
      };
      if (b.id) { await updatePage(b.id, props); return authResp(200, { ok: true, id: b.id, slug }); }
      const pg = await createPage(DB_TPL, props);
      return authResp(200, { ok: true, id: pg.id, slug });
    }

    return authResp(405, { error: "Méthode non supportée" });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
