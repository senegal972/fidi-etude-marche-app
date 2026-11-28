// Netlify Function — Liste des dossiers récents (avis ou études)
// GET /api/notion-list?kind=avis|etude&limit=20

import { DB, jsonResp, hasToken, queryDatabase, readBigText } from "./_notion.mjs";
import { factureLockMap } from "./_facture.mjs";

function summarize(kind, page) {
  const p = page.properties || {};
  const txt = (x) => (x?.rich_text || []).map((t) => t.plain_text).join("");
  const title = (x) => (x?.title || []).map((t) => t.plain_text).join("");
  const common = {
    ref:        title(p["Référence"]),
    date:       p["Date"]?.date?.start || null,
    adresse:    txt(p["Adresse"]),
    commune:    txt(p["Commune"]),
    type_bien:  p["Type de bien"]?.select?.name || null,
    surface:    p["Surface m2"]?.number ?? null,
    client:     txt(p["Client"]),
    statut:     p["Statut"]?.status?.name || null,
    statut_facture: p["Statut facture"]?.select?.name || null,
    page_url:   page.url,
    page_id:    page.id,
  };
  if (kind === "avis") {
    return { ...common, valeur: p["Valeur retenue"]?.number ?? null };
  }
  return {
    ...common,
    score:      p["Score potentiel"]?.number ?? null,
    estimation: p["Estimation"]?.number ?? null,
    code_insee: txt(p["Code INSEE"]),
  };
}

import { sessionRequise } from "./_auth.mjs";
import { lecteurDe, chargerComptes, comptesVisibles, peutVoir, proprietaireDePage, colonneProprietaire, PROP_PROPRIETAIRE } from "./_documents.mjs";
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  // Session vérifiée avant tout le reste : ces dossiers contiennent des noms de clients.
  const s = await sessionRequise(event); if (s.refus) return s.refus;
  const lecteur = lecteurDe(s.found), admin = lecteur.role === "Administrateur";

  if (!hasToken()) {
    return jsonResp(503, { error: "Notion non configuré (NOTION_TOKEN absent).", configured: false });
  }

  const q = event.queryStringParameters || {};
  const kind = (q.kind || "avis").toLowerCase();
  const limit = Math.min(parseInt(q.limit) || 20, 100);
  const databaseId = kind === "etude" ? DB.etude : DB.avis;

  try {
    // Confidentialité : un compte ne reçoit que ses dossiers et ceux que des membres de son groupe lui ouvrent (_documents.mjs).
    // Le filtre est posé dans la requête ET revérifié dossier par dossier ; l'administrateur voit tout.
    const colonne = await colonneProprietaire(databaseId);
    let comptes = [];
    try { comptes = await chargerComptes(); } catch (e) { if (!admin) comptes = [lecteur]; }
    const visibles = comptesVisibles(lecteur, comptes.some((c) => c.email === lecteur.email) ? comptes : [...comptes, lecteur]);
    const parEmail = Object.fromEntries(comptes.map((c) => [c.email, c]));
    if (!admin && !colonne) return jsonResp(200, { kind, count: 0, items: [], moi: lecteur.email });
    const filtre = admin ? null : { or: visibles.slice(0, 90).map((c) => ({ property: PROP_PROPRIETAIRE, rich_text: { equals: c.email } })) };
    const [data, lockMap] = await Promise.all([
      queryDatabase(databaseId, {
        sorts: [{ property: "Date", direction: "descending" }],
        page_size: limit,
        ...(filtre ? { filter: filtre } : {}),
      }),
      factureLockMap(100), // { ref -> { locked, paye, raison } } via la base Factures
    ]);
    // verrou = dossier envoyé/payé → non supprimable (icône rouge côté client).
    const items = (data.results || []).filter((pg) => {
      const pr = proprietaireDePage(pg);
      return admin || pr === lecteur.email || peutVoir(lecteur, parEmail[pr] || null);
    }).map((pg) => {
      const it = summarize(kind, pg);
      const pr = proprietaireDePage(pg), cp = parEmail[pr] || null;
      it.proprietaire = pr; it.proprietaire_nom = cp ? (cp.nom || pr) : (pr || "");
      it.groupe = cp ? cp.groupe : ""; it.a_moi = !!pr && pr === lecteur.email; it.modifiable = admin || it.a_moi;
      const lk = lockMap[it.ref];
      it.verrou = !!(lk && lk.locked);
      it.verrou_raison = lk ? lk.raison : "";
      return it;
    });
    return jsonResp(200, { kind, count: items.length, items, moi: lecteur.email, admin });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
