// /api/auth/oubli — « Mot de passe oublié ». Public.
//
// POST { email }                                → envoie, si le compte existe et est actif, un e-mail avec un lien de
//                                                 réinitialisation valable 1 h. La réponse est TOUJOURS la même : elle ne dit
//                                                 pas si un compte existe pour cette adresse.
// POST { action:"changer", token, password }    → enregistre le nouveau mot de passe choisi par le titulaire.
//
// Le lien porte un JWT { purpose:"reset", email, v } où v est une empreinte du mot de passe actuel : dès que le mot de passe
// change, tous les liens déjà envoyés cessent de fonctionner (usage unique, sans stockage). Aucun mot de passe ne voyage par e-mail.
// Frein : une demande toutes les 2 minutes par adresse (mémoire du conteneur + Blobs « fidi-invitations », au mieux).

import crypto from "node:crypto";
import { hasToken } from "./_notion.mjs";
import { authResp, findUserByEmail, signJWT, verifyJWT, setPassword, isExpired } from "./_auth.mjs";
import { envoyerEmail } from "./send-email.mjs";
import { motDePasseRefuse } from "./signup-link.mjs";
import { getNamedStore } from "./_blobs.mjs";

export const DUREE_LIEN = 3600;        // secondes
export const DELAI_ENTRE_DEMANDES = 120_000; // millisecondes
const EMAIL_OK = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const REPONSE = { ok: true, message: "Si un compte existe pour cette adresse, un e-mail contenant un lien vient d'être envoyé. Il est valable 1 heure." };

export const empreinte = (hash) => crypto.createHash("sha256").update(String(hash || "")).digest("hex").slice(0, 16);

const recentes = new Map();
async function tropTot(event, email) {
  const maintenant = Date.now();
  const d = recentes.get(email);
  if (d && maintenant - d < DELAI_ENTRE_DEMANDES) return true;
  recentes.set(email, maintenant);
  try {
    const store = await getNamedStore(event, "fidi-invitations");
    const cle = "oubli/" + crypto.createHash("sha256").update(email).digest("hex");
    const vu = await store.get(cle, { type: "json" });
    if (vu && maintenant - Number(vu.le || 0) < DELAI_ENTRE_DEMANDES) return true;
    await store.setJSON(cle, { le: maintenant });
  } catch { /* sans stockage, le frein en mémoire suffit */ }
  return false;
}

function origine(event) {
  const h = event.headers || {};
  const hote = h["x-forwarded-host"] || h.host || "";
  return hote ? `${h["x-forwarded-proto"] || "https"}://${hote}` : String(process.env.URL || "");
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET || !hasToken()) return authResp(503, { error: "Service non configuré." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }

  try {
    // ── Nouveau mot de passe choisi depuis le lien ──
    if (b.action === "changer") {
      const p = verifyJWT(String(b.token || ""));
      const invalide = () => authResp(410, { error: "Ce lien n'est plus valable (il dure 1 heure et ne sert qu'une fois). Refaites une demande.", expired: true });
      if (!p || p.purpose !== "reset" || !p.email) return invalide();
      const refus = motDePasseRefuse(b.password);
      if (refus) return authResp(400, { error: refus });
      const found = await findUserByEmail(p.email);
      if (!found || found.user.statut !== "Actif" || isExpired(found.user)) return invalide();
      if (p.v !== empreinte(found.user.hash)) return invalide(); // mot de passe déjà changé depuis l'envoi du lien
      await setPassword(found.page.id, String(b.password));
      return authResp(200, { ok: true, email: found.user.email });
    }

    // ── Demande de lien ──
    const email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL_OK.test(email) || email.length > 120) return authResp(400, { error: "Adresse e-mail invalide." });
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
      return authResp(503, { error: "L'envoi d'e-mails n'est pas configuré : demandez un nouveau mot de passe à votre administrateur." });
    }
    if (await tropTot(event, email)) return authResp(200, REPONSE);
    const found = await findUserByEmail(email);
    if (found && found.user.statut === "Actif" && !isExpired(found.user)) {
      const jeton = signJWT({ purpose: "reset", email, v: empreinte(found.user.hash) }, DUREE_LIEN);
      const r = await envoyerEmail({
        to: email, subject: "Réinitialisation de votre mot de passe", lien: `${origine(event)}/#reset?token=${jeton}`, bouton: "Choisir un nouveau mot de passe",
        message: "Vous avez demandé à réinitialiser le mot de passe de votre compte. Ce lien est valable 1 heure et ne sert qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste inchangé.",
      });
      if (r.statusCode !== 200) console.error("[auth-oubli] e-mail non envoyé :", r.statusCode);
    }
    return authResp(200, REPONSE);
  } catch (e) {
    console.error("[auth-oubli]", e.message);
    return authResp(500, { error: "Demande impossible pour le moment. Réessayez." });
  }
};
