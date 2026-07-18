// Netlify Function — Connexion. POST /api/auth/login { email, password }
import { hasToken } from "./_notion.mjs";
import {
  authResp, findUserByEmail, verifyPassword, signJWT, sessionCookie, touchLastLogin,
} from "./_auth.mjs";

// Anti-brute-force best-effort (mémoire du conteneur ; réinitialisé au cold start).
const attempts = new Map();
const WINDOW = 15 * 60 * 1000, MAX = 8;
function throttled(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.ts > WINDOW) { attempts.set(key, { count: 1, ts: now }); return false; }
  a.count += 1;
  return a.count > MAX;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Authentification non configurée (JWT_SECRET absent)." });
  if (!hasToken()) return authResp(503, { error: "Notion non configuré (NOTION_TOKEN absent)." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!email || !password) return authResp(400, { error: "E-mail et mot de passe requis" });
  if (throttled(email)) return authResp(429, { error: "Trop de tentatives. Réessayez dans quelques minutes." });

  try {
    const found = await findUserByEmail(email);
    const bad = () => authResp(401, { error: "E-mail ou mot de passe incorrect." });
    if (!found) return bad();
    if (found.user.statut !== "Actif") return authResp(403, { error: "Compte désactivé. Contactez l'administrateur." });
    if (!verifyPassword(password, found.user.hash)) return bad();

    attempts.delete(email);
    const token = signJWT({ email, role: found.user.role, sub: found.page.id });
    touchLastLogin(found.page.id).catch(() => {});
    return authResp(200, {
      ok: true,
      token,
      user: { email, nom: found.user.nom, role: found.user.role, credits: found.user.credits },
    }, { "Set-Cookie": sessionCookie(token) });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
