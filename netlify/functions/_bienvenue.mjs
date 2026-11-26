// E-mail de bienvenue envoyé à la création d'un compte : identifiant, lien de l'application, installation sur téléphone
// et, quand le mot de passe n'a pas été choisi par la personne elle-même, un lien pour le choisir.
//
// Aucun mot de passe ne voyage par e-mail. Le lien « Choisir mon mot de passe » est le même que celui de « Mot de passe oublié »
// (jeton { purpose:"reset", email, v }), valable 7 jours et une seule fois : il meurt dès que le mot de passe change.
// Envoi « au mieux » : un échec ne fait jamais échouer la création du compte. Sans RESEND_API_KEY / RESEND_FROM : rien n'est envoyé.
import { signJWT, empreinteMdp } from "./_auth.mjs";
import { envoyerEmail } from "./send-email.mjs";
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
    "Sur ordinateur, ouvrez simplement " + origin + " dans votre navigateur.",
    ...(nbPieces ? ["", nbPieces > 1 ? nbPieces + " documents sont joints à ce message." : "Un document est joint à ce message."] : []),
  ].join("\n");
}

// → "envoye" | "non_configure" | "echec". hash : mot de passe haché du compte (pour le lien de choix du mot de passe).
export async function envoyerBienvenue({ event, email, nom, hash, choisirMotDePasse, store, essai }) {
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
    const r = await envoyerEmail({
      to: email, subject: (essai ? "[Essai] " : "") + "Votre accès à l'application", lien,
      appel: avecLien ? "Pour commencer, choisissez votre mot de passe :" : "Pour commencer, ouvrez l'application :",
      liens: regl.liens, titreLiens: "Pour bien démarrer", ...(attachments.length ? { attachments } : {}),
      bouton: avecLien ? "Choisir mon mot de passe" : "Ouvrir l'application",
      message: texteBienvenue({ nom: String(nom || "").trim().slice(0, 80), email, origin, avecLien, message: regl.message, nbPieces: attachments.length }),
    });
    if (r.statusCode !== 200) { console.error("[bienvenue] e-mail non envoyé :", r.statusCode); return "echec"; }
    return "envoye";
  } catch (e) { console.error("[bienvenue]", e.message); return "echec"; }
}
