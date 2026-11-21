// Fiche contact d'un client de facturation : plusieurs adresses e-mail, report sur les factures, accès réservé.
// Vrai client @netlify/blobs sur un store en mémoire (même méthode que facture-paiement-store.test.mjs).
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID; delete process.env.NETLIFY_AUTH_TOKEN; delete process.env.NETLIFY_TOKEN; delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler, assainirContact, cleContact, EMAILS_MAX } = await import("../netlify/functions/contacts.mjs");
const crm = await import("../netlify/functions/crm-clients.mjs");
const histo = await import("../netlify/functions/factures-client.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();
let role, factures, majs;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    if (u.pathname.endsWith("/query")) {
      if (JSON.stringify(corps).includes('"Client"')) {
        return new Response(JSON.stringify({ results: factures.map((f) => ({ id: f.id, properties: {
          "Email client": { email: f.email || null }, "Téléphone client": { phone_number: f.tel || null } } })) }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [{ id: "page-moi", properties: {
        "Email": { title: [{ plain_text: "moi@exemple.fr" }] }, "Nom": { rich_text: [{ plain_text: "Moi" }] },
        "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: role } } } }] }), { status: 200 });
    }
    const id = u.pathname.split("/").pop(), p = corps.properties || {};
    const f = factures.find((x) => x.id === id);
    if (f) { f.email = p["Email client"].email; f.tel = p["Téléphone client"].phone_number; majs.push(id); }
    return new Response("{}", { status: 200 });
  }
  if (u.hostname === "edge.test") {
    const cle = u.pathname.split("/").filter(Boolean).map(decodeURIComponent).slice(2).join("/");
    const methode = String(options.method || "get").toLowerCase();
    if (methode === "put") { blobs.set(cle, String(options.body)); return new Response(null, { status: 200 }); }
    if (!blobs.has(cle)) return new Response(null, { status: 404 });
    return new Response(methode === "head" ? null : blobs.get(cle), { status: 200 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });
beforeEach(() => { blobs.clear(); role = "Administrateur"; majs = [];
  factures = [{ id: "f1", email: "ancien@exemple.fr", tel: "" }, { id: "f2", email: "ancien@exemple.fr", tel: "" }]; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const base = { "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr" };
const entetes = { ...base, cookie: "fidi_session=" + signJWT({ email: "moi@exemple.fr" }) };
const post = async (b, h = entetes) => { const r = await handler({ httpMethod: "POST", headers: h, blobs: contexte, body: JSON.stringify(b) }); return { code: r.statusCode, ...JSON.parse(r.body) }; };
const get = async (nom, h = entetes) => { const r = await handler({ httpMethod: "GET", headers: h, blobs: contexte, queryStringParameters: { nom } }); return { code: r.statusCode, ...JSON.parse(r.body) }; };

test("assainirContact : adresses validées, dédoublonnées, en minuscules", () => {
  const r = assainirContact({ nom: " Mme Durand ", emails: ["A@Exemple.fr", "a@exemple.fr", "", "notaire@etude.fr"], telephone: "+596 696 00 00 00", adresse: "1 rue X", note: "n" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.valeur.emails, ["a@exemple.fr", "notaire@etude.fr"]);
  assert.equal(r.valeur.nom, "Mme Durand");
  assert.equal(assainirContact({ nom: "Durand", emails: ["pas-une-adresse"] }).ok, false);
  assert.equal(assainirContact({ nom: "D", emails: [] }).ok, false);
  assert.equal(assainirContact({ nom: "Durand", emails: [], telephone: "abc" }).ok, false);
  assert.equal(assainirContact({ nom: "Durand", emails: Array.from({ length: EMAILS_MAX + 1 }, (_, i) => `a${i}@exemple.fr`) }).ok, false);
  assert.equal(assainirContact({ nom: "Durand", emails: [] }).ok, true, "un contact peut n'avoir aucune adresse");
  assert.equal(cleContact("Mme  DURAND"), cleContact("mme durand"));
});

test("sans session : 401 ; sans rôle administrateur : 403", async () => {
  assert.equal((await get("Mme Durand", base)).code, 401);
  assert.equal((await post({ nom: "Mme Durand", emails: [] }, base)).code, 401);
  role = "Utilisateur";
  assert.equal((await get("Mme Durand")).code, 403);
  assert.equal((await post({ nom: "Mme Durand", emails: ["x@exemple.fr"] })).code, 403);
  assert.equal(blobs.size, 0); assert.equal(majs.length, 0);
});

test("sans fiche : coordonnées relevées sur les factures", async () => {
  const r = await get("Mme Durand");
  assert.equal(r.code, 200); assert.equal(r.contact.provisoire, true);
  assert.deepEqual(r.contact.emails, ["ancien@exemple.fr"]); assert.equal(r.factures, 2);
});

test("enregistrement : plusieurs adresses gardées, la principale reportée sur les factures", async () => {
  const r = await post({ nom: "Mme Durand", emails: ["nouveau@exemple.fr", "notaire@etude.fr"], telephone: "0696 00 00 00", adresse: "1 rue X", note: "Copie au notaire" });
  assert.equal(r.code, 200); assert.equal(r.reportees, 2); assert.equal(r.echecs, 0);
  assert.ok(factures.every((f) => f.email === "nouveau@exemple.fr" && f.tel === "0696 00 00 00"));
  const lu = await get("Mme Durand");
  assert.deepEqual(lu.contact.emails, ["nouveau@exemple.fr", "notaire@etude.fr"]);
  assert.equal(lu.contact.note, "Copie au notaire"); assert.equal(lu.contact.par.email, "moi@exemple.fr"); assert.ok(!lu.contact.provisoire);
  // Second enregistrement identique : aucune facture retouchée.
  majs = [];
  assert.equal((await post({ nom: "Mme Durand", emails: ["nouveau@exemple.fr", "notaire@etude.fr"], telephone: "0696 00 00 00" })).reportees, 0);
  assert.equal(majs.length, 0);
});

test("toutes les adresses retirées : l'adresse des factures est vidée", async () => {
  const r = await post({ nom: "Mme Durand", emails: [] });
  assert.equal(r.code, 200);
  assert.ok(factures.every((f) => f.email === null));
});

test("adresse invalide : 400, rien n'est écrit", async () => {
  assert.equal((await post({ nom: "Mme Durand", emails: ["bon@exemple.fr", "faux"] })).code, 400);
  assert.equal(blobs.size, 0); assert.equal(majs.length, 0);
});

test("liste des clients du CRM et historique d'un client : connexion exigée", async () => {
  assert.equal((await crm.handler({ httpMethod: "GET", headers: base, queryStringParameters: {} })).statusCode, 401);
  assert.equal((await histo.handler({ httpMethod: "GET", headers: base, queryStringParameters: { client: "Mme Durand" } })).statusCode, 401);
});

test("périmètre d'analyse : 500 m par défaut", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bloc = html.slice(html.indexOf('id="selectPerimetre"'), html.indexOf("</select>", html.indexOf('id="selectPerimetre"')));
  const choisies = bloc.match(/<option[^>]*\bselected\b[^>]*>/g) || [];
  assert.equal(choisies.length, 1);
  assert.match(choisies[0], /rayon_500m/);
});

test("rubrique Facturation : fiche contact et destinataires multiples branchés", () => {
  const js = readFileSync(new URL("../compte-facturation.js", import.meta.url), "utf8");
  for (const m of ["/api/contacts", 'data-fa-form="contact"', 'data-fa-email="ajouter"', 'data-fa-email="retirer"', "fa-dest", "faDestAutre"]) assert.ok(js.includes(m), m);
  assert.match(readFileSync(new URL("../netlify.toml", import.meta.url), "utf8"), /\/api\/contacts/);
});
