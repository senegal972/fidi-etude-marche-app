// Netlify Function — Débit d'un crédit à l'ÉDITION d'un document hors PDF serveur :
// impression navigateur et facturation. Le PDF serveur débite lui-même (pdf-render.mjs).
// POST /api/consume { kind: "etude"|"avis", cle, ref, extrait? }
// extrait: true : récapitulatif ou PDF du module d'implantation, rattachés au crédit de l'étude.
//
// C'est l'acte facturé : produire/imprimer un livrable = 1 crédit.
// La règle, ré-édition gratuite comprise, est dans _edition.mjs.
// Les admins et comptes « Illimité » ne consomment jamais. Sans péage : gratuit.

import { hasToken } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { deciderEdition, editionFacturable, enregistrerEdition, lireDoc } from "./_edition.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Authentification non configurée." });
  if (!hasToken()) return authResp(503, { error: "Notion non configuré." });

  const found = await currentUser(event);
  if (!found) return authResp(401, { error: "Connexion requise.", need_auth: true });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
  const doc = lireDoc(b);
  if (editionFacturable(found.user) && !doc) {
    return authResp(400, { error: "Document non identifié. Rechargez la page puis réessayez." });
  }

  try {
    const decision = await deciderEdition(found, doc, Date.now(), { extrait: b.extrait === true });
    if (decision.mode === "refus") {
      return authResp(402, { error: "Crédits épuisés. Rechargez pour éditer ce document.", credits: 0, need_credits: true });
    }
    const res = await enregistrerEdition(found, decision, doc);
    if (!res.facture) {
      return authResp(200, { ok: true, facture: false, raison: res.raison, credits: res.credits, illimite: res.raison === "illimite" || undefined });
    }
    return authResp(200, {
      ok: true, facture: true, kind: doc.kind, ref: doc.ref,
      credits_restants: res.credits, recherches_utilisees: 0,
    });
  } catch (e) {
    if (e.status === 402) return authResp(402, { error: e.message, credits: 0, need_credits: true });
    return authResp(e.status || 500, { error: e.message });
  }
};
