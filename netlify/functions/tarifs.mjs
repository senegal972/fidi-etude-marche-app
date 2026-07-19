// Netlify Function — Grille tarifaire des prestations facturées au client.
// GET  /api/tarifs           → prestations actives (admin voit tout)
// POST /api/tarifs {action}  → admin : create, set_price, set_active, delete
//
// Réservé aux professionnels connectés. « Une information = un champ » : chaque
// donnée d'une prestation est une propriété Notion dédiée (base Tarifs prestations).

import {
  DB, queryDatabase, createPage, updatePage, archivePage, P, hasToken,
  readText, readNumber, readSelect, readCheckbox,
} from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";

const CATEGORIES = ["Avis de valeur", "Étude de marché", "Option", "Forfait"];

function tarifFromPage(pg) {
  const p = pg.properties || {};
  return {
    id:          pg.id,
    prestation:  readText(p["Prestation"]),
    categorie:   readSelect(p["Catégorie"]),
    prix:        readNumber(p["Prix TTC"]),
    actif:       readCheckbox(p["Actif"]),
    ordre:       readNumber(p["Ordre"]) || 0,
    description: readText(p["Description"]),
  };
}

async function allTarifs() {
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await queryDatabase(DB.tarifs, body);
    out.push(...(res.results || []).map(tarifFromPage));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  out.sort((a, b) => (CATEGORIES.indexOf(a.categorie) - CATEGORIES.indexOf(b.categorie)) || (a.ordre - b.ordre));
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Authentification non configurée." });
  if (!hasToken()) return authResp(503, { error: "Notion non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });
  const isAdmin = me.user.role === "Administrateur";

  try {
    if (event.httpMethod === "GET") {
      const list = await allTarifs();
      return authResp(200, { ok: true, tarifs: isAdmin ? list : list.filter((t) => t.actif) });
    }

    if (event.httpMethod === "POST") {
      if (!isAdmin) return authResp(403, { error: "Réservé aux administrateurs." });
      let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
      const action = String(b.action || "").toLowerCase();

      if (action === "create") {
        const prestation = String(b.prestation || "").trim();
        const prix = parseFloat(b.prix);
        if (!prestation) return authResp(400, { error: "Nom de prestation requis." });
        if (!Number.isFinite(prix) || prix < 0) return authResp(400, { error: "Prix invalide." });
        const categorie = CATEGORIES.includes(b.categorie) ? b.categorie : "Option";
        const page = await createPage(DB.tarifs, {
          "Prestation": P.title(prestation),
          "Catégorie":  P.select(categorie),
          "Prix TTC":   P.number(prix),
          "Actif":      P.checkbox(b.actif !== false),
          "Ordre":      P.number(parseInt(b.ordre) || 99),
          "Description":P.text(b.description || ""),
        });
        return authResp(200, { ok: true, id: page.id });
      }

      const id = b.id;
      if (!id) return authResp(400, { error: "id requis" });

      if (action === "set_price") {
        const prix = parseFloat(b.prix);
        if (!Number.isFinite(prix) || prix < 0) return authResp(400, { error: "Prix invalide." });
        await updatePage(id, { "Prix TTC": P.number(prix) });
        return authResp(200, { ok: true, id, prix });
      }
      if (action === "set_active") {
        await updatePage(id, { "Actif": P.checkbox(!!b.actif) });
        return authResp(200, { ok: true, id, actif: !!b.actif });
      }
      if (action === "delete") {
        await archivePage(id);
        return authResp(200, { ok: true, id, deleted: true });
      }
      return authResp(400, { error: "Action inconnue : " + action });
    }

    return authResp(405, { error: "Méthode non supportée" });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
