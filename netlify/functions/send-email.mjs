// Netlify Function — Envoi email avec PDF en pièce jointe via Resend API
// POST /api/send-email  body: { to, subject, pdf_b64, filename, kind, titre }
//
// ACCÈS RÉSERVÉ : session d'un utilisateur actif (cookie fidi_session). Vérifié AVANT tout
// le reste, même avant de regarder la clé Resend. Sans cette garde, la clé Resend ferait de
// cette route publique un relais d'e-mails ouvert à tout Internet (hameçonnage au nom de
// FIDI, quota Resend épuisé, réputation du domaine d'envoi abîmée). Les envois faits par le
// serveur lui-même (facture-pay-capture, après vérification du paiement) appellent
// envoyerEmail() directement, sans passer par cette route.
//
// Prérequis :
//   1. Créer un compte sur resend.com (gratuit — 100 emails/jour)
//   2. Vérifier le domaine d'envoi chez Resend (un sous-domaine d'envoi, pas la racine)
//   3. Ajouter RESEND_API_KEY dans les variables Netlify (clé « Sending access », secrète)
//   4. RESEND_FROM = "Nom <adresse@domaine-vérifié>" : obligatoire, adresse d'un domaine vérifié chez Resend
//   5. RESEND_REPLY_TO : adresse où arrivent les réponses des clients (l'expéditeur n'a pas de boîte) ;
//      à défaut FIDI_CONTACT_EMAIL. Sans aucune des deux, les réponses partent vers l'expéditeur.
//   6. FIDI_CONTACT_EMAIL : adresse de contact affichée en pied des e-mails et de l'ancien modèle de facture.
// Aucune adresse n'est écrite dans le code : le dépôt est public.

const ADRESSE_OK = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const lireAdresse = (v) => { const s = String(v || "").trim(); return ADRESSE_OK.test(s) ? s : ""; };
export const adresseContact = () => lireAdresse(process.env.FIDI_CONTACT_EMAIL);
export const adresseReponse = () => lireAdresse(process.env.RESEND_REPLY_TO) || adresseContact();

import { currentUser } from "./_auth.mjs";
import { PRODUIT, FABRICANT, identiteCompte } from "./_identite.mjs";

// Habillage commun de tous les e-mails : bandeau au nom de la SOCIÉTÉ QUI AGIT (identite : nom, baseline, couleur, logo, email),
// pied signé du logiciel (produit + fabricant). Sans identité : le bandeau porte le nom du produit. `corps` est du HTML déjà échappé.
export function gabaritEmail({ identite, corps, contact }) {
  const id = identite || {};
  const couleur = /^#[0-9a-f]{6}$/i.test(id.couleur || "") ? id.couleur : "#1a3a6e";
  const nom = escHtml(id.nom || PRODUIT);
  const sous = escHtml(id.nom ? (id.baseline || "") : `Une application ${FABRICANT}`);
  const logo = id.logo ? `<img src="cid:logo-societe" alt="${nom}" height="44" style="display:block;height:44px;max-width:220px;background:#fff;border-radius:8px;padding:6px 10px;margin:0 0 12px;">` : "";
  const piedContact = [id.nom ? nom : "", id.telephone ? escHtml(id.telephone) : "", contact ? `<a href="mailto:${escHtml(contact)}" style="color:${couleur};">${escHtml(contact)}</a>` : ""].filter(Boolean).join(" · ");
  return `
<div style="background:#eef1f5;padding:18px 8px;">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#1a2233;">
  <div style="background:${couleur};padding:22px 28px;border-radius:12px 12px 0 0;">
    ${logo}<h2 style="color:#fff;margin:0;font-size:1.35rem;line-height:1.25;">${nom}</h2>
    ${sous ? `<p style="color:#ffffff;opacity:.82;margin:4px 0 0;font-size:.85rem;">${sous}</p>` : ""}
  </div>
  <div style="padding:28px;border:1px solid #dee2e6;border-top:none;border-radius:0 0 12px 12px;background:#fff;">
    ${corps}
    <hr style="margin:22px 0 14px;border:none;border-top:1px solid #dee2e6;">
    <p style="color:#6c757d;font-size:11px;margin:0;line-height:1.5;">
      ${piedContact ? piedContact + "<br>" : ""}Message envoyé avec ${escHtml(PRODUIT)} — une application ${escHtml(FABRICANT)}.
    </p>
  </div>
</div>
</div>`.trim();
}

