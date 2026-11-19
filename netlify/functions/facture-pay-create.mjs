// Netlify Function — Crée une commande PayPal pour régler une facture.
// POST /api/facture/pay-create { token }   (public — clé = jeton de remise)
import { hasToken } from "./_notion.mjs";
import { jsonResp } from "./_notion.mjs";
import { paypalConfigured, createOrder, erreurPaypal, journalPaypal } from "./_paypal.mjs";
import { findFactureByToken, factureFromPage } from "./_facture.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });
  if (!hasToken()) return jsonResp(503, { error: "Service non configuré." });
  if (!paypalConfigured()) return jsonResp(503, { error: "Paiement en ligne indisponible." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }
  const token = String(b.token || "").trim();
  if (!token) return jsonResp(400, { error: "token requis" });

  try {
    const pg = await findFactureByToken(token);
    if (!pg) return jsonResp(404, { error: "Facture introuvable." });
    const f = factureFromPage(pg);
    if (f.paye) return jsonResp(409, { error: "Facture déjà réglée.", paye: true });
    if (f.statut === "Annulée") return jsonResp(409, { error: "Cette facture a été annulée." });
    if (!(f.montant > 0)) return jsonResp(400, { error: "Montant de facture invalide." });

    const order = await createOrder({
      montant: f.montant,
      description: `FIDI · Facture ${f.numero}`.slice(0, 127),
      custom: token,
    });
    return jsonResp(200, { ok: true, orderId: order.id });
  } catch (e) {
    journalPaypal("facture-pay-create", e);
    const x = erreurPaypal(e);
    return jsonResp(e.status || 500, { error: x.message, code: x.code });
  }
};
