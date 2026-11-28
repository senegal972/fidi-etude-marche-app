// /api/assistance — signalements des utilisateurs : erreur, idée d'amélioration, question, compte / facturation.
//
// Auth : session exigée avant tout le reste. Tout compte peut signaler ; seul l'administrateur lit la liste et clôt.
//
// GET                          → { contact } adresse de contact du site (FIDI_CONTACT_EMAIL), pour qui préfère écrire par e-mail
// GET  ?liste=1                → administrateur : { signalements:[…] } (sans les captures)
// GET  ?id=<n°>                → administrateur : le signalement complet
// GET  ?id=<n°>&capture=<i>    → administrateur : une capture d'écran
// POST { action:"signaler", nature, module, gravite, message, captures:[{ nom, base64 }], contexte }
//                              → { ok, numero, email:"envoye"|"non_configure"|"echec" }
// POST { action:"etat", id, etat:"ouvert"|"traite" }   administrateur
//
// Stockage : Netlify Blobs « fidi-assistance » — t/<n°> (le signalement), c/<n°>/<i> (captures). Le signalement est écrit AVANT l'e-mail :
// un e-mail qui ne part pas ne fait pas perdre la demande. L'e-mail va à l'adresse de contact du site, avec les captures en pièces jointes.
import crypto from "node:crypto";
import { authResp, currentUser } from "./_auth.mjs";
import { getNamedStore } from "./_blobs.mjs";
import { envoyerEmail, adresseContact } from "./send-email.mjs";

export const ASSISTANCE_STORE = "fidi-assistance";
export const NATURES = { erreur: "Une erreur", amelioration: "Une idée d'amélioration", question: "Une question d'utilisation", compte: "Mon compte ou ma facturation" };
export const MODULES = { saisie: "Nouvelle étude (saisie)", etude: "Résultats de l'étude", carte: "Carte et parcelles", avis: "Avis de valeur", facturation: "Facturation et paiement", documents: "Mes documents", compte: "Mon compte", autre: "Autre / je ne sais pas" };
export const GRAVITES = { bloquant: "Bloquant : je ne peux plus travailler", genant: "Gênant : je contourne", mineur: "Mineur" };
export const CAPTURES_MAX = 3;
export const TAILLE_CAPTURE_MAX = 1_400_000; // octets ; trois captures tiennent sous la limite de 6 Mo d'une fonction
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const texte = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, max);

