// Paiement PayPal : commande, lecture de la capture, messages d'erreur, page de règlement.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

process.env.NOTION_TOKEN = process.env.NOTION_TOKEN || "test";
process.env.PAYPAL_CLIENT_ID = "test"; process.env.PAYPAL_SECRET = "test"; process.env.PAYPAL_ENV = "sandbox";

let facture = { requis: true, statut: "À payer", montant: 450 };
let reponseCapture = null;
const envois = [];
const vraiFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.notion.com")) {
    if (opt && opt.method === "PATCH") { envois.push({ u, body: opt.body }); return new Response("{}", { status: 200 }); }
    if (u.includes("/pages")) { envois.push({ u, body: opt.body }); return new Response("{}", { status: 200 }); }
    return new Response(JSON.stringify({ results: [{ id: "pg1", properties: {
      "Statut": { select: { name: facture.statut } }, "Paiement requis": { checkbox: facture.requis },
      "Numéro": { title: [{ plain_text: "FIDI-FAC-2026-099" }] }, "Type": { select: { name: "Avis de valeur" } },
      "Montant TTC": { number: facture.montant }, "Jeton livraison": { rich_text: [{ plain_text: "jetontest" }] },
      "Lien document": { url: "https://example.org/doc.pdf" } } }] }), { status: 200 });
  }
  if (u.includes("paypal.com")) {
    envois.push({ u, body: opt && opt.body });
    if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3000 }), { status: 200 });
    if (u.endsWith("/capture")) return new Response(JSON.stringify(reponseCapture.body), { status: reponseCapture.status });
    return new Response(JSON.stringify({ id: "CMD1" }), { status: 201 });
  }
  return vraiFetch(url, opt);
};

const pp = await import("../netlify/functions/_paypal.mjs");
const liv = await import("../netlify/functions/livraison.mjs");
const creer = await import("../netlify/functions/facture-pay-create.mjs");
const capt = await import("../netlify/functions/facture-pay-capture.mjs");
const ev = (o = {}) => ({ httpMethod: "GET", headers: { host: "x.test" }, path: "/l/jetontest", rawUrl: "https://x.test/l/jetontest", queryStringParameters: {}, ...o });
const post = (b) => ({ httpMethod: "POST", headers: { host: "x.test" }, body: JSON.stringify(b) });
const capture = (statutCmd, statutCap, montant = "450.00") => ({ status: statutCmd, purchase_units: [{ custom_id: "jetontest",
  payments: { captures: [{ id: "CAP1", status: statutCap, amount: { value: montant } }] } }] });

test("commande : sans livraison, bouton « Payer », en français", async () => {
  envois.length = 0;
  const r = await creer.handler(post({ token: "jetontest" }));
  assert.equal(r.statusCode, 200);
  const corps = JSON.parse(envois.find((e) => e.u.endsWith("/v2/checkout/orders")).body);
  assert.equal(corps.application_context.shipping_preference, "NO_SHIPPING");
  assert.equal(corps.application_context.user_action, "PAY_NOW");
  assert.equal(corps.purchase_units[0].amount.value, "450.00");
  assert.equal(corps.purchase_units[0].custom_id, "jetontest");
});

test("lireCapture : seule une capture COMPLETED vaut paiement", () => {
  assert.equal(pp.lireCapture(capture("COMPLETED", "COMPLETED")).ok, true);
  assert.equal(pp.lireCapture(capture("COMPLETED", "DECLINED")).ok, false);
  assert.equal(pp.lireCapture(capture("COMPLETED", "PENDING")).ok, false);
  assert.equal(pp.lireCapture(capture("APPROVED", "COMPLETED")).ok, false);
  assert.equal(pp.lireCapture({}).ok, false);
});

test("erreurPaypal : message en français, moyen refusé → reprise", () => {
  const x = pp.erreurPaypal({ status: 422, paypal: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] } });
  assert.equal(x.restart, true);
  assert.match(x.message, /refusé/);
  const y = pp.erreurPaypal({ status: 500, paypal: { name: "INTERNAL_SERVER_ERROR" } });
  assert.equal(y.restart, false);
  assert.doesNotMatch(y.message, /semantically|business validation/i);
});

test("capture refusée par la banque : la facture ne passe PAS « Payée »", async () => {
  facture = { requis: true, statut: "À payer", montant: 450 }; envois.length = 0;
  reponseCapture = { status: 201, body: capture("COMPLETED", "DECLINED") };
  const r = await capt.handler(post({ token: "jetontest", orderId: "CMD1" }));
  const d = JSON.parse(r.body);
  assert.equal(r.statusCode, 402);
  assert.equal(d.restart, true);
  assert.ok(!envois.some((e) => /Payée/.test(e.body || "")), "aucune écriture « Payée »");
});

test("capture refusée (422 INSTRUMENT_DECLINED) : message clair et reprise", async () => {
  reponseCapture = { status: 422, body: { name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed, semantically incorrect, or failed business validation.", details: [{ issue: "INSTRUMENT_DECLINED" }] } };
  const r = await capt.handler(post({ token: "jetontest", orderId: "CMD1" }));
  const d = JSON.parse(r.body);
  assert.equal(d.restart, true);
  assert.doesNotMatch(d.error, /semantically/);
  assert.equal(d.paypal, undefined, "la réponse brute de PayPal n'est pas renvoyée au public");
});

test("capture réussie : facture marquée « Payée »", async () => {
  envois.length = 0;
  reponseCapture = { status: 201, body: capture("COMPLETED", "COMPLETED") };
  const r = await capt.handler(post({ token: "jetontest", orderId: "CMD1" }));
  assert.equal(r.statusCode, 200);
  assert.ok(envois.some((e) => /Payée/.test(e.body || "")));
});

function scriptsValides(html) {
  const blocs = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const b of blocs) new vm.Script(b); // lève une SyntaxError si le script en ligne est cassé
  return blocs.length;
}

test("page de règlement : script valide, message si PayPal est bloqué, aide carte sans compte", async () => {
  facture = { requis: true, statut: "À payer", montant: 450 };
  const r = await liv.handler(ev());
  assert.ok(scriptsValides(r.body) >= 1);
  assert.match(r.body, /pas pu se charger/);
  assert.match(r.body, /aucun compte PayPal n'est nécessaire/);
  assert.match(r.body, /onCancel/);
  assert.match(r.body, /actions\.restart/);
  assert.match(r.body, /locale=fr_FR/);
  assert.doesNotMatch(r.body, /example\.org\/doc\.pdf/, "document non délivré avant paiement");
});

test("facture impayée sans paiement préalable : documents + bouton de règlement", async () => {
  facture = { requis: false, statut: "À payer", montant: 450 };
  const r = await liv.handler(ev());
  assert.match(r.body, /id="btnPayer"/);
  assert.match(r.body, /\/l\/jetontest\?pay=1/);
  assert.match(r.body, /example\.org\/doc\.pdf/);
  const p = await liv.handler(ev({ queryStringParameters: { pay: "1" } }));
  assert.ok(scriptsValides(p.body) >= 1);
  assert.match(p.body, /Revenir à mes documents/);
});

test("facture payée ou annulée : aucun bouton de règlement", async () => {
  facture = { requis: false, statut: "Payée", montant: 450 };
  assert.doesNotMatch((await liv.handler(ev())).body, /btnPayer/);
  facture = { requis: false, statut: "Annulée", montant: 450 };
  assert.doesNotMatch((await liv.handler(ev())).body, /btnPayer/);
  facture = { requis: true, statut: "Annulée", montant: 450 };
  assert.doesNotMatch((await liv.handler(ev())).body, /paypal\.com\/sdk/);
});
