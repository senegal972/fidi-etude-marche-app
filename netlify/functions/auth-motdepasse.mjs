// POST /api/auth/mot-de-passe { actuel, nouveau } — un utilisateur connecté change son propre mot de passe.
//
// Session exigée avant tout le reste. Le mot de passe actuel est redemandé : une session laissée ouverte sur un poste ne
// suffit pas à changer le mot de passe. Frein : 5 essais par quart d'heure et par compte (mémoire du conteneur).
// Le nouveau mot de passe suit la même règle qu'à l'inscription (motDePasseRefuse). Rien n'est envoyé par e-mail.
// Les liens « mot de passe oublié » déjà envoyés cessent de fonctionner (leur empreinte dépend de l'ancien mot de passe).
import { hasToken } from "./_notion.mjs";
import { authResp, currentUser, verifyPassword, setPassword, signJWT, sessionCookie, findUserByEmail, empreinteMdp } from "./_auth.mjs";
import { motDePasseRefuse } from "./signup-link.mjs";

export const ESSAIS_MAX = 5;
export const FENETRE_MS = 15 * 60 * 1000;
const essais = new Map(); // id du compte → [instants des essais manqués]

function bloque(id) {
  const maintenant = Date.now();
  const l = (essais.get(id) || []).filter((t) => maintenant - t < FENETRE_MS);
  essais.set(id, l);
  return l.length >= ESSAIS_MAX;
}
const noterEchec = (id) => { const l = essais.get(id) || []; l.push(Date.now()); essais.set(id, l); };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET || !hasToken()) return authResp(503, { error: "Service non configuré." });

  let moi;
  try { moi = await currentUser(event); }
  catch { return authResp(503, { error: "Vérification de la connexion impossible, réessayez." }); }
  if (!moi) return authResp(401, { error: "Connexion requise." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
  const actuel = String((b && b.actuel) || ""), nouveau = String((b && b.nouveau) || "");
  if (!actuel || !nouveau) return authResp(400, { error: "Indiquez votre mot de passe actuel et le nouveau." });

  const id = moi.user.id;
  if (bloque(id)) return authResp(429, { error: "Trop d'essais. Réessayez dans un quart d'heure, ou utilisez « Mot de passe oublié »." });
  if (!verifyPassword(actuel, moi.user.hash)) {
    noterEchec(id);
    return authResp(403, { error: "Le mot de passe actuel n'est pas le bon.", champ: "actuel" });
  }
  const refus = motDePasseRefuse(nouveau);
  if (refus) return authResp(400, { error: refus, champ: "nouveau" });
  if (nouveau === actuel) return authResp(400, { error: "Le nouveau mot de passe doit être différent de l'actuel.", champ: "nouveau" });

  try { await setPassword(id, nouveau); }
  catch (e) { console.error("[mot-de-passe] enregistrement impossible :", e.message); return authResp(502, { error: "Le mot de passe n'a pas pu être enregistré. Réessayez." }); }
  essais.delete(id);
  // Les sessions ouvertes ailleurs tombent (elles portent l'empreinte de l'ancien mot de passe) ; celle-ci est renouvelée.
  let entetes = {};
  try {
    const relu = await findUserByEmail(moi.user.email);
    if (relu) entetes = { "Set-Cookie": sessionCookie(signJWT({ email: moi.user.email, role: moi.user.role, sub: id, pv: empreinteMdp(relu.user.hash) })) };
  } catch { /* à défaut, l'utilisateur se reconnectera */ }
  return authResp(200, { ok: true, message: "Mot de passe modifié. Vos autres appareils devront se reconnecter." }, entetes);
};
