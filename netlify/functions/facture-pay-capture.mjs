// Netlify Function — Capture le paiement d'une facture et la débloque.
// POST /api/facture/pay-capture { token, orderId }   (public — clé = jeton)
//
// Sur capture COMPLETED, avec vérification que la commande correspond bien à ce
// jeton et que le montant payé = le montant de la facture, la facture passe
// « Payée » : la page de remise délivre alors le document + la facture acquittée.
import { DB, P, hasToken, updatePage, createPage, jsonResp } from "./_notion.mjs";
import { paypalConfigured, captureOrder } from "./_paypal.mjs";
import { findFactureByToken, factureFromPage, factureHtmlUrl, reqOrigin } from "./_facture.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });
  if (!hasToken()) return jsonResp(503, { error: "Service non configuré." });
  if (!paypalConfigured()) return jsonResp(503, { error: "Paiement en ligne indisponible." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }
  const token   = String(b.token || "").trim();
  const orderId = String(b.orderId || "").trim();
  if (!token || !orderId) return jsonResp(400, { error: "token et orderId requis" });

  try {
    const pg = await findFactureByToken(token);
    if (!pg) return jsonResp(404, { error: "Facture introuvable." });
    let f = factureFromPage(pg);

    // Déjà réglée : idempotent, on renvoie simplement les liens débloqués.
    if (f.paye) {
      const origin = reqOrigin(event);
      return jsonResp(200, { ok: true, deja_regle: true, facture_url: factureHtmlUrl(f, origin), document_url: f.lienDocument });
    }

    const cap = await captureOrder(orderId);
    if (cap.status !== "COMPLETED") {
      return jsonResp(402, { error: "Paiement non finalisé (" + cap.status + ").", statut: cap.status });
    }
    const pu = (cap.purchase_units || [])[0] || {};
    const capture = (((pu.payments || {}).captures) || [])[0] || {};
    const custom = pu.custom_id || capture.custom_id || "";
    const paid = parseFloat(((capture.amount || {}).value) || "0");

    if (custom !== token) return jsonResp(403, { error: "Commande non concordante." });
    if (Math.abs(paid - f.montant) > 0.5) return jsonResp(400, { error: "Montant payé incohérent." });

    const payer = cap.payer || {};
    const moyen = ((payer.payment_source && Object.keys(payer.payment_source)[0]) === "card") ? "Carte" : "PayPal";
    const today = new Date().toISOString().slice(0, 10);

    await updatePage(f.id, {
      "Statut":         P.select("Payée"),
      "Date paiement":  P.date(today),
      "Moyen paiement": P.select(moyen),
      "Montant payé":   P.number(paid),
      "ID transaction": P.text(capture.id || orderId),
    });

    // Journal Paiements (best-effort) — n'empêche pas le déblocage.
    try {
      await createPage(DB.paiements, {
        "Référence":             P.title(capture.id || orderId),
        "Email utilisateur":     P.text(f.email),
        "Offre":                 P.text("Facture " + f.numero),
        "Montant €":             P.number(paid),
        "Moyen":                 P.select(moyen),
        "Statut":                P.select("Payé"),
        "ID transaction PayPal": P.text(capture.id || orderId),
        "Date":                  P.date(today),
      });
    } catch (_) { /* ignore */ }

    f = { ...f, paye: true, statut: "Payée" };
    const origin = reqOrigin(event);
    const facture_url  = factureHtmlUrl(f, origin);
    const document_url = f.lienDocument;

    // Phase C — envoi automatique post-paiement : e-mail au client avec le lien
    // de remise (accès au document livré + facture acquittée). Best-effort :
    // n'empêche jamais la réponse OK au client, ne bloque pas le déblocage.
    if (f.email && process.env.RESEND_API_KEY) {
      const kind = (f.type && f.type.toLowerCase().includes("étude")) ? "étude de marché" : "avis de valeur";
      const titre = f.libelle || f.adresse || f.numero;
      const deliveryUrl = document_url && /^https?:/i.test(document_url) ? document_url
        : (f.jeton ? `${origin}/l/${f.jeton}` : "");
      const payload = {
        to: f.email,
        subject: `Votre ${kind} — FIDI Conseil (${f.numero})`,
        kind,
        titre,
        lien: deliveryUrl || facture_url,
        message: `Votre paiement de ${paid.toFixed(2)} € a bien été reçu. Cliquez ci-dessous pour accéder à votre ${kind} et à votre facture acquittée.`,
      };
      // Fire-and-forget (pas d'await pour ne pas ralentir la réponse au client)
      fetch(`${origin}/.netlify/functions/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }

    return jsonResp(200, {
      ok: true, montant: paid, moyen,
      facture_url,
      document_url,
    });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, paypal: e.paypal || null });
  }
};
