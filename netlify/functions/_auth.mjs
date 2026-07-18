// Authentification FIDI — JWT maison (HMAC-SHA256) + scrypt, utilisateurs stockés
// dans la base Notion « Utilisateurs FIDI » (source de vérité, une info = un champ).
//
// Env requis : JWT_SECRET (signature des jetons), NOTION_TOKEN (accès base users).
// Le péage s'active via PAYWALL_ENABLED=true ; tant que false, accès libre.

import crypto from "node:crypto";
import {
  DB, jsonResp, queryDatabase, updatePage, createPage,
  P, readText, readNumber, readSelect,
} from "./_notion.mjs";

const JWT_TTL = 60 * 60 * 24 * 7; // 7 jours
const COOKIE = "fidi_session";

export function paywallOn() {
  return String(process.env.PAYWALL_ENABLED || "").toLowerCase() === "true";
}
export function startCredits() {
  const n = parseInt(process.env.START_CREDITS); return Number.isFinite(n) ? n : 3;
}
export function costEtude() {
  const n = parseInt(process.env.COST_ETUDE); return Number.isFinite(n) ? n : 1;
}
function secret() { return process.env.JWT_SECRET || ""; }

// ─── base64url ────────────────────────────────────────────────────────────────
const b64u  = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64ud = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// ─── JWT HMAC-SHA256 ──────────────────────────────────────────────────────────
export function signJWT(payload, ttl = JWT_TTL) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttl };
  const head = b64u(JSON.stringify(header)) + "." + b64u(JSON.stringify(body));
  const sig = b64u(crypto.createHmac("sha256", secret()).update(head).digest());
  return head + "." + sig;
}

export function verifyJWT(token) {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const head = parts[0] + "." + parts[1];
  const expected = b64u(crypto.createHmac("sha256", secret()).update(head).digest());
  const a = Buffer.from(parts[2]); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body; try { body = JSON.parse(b64ud(parts[1]).toString()); } catch { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

// ─── Mots de passe (scrypt) ───────────────────────────────────────────────────
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const dk = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), 64);
  const a = Buffer.from(hashHex, "hex");
  return a.length === dk.length && crypto.timingSafeEqual(a, dk);
}

// ─── Utilisateurs (Notion) ────────────────────────────────────────────────────
export function userFromPage(page) {
  const p = page.properties || {};
  return {
    id:      page.id,
    email:   readText(p["Email"]).toLowerCase(),
    nom:     readText(p["Nom"]),
    role:    readSelect(p["Rôle"]) || "Collaborateur",
    statut:  readSelect(p["Statut"]) || "Actif",
    credits: readNumber(p["Crédits"]) ?? 0,
    hash:    readText(p["Mot de passe"]),
  };
}

export async function findUserByEmail(email) {
  const data = await queryDatabase(DB.users, {
    filter: { property: "Email", title: { equals: String(email).trim().toLowerCase() } },
    page_size: 1,
  });
  const page = data.results?.[0];
  return page ? { page, user: userFromPage(page) } : null;
}

export async function setCredits(pageId, value) {
  return updatePage(pageId, { "Crédits": P.number(Math.max(0, value)) });
}

export async function touchLastLogin(pageId) {
  return updatePage(pageId, { "Dernière connexion": P.date(new Date().toISOString()) });
}

export async function createUser({ email, nom, password, role = "Collaborateur", credits = startCredits() }) {
  return createPage(DB.users, {
    "Email":       P.title(String(email).trim().toLowerCase()),
    "Nom":         P.text(nom || ""),
    "Mot de passe":P.text(hashPassword(password)),
    "Rôle":        P.select(role),
    "Statut":      P.select("Actif"),
    "Crédits":     P.number(credits),
  });
}

// ─── Cookies / requête ────────────────────────────────────────────────────────
export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${JWT_TTL}`;
}
export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
function readToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookie = h.cookie || h.Cookie || "";
  const m = cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// Renvoie le payload JWT vérifié, ou null.
export function authPayload(event) {
  return verifyJWT(readToken(event));
}

// Charge l'utilisateur à jour depuis Notion (solde frais). null si absent/désactivé.
export async function currentUser(event) {
  const pl = authPayload(event);
  if (!pl || !pl.email) return null;
  const found = await findUserByEmail(pl.email);
  if (!found || found.user.statut !== "Actif") return null;
  return found;
}

export const AUTH_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};
export function authResp(status, body, extraHeaders = {}) {
  return { statusCode: status, headers: { ...AUTH_HEADERS, ...extraHeaders }, body: JSON.stringify(body) };
}

export { jsonResp };