// Nettoie une demande : { ok, erreur?, valeur? }. Pur, testé sans réseau.
export function assainirSignalement(b) {
  const nature = Object.prototype.hasOwnProperty.call(NATURES, b && b.nature) ? b.nature : "";
  if (!nature) return { ok: false, erreur: "Indiquez d'abord la nature de votre demande." };
  const module = Object.prototype.hasOwnProperty.call(MODULES, b.module) ? b.module : "autre";
  const gravite = nature === "erreur" ? (Object.prototype.hasOwnProperty.call(GRAVITES, b.gravite) ? b.gravite : "genant") : "";
  const message = texte(b.message, 4000);
  const captures = [];
  for (const c of (Array.isArray(b.captures) ? b.captures : []).slice(0, CAPTURES_MAX + 1)) {
    const nom = texte(c && c.nom, 80).replace(/[^\w .()-]/g, "_") || "capture.png";
    const type = TYPES[String((nom.match(/\.([a-z0-9]+)$/i) || [])[1] || "").toLowerCase()];
    if (!type) return { ok: false, erreur: "Capture non admise : image PNG, JPEG ou WebP seulement." };
    const base64 = String((c && c.base64) || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
    if (!base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) return { ok: false, erreur: "Capture illisible." };
    if (Math.floor(base64.length * 0.75) > TAILLE_CAPTURE_MAX) return { ok: false, erreur: "Capture trop lourde (1,4 Mo au plus par image)." };
    captures.push({ nom, type, base64 });
  }
  if (captures.length > CAPTURES_MAX) return { ok: false, erreur: `${CAPTURES_MAX} captures au plus.` };
  if (message.length < 10 && !captures.length) return { ok: false, erreur: "Décrivez votre demande en quelques mots, ou joignez une capture d'écran." };
  const cx = (b.contexte && typeof b.contexte === "object") ? b.contexte : {};
  return { ok: true, valeur: { nature, module, gravite, message, captures,
    contexte: { version: texte(cx.version, 20), ecran: texte(cx.ecran, 20), navigateur: texte(cx.navigateur, 160), page: texte(cx.page, 60) } } };
}
export const numeroSignalement = (date = new Date()) => "A-" + date.toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
const ID_OK = /^A-\d{8}-[0-9A-F]{6}$/;

export async function traiter(event, me, store) {
  const admin = me.user.role === "Administrateur";
  const q = event.queryStringParameters || {};
  if (event.httpMethod === "GET") {
    if (!q.liste && !q.id) return authResp(200, { contact: adresseContact(), natures: NATURES, modules: MODULES, gravites: GRAVITES });
    if (!admin) return authResp(403, { error: "Réservé aux administrateurs." });
    if (q.liste) {
      const { blobs } = await store.list({ prefix: "t/" });
      const cles = blobs.map((b) => b.key).sort().reverse().slice(0, 200);
      const signalements = (await Promise.all(cles.map((k) => store.get(k, { type: "json" }).catch(() => null)))).filter(Boolean);
      return authResp(200, { signalements });
    }
    const id = String(q.id || "");
    if (!ID_OK.test(id)) return authResp(400, { error: "Référence invalide." });
    if (q.capture != null) {
      const c = await store.get(`c/${id}/${parseInt(q.capture, 10) || 0}`, { type: "json" }).catch(() => null);
      if (!c) return authResp(404, { error: "Capture introuvable." });
      return { statusCode: 200, isBase64Encoded: true, body: c.base64, headers: { "Content-Type": c.type, "Cache-Control": "private, no-store" } };
    }
    const t = await store.get("t/" + id, { type: "json" }).catch(() => null);
    return t ? authResp(200, { signalement: t }) : authResp(404, { error: "Signalement introuvable." });
  }
  if (event.httpMethod !== "POST") return authResp(405, { error: "Méthode non admise." });
  let b = {};
  try { b = JSON.parse(event.body || "{}") || {}; } catch { return authResp(400, { error: "Demande illisible." }); }

  if (b.action === "etat") {
    if (!admin) return authResp(403, { error: "Réservé aux administrateurs." });
    const id = String(b.id || "");
    if (!ID_OK.test(id)) return authResp(400, { error: "Référence invalide." });
    const t = await store.get("t/" + id, { type: "json" }).catch(() => null);
    if (!t) return authResp(404, { error: "Signalement introuvable." });
    t.etat = b.etat === "traite" ? "traite" : "ouvert"; t.traite_le = t.etat === "traite" ? new Date().toISOString() : "";
    await store.setJSON("t/" + id, t);
    return authResp(200, { ok: true, signalement: t });
  }
  if (b.action !== "signaler") return authResp(400, { error: "Action inconnue." });
  const r = assainirSignalement(b);
  if (!r.ok) return authResp(400, { error: r.erreur });
  const v = r.valeur, numero = numeroSignalement();
  const fiche = { numero, le: new Date().toISOString(), etat: "ouvert", nature: v.nature, module: v.module, gravite: v.gravite, message: v.message, contexte: v.contexte,
    auteur: { email: me.user.email, nom: me.user.nom || "", role: me.user.role }, captures: v.captures.map((c) => ({ nom: c.nom, type: c.type })) };
  for (let i = 0; i < v.captures.length; i++) await store.setJSON(`c/${numero}/${i}`, v.captures[i]);
  await store.setJSON("t/" + numero, fiche);

  // E-mail à l'adresse de contact du site, au mieux : la demande est déjà enregistrée.
  let email = "non_configure";
  const contact = adresseContact();
  if (contact && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    try {
      const lignes = [`${NATURES[v.nature]} — ${MODULES[v.module]}` + (v.gravite ? ` — ${GRAVITES[v.gravite]}` : ""), `De : ${fiche.auteur.nom || fiche.auteur.email} (${fiche.auteur.email})`, "", v.message || "(pas de texte : voir les captures jointes)", "",
        `Version ${v.contexte.version || "?"} · écran ${v.contexte.ecran || "?"} · ${v.contexte.navigateur || ""}`];
      const origine = (event.headers && (event.headers["x-forwarded-host"] || event.headers.host)) ? `https://${event.headers["x-forwarded-host"] || event.headers.host}/` : String(process.env.URL || "");
      const e = await envoyerEmail({ to: contact, subject: `[Assistance ${numero}] ${NATURES[v.nature]} — ${MODULES[v.module]}`, lien: origine, bouton: "Ouvrir l'application", appel: "Le signalement est aussi dans Mon compte → Assistance :",
        message: lignes.join("\n"), ...(v.captures.length ? { attachments: v.captures.map((c) => ({ filename: c.nom, content: c.base64 })) } : {}) });
      email = e.statusCode === 200 ? "envoye" : "echec";
    } catch (e) { console.error("[assistance] e-mail :", e.message); email = "echec"; }
  }
  return authResp(200, { ok: true, numero, email });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });
  let me = null;
  try { me = await currentUser(event); } catch { return authResp(503, { error: "Vérification de la connexion impossible, réessayez." }); }
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });
  let store;
  try { store = await getNamedStore(event, ASSISTANCE_STORE); }
  catch (e) { console.error("[assistance]", e.message); return authResp(503, { error: "Enregistrement indisponible pour l'instant. Réessayez dans un instant.", blobs_error: true }); }
  try { return await traiter(event, me, store); }
  catch (e) { console.error("[assistance]", e.message); return authResp(500, { error: "Envoi impossible, réessayez." }); }
};
