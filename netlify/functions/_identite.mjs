// Identité portée par les e-mails et les pages remises aux clients : la SOCIÉTÉ QUI AGIT (société émettrice par défaut du compte,
// à défaut l'enseigne de sa charte), jamais un nom écrit en dur. Le logiciel, lui, se signe à part, en pied :
// produit « Étude de marché & Avis de valeur », fabricant « Optimmo Dom ».
import { getNamedStore } from "./_blobs.mjs";
import { MARQUE_STORE, assainirMarque } from "./marque.mjs";

export const FABRICANT = "Optimmo Dom";
export const PRODUIT = "Étude de marché & Avis de valeur";
export const SIGNATURE_LOGICIEL = `${PRODUIT} — une application ${FABRICANT}`;

const propre = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>"]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const couleurOk = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c) : "");
const emailOk = (v) => { const s = String(v || "").trim(); return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(s) ? s : ""; };
// Un logo n'est joint à un e-mail qu'en PNG ou JPEG (les messageries n'affichent ni SVG ni WebP de façon fiable).
const logoOk = (l) => (typeof l === "string" && /^data:image\/(png|jpeg);base64,/.test(l) && l.length < 400_000 ? l : "");

const forme = (o) => ({ nom: propre(o.nom, 80), baseline: propre(o.baseline, 120), couleur: couleurOk(o.couleur), logo: logoOk(o.logo),
  email: emailOk(o.email), telephone: propre(o.telephone, 30), adresse: propre(o.adresse, 200) });

// Charte d'un compte → société par défaut (même règle de logo que les factures : le sien, sinon celui de la charte si « avecLogo »).
export function identiteDeCharte(charte) {
  const m = assainirMarque(charte || {}), co = m.coordonnees || {}, l = m.emetteurs || [];
  const e = l.find((x) => x.id === m.emetteurDefaut) || l[0] || null;
  if (e) return forme({ nom: e.raisonSociale, couleur: (m.couleurs || {}).principale, logo: e.logo || (e.avecLogo ? m.logo : ""), email: e.email || co.email, telephone: e.telephone, adresse: e.adresse });
  return forme({ nom: co.raisonSociale || m.enseigne, baseline: m.baseline, couleur: (m.couleurs || {}).principale, logo: m.logo, email: co.email, telephone: co.telephone, adresse: co.adresse });
}
// Émetteur figé dans le détail d'une facture (facture.mjs → emetteurDe).
export function identiteDEmetteur(em) {
  if (!em || typeof em !== "object") return forme({});
  const co = em.coordonnees || {};
  return forme({ nom: em.enseigne || co.raisonSociale, couleur: (em.couleurs || {}).principale, logo: em.logo, email: co.email, telephone: co.telephone, adresse: co.adresse });
}
// Identité du compte connecté. Ne lève jamais : sans stockage ou sans charte, identité vide (l'e-mail se signe du nom du logiciel).
export async function identiteCompte(event, me, store) {
  try {
    const id = String((me && ((me.user && me.user.id) || (me.page && me.page.id))) || "");
    if (!id) return forme({});
    const s = store || await getNamedStore(event, MARQUE_STORE);
    return identiteDeCharte(await s.get(id, { type: "json" }));
  } catch (e) { console.error("[identite]", e.message); return forme({}); }
}

// Société émettrice d'une facture, lue dans son détail figé (Blobs « fidi-factures », clé = jeton de remise). Ne lève jamais.
export async function identiteFacture(event, jeton, store) {
  try {
    if (!jeton) return forme({});
    const s = store || await getNamedStore(event, "fidi-factures");
    const d = await s.get(String(jeton), { type: "json" });
    return identiteDEmetteur(d && d.emetteur);
  } catch (e) { return forme({}); }
}
