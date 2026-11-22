// Dossier du client en un seul PDF : facture + document. Store Blobs en mémoire, rendu de la facture injecté (pas de Chromium).
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID; delete process.env.NETLIFY_AUTH_TOKEN; delete process.env.NETLIFY_TOKEN; delete process.env.NETLIFY_BLOBS_CONTEXT;

const { traiter, fusionner, idPartage, fusionPossible, MAX_OCTETS } = await import("../netlify/functions/dossier.mjs");
const liv = await import("../netlify/functions/livraison.mjs");

const pdf = async (pages) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([595, 842]); return Buffer.from(await d.save()); };
const ID = "0123456789abcdef0123456789abcdef";
const vraiFetch = globalThis.fetch;
const blobs = new Map(); const meta = new Map();
let facture;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    return new Response(JSON.stringify({ results: [{ id: "pg1", properties: {
      "Statut": { select: { name: facture.statut } }, "Paiement requis": { checkbox: true },
      "Numéro": { title: [{ plain_text: "FF-FAC-2026-002" }] }, "Type": { select: { name: "Avis de valeur" } },
      "Montant TTC": { number: 250 }, "Jeton livraison": { rich_text: [{ plain_text: "jetontest" }] },
      "Lien document": { url: facture.lien } } }] }), { status: 200 });
  }
  if (u.hostname === "edge.test") {
    const cle = u.pathname.split("/").filter(Boolean).map(decodeURIComponent).slice(1).join("/");
    const methode = String(options.method || "get").toLowerCase();
    if (methode === "put") { blobs.set(cle, String(options.body)); const hd = new Headers(options.headers); const m = hd.get("x-amz-meta-user") || hd.get("netlify-blobs-metadata"); if (m) meta.set(cle, m); else meta.delete(cle); return new Response(null, { status: 200 }); }
    if (!blobs.has(cle)) return new Response(null, { status: 404 });
    return new Response(methode === "head" ? null : blobs.get(cle), { status: 200, headers: meta.has(cle) ? { "x-amz-meta-user": meta.get(cle) } : {} });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });
