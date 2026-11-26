// E-mail de bienvenue envoyé à la création d'un compte : identifiant, lien de l'application, installation sur téléphone
// et, quand le mot de passe n'a pas été choisi par la personne elle-même, un lien pour le choisir.
//
// Aucun mot de passe ne voyage par e-mail. Le lien « Choisir mon mot de passe » est le même que celui de « Mot de passe oublié »
// (jeton { purpose:"reset", email, v }), valable 7 jours et une seule fois : il meurt dès que le mot de passe change.
// Envoi « au mieux » : un échec ne fait jamais échouer la création du compte. Sans RESEND_API_KEY / RESEND_FROM : rien n'est envoyé.
import { signJWT, empreinteMdp } from "./_auth.mjs";
import { envoyerEmail, adresseReponse } from "./send-email.mjs";
import { getNamedStore } from "./_blobs.mjs";

// Réglages de l'e-mail de bienvenue (Mon compte → Comptes → « E-mail de bienvenue ») : mot d'accueil, liens (vidéo, présentation)
// et pièces jointes. Netlify Blobs « fidi-bienvenue » : « reglages » = { message, liens[], pieces[{ id, nom, type, taille }] },
// « f/<id> » = { nom, type, base64 }. Communs à tout le déploiement.
export const BIENVENUE_STORE = "fidi-bienvenue";
export const LIENS_MAX = 6;
export const PIECES_MAX = 3;
export const TAILLE_PIECE_MAX = 4_000_000; // octets : le corps d'une fonction est limité à 6 Mo, base64 compris
export const TYPES_PIECE = { pdf: "application/pdf", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const propre = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, max);

// Mot d'accueil et liens : { ok, erreur?, valeur? }. Pur, testé sans réseau.
export function assainirReglages(b) {
  const message = propre(b && b.message, 1200);
  const liens = [];
  for (const l of (Array.isArray(b && b.liens) ? b.liens : [])) {
    const url = propre(l && l.url, 500), libelle = propre(l && l.libelle, 80).replace(/\s+/g, " ");
    if (!url && !libelle) continue;
    if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(url)) return { ok: false, erreur: "Adresse de lien invalide (elle doit commencer par https://) : " + (url || libelle) };
    liens.push({ libelle: libelle || url, url });
  }
  if (liens.length > LIENS_MAX) return { ok: false, erreur: `${LIENS_MAX} liens au plus.` };
  return { ok: true, valeur: { message, liens } };
}

// Pièce jointe : { ok, erreur?, valeur:{ nom, type, base64, taille } }. Le type est déduit de l'extension.
export function assainirPiece(b) {
  const nom = propre(b && b.nom, 120).replace(/[^\w .()\-À-ÿ]/g, "_");
  const ext = (nom.match(/\.([a-z0-9]+)$/i) || [])[1];
  const type = TYPES_PIECE[String(ext || "").toLowerCase()];
  if (!type) return { ok: false, erreur: "Type de fichier non admis. Acceptés : PDF, PowerPoint, Word, JPEG, PNG. Pour une vidéo, ajoutez plutôt un lien." };
  const base64 = String((b && b.base64) || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) return { ok: false, erreur: "Fichier illisible." };
  const taille = Math.floor(base64.length * 0.75);
  if (taille > TAILLE_PIECE_MAX) return { ok: false, erreur: "Fichier trop lourd (4 Mo au plus). Déposez-le en ligne et ajoutez un lien." };
  return { ok: true, valeur: { nom, type, base64, taille } };
}

// Réglages enregistrés. Ne lève jamais : sans stockage, l'e-mail part avec son texte de base.
export async function lireReglages(event, store) {
  const vide = { message: "", liens: [], pieces: [] };
  try {
    const s = store || await getNamedStore(event, BIENVENUE_STORE);
    const r = await s.get("reglages", { type: "json" });
    if (!r || typeof r !== "object") return vide;
    return { message: propre(r.message, 1200), liens: Array.isArray(r.liens) ? r.liens.slice(0, LIENS_MAX) : [], pieces: Array.isArray(r.pieces) ? r.pieces.slice(0, PIECES_MAX) : [] };
  } catch (e) { console.error("[bienvenue] réglages illisibles :", e.message); return vide; }
}

async function piecesJointes(event, pieces, store) {
  const out = [];
  try {
    const s = store || await getNamedStore(event, BIENVENUE_STORE);
    for (const p of pieces) {
      const f = await s.get("f/" + p.id, { type: "json" }).catch(() => null);
      if (f && f.base64) out.push({ filename: f.nom || p.nom || "document", content: f.base64 });
    }
  } catch (e) { console.error("[bienvenue] pièces illisibles :", e.message); }
  return out;
}

export const DUREE_LIEN_BIENVENUE = 7 * 24 * 3600; // secondes

export function origineDe(event) {
  const h = (event && event.headers) || {};
  const hote = h["x-forwarded-host"] || h.host || "";
  return hote ? `${h["x-forwarded-proto"] || "https"}://${hote}` : String(process.env.URL || "");
}

