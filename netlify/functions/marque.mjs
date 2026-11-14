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
};

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
