// Inscription par lien d'invitation : le lien vaut 24 h, sert une seule fois, et l'invité choisit son mot de passe.
// Vrai client @netlify/blobs sur un store en mémoire (même méthode que avis-store.test.mjs).
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID; delete process.env.NETLIFY_AUTH_TOKEN; delete process.env.NETLIFY_TOKEN; delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler, motDePasseRefuse } = await import("../netlify/functions/signup-link.mjs");
const { signJWT, verifyPassword } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();
let comptes, crees;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    if (u.pathname.endsWith("/query")) {
      const email = corps?.filter?.title?.equals || "";
      const c = comptes[email];
      return new Response(JSON.stringify({ results: c ? [{ id: "p-" + email, properties: {
        "Email": { title: [{ plain_text: email }] }, "Nom": { rich_text: [{ plain_text: c.nom }] }, "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: c.role } } } }] : [] }), { status: 200 });
    }
    if (u.pathname === "/v1/pages" && options.method === "POST") { crees.push(corps.properties); return new Response(JSON.stringify({ id: "nouvelle-page" }), { status: 200 }); }
    return new Response(JSON.stringify({ properties: { "Réseau": {} } }), { status: 200 });
  }
  if (u.hostname === "edge.test") {
    const cle = u.pathname.split("/").filter(Boolean).map(decodeURIComponent).slice(2).join("/");
    const methode = String(options.method || "get").toLowerCase();
    if (methode === "put") { blobs.set(cle, String(options.body)); return new Response(null, { status: 200 }); }
    if (!blobs.has(cle)) return new Response(null, { status: 404 });
    return new Response(blobs.get(cle), { status: 200 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });
beforeEach(() => { blobs.clear(); crees = []; comptes = { "admin@exemple.fr": { nom: "Admin Test", role: "Administrateur" }, "agent@exemple.fr": { nom: "Agent", role: "Collaborateur" } }; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const entetes = (email) => ({ "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr", ...(email ? { cookie: "fidi_session=" + signJWT({ email }) } : {}) });
const post = async (b, email, avecBlobs = true) => { const r = await handler({ httpMethod: "POST", headers: entetes(email), ...(avecBlobs ? { blobs: contexte } : {}), body: JSON.stringify(b) }); return { code: r.statusCode, ...JSON.parse(r.body) }; };
const lien = async (b = {}) => (await post(b, "admin@exemple.fr")).token;
const demande = (token, extra = {}) => ({ action: "inscrire", token, nom: "Nouvelle Personne", email: "nouveau@exemple.fr", password: "motdepasse2026", ...extra });

test("règle du mot de passe choisi par l'invité", () => {
  assert.ok(motDePasseRefuse("court1"));
  assert.ok(motDePasseRefuse("seulementdeslettres"));
  assert.ok(motDePasseRefuse("12345678901234"));
  assert.equal(motDePasseRefuse("motdepasse2026"), "");
});

test("créer un lien est réservé à l'administrateur", async () => {
  assert.equal((await post({}, null)).code, 401);
  assert.equal((await post({}, "agent@exemple.fr")).code, 403);
  const r = await post({ reseau: "Sextant" }, "admin@exemple.fr");
  assert.equal(r.code, 200);
  assert.match(r.url, /#signup\?token=/);
});

test("l'invité crée son compte : mot de passe haché, rôle et réseau du lien, jamais administrateur", async () => {
  const token = await lien({ reseau: "Sextant", role: "Administrateur", credits: 2 });
  const r = await post(demande(token, { reseau: "Autre réseau" }));
  assert.equal(r.code, 200);
  assert.equal(crees.length, 1);
  const p = crees[0];
  assert.equal(p["Email"].title[0].text.content, "nouveau@exemple.fr");
  assert.equal(p["Rôle"].select.name, "Collaborateur", "un lien public ne crée jamais d'administrateur");
  assert.equal(p["Crédits"].number, 2);
  const hash = p["Mot de passe"].rich_text[0].text.content;
  assert.notEqual(hash, "motdepasse2026", "le mot de passe n'est pas stocké en clair");
  assert.equal(verifyPassword("motdepasse2026", hash), true);
});

test("un lien ne sert qu'une fois", async () => {
  const token = await lien();
  assert.equal((await post(demande(token))).code, 200);
  const r = await post(demande(token, { email: "second@exemple.fr" }));
  assert.equal(r.code, 410); assert.equal(r.used, true);
  assert.equal(crees.length, 1);
});

test("refus : lien faux ou expiré, e-mail déjà pris, mot de passe faible, saisie incomplète", async () => {
  assert.equal((await post(demande("faux.jeton.ici"))).code, 410);
  assert.equal((await post(demande(signJWT({ purpose: "signup" }, -10)))).code, 410, "lien expiré");
  assert.equal((await post(demande(signJWT({ email: "admin@exemple.fr" })))).code, 410, "un jeton de session n'est pas une invitation");
  const token = await lien();
  assert.equal((await post(demande(token, { email: "agent@exemple.fr" }))).code, 409);
  assert.equal((await post(demande(token, { password: "court1" }))).code, 400);
  assert.equal((await post(demande(token, { email: "pas-une-adresse" }))).code, 400);
  assert.equal((await post(demande(token, { nom: "" }))).code, 400);
  assert.equal(crees.length, 0);
  // Après ces refus, le lien n'est pas consommé.
  assert.equal((await post(demande(token))).code, 200);
});

test("page d'inscription : chargée par l'application, règle de mot de passe identique au serveur", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const module = readFileSync(new URL("../inscription.js", import.meta.url), "utf8");
  new Function(module);
  assert.match(page, /<script src="\/inscription\.js" defer><\/script>/);
  assert.match(module, /\^#signup\\\?token=/);
  assert.ok(module.includes("pw.length < 10") && module.includes("action: 'inscrire'"));
  assert.ok(page.includes("Compte.ficheMotDePasse("), "bouton de nouveau mot de passe dans la fiche du compte");
});
