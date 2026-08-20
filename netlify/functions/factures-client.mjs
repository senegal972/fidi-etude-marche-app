// Netlify Function — Historique factures par client
// GET /api/factures/client?email=xxx&client=YYY
// Retourne toutes les factures pour ce client, triées par date décroissante,
// avec statut (À payer / Payée / Annulée) et montant. Inclut donc l'archive.

import { DB, hasToken, queryDatabase } from "./_notion.mjs";
import { authResp } from "./_auth.mjs";
import { factureFromPage, factureHtmlUrl, reqOrigin } from "./_facture.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "GET") return authResp(405, { error: "GET requis" });
  if (!hasToken()) return authResp(503, { error: "Service non configuré." });

  const q = event.queryStringParameters || {};
  const email = String(q.email || "").trim().toLowerCase();
  const client = String(q.client || "").trim();

  if (!email && !client) return authResp(400, { error: "email ou client requis" });

  try {
    // Filtre par email (le plus fiable) ou nom client (fallback / large)
    let filter;
    if (email) {
      filter = { property: "Email client", email: { equals: email } };
    } else {
      filter = { property: "Client", rich_text: { contains: client } };
    }

    const pages = [];
    let cursor;
    for (let i = 0; i < 5; i++) { // max 5 pages = ~500 factures
      const r = await queryDatabase(DB.facture, {
        filter,
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
      return {
        ref: f.numero,
        date: f.date,
        client: f.client,
        email: f.email,
        adresse: f.adresse,
        type: f.type,
        libelle: f.libelle,
        montant: f.montant,
        statut: f.statut,
        paye: f.paye,
        jeton: f.jeton,
        delivery_url: f.jeton ? `${origin}/l/${f.jeton}` : "",
        facture_url: factureHtmlUrl(f, origin),
      };
    });

    // Statistiques utiles pour l'UI historique
    const total = items.length;
    const paid = items.filter((x) => x.statut === "Payée");
    const pending = items.filter((x) => x.statut === "À payer");
    const cancelled = items.filter((x) => x.statut === "Annulée");
    const totalPaid = paid.reduce((a, x) => a + (x.montant || 0), 0);
    const totalPending = pending.reduce((a, x) => a + (x.montant || 0), 0);

    return authResp(200, {
      ok: true,
      count: total,
      items,
      stats: {
        paid: paid.length,
        pending: pending.length,
        cancelled: cancelled.length,
        total_paid_eur: totalPaid,
        total_pending_eur: totalPending,
      },
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
