// Netlify Function — Capture une commande PayPal et crédite le compte.
// POST /api/paypal/capture-order { orderId }
//
// Sécurité : le crédit n'est ajouté que sur capture COMPLETED, avec vérification
// que le montant payé correspond au prix de l'offre et que l'acheteur = le compte
// connecté. Journalisé dans la base « Paiements ».
import { DB, createPage, P, hasToken } from "./_notion.mjs";
import { authResp, currentUser, setCredits } from "./_auth.mjs";
import { paypalConfigured, captureOrder } from "./_paypal.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET || !hasToken()) return authResp(503, { error: "Service non configuré." });
  if (!paypalConfigured()) return authResp(503, { error: "PayPal non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
  const orderId = String(b.orderId || "").trim();
  if (!orderId) return authResp(400, { error: "orderId requis" });

  try {
    const cap = await captureOrder(orderId);
    if (cap.status !== "COMPLETED") {
      return authResp(402, { error: "Paiement non finalisé (" + cap.status + ").", statut: cap.status });
    }
    const pu = (cap.purchase_units || [])[0] || {};
    const capture = (((pu.payments || {}).captures) || [])[0] || {};
    const custom = pu.custom_id || capture.custom_id || "";
    const paid = parseFloat(((capture.amount || {}).value) || "0");
    const [userPageId, offerId, creditsStr, prixStr] = String(custom).split("|");
    const credits = parseInt(creditsStr) || 0;
    const prix = parseFloat(prixStr) || 0;

    // Vérifications anti-fraude.
    if (userPageId !== me.page.id) return authResp(403, { error: "Acheteur non concordant." });
    if (!credits || Math.abs(paid - prix) > 0.5) {
      return authResp(400, { error: "Montant payé incohérent avec l'offre." });
    }

    const nouveauSolde = me.user.credits + credits;
    await setCredits(me.page.id, nouveauSolde);

    // Journal Paiements (best-effort).
    try {
      const payer = cap.payer || {};
      const moyen = ((payer.payment_source && Object.keys(payer.payment_source)[0]) === "card") ? "Carte" : "PayPal";
      await createPage(DB.paiements, {
        "Référence":            P.title(capture.id || orderId),
        "Utilisateur":          P.relation([me.page.id]),
        "Email utilisateur":    P.text(me.user.email),
        "Offre":                P.text(offerId),
        "Montant €":            P.number(paid),
        "Crédits ajoutés":      P.number(credits),
        "Moyen":                P.select(moyen),
        "Statut":               P.select("Payé"),
        "ID transaction PayPal":P.text(capture.id || orderId),
        "Date":                 P.date(new Date().toISOString().slice(0, 10)),
      });
    } catch (_) { /* le crédit reste acquis même si le log échoue */ }

    return authResp(200, { ok: true, credits: nouveauSolde, ajoutes: credits, transaction: capture.id });
  } catch (e) {
    // PayPal renvoie une erreur si la commande est déjà capturée : pas de double-crédit.
    return authResp(e.status || 500, { error: e.message, paypal: e.paypal || null });
  }
};
