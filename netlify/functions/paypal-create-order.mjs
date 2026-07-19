// Netlify Function — Crée une commande PayPal pour une offre de crédits.
// POST /api/paypal/create-order { offerId }
import { getPage, hasToken, readText, readNumber, readCheckbox } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { paypalConfigured, createOrder } from "./_paypal.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET || !hasToken()) return authResp(503, { error: "Service non configuré." });
  if (!paypalConfigured()) return authResp(503, { error: "PayPal non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
  const offerId = String(b.offerId || "").trim();
  if (!offerId) return authResp(400, { error: "offerId requis" });

  try {
    const page = await getPage(offerId);
    const p = page.properties || {};
    const prix = readNumber(p["Prix TTC"]);
    const credits = readNumber(p["Crédits"]);
    const nom = readText(p["Nom"]);
    const active = readCheckbox(p["Active"]);
    if (!active || !(prix > 0) || !(credits > 0)) return authResp(400, { error: "Offre indisponible." });

    // custom_id (défini côté serveur, relayé tel quel par PayPal) : source de vérité au capture.
    const custom = `${me.page.id}|${offerId}|${credits}|${prix}`;
    const order = await createOrder({ montant: prix, description: `FIDI · ${nom} (${credits} crédits)`, custom });
    return authResp(200, { ok: true, orderId: order.id });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, paypal: e.paypal || null });
  }
};
