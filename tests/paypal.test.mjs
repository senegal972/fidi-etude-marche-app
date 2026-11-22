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

// ─── Virement bancaire ─────────────────────────────────────────────────────────
const IBAN_TEST = "FR7630006000011234567890189"; // IBAN d'exemple public (clé valide), aucun compte réel

test("IBAN : clé contrôlée, espaces admis, IBAN faux rejeté", async () => {
  const m = await import("../netlify/functions/marque.mjs");
  assert.equal(m.ibanValide("fr76 3000 6000 0112 3456 7890 189"), IBAN_TEST);
  assert.equal(m.ibanValide("FR7630006000011234567890188"), "");
  assert.equal(m.ibanValide(""), "");
  assert.equal(m.bicValide("agrifrpp"), "AGRIFRPP");
  assert.equal(m.bicValide("XX"), "");
  const e = m.assainirEmetteur({ id: "a1", raisonSociale: "Société Test", iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP", titulaire: "Société Test" });
  assert.equal(e.iban, IBAN_TEST); assert.equal(e.bic, "AGRIFRPP");
  const f = m.assainirEmetteur({ id: "a2", raisonSociale: "Société Test", iban: "FR00", bic: "AGRIFRPP", titulaire: "X" });
  assert.equal(f.iban, ""); assert.equal(f.bic, ""); assert.equal(f.titulaire, "");
});

test("page du client : virement proposé quand un IBAN est configuré, absent sinon", async () => {
  facture = { requis: true, statut: "À payer", montant: 450 };
  delete process.env.FIDI_VIREMENT_IBAN;
  assert.doesNotMatch((await liv.handler(ev())).body, /id="virement"/);
  process.env.FIDI_VIREMENT_IBAN = IBAN_TEST; process.env.FIDI_VIREMENT_BIC = "AGRIFRPP"; process.env.FIDI_VIREMENT_TITULAIRE = "Société Test";
  const r = await liv.handler(ev());
  assert.match(r.body, /id="virement"/);
  assert.match(r.body, /FR76 3000 6000 0112 3456 7890 189/);
  assert.match(r.body, /data-copie="FR7630006000011234567890189"/);
  assert.match(r.body, /data-copie="450\.00"/);
  assert.match(r.body, /FIDI-FAC-2026-099/);
  assert.match(r.body, /dès réception du virement/);
  assert.doesNotMatch(r.body, /example\.org\/doc\.pdf/, "le virement ne délivre pas le document avant réception");
  assert.ok(scriptsValides(r.body) >= 2);
  facture = { requis: false, statut: "À payer", montant: 450 };
  assert.match((await liv.handler(ev())).body, /id="virement"/);
  facture = { requis: false, statut: "Payée", montant: 450 };
  assert.doesNotMatch((await liv.handler(ev())).body, /id="virement"/);
  delete process.env.FIDI_VIREMENT_IBAN;
});

test("page du client : aucune adresse e-mail en pied de page", async () => {
  facture = { requis: true, statut: "À payer", montant: 450 };
  assert.doesNotMatch((await liv.handler(ev())).body, /class="foot">[^<]*(<br>)?[^<]*@/);
});

test("facture : bloc virement sur une facture à payer, pas sur une facture acquittée", async () => {
  const { renderFactureHTML } = await import("../netlify/functions/_facture_doc.mjs");
  const base = { numero: "OD-FAC-2026-001", client: { nom: "Client Test" }, facture: { lignes: [{ designation: "Avis de valeur", montant: 250 }], mode: "montant", tva: { regime: "franchise" } },
    emetteur: { coordonnees: { raisonSociale: "Société Test" }, facturation: { regimeTva: "franchise" }, banque: { iban: IBAN_TEST, bic: "AGRIFRPP", titulaire: "Société Test" } } };
  const h = renderFactureHTML(base);
  assert.match(h, /Règlement par virement/); assert.match(h, /FR76 3000 6000 0112 3456 7890 189/); assert.match(h, /Référence à indiquer : OD-FAC-2026-001/);
  assert.doesNotMatch(renderFactureHTML({ ...base, acquittee: true }), /Règlement par virement/);
  assert.doesNotMatch(renderFactureHTML({ ...base, emetteur: { ...base.emetteur, banque: undefined } }), /Règlement par virement/);
});

// Identification refusée par PayPal : erreur de réglage du site, signalée comme telle (et non comme un refus du client).
test("diagnostic : secret refusé par PayPal → acces « refuse », code invalid_client ; route réservée", async () => {
  const avant = { id: process.env.PAYPAL_CLIENT_ID, s: process.env.PAYPAL_SECRET, f: globalThis.fetch };
  process.env.PAYPAL_CLIENT_ID = "AaOWxB-identifiant-de-test-83bU"; process.env.PAYPAL_SECRET = "mauvais";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_client", error_description: "Client Authentication failed" }), { status: 401 });
  try {
    const m = await import("../netlify/functions/_paypal.mjs");
    const d = await m.diagnosticPaypal();
    assert.equal(d.acces, "refuse"); assert.equal(d.code, "invalid_client");
    assert.ok(!JSON.stringify(d).includes("mauvais"), "le secret n'est jamais renvoyé");
    let err; try { await m.createOrder({ montant: 10 }); } catch (e) { err = e; }
    assert.equal(m.erreurPaypal(err).code, "invalid_client");
    globalThis.fetch = async () => new Response(JSON.stringify({ access_token: "t", expires_in: 100 }), { status: 200 });
    assert.equal((await m.diagnosticPaypal()).acces, "ok");
    const { handler } = await import("../netlify/functions/paypal-diagnostic.mjs");
    const r = await handler({ httpMethod: "GET", headers: {} });
    assert.ok([401, 503].includes(r.statusCode));
  } finally {
    globalThis.fetch = avant.f;
    if (avant.id === undefined) delete process.env.PAYPAL_CLIENT_ID; else process.env.PAYPAL_CLIENT_ID = avant.id;
    if (avant.s === undefined) delete process.env.PAYPAL_SECRET; else process.env.PAYPAL_SECRET = avant.s;
  }
});

// Après paiement : un seul bouton pour le document et la facture, la page ne dit plus « en attente ».
test("documents remis : un bouton ouvre le document et la facture, chacun dans un nouvel onglet", async () => {
  facture = { requis: true, statut: "Payée", montant: 450 };
  const h = (await liv.handler(ev())).body;
  const b = h.match(/<a[^>]*id="btnTout"[^>]*>/)[0];
  assert.match(b, /target="_blank"/); assert.match(b, /href="https:\/\/example\.org\/doc\.pdf"/); assert.match(b, /data-fac="[^"]*facture-html/);
  assert.ok(!/<a(?![^>]*target="_blank")[^>]*(btn-dl|btnDoc|btnFac)/.test(h), "aucun document ne remplace la page du client");
  for (const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
  facture = { requis: true, statut: "À payer", montant: 450 };
  const p = (await liv.handler(ev())).body;
  assert.ok(!p.includes("example.org/doc.pdf"), "le document n'est pas livré avant paiement");
  for (const id of ["etatBadge", "zonePaiement", "sousTitre"]) assert.ok(p.includes('id="' + id + '"'), id);
  for (const m of p.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});

test("facture ouverte par le client : lien de retour vers ses documents, absent à l'impression", async () => {
  const fh = await import("../netlify/functions/facture-html.mjs");
  const r = await fh.handler({ httpMethod: "GET", headers: { host: "x.test" }, queryStringParameters: { ref: "FIDI-FAC-2026-099", t: "jetontest" } });
  assert.match(r.body, /<a class="no-print" href="\/l\/jetontest"[^>]*>← Retour à mes documents<\/a>/);
  const s = await fh.handler({ httpMethod: "GET", headers: { host: "x.test" }, queryStringParameters: { ref: "FIDI-FAC-2026-099" } });
  assert.ok(!s.body.includes("Retour à mes documents"));
});
