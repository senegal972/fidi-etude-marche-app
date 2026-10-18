// Garde d'accès de /api/send-email : sans session valide rien ne part, même quand la clé
// Resend est posée. Sans cette garde, la route publique serait un relais d'e-mails ouvert à
// tout Internet (hameçonnage au nom de FIDI, quota Resend épuisé, réputation du domaine
// d'envoi abîmée). Aucun réseau réel : fetch est remplacé (Notion et Resend simulés).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
process.env.RESEND_API_KEY = "re_cle_de_test";

const { handler, envoyerEmail } = await import("../netlify/functions/send-email.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
let appels = [];
let compte = { statut: "Actif", absent: false };

globalThis.fetch = async (url) => {
  const u = String(url);
  appels.push(u);
  if (u.startsWith("https://api.notion.com/")) {
    const page = {
      id: "page-1",
      properties: {
        "Email": { title: [{ plain_text: "agent@exemple.fr" }] },
        "Statut": { select: { name: compte.statut } },
        "Rôle": { select: { name: "Collaborateur" } },
      },
    };
    return new Response(JSON.stringify({ results: compte.absent ? [] : [page] }), { status: 200 });
  }
  if (u === "https://api.resend.com/emails") return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
  throw new Error("appel réseau inattendu : " + u);
};
after(() => { globalThis.fetch = vraiFetch; });

beforeEach(() => {
  appels = [];
  compte = { statut: "Actif", absent: false };
  process.env.RESEND_API_KEY = "re_cle_de_test";
  process.env.JWT_SECRET = "secret-de-test-seulement";
});

const mails = () => appels.filter((u) => u === "https://api.resend.com/emails").length;
const corps = { to: "client@exemple.fr", subject: "Document", lien: "https://exemple.fr/l/abc", message: "Bonjour" };
const ev = (headers = {}, body = corps) => ({ httpMethod: "POST", headers, body: JSON.stringify(body) });
const jeton = (payload = { email: "agent@exemple.fr" }, ttl) => signJWT(payload, ttl);
const bearer = (t) => ({ authorization: "Bearer " + t });

test("anonyme : 401, aucun appel Notion ni Resend, même avec la clé Resend posée", async () => {
  const r = await handler(ev());
  assert.equal(r.statusCode, 401);
  assert.equal(appels.length, 0);
});

test("anonyme sans clé Resend : 401 et non 503 (la route ne révèle pas sa configuration)", async () => {
  delete process.env.RESEND_API_KEY;
  const r = await handler(ev());
  assert.equal(r.statusCode, 401);
});

test("jeton à signature fausse : 401, rien ne part", async () => {
  const p = jeton().split(".");
  p[2] = (p[2][0] === "A" ? "B" : "A") + p[2].slice(1);
  const r = await handler(ev(bearer(p.join("."))));
  assert.equal(r.statusCode, 401);
  assert.equal(mails(), 0);
});

test("jeton expiré : 401, rien ne part", async () => {
  const r = await handler(ev(bearer(jeton({ email: "agent@exemple.fr" }, -10))));
  assert.equal(r.statusCode, 401);
  assert.equal(mails(), 0);
});

test("jeton d'un autre usage (lien d'inscription, sans e-mail de compte) : 401", async () => {
  const r = await handler(ev(bearer(jeton({ purpose: "signup", role: "Collaborateur" }))));
  assert.equal(r.statusCode, 401);
  assert.equal(mails(), 0);
});

test("compte désactivé : 401, rien ne part", async () => {
  compte.statut = "Désactivé";
  const r = await handler(ev(bearer(jeton())));
  assert.equal(r.statusCode, 401);
  assert.equal(mails(), 0);
});

test("compte introuvable dans Notion : 401, rien ne part", async () => {
  compte.absent = true;
  const r = await handler(ev(bearer(jeton())));
  assert.equal(r.statusCode, 401);
  assert.equal(mails(), 0);
});

test("sans JWT_SECRET : fermé par défaut (401), même avec un jeton fabriqué avant", async () => {
  const t = jeton();
  delete process.env.JWT_SECRET;
  const r = await handler(ev(bearer(t)));
  assert.equal(r.statusCode, 401);
  assert.equal(mails(), 0);
});

test("Notion en panne : 503 (fermé), rien ne part", async () => {
  const courant = globalThis.fetch;
  globalThis.fetch = async (url) => { appels.push(String(url)); throw new Error("réseau coupé"); };
  try {
    const r = await handler(ev(bearer(jeton())));
    assert.equal(r.statusCode, 503);
    assert.equal(mails(), 0);
  } finally { globalThis.fetch = courant; }
});

test("utilisateur actif (en-tête Bearer) : 200 et un seul e-mail", async () => {
  const r = await handler(ev(bearer(jeton())));
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(mails(), 1);
});

test("utilisateur actif (cookie fidi_session, comme le navigateur) : 200 et un seul e-mail", async () => {
  const r = await handler(ev({ cookie: "autre=1; fidi_session=" + jeton() }));
  assert.equal(r.statusCode, 200);
  assert.equal(mails(), 1);
});

test("utilisateur actif, corps invalide : 400 et rien ne part", async () => {
  const r = await handler({ httpMethod: "POST", headers: bearer(jeton()), body: "{pas du json" });
  assert.equal(r.statusCode, 400);
  assert.equal(mails(), 0);
});

test("utilisateur actif sans clé Resend : 503 « non configuré » (la garde passe d'abord)", async () => {
  delete process.env.RESEND_API_KEY;
  const r = await handler(ev(bearer(jeton())));
  assert.equal(r.statusCode, 503);
  assert.equal(JSON.parse(r.body).not_configured, true);
  assert.equal(mails(), 0);
});

test("OPTIONS reste 200 et les autres méthodes 405, sans session", async () => {
  assert.equal((await handler({ httpMethod: "OPTIONS", headers: {} })).statusCode, 200);
  assert.equal((await handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
});

test("cœur d'envoi direct (facture-pay-capture, paiement déjà vérifié) : envoie sans session", async () => {
  const r = await envoyerEmail(corps);
  assert.equal(r.statusCode, 200);
  assert.equal(mails(), 1);
});

test("facture-pay-capture se charge et expose son handler", async () => {
  const m = await import("../netlify/functions/facture-pay-capture.mjs");
  assert.equal(typeof m.handler, "function");
});

test("garde-fou : facture-pay-capture appelle le cœur d'envoi, jamais la route publique", () => {
  const src = readFileSync(new URL("../netlify/functions/facture-pay-capture.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{ envoyerEmail \} from "\.\/send-email\.mjs"/);
  assert.match(src, /envoyerEmail\(payload\)/);
  assert.doesNotMatch(src, /\/\.netlify\/functions\/send-email/);
});

test("garde-fou : le handler de send-email vérifie la session avant l'envoi et sans regarder la clé", () => {
  const src = readFileSync(new URL("../netlify/functions/send-email.mjs", import.meta.url), "utf8");
  const h = src.slice(src.indexOf("export const handler"));
  assert.ok(h.indexOf("currentUser(") > 0, "currentUser absent du handler");
  assert.ok(h.indexOf("currentUser(") < h.indexOf("envoyerEmail("), "la garde doit précéder l'envoi");
  assert.doesNotMatch(h, /RESEND_API_KEY/, "le handler ne doit pas dépendre de la clé avant la garde");
});
