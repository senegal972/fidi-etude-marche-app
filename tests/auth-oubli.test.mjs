// « Mot de passe oublié » : lien par e-mail (1 h, usage unique), réponse identique que le compte existe ou non.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
process.env.RESEND_API_KEY = "re_cle_de_test";
process.env.RESEND_FROM = "Cabinet Test <envoi@mail.exemple.fr>";
delete process.env.NETLIFY_SITE_ID; delete process.env.NETLIFY_AUTH_TOKEN; delete process.env.NETLIFY_TOKEN; delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler, empreinte } = await import("../netlify/functions/auth-oubli.mjs");
const { hashPassword, verifyPassword, signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
let comptes, mails;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.resend.com") { mails.push(JSON.parse(options.body)); return new Response(JSON.stringify({ id: "m1" }), { status: 200 }); }
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    if (u.pathname.endsWith("/query")) {
      const email = corps?.filter?.title?.equals || "";
      const c = comptes[email];
      return new Response(JSON.stringify({ results: c ? [{ id: "p-" + email, properties: {
        "Email": { title: [{ plain_text: email }] }, "Nom": { rich_text: [{ plain_text: "Test" }] }, "Statut": { select: { name: c.statut } },
        "Rôle": { select: { name: "Collaborateur" } }, "Mot de passe": { rich_text: [{ plain_text: c.hash }] } } }] : [] }), { status: 200 });
    }
    const m = u.pathname.match(/\/pages\/p-(.+)$/);
    if (m && corps.properties && corps.properties["Mot de passe"]) comptes[decodeURIComponent(m[1])].hash = corps.properties["Mot de passe"].rich_text[0].text.content;
    return new Response("{}", { status: 200 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });
let n = 0;
beforeEach(() => { mails = []; n++; comptes = { [`agent${n}@exemple.fr`]: { statut: "Actif", hash: hashPassword("ancienmotdepasse1") }, [`ferme${n}@exemple.fr`]: { statut: "Désactivé", hash: hashPassword("ancienmotdepasse1") } }; });

const post = async (b) => { const r = await handler({ httpMethod: "POST", headers: { host: "app.exemple.fr" }, body: JSON.stringify(b) }); return { code: r.statusCode, ...JSON.parse(r.body) }; };
const jetonDuMail = () => decodeURIComponent((mails[0].html.match(/#reset\?token=([A-Za-z0-9._-]+)/) || [])[1] || "");

test("demande : même réponse que le compte existe, n'existe pas ou soit désactivé ; un seul e-mail part", async () => {
  const a = await post({ email: `agent${n}@exemple.fr` });
  const b = await post({ email: `inconnu${n}@exemple.fr` });
  const c = await post({ email: `ferme${n}@exemple.fr` });
  assert.deepEqual([a.code, b.code, c.code], [200, 200, 200]);
  assert.equal(a.message, b.message); assert.equal(a.message, c.message);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, [`agent${n}@exemple.fr`]);
  assert.match(mails[0].html, /https:\/\/app\.exemple\.fr\/#reset\?token=/);
  assert.match(mails[0].html, /Choisir un nouveau mot de passe/);
  assert.doesNotMatch(mails[0].html, /ancienmotdepasse1/, "aucun mot de passe dans l'e-mail");
  assert.equal((await post({ email: "pas-une-adresse" })).code, 400);
});

test("deux demandes rapprochées : un seul e-mail", async () => {
  await post({ email: `agent${n}@exemple.fr` });
  await post({ email: `agent${n}@exemple.fr` });
  assert.equal(mails.length, 1);
});

test("le lien change le mot de passe, puis ne sert plus", async () => {
  const email = `agent${n}@exemple.fr`;
  await post({ email });
  const jeton = jetonDuMail();
  assert.ok(jeton.length > 20);
  assert.equal((await post({ action: "changer", token: jeton, password: "court1" })).code, 400);
  assert.equal(verifyPassword("ancienmotdepasse1", comptes[email].hash), true, "un refus ne change rien");
  const r = await post({ action: "changer", token: jeton, password: "nouveaumotdepasse2" });
  assert.equal(r.code, 200); assert.equal(r.email, email);
  assert.equal(verifyPassword("nouveaumotdepasse2", comptes[email].hash), true);
  assert.equal(verifyPassword("ancienmotdepasse1", comptes[email].hash), false);
  const encore = await post({ action: "changer", token: jeton, password: "encoreunautre3" });
  assert.equal(encore.code, 410, "le lien est à usage unique");
  assert.equal(verifyPassword("nouveaumotdepasse2", comptes[email].hash), true);
});

test("refus : lien faux, expiré, d'un autre usage, ou compte désactivé", async () => {
  const email = `agent${n}@exemple.fr`, v = empreinte(comptes[email].hash);
  const essai = (token) => post({ action: "changer", token, password: "nouveaumotdepasse2" });
  assert.equal((await essai("faux.jeton.ici")).code, 410);
  assert.equal((await essai(signJWT({ purpose: "reset", email, v }, -10))).code, 410, "expiré");
  assert.equal((await essai(signJWT({ email }))).code, 410, "un jeton de session ne permet pas de changer le mot de passe");
  assert.equal((await essai(signJWT({ purpose: "signup", email }))).code, 410, "une invitation non plus");
  assert.equal((await essai(signJWT({ purpose: "reset", email, v: "mauvaise-empreinte" }, 600))).code, 410);
  assert.equal((await essai(signJWT({ purpose: "reset", email: `ferme${n}@exemple.fr`, v: empreinte(comptes[`ferme${n}@exemple.fr`].hash) }, 600))).code, 410);
  assert.equal(verifyPassword("ancienmotdepasse1", comptes[email].hash), true);
});

test("sans service d'e-mail : message clair, aucun envoi", async () => {
  const cle = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  const r = await post({ email: `agent${n}@exemple.fr` });
  process.env.RESEND_API_KEY = cle;
  assert.equal(r.code, 503); assert.equal(mails.length, 0);
});

test("écran : lien « Mot de passe oublié » sur les deux écrans de connexion", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const module = readFileSync(new URL("../inscription.js", import.meta.url), "utf8");
  assert.ok(page.includes('id="gateOubli"') && page.includes('id="cpOubli"'));
  assert.ok(module.includes("'/api/auth/oubli'") && module.includes("action: 'changer'"));
  assert.match(module, /\^#reset\\\?token=/);
});
