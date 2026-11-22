// GET /api/paypal/diagnostic — contrôle des réglages du paiement en ligne. Administrateur uniquement.
// Demande un jeton d'accès à PayPal avec l'identifiant et le secret du site : rien n'est créé ni encaissé.
import { authResp, currentUser } from "./_auth.mjs";
import { hasToken } from "./_notion.mjs";
import { diagnosticPaypal } from "./_paypal.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!hasToken() || !process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });
  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });
  const d = await diagnosticPaypal();
  const virement = !!(process.env.FIDI_VIREMENT_IBAN);
  const email = !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
  return authResp(200, { ok: true, paypal: d, virement_defaut: virement, email });
};
