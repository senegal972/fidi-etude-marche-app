// Netlify Function — Profil + solde de l'utilisateur connecté.
// GET /api/moncompte  (et /api/auth/me)
import { authResp, currentUser, paywallOn, costEtude, loginRequired } from "./_auth.mjs";
import { paypalConfigured, paypalClientId, paypalEnv } from "./_paypal.mjs";

const paypalInfo = () => ({ configured: paypalConfigured(), client_id: paypalClientId(), env: paypalEnv() });

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  try {
    const found = await currentUser(event);
    if (!found) {
      return authResp(200, { authenticated: false, paywall: paywallOn(), login_required: loginRequired(), cost_etude: costEtude(), paypal: paypalInfo() });
    }
    const u = found.user;
    return authResp(200, {
      authenticated: true,
      paywall: paywallOn(),
      login_required: loginRequired(),
      cost_etude: costEtude(),
      paypal: paypalInfo(),
      user: {
        email: u.email, nom: u.nom, role: u.role, statut: u.statut, credits: u.credits,
        illimite: u.illimite, quota: u.quota, recherches: u.recherches,
      },
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