beforeEach(() => { blobs.clear(); meta.clear(); facture = { statut: "Payée", lien: "https://app.exemple.fr/api/download/" + ID }; rendus = 0; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const ev = (q) => ({ httpMethod: "GET", headers: { "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr" }, blobs: contexte, queryStringParameters: q });
let rendus = 0;
const rendre = async (html) => { rendus++; assert.match(html, /FF-FAC-2026-002/); return pdf(1); };
const cles = (prefixe) => [...blobs.keys()].filter((k) => k.includes(prefixe));
const deposer = async (pages, ts = Date.now()) => {
  const { getShareStore } = await import("../netlify/functions/_blobs.mjs");
  await (await getShareStore(ev({}))).set(ID, (await pdf(pages)).toString("base64"), { metadata: { ts, filename: "etude.pdf" } });
};

test("idPartage : seul un dépôt de l'application est fusionnable", () => {
  assert.equal(idPartage("https://x.fr/api/download/" + ID), ID);
  assert.equal(idPartage("https://autre.site/rapport.pdf"), "");
  assert.equal(fusionPossible({ jeton: "j", lienDocument: "https://x.fr/api/download/" + ID }), true);
  assert.equal(fusionPossible({ jeton: "j", lienDocument: "https://autre.site/rapport.pdf" }), false);
});

test("fusionner : la facture d'abord, puis toutes les pages du document", async () => {
  const d = await PDFDocument.load(await fusionner(await pdf(1), await pdf(3)));
  assert.equal(d.getPageCount(), 4);
});

test("dossier payé : un seul PDF, gardé en réserve, Chromium une seule fois", async () => {
  await deposer(3);
  const r = await traiter(ev({ t: "jetontest" }), rendre);
  assert.equal(r.statusCode, 200); assert.equal(r.headers["Content-Type"], "application/pdf"); assert.equal(r.isBase64Encoded, true);
  assert.equal((await PDFDocument.load(Buffer.from(r.body, "base64"))).getPageCount(), 4);
  assert.match(r.headers["Content-Disposition"], /FF-FAC-2026-002_dossier\.pdf/);
  assert.equal(cles("doc/jetontest").length, 1, "copie durable du document");
  assert.equal(cles("tout/jetontest/p").length, 1);
  const r2 = await traiter(ev({ t: "jetontest" }), rendre);
  assert.equal(r2.body, r.body); assert.equal(rendus, 1);
});

test("document seul : servi depuis la copie durable, même après l'expiration du dépôt", async () => {
  await deposer(2);
  assert.equal((await traiter(ev({ t: "jetontest", part: "doc" }), rendre)).statusCode, 200);
  for (const k of cles(ID)) blobs.delete(k);   // le dépôt de 7 jours a disparu
  const r = await traiter(ev({ t: "jetontest", part: "doc" }), rendre);
  assert.equal(r.statusCode, 200);
  assert.equal((await PDFDocument.load(Buffer.from(r.body, "base64"))).getPageCount(), 2);
  assert.equal(rendus, 0);
});

test("facture non réglée : rien n'est servi, ni dossier ni document", async () => {
  await deposer(2); facture.statut = "À payer";
  for (const q of [{ t: "jetontest" }, { t: "jetontest", part: "doc" }]) {
    const r = await traiter(ev(q), rendre);
    assert.equal(r.statusCode, 403); assert.match(r.headers["Content-Type"], /text\/html/);
  }
  assert.equal(rendus, 0); assert.equal(cles("jetontest").length, 0);
});

test("document expiré ou rendu impossible : page d'explication avec les liens séparés, jamais d'erreur brute", async () => {
  const r = await traiter(ev({ t: "jetontest" }), rendre);            // aucun dépôt
  assert.equal(r.statusCode, 200); assert.match(r.body, /séparément/); assert.match(r.body, /facture-html/);
  await deposer(2, Date.now() - 8 * 24 * 3600 * 1000);               // dépôt de plus de 7 jours
  assert.match((await traiter(ev({ t: "jetontest" }), rendre)).body, /séparément/);
  await deposer(2);
  const ko = await traiter(ev({ t: "jetontest" }), async () => { throw new Error("chromium absent"); });
  assert.match(ko.body, /séparément/); assert.ok(!ko.body.includes("chromium"));
  assert.equal(cles("tout/").length, 0);
});

test("jeton invalide ou méthode refusée", async () => {
  assert.equal((await traiter(ev({ t: "../x" }), rendre)).statusCode, 400);
  assert.equal((await traiter({ ...ev({ t: "jetontest" }), httpMethod: "POST" }, rendre)).statusCode, 405);
  assert.ok(MAX_OCTETS < 4.5 * 1024 * 1024);
});

test("page du client : bouton unique vers le dossier quand le document est un dépôt de l'application", async () => {
  const evL = { httpMethod: "GET", headers: { host: "app.exemple.fr" }, path: "/l/jetontest", rawUrl: "https://app.exemple.fr/l/jetontest", queryStringParameters: {} };
  const h = (await liv.handler(evL)).body;
  assert.match(h.match(/<a[^>]*id="btnTout"[^>]*>/)[0], /href="https:\/\/app\.exemple\.fr\/api\/dossier\?t=jetontest"/);
  assert.match(h, /id="btnDoc"|part=doc/); assert.match(h, /un seul fichier PDF/);
  facture.lien = "https://autre.site/rapport.pdf";
  const e = (await liv.handler(evL)).body;
  assert.match(e.match(/<a[^>]*id="btnTout"[^>]*>/)[0], /href="https:\/\/autre\.site\/rapport\.pdf"/);
  facture.statut = "À payer"; facture.lien = "https://app.exemple.fr/api/download/" + ID;
  assert.ok(!(await liv.handler(evL)).body.includes("/api/download/"), "lien du document absent avant paiement");
});

// Le document remis au client est le document mis en page (rendu serveur), pas une copie de l'écran.
test("document remis : rendu mis en page d'abord, capture d'écran seulement en repli", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const f = html.slice(html.indexOf("async function factGenDocLink"), html.indexOf("function factAfficherRemise"));
  assert.ok(f.indexOf("fidiAutoPdfFile(") > 0 && f.indexOf("fidiAutoPdfFile(") < f.indexOf("html2pdf()"));
  assert.match(f, /__factDocMode = 'capture'/);
});