// Texte du message (lignes séparées par des retours à la ligne ; send-email les rend tels quels).
export function texteBienvenue({ nom, email, origin, avecLien, message, nbPieces }) {
  return [
    (nom ? nom + ", un" : "Un") + " compte vient d'être créé pour vous sur l'application.",
    ...(message ? ["", message] : []),
    "",
    "Votre identifiant de connexion : " + email,
    avecLien
      ? "Choisissez votre mot de passe avec le bouton ci-dessous. Ce lien est valable 7 jours et ne sert qu'une fois."
      : "Connectez-vous avec le mot de passe que vous avez choisi.",
    "",
    "Pour installer l'application sur votre téléphone :",
    "• iPhone : ouvrez " + origin + " dans Safari, touchez « Partager », puis « Sur l'écran d'accueil ».",
    "• Android : ouvrez " + origin + " dans Chrome, touchez le menu ⋮, puis « Installer l'application ».",
    "",
    "Pour l'installer sur votre ordinateur :",
    "• Chrome ou Edge (Windows, Mac) : ouvrez " + origin + ", puis cliquez sur l'icône d'installation à droite de la barre d'adresse, ou ouvrez le menu ⋮ et choisissez « Installer ».",
    "• Safari (Mac) : ouvrez " + origin + ", puis menu Fichier, « Ajouter au Dock ».",
    "Sans installation, l'application s'utilise aussi directement à l'adresse " + origin + " dans votre navigateur.",
    ...(nbPieces ? ["", nbPieces > 1 ? nbPieces + " documents sont joints à ce message." : "Un document est joint à ce message."] : []),
  ].join("\n");
}

// Adresse qui reçoit la copie quand aucun administrateur n'est connecté (inscription par lien d'invitation) :
// adresse de réponse du site (RESEND_REPLY_TO, à défaut FIDI_CONTACT_EMAIL), sinon le super-administrateur.
export function adresseCopieDefaut() {
  const s = String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  return adresseReponse() || (/^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(s) ? s : "");
}

// Copie pour l'administrateur : même contenu (mot d'accueil, consignes, liens, pièces jointes), mais JAMAIS le lien personnel de choix du mot de
// passe — il ne sert qu'une fois : ouvert depuis la copie, il priverait le client du sien. Au mieux : un échec ne change pas le résultat.
async function envoyerCopie({ copie, email, nom, origin, avecLien, regl, attachments }) {
  try {
    const r = await envoyerEmail({
      to: copie, subject: "[Copie] E-mail de bienvenue envoyé à " + email, lien: origin + "/", bouton: "Ouvrir l'application",
      appel: avecLien ? "Dans l'e-mail du client, ce bouton est « Choisir mon mot de passe » (lien personnel valable 7 jours, non reproduit ici) :" : "Bouton de l'e-mail du client :",
      liens: regl.liens, titreLiens: "Pour bien démarrer", ...(attachments.length ? { attachments } : {}),
      message: "Copie de l'e-mail de bienvenue envoyé à " + email + ".\n———\n" + texteBienvenue({ nom, email, origin, avecLien, message: regl.message, nbPieces: attachments.length }),
    });
    if (r.statusCode !== 200) console.error("[bienvenue] copie non envoyée :", r.statusCode);
    return r.statusCode === 200;
  } catch (e) { console.error("[bienvenue] copie :", e.message); return false; }
}

// → "envoye" | "non_configure" | "echec". copie : adresse de l'administrateur mis en copie (facultative). hash : mot de passe haché du compte (pour le lien de choix du mot de passe).
export async function envoyerBienvenue({ event, email, nom, hash, choisirMotDePasse, store, essai, copie }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return "non_configure";
  const origin = origineDe(event);
  if (!origin || !email) return "echec";
  const avecLien = !!(choisirMotDePasse && hash && process.env.JWT_SECRET);
  const lien = avecLien
    ? `${origin}/#reset?token=${signJWT({ purpose: "reset", email, v: empreinteMdp(hash) }, DUREE_LIEN_BIENVENUE)}`
    : origin + "/";
  try {
    const regl = await lireReglages(event, store);
    const attachments = regl.pieces.length ? await piecesJointes(event, regl.pieces, store) : [];
    const nomPropre = String(nom || "").trim().slice(0, 80);
    const r = await envoyerEmail({
      to: email, subject: (essai ? "[Essai] " : "") + "Votre accès à l'application", lien,
      appel: avecLien ? "Pour commencer, choisissez votre mot de passe :" : "Pour commencer, ouvrez l'application :",
      liens: regl.liens, titreLiens: "Pour bien démarrer", ...(attachments.length ? { attachments } : {}),
      bouton: avecLien ? "Choisir mon mot de passe" : "Ouvrir l'application",
      message: texteBienvenue({ nom: nomPropre, email, origin, avecLien, message: regl.message, nbPieces: attachments.length }),
    });
    if (r.statusCode !== 200) { console.error("[bienvenue] e-mail non envoyé :", r.statusCode); return "echec"; }
    const c = String(copie || "").trim().toLowerCase();
    if (!essai && c && c !== String(email).trim().toLowerCase()) await envoyerCopie({ copie: c, email, nom: nomPropre, origin, avecLien, regl, attachments });
    return "envoye";
  } catch (e) { console.error("[bienvenue]", e.message); return "echec"; }
}
