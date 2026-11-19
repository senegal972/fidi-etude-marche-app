// GET  /api/marque — charte de marque (enseigne, logo, couleurs, coordonnées) du compte connecté
// POST /api/marque — enregistre la charte du compte connecté
//
// Auth : cookie fidi_session ou Authorization: Bearer (voir _auth.mjs → currentUser).
// Stockage : Netlify Blobs, store « fidi-marques », clé = identifiant de la page Notion de l'utilisateur.
// La charte suit ainsi l'utilisateur d'un poste à l'autre. Côté navigateur : marque.js.
//
// Réponses : 200 { compte:{ nom }, marque|null } · 401 non connecté · 413 trop lourd
//            503 { blobs_error:true } si le stockage est indisponible (jamais de 500 muet).

import { authResp, currentUser } from "./_auth.mjs";
import { getNamedStore } from "./_blobs.mjs";

export const MARQUE_STORE = "fidi-marques";
const TAILLE_MAX = 800_000; // octets — une charte avec logo redimensionné pèse quelques dizaines de ko

const LIMITES = {
  enseigne: 40, produit: 60, baseline: 80,
  raisonSociale: 80, adresse: 160, telephone: 30, email: 80, mentions: 240,
  formeJuridique: 60, capital: 40, siren: 20, registre: 80, tvaIntra: 20, conditions: 400,
  siret: 20, prefixe: 16, titulaire: 80,
};
export const MAX_EMETTEURS = 10;

// IBAN : espaces retirés, majuscules, contrôle de la clé (modulo 97). Renvoie "" si invalide.
// Mêmes règles que ibanValide() dans marque.js.
export function ibanValide(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return "";
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let reste = 0;
  for (const ch of r) reste = (reste * 10 + Number(ch)) % 97;
  return reste === 1 ? s : "";
}
export function bicValide(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) ? s : "";
}

// Une société émettrice de factures (plusieurs par compte, choisie au moment de facturer).
// Mêmes règles que assainirEmetteur() dans marque.js — à faire évoluer ensemble.
export function assainirEmetteur(src) {
  if (!src || typeof src !== "object" || Array.isArray(src)) return null;
  const o = {};
  const id = String(src.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
  if (!id) return null;
  o.id = id;
  for (const k of ["raisonSociale", "adresse", "telephone", "email", "formeJuridique", "capital", "siren", "siret", "registre", "tvaIntra"]) {
    const t = texte(src[k], LIMITES[k]);
    o[k] = t === null ? "" : t;
  }
  o.regimeTva = ["franchise", "assujetti"].includes(src.regimeTva) ? src.regimeTva : "";
  const taux = Number(src.tauxTva);
  o.tauxTva = Number.isFinite(taux) ? Math.max(0, Math.min(30, taux)) : 8.5;
  // Préfixe de numérotation : une suite chronologique distincte par société (obligation légale).
  const pre = String(src.prefixe || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, LIMITES.prefixe);
  o.prefixe = pre.length >= 2 ? pre : "";
  o.avecLogo = !!src.avecLogo;
  // Coordonnées bancaires pour le règlement par virement (affichées sur la facture et la page du client).
  o.iban = ibanValide(src.iban);
  o.bic = o.iban ? bicValide(src.bic) : "";
  const tit = texte(src.titulaire, LIMITES.titulaire);
  o.titulaire = o.iban && tit ? tit : "";
  return o;
}

const hexOk = (h) => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h);
const logoOk = (l) => typeof l === "string" && /^data:image\/(png|jpeg|webp|svg\+xml);/.test(l) && l.length < 600_000;
const texte = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : null);

// Ne conserve que les champs connus et valides : rien d'autre n'est stocké.
// Mêmes règles que assainir() dans marque.js — à faire évoluer ensemble.
export function assainirMarque(src) {
  const out = {};
  if (!src || typeof src !== "object" || Array.isArray(src)) return out;
  for (const k of ["enseigne", "produit", "baseline"]) {
    const t = texte(src[k], LIMITES[k]);
    if (t !== null) out[k] = t;
  }
  if (src.logo === "" || logoOk(src.logo)) out.logo = src.logo;
  if (src.couleurs && typeof src.couleurs === "object") {
    out.couleurs = {};
    for (const k of ["principale", "accent", "secondaire"]) {
      if (hexOk(src.couleurs[k])) out.couleurs[k] = src.couleurs[k].toUpperCase();
    }
  }
  if (src.coordonnees && typeof src.coordonnees === "object") {
    out.coordonnees = {};
    for (const k of ["raisonSociale", "adresse", "telephone", "email", "mentions"]) {
      const t = texte(src.coordonnees[k], LIMITES[k]);
      if (t !== null) out.coordonnees[k] = t;
    }
  }
  // Mentions légales de l'émetteur des factures (régime de TVA, SIREN, registre…).
  if (src.facturation && typeof src.facturation === "object") {
    const f = src.facturation, o = {};
    for (const k of ["formeJuridique", "capital", "siren", "registre", "tvaIntra", "conditions"]) {
      const t = texte(f[k], LIMITES[k]);
      if (t !== null) o[k] = t;
    }
    if (["franchise", "assujetti", ""].includes(f.regimeTva)) o.regimeTva = f.regimeTva;
    const taux = Number(f.tauxTva);
    if (f.tauxTva !== undefined && f.tauxTva !== "" && Number.isFinite(taux)) o.tauxTva = Math.max(0, Math.min(30, taux));
    const delai = parseInt(f.delaiJours, 10);
    if (Number.isFinite(delai)) o.delaiJours = Math.max(0, Math.min(90, delai));
    out.facturation = o;
  }
  if (Array.isArray(src.emetteurs)) {
    const vus = new Set();
    out.emetteurs = src.emetteurs.map(assainirEmetteur).filter((e) => e && !vus.has(e.id) && vus.add(e.id)).slice(0, MAX_EMETTEURS);
  }
  if (typeof src.emetteurDefaut === "string") out.emetteurDefaut = src.emetteurDefaut.replace(/[^a-z0-9]/gi, "").slice(0, 16);
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return authResp(405, { error: "Méthode non autorisée" });
  }

  let found;
  try { found = await currentUser(event); }
  catch (e) { return authResp(503, { error: "Comptes indisponibles" }); }
  if (!found) return authResp(401, { error: "Non connecté" });
  const cle = String(found.user.id || found.page?.id || "");
  if (!cle) return authResp(401, { error: "Compte introuvable" });
  const compte = { nom: found.user.nom || "" };

  let corps = null;
  if (event.httpMethod === "POST") {
    if ((event.body || "").length > TAILLE_MAX) return authResp(413, { error: "Charte trop volumineuse" });
    try { corps = JSON.parse(event.body || "{}"); } catch (e) { return authResp(400, { error: "JSON invalide" }); }
  }

  let store;
  try { store = await getNamedStore(event, MARQUE_STORE); }
  catch (e) { return authResp(503, { error: "Stockage indisponible", blobs_error: true }); }

  try {
    if (event.httpMethod === "GET") {
      const brut = await store.get(cle, { type: "json" });
      return authResp(200, { compte, marque: brut ? assainirMarque(brut) : null });
    }
    const marque = assainirMarque(corps);
    await store.setJSON(cle, marque);
    return authResp(200, { compte, marque });
  } catch (e) {
    console.error("[marque] stockage :", e.message);
    return authResp(503, { error: "Stockage indisponible", blobs_error: true });
  }
};
