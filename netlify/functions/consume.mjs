// Netlify Function — Débit d'un crédit à l'ÉDITION d'un document (étude/avis).
// POST /api/consume { kind: "etude"|"avis", ref }
//
// C'est l'acte facturé : produire/imprimer un livrable = 1 crédit.
// Ré-éditer le MÊME document (même réf que la dernière éditée) est gratuit.
// Les admins et comptes « Illimité » ne consomment jamais. Sans péage : gratuit.

import { hasToken } from "./_notion.mjs";
import { authResp, currentUser, paywallOn, isUnlimited, setCredits, startNewCycle } from "./_auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Authentification non configurée." });
  if (!hasToken()) return authResp(503, { error: "Notion non configuré." });

  const found = await currentUser(event);
  if (!found) return authResp(401, { error: "Connexion requise.", need_auth: true });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
  const kind = (b.kind || "").toLowerCase();
  const ref = String(b.ref || "").trim();

  // Péage inactif → édition libre.
  if (!paywallOn()) return authResp(200, { ok: true, facture: false, raison: "peage_inactif", credits: found.user.credits });
  // Accès illimité (admin / partenaire) → jamais débité.
  if (isUnlimited(found.user)) return authResp(200, { ok: true, facture: false, raison: "illimite", illimite: true });

  try {
    // Ré-édition du même document → gratuit.
    if (ref && ref === found.user.derniereRef) {
      return authResp(200, { ok: true, facture: false, raison: "deja_edite", credits: found.user.credits });
    }
    if (found.user.credits < 1) {
      return authResp(402, { error: "Crédits épuisés. Rechargez pour éditer ce document.", credits: 0, need_credits: true });
    }
    const restants = found.user.credits - 1;
    await setCredits(found.page.id, restants);
    await startNewCycle(found.page.id, ref); // nouveau cycle : compteur d'essais remis à zéro
    return authResp(200, {
      ok: true, facture: true, kind, ref,
      credits_restants: restants, recherches_utilisees: 0,
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
