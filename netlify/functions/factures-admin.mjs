// Netlify Function — Historique factures ADMIN (toutes factures, filtres avancés)
// GET /api/factures-admin?fidi_only=1&statut=Payée&type=Avis&collab=email
// Réservé au rôle Administrateur.

import { DB, hasToken, queryDatabase } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { factureFromPage, factureHtmlUrl, reqOrigin } from "./_facture.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "GET") return authResp(405, { error: "GET requis" });
  if (!hasToken()) return authResp(503, { error: "Notion non configuré." });
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Auth non configurée." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  const q = event.queryStringParameters || {};
  const fidiOnly = String(q.fidi_only || "").trim() === "1";
  const statutFilter = String(q.statut || "").trim();
  const typeFilter = String(q.type || "").trim();
  const collabFilter = String(q.collab || "").trim().toLowerCase();

  try {
    // Récupère jusqu'à 500 factures récentes (5 pages × 100), triées par date desc.
    const pages = [];
    let cursor;
    for (let i = 0; i < 5; i++) {
      const r = await queryDatabase(DB.facture, {
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ property: "Date", direction: "descending" }],
      });
      pages.push(...(r.results || []));
      if (!r.has_more) break;
      cursor = r.next_cursor;
    }

    const origin = reqOrigin(event);
    const items = pages.map((p) => {
      const f = factureFromPage(p);
      const props = p.properties || {};
      // Champs facultatifs FIDI (facturation split)
      const fidiEncaisse = !!(props["FIDI encaisse"]?.checkbox);
      const commissionPct = props["Commission FIDI %"]?.number ?? 0;
      const collabEmail = (props["Collaborateur"] && props["Collaborateur"].email) ||
                          (props["Collaborateur email"] && props["Collaborateur email"].email) || "";
      const commissionEUR = fidiEncaisse && commissionPct ? Math.round(f.montant * commissionPct) / 100 : 0;
      const reverserEUR = fidiEncaisse ? Math.round((f.montant - commissionEUR) * 100) / 100 : 0;
      return {
        ref: f.numero, date: f.date, client: f.client, email: f.email,
        type: f.type, libelle: f.libelle, montant: f.montant, statut: f.statut,
        paye: f.paye, jeton: f.jeton,
        delivery_url: f.jeton ? `${origin}/l/${f.jeton}` : "",
        facture_url: factureHtmlUrl(f, origin),
        fidi_encaisse: fidiEncaisse,
        commission_pct: commissionPct,
        commission_eur: commissionEUR,
        reverser_eur: reverserEUR,
        collab: collabEmail,
      };
    }).filter((f) => {
      if (fidiOnly && !f.fidi_encaisse) return false;
      if (statutFilter && f.statut !== statutFilter) return false;
      if (typeFilter && (f.type || "").toLowerCase().indexOf(typeFilter.toLowerCase()) < 0) return false;
      if (collabFilter && (f.collab || "").toLowerCase() !== collabFilter) return false;
      return true;
    });

    // Stats agrégées
    const paid = items.filter((x) => x.statut === "Payée");
    const pending = items.filter((x) => x.statut === "À payer");
    const cancelled = items.filter((x) => x.statut === "Annulée");
    const stats = {
      total: items.length,
      paid: paid.length, pending: pending.length, cancelled: cancelled.length,
      total_ttc_paye: paid.reduce((a, x) => a + (x.montant || 0), 0),
      total_ttc_attente: pending.reduce((a, x) => a + (x.montant || 0), 0),
      commissions_fidi_paye: paid.reduce((a, x) => a + (x.commission_eur || 0), 0),
      a_reverser: paid.filter((x) => x.fidi_encaisse).reduce((a, x) => a + (x.reverser_eur || 0), 0),
    };

    return authResp(200, {
      ok: true,
      filters: { fidi_only: fidiOnly, statut: statutFilter, type: typeFilter, collab: collabFilter },
      count: items.length,
      items,
      stats,
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