// Expéditeur affiché : le nom de la société qui agit, sur l'adresse d'envoi du site (RESEND_FROM).
export function expediteur(from, nom) {
  const adresse = (String(from).match(/<([^<>\s]+@[^<>\s]+)>/) || [])[1] || (/^[^\s<>]+@[^\s<>]+$/.test(String(from).trim()) ? String(from).trim() : "");
  const n = String(nom || "").replace(/[\u0000-\u001f<>"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
  return adresse && n ? `"${n}" <${adresse}>` : from;
}

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Cœur de l'envoi (Resend). AUCUN contrôle d'accès ici : l'appelant doit l'avoir fait
// (handler plus bas : session d'un utilisateur actif ; facture-pay-capture : paiement vérifié).
export async function envoyerEmail(b) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return jsonResp(503, {
      error: "Envoi email non configuré. Ajoutez RESEND_API_KEY dans les variables Netlify.",
      not_configured: true,
    });
  }

  const to = (b.to || "").trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return jsonResp(400, { error: "Adresse e-mail invalide : " + to });
  }

  const identite = (b.identite && typeof b.identite === "object") ? b.identite : {};
  const subject  = (b.subject  || ("Document" + (identite.nom ? " — " + identite.nom : ""))).slice(0, 200);
  const filename = (b.filename || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const kind     = escHtml(b.kind  || "document");
  const titre    = escHtml(b.titre || "");
  const from     = process.env.RESEND_FROM;
  if (!from) {
    return jsonResp(503, { error: "Envoi email non configuré. Ajoutez RESEND_FROM dans les variables Netlify.", not_configured: true });
  }
  // Contact et réponses : l'adresse de la société qui agit, à défaut celles du site.
  const contact  = lireAdresse(identite.email) || adresseContact();
  const replyTo  = lireAdresse(identite.email) || adresseReponse();

  // Lien de remise (page /l/<jeton>) : e-mail « avec bouton » plutôt que pièce jointe.
  let lien = String(b.lien || "").trim();
  if (lien && !/^https?:\/\//i.test(lien)) lien = "";
  // Les retours à la ligne du message sont conservés (consignes en plusieurs lignes) ; le texte reste échappé.
  const messagePerso = b.message ? escHtml(b.message).replace(/\r?\n/g, "<br>") : "";
  const bouton = escHtml(String(b.bouton || "Accéder à mes documents").slice(0, 60));

  // Liens complémentaires (vidéo, présentation…) : [{ libelle, url }], adresses http(s) seulement.
  const liensPlus = (Array.isArray(b.liens) ? b.liens : [])
    .filter((l) => l && /^https?:\/\//i.test(String(l.url || ""))).slice(0, 10)
    .map((l) => `<li style="margin:4px 0;"><a href="${escHtml(l.url)}" style="color:#1a3a6e;font-weight:600;">${escHtml(String(l.libelle || l.url).slice(0, 120))}</a></li>`).join("");
  const blocLiens = liensPlus ? `<p style="margin-bottom:4px;"><strong>${escHtml(String(b.titreLiens || "À consulter").slice(0, 80))}</strong></p><ul style="margin-top:0;padding-left:20px;">${liensPlus}</ul>` : "";

  const corps = typeof b.corpsHtml === "string" && b.corpsHtml ? b.corpsHtml : lien
    ? `<p style="margin-top:0;">Bonjour,</p>
       ${messagePerso ? `<p>${messagePerso}</p>` : `<p>Votre ${kind}${titre ? " <strong>— " + titre + "</strong>" : ""} est disponible.</p>`}
       <p>${b.appel ? escHtml(String(b.appel).slice(0, 160)) : "Cliquez sur le bouton ci-dessous pour y accéder :"}</p>
       <p style="text-align:center;margin:26px 0;">
         <a href="${escHtml(lien)}" style="display:inline-block;background:${/^#[0-9a-f]{6}$/i.test(identite.couleur || "") ? identite.couleur : "#1a3a6e"};color:#fff;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:700;font-size:15px;">${bouton}</a>
       </p>
       <p style="font-size:12px;color:#6c757d;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${escHtml(lien)}" style="color:#1a3a6e;word-break:break-all;">${escHtml(lien)}</a></p>${blocLiens}`
    : `<p style="margin-top:0;">Bonjour,</p>
       <p>Veuillez trouver ci-joint ${kind}${titre ? " <strong>— " + titre + "</strong>" : ""}.</p>
       ${messagePerso ? `<p>${messagePerso}</p>` : ""}`;

  const htmlBody = gabaritEmail({ identite, corps, contact });

  const payload = {
    from: expediteur(from, identite.nom),
    to: [to],
    subject,
    html: htmlBody,
    // Les réponses des clients vont dans la vraie boîte : l'expéditeur n'en a pas.
    ...(replyTo ? { reply_to: replyTo } : {}),
  };

  // Pièces jointes : tableau b.attachments [{ filename, content(base64) }]
  // Rétrocompat : b.pdf_b64 + b.filename (une seule pièce).
  const MAX_TOTAL = 20 * 1024 * 1024; // 20 Mo cumulés (limite Resend ~40 Mo)
  let atts = [];
  if (Array.isArray(b.attachments) && b.attachments.length) {
    atts = b.attachments
      .filter((a) => a && a.content)
      .map((a) => ({
        filename: String(a.filename || "piece-jointe").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120),
        content: a.content,
      }));
  } else if (b.pdf_b64) {
    atts = [{ filename, content: b.pdf_b64 }];
  }
  if (atts.length) {
    const totalBytes = atts.reduce((s, a) => s + Math.floor(a.content.length * 0.75), 0);
    if (totalBytes > MAX_TOTAL) {
      return jsonResp(413, { error: "Pièces jointes trop volumineuses (max 20 Mo au total)" });
    }
    payload.attachments = atts;
  }
  // Logo de la société, intégré au message (image « cid »), en plus des pièces jointes.
  const logo = /^data:image\/(png|jpeg);base64,/.exec(String(identite.logo || ""));
  if (logo) {
    payload.attachments = [...(payload.attachments || []), { filename: "logo." + (logo[1] === "jpeg" ? "jpg" : "png"), content: String(identite.logo).slice(logo[0].length), content_id: "logo-societe" }];
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = result.message || result.name || "Erreur Resend (" + resp.status + ")";
      return jsonResp(resp.status >= 500 ? 502 : resp.status, { error: msg, resend: result });
    }

    return jsonResp(200, { ok: true, id: result.id });
  } catch (e) {
    return jsonResp(500, { error: "Erreur réseau : " + e.message });
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  // Garde d'accès : un compte actif, relu dans Notion. Un jeton valide d'un autre usage
  // (lien d'inscription, sans e-mail de compte) ne donne rien. Fermé par défaut : sans
  // JWT_SECRET, aucun jeton n'est valide ; si Notion ne répond pas, rien ne part.
  let moi = null;
  try { moi = await currentUser(event); }
  catch { return jsonResp(503, { error: "Vérification de la connexion impossible, réessayez." }); }
  if (!moi) return jsonResp(401, { error: "Connexion requise pour envoyer un e-mail." });

  let b = {};
  try { b = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "JSON invalide" }); }
  if (!b || typeof b !== "object") b = {};

  // L'identité vient de la charte du compte (société par défaut), jamais de la demande : `identite` et `corpsHtml` transmis sont ignorés.
  delete b.corpsHtml;
  b.identite = await identiteCompte(event, moi);
  return envoyerEmail(b);
};
