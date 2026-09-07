// Netlify Function — Lien d'inscription éphémère (24 h)
// POST /api/signup-link  body: { reseau?, role?, credits?, quota? }  → admin : génère un lien
// GET  /api/signup-link?token=XXX                                   → public : valide le token
// Le token est un JWT signé (JWT_SECRET) qui expire au bout de 24 h. Il peut porter
// un réseau pré-affecté ; sinon l'invité choisira/créera son réseau à l'inscription.

import { signJWT, verifyJWT, currentUser, authResp } from "./_auth.mjs";

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
