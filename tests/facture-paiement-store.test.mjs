// Paiement manuel, parcours complet : enregistrement avec justificatif, relecture, modification, annulation.
// Vrai client @netlify/blobs sur un store en mémoire (même méthode que avis-store.test.mjs). Fichier séparé :
// connectLambda pose un contexte global au processus.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID; delete process.env.NETLIFY_AUTH_TOKEN; delete process.env.NETLIFY_TOKEN; delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler } = await import("../netlify/functions/facture-paiement.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();
let facture, notion;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    if (u.pathname.endsWith("/query")) {
      if (JSON.stringify(corps).includes("Numéro")) {
        return new Response(JSON.stringify({ results: [{ id: "f1", properties: {
          "Numéro": { title: [{ plain_text: "OD-FAC-2026-001" }] }, "Statut": { select: { name: facture.statut } }, "Montant TTC": { number: 450 },
          "Moyen paiement": { select: facture.moyen ? { name: facture.moyen } : null },
          "ID transaction": { rich_text: facture.transaction ? [{ plain_text: facture.transaction }] : [] }, "Email client": { email: "client@exemple.fr" } } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [{ id: "page-admin", properties: {
        "Email": { title: [{ plain_text: "admin@exemple.fr" }] }, "Nom": { rich_text: [{ plain_text: "Admin Test" }] },
        "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: "Administrateur" } } } }] }), { status: 200 });
    }
    notion.push({ chemin: u.pathname, corps });
    // La mise à jour de la facture est répercutée, comme le ferait Notion.
    if (u.pathname.includes("/pages/f1")) {
      const p = corps.properties || {};
      if (p["Statut"]) facture.statut = p["Statut"].select.name;
      if (p["Moyen paiement"]) facture.moyen = p["Moyen paiement"].select.name;
      if (p["ID transaction"]) facture.transaction = p["ID transaction"].rich_text[0].text.content;
    }
    return new Response("{}", { status: 200 });
  }
  if (u.hostname === "edge.test") {
    const cle = u.pathname.split("/").filter(Boolean).map(decodeURIComponent).slice(2).join("/");
    const methode = String(options.method || "get").toLowerCase();
    if (methode === "put") { blobs.set(cle, String(options.body)); return new Response(null, { status: 200 }); }
    if (methode === "delete") { blobs.delete(cle); return new Response(null, { status: 204 }); }
    if (!blobs.has(cle)) return new Response(null, { status: 404 });
    return new Response(methode === "head" ? null : blobs.get(cle), { status: 200 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });
beforeEach(() => { blobs.clear(); facture = { statut: "À payer" }; notion = []; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const entetes = { "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr", cookie: "fidi_session=" + signJWT({ email: "admin@exemple.fr" }) };
const post = async (b) => { const r = await handler({ httpMethod: "POST", headers: entetes, blobs: contexte, body: JSON.stringify(b) }); return { code: r.statusCode, ...JSON.parse(r.body) }; };
const get = (q) => handler({ httpMethod: "GET", headers: entetes, blobs: contexte, queryStringParameters: q });
const REF = "OD-FAC-2026-001";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("espèces sans justificatif : facture payée, note et auteur conservés", async () => {
  const r = await post({ action: "enregistrer", ref: REF, moyen: "Espèces", date: "2026-01-10", montant: 450, sans_justificatif: true, recu_remis: true, note: "Réglé au cabinet.", reference: "Reçu 12" });
  assert.equal(r.code, 200);
  assert.equal(facture.statut, "Payée"); assert.equal(facture.moyen, "Espèces"); assert.match(facture.transaction, /^MANUEL — Reçu 12/);
  const lu = JSON.parse((await get({ ref: REF })).body).paiement;
  assert.equal(lu.note, "Réglé au cabinet."); assert.equal(lu.sans_justificatif, true); assert.equal(lu.recu_remis, true);
  assert.equal(lu.enregistre.par.email, "admin@exemple.fr");
  assert.equal((await get({ ref: REF, justificatif: "1" })).statusCode, 404);
  assert.ok(notion.some((n) => JSON.stringify(n.corps).includes("MANUEL-" + REF)), "ligne au journal des paiements");
});

test("chèque avec justificatif : le fichier se relit, puis la modification le garde", async () => {
  const r = await post({ action: "enregistrer", ref: REF, moyen: "Chèque", date: "2026-01-10", montant: 450, reference: "0012345 BNP", justificatif: { nom: "cheque.png", type: "image/png", base64: PNG } });
  assert.equal(r.code, 200);
  assert.equal(r.paiement.justificatif.nom, "cheque.png");
  const f = await get({ ref: REF, justificatif: "1" });
  assert.equal(f.statusCode, 200); assert.equal(f.isBase64Encoded, true); assert.equal(f.body, PNG); assert.equal(f.headers["Content-Type"], "image/png");
  assert.equal(f.headers["X-Content-Type-Options"], "nosniff");
  // Modification : date corrigée, justificatif gardé, une seule ligne au journal.
  const m = await post({ action: "enregistrer", ref: REF, moyen: "Chèque", date: "2026-01-12", montant: 450, garder_justificatif: true });
  assert.equal(m.code, 200);
  assert.equal(m.paiement.justificatif.nom, "cheque.png"); assert.equal(m.paiement.date, "2026-01-12"); assert.ok(m.paiement.modifie);
  assert.equal((await get({ ref: REF, justificatif: "1" })).statusCode, 200);
  assert.equal(notion.filter((n) => JSON.stringify(n.corps).includes("MANUEL-" + REF)).length, 1);
});

test("annuler un paiement manuel : la facture repasse « À payer », la trace reste", async () => {
  await post({ action: "enregistrer", ref: REF, moyen: "Chèque", date: "2026-01-10", montant: 450, sans_justificatif: true, note: "Chèque remis en main propre." });
  const a = await post({ action: "annuler_paiement", ref: REF, motif: "Chèque revenu impayé" });
  assert.equal(a.code, 200);
  assert.equal(facture.statut, "À payer");
  const lu = JSON.parse((await get({ ref: REF })).body).paiement;
  assert.equal(lu.annule.motif, "Chèque revenu impayé"); assert.equal(lu.moyen, "Chèque");
  // Une facture qui n'est pas payée ne s'annule pas une seconde fois.
  assert.equal((await post({ action: "annuler_paiement", ref: REF, motif: "x" })).code, 409);
});

test("montant différent : refus sans confirmation, accepté avec explication", async () => {
  assert.equal((await post({ action: "enregistrer", ref: REF, moyen: "Virement", date: "2026-01-10", montant: 400, sans_justificatif: true, note: "Virement reçu." })).code, 400);
  assert.equal(facture.statut, "À payer");
  const r = await post({ action: "enregistrer", ref: REF, moyen: "Virement", date: "2026-01-10", montant: 400, ecart_accepte: true, sans_justificatif: true, note: "Geste commercial de 50 €." });
  assert.equal(r.code, 200); assert.equal(r.paiement.ecart, -50);
});
