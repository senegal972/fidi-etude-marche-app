// Netlify Function — Tarifs & Offres (crédits ImmoData Pro)
// GET  /api/offres            → offres actives (utilisateur connecté ; admin voit tout)
// POST /api/offres {action}   → admin : set_active, set_price
//
// Confidentiel : réservé aux professionnels connectés.

import {
  DB, queryDatabase, updatePage, P, hasToken,
  readText, readNumber, readSelect, readCheckbox,
} from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";

function offerFromPage(pg) {
  const p = pg.properties || {};
  return {
    id:          pg.id,
    nom:         readText(p["Nom"]),
    module:      readSelect(p["Module"]),
    palier:      readSelect(p["Palier"]),
    credits:     readNumber(p["Crédits"]),
    prix:        readNumber(p["Prix TTC"]),
    prix_credit: readNumber(p["Prix par crédit"]),
    economie:    readNumber(p["Économie %"]),
    recommande:  readCheckbox(p["Recommandé"]),
    active:      readCheckbox(p["Active"]),
    ordre:       readNumber(p["Ordre"]) || 0,
    description: readText(p["Description"]),
  };
}

async function allOffers() {
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await queryDatabase(DB.offres, body);
    out.push(...(res.results || []).map(offerFromPage));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  const MOD = ["Cumulatif", "Études de marché", "Avis de valeur"];
  out.sort((a, b) => (MOD.indexOf(a.module) - MOD.indexOf(b.module)) || (a.ordre - b.ordre));
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
      const offers = await allOffers();
      return authResp(200, { ok: true, offres: isAdmin ? offers : offers.filter((o) => o.active) });
    }

    if (event.httpMethod === "POST") {
      if (!isAdmin) return authResp(403, { error: "Réservé aux administrateurs." });
      let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
      const action = String(b.action || "").toLowerCase();
      const id = b.id;
      if (!id) return authResp(400, { error: "id requis" });

      if (action === "set_active") {
        await updatePage(id, { "Active": P.checkbox(!!b.active) });
        return authResp(200, { ok: true, id, active: !!b.active });
      }
      if (action === "set_price") {
        const prix = parseFloat(b.prix);
        if (!Number.isFinite(prix) || prix < 0) return authResp(400, { error: "prix invalide" });
        const credits = parseInt(b.credits) || 0;
        const props = { "Prix TTC": P.number(prix) };
        if (credits > 0) props["Prix par crédit"] = P.number(Math.round((prix / credits) * 100) / 100);
        await updatePage(id, props);
        return authResp(200, { ok: true, id, prix });
      }
      return authResp(400, { error: "Action inconnue : " + action });
    }

    return authResp(405, { error: "Méthode non supportée" });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
