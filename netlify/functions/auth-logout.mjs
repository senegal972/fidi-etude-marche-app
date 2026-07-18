// Netlify Function — Déconnexion. POST /api/auth/logout
import { authResp, clearCookie } from "./_auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  return authResp(200, { ok: true }, { "Set-Cookie": clearCookie() });
};
