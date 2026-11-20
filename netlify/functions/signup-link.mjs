// Netlify Function — Lien d'inscription éphémère (24 h)
// POST /api/signup-link  body: { reseau?, role?, credits?, quota? }  → admin : génère un lien
// GET  /api/signup-link?token=XXX                                   → public : valide le token
// POST /api/signup-link  body: { action:"inscrire", token, email, nom, password, reseau? }
//                                                                    → public : l'invité crée SON compte et choisit SON mot de passe
//      Le lien ne sert qu'une fois : son empreinte est notée dans Blobs « fidi-invitations ». Stockage indisponible ⇒ refus.
// Le token est un JWT signé (JWT_SECRET) qui expire au bout de 24 h. Il peut porter
// un réseau pré-affecté ; sinon l'invité choisira/créera son réseau à l'inscription.

import crypto from "node:crypto";
import { signJWT, verifyJWT, currentUser, authResp, createUser, findUserByEmail } from "./_auth.mjs";
import { DB, P, updatePage, ensureProperty, hasToken } from "./_notion.mjs";
import { getNamedStore } from "./_blobs.mjs";

export const INVITATIONS_STORE = "fidi-invitations";
const EMAIL_OK = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const texte = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

// Règle du mot de passe choisi par l'invité : 10 caractères au moins, avec une lettre et un chiffre. Renvoie "" si valide.
export function motDePasseRefuse(pw) {
  const s = String(pw || "");
  if (s.length < 10) return "Mot de passe : 10 caractères au moins.";
  if (s.length > 200) return "Mot de passe trop long.";
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return "Mot de passe : au moins une lettre et un chiffre.";
  return "";
}

async function inscrire(event, b) {
  if (!hasToken()) return authResp(503, { error: "Service non configuré." });
  const jeton = String(b.token || "").trim();
  const payload = verifyJWT(jeton);
  if (!payload || payload.purpose !== "signup") return authResp(410, { error: "Lien d'inscription invalide ou expiré (validité 24 h). Demandez-en un nouveau.", expired: true });
  const email = texte(b.email, 120).toLowerCase();
  if (!EMAIL_OK.test(email)) return authResp(400, { error: "Adresse e-mail invalide." });
  const nom = texte(b.nom, 80);
  if (nom.length < 2) return authResp(400, { error: "Indiquez votre nom." });
  const refus = motDePasseRefuse(b.password);
  if (refus) return authResp(400, { error: refus });

  // Un lien = un compte. L'empreinte du lien est notée ; sans stockage, on refuse plutôt que de laisser le lien resservir.
  const cle = crypto.createHash("sha256").update(jeton).digest("hex");
  let store;
  try {
    store = await getNamedStore(event, INVITATIONS_STORE);
    if (await store.get(cle, { type: "json" })) return authResp(410, { error: "Ce lien d'inscription a déjà servi. Demandez-en un nouveau.", used: true });
  } catch (e) {
    console.error("[signup-link] stockage des invitations indisponible :", e.message);
    return authResp(503, { error: "Inscription momentanément indisponible. Réessayez dans un instant." });
  }
  if (await findUserByEmail(email)) return authResp(409, { error: "Un compte existe déjà pour cette adresse. Connectez-vous, ou demandez un nouveau mot de passe à votre administrateur." });

  await store.setJSON(cle, { le: new Date().toISOString(), email, par: payload.by || "" });
  const page = await createUser({
    email, nom, password: String(b.password), role: payload.role === "Test" ? "Test" : "Collaborateur",
    ...(Number.isFinite(+payload.credits) ? { credits: +payload.credits } : {}),
    ...(Number.isFinite(+payload.quota) ? { quota: +payload.quota } : {}),
  });
  const reseau = texte(payload.reseau || b.reseau, 100);
  if (reseau && page && page.id) {
    try { await ensureProperty(DB.users, "Réseau", { rich_text: {} }); await updatePage(page.id, { "Réseau": P.text(reseau) }); }
    catch (e) { console.error("[signup-link] réseau non enregistré :", e.message); }
  }
  return authResp(200, { ok: true, created: email });
}

const TTL_24H = 24 * 3600;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Auth non configurée." });

  // GET public : validation d'un token (pour la page d'inscription)
  if (event.httpMethod === "GET") {
    const token = String((event.queryStringParameters || {}).token || "").trim();
    if (!token) return authResp(400, { error: "token requis" });
    const payload = verifyJWT(token);
    if (!payload || payload.purpose !== "signup") {
      return authResp(410, { error: "Lien d'inscription invalide ou expiré (validité 24 h).", expired: true });
    }
    const expiresIn = payload.exp - Math.floor(Date.now() / 1000);
    return authResp(200, {
      ok: true, valid: true,
      reseau: payload.reseau || "",
      role: payload.role || "Collaborateur",
      credits: payload.credits ?? null,
      quota: payload.quota ?? null,
      expires_in_seconds: expiresIn,
      reseau_libre: !payload.reseau, // si aucun réseau imposé, l'invité peut créer le sien
    });
  }

  if (event.httpMethod !== "POST") return authResp(405, { error: "GET ou POST requis" });

  // POST public : l'invité crée son compte avec le lien reçu.
  let corps; try { corps = JSON.parse(event.body || "{}"); } catch { corps = {}; }
  if (corps && corps.action === "inscrire") {
    try { return await inscrire(event, corps); }
    catch (e) { console.error("[signup-link] inscription :", e.message); return authResp(e.status || 500, { error: "Inscription impossible. Réessayez." }); }
  }

  // POST : génération réservée aux administrateurs
  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { b = {}; }
  const payload = {
    purpose: "signup",
    reseau: b.reseau ? String(b.reseau).slice(0, 100) : "",
    role: b.role === "Test" ? "Test" : "Collaborateur", // jamais Administrateur via lien public
    ...(Number.isFinite(+b.credits) ? { credits: +b.credits } : {}),
    ...(Number.isFinite(+b.quota) ? { quota: +b.quota } : {}),
    by: me.user.email,
  };
  const token = signJWT(payload, TTL_24H);
  const origin = (event.headers["x-forwarded-proto"] || "https") + "://" + (event.headers.host || "");
  const url = `${origin}/#signup?token=${token}`;
  return authResp(200, {
    ok: true, url, token,
    expires_in_hours: 24,
    reseau: payload.reseau,
    note: "Lien valable 24 h. L'invité crée son compte" + (payload.reseau ? " (réseau : " + payload.reseau + ")" : " et choisit/crée son réseau") + ".",
  });
};
