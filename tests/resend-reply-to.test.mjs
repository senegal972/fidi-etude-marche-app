// Les réponses des clients doivent arriver dans la vraie boîte (contact@fidiconseil.com) :
// l'expéditeur, sur mail.fidiconseil.com, n'a pas de boîte. Champ reply_to de l'API Resend,
// présent dans l'envoi d'un document (send-email) et dans la relance automatique de facture.
// Aucun réseau réel : fetch est remplacé (Notion et Resend simulés).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
process.env.RESEND_API_KEY = "re_cle_de_test";

const { envoyerEmail } = await import("../netlify/functions/send-email.mjs");
const autorelance = await import("../netlify/functions/facture-autorelance.mjs");

const vraiFetch = globalThis.fetch;
let envoisResend = [];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === "https://api.resend.com/emails") {
    envoisResend.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
  }
  if (u.startsWith("https://api.notion.com/v1/databases/") && init.method === "GET") {
    return new Response(JSON.stringify({ properties: { "Relances": {}, "Dernière relance": {} } }), { status: 200 });
  }
  if (u.startsWith("https://api.notion.com/v1/databases/") && u.endsWith("/query")) {
    const page = {
      id: "facture-1",
      properties: {
        "Numéro": { title: [{ plain_text: "F-2026-001" }] },
        "Email client": { email: "client@exemple.fr" },
        "Jeton livraison": { rich_text: [{ plain_text: "jeton123" }] },
        "Montant TTC": { number: 250 },
        "Date": { date: { start: "2020-01-01" } },
        "Relances": { number: 0 },
        "Dernière relance": { date: null },
      },
    };
    return new Response(JSON.stringify({ results: [page], has_more: false }), { status: 200 });
  }
  if (u.startsWith("https://api.notion.com/v1/pages/")) return new Response("{}", { status: 200 });
  throw new Error("appel réseau inattendu : " + u);
};
after(() => { globalThis.fetch = vraiFetch; });

beforeEach(() => {
  envoisResend = [];
  delete process.env.RESEND_REPLY_TO;
  process.env.RESEND_API_KEY = "re_cle_de_test";
  process.env.AUTORELANCE_ENABLED = "1";
  process.env.URL = "https://exemple.netlify.app";
});

const document = { to: "client@exemple.fr", subject: "Document", lien: "https://exemple.fr/l/abc", message: "Bonjour" };

test("envoi d'un document : reply_to par défaut = contact@fidiconseil.com", async () => {
  const r = await envoyerEmail(document);
  assert.equal(r.statusCode, 200);
  assert.equal(envoisResend.length, 1);
  assert.equal(envoisResend[0].reply_to, "contact@fidiconseil.com");
  assert.deepEqual(envoisResend[0].to, ["client@exemple.fr"]);
});

test("envoi d'un document : RESEND_REPLY_TO prime sur la valeur par défaut", async () => {
  process.env.RESEND_REPLY_TO = "service@exemple.fr";
  await envoyerEmail(document);
  assert.equal(envoisResend[0].reply_to, "service@exemple.fr");
});

test("relance automatique : reply_to par défaut = contact@fidiconseil.com", async () => {
  const r = await autorelance.handler();
  const sortie = JSON.parse(r.body);
  assert.equal(sortie.errors.length, 0, JSON.stringify(sortie.errors));
  assert.equal(envoisResend.length, 1);
  assert.equal(envoisResend[0].reply_to, "contact@fidiconseil.com");
  assert.deepEqual(envoisResend[0].to, ["client@exemple.fr"]);
});

test("relance automatique : RESEND_REPLY_TO prime sur la valeur par défaut", async () => {
  process.env.RESEND_REPLY_TO = "service@exemple.fr";
  await autorelance.handler();
  assert.equal(envoisResend[0].reply_to, "service@exemple.fr");
});

test("relance automatique désactivée (AUTORELANCE_ENABLED absent) : simulation, aucun envoi", async () => {
  delete process.env.AUTORELANCE_ENABLED;
  const r = await autorelance.handler();
  assert.equal(JSON.parse(r.body).enabled, false);
  assert.equal(envoisResend.length, 0);
});
