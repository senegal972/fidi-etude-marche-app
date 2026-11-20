// Paiement enregistré à la main (espèces, virement, chèque…) et annulation de facture : sessions, règles, justificatif.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";

const auth = await import("../netlify/functions/_auth.mjs");
const mod = await import("../netlify/functions/facture-paiement.mjs");
const annul = await import("../netlify/functions/facture-cancel.mjs");

let role = "Administrateur";
let facture = {};
let ecritures = [];
const vraiFetch = globalThis.fetch;
const pageUtilisateur = () => ({ id: "u1", properties: {
  "Email": { email: "admin@exemple.fr" }, "Nom": { title: [{ plain_text: "Admin Test" }] }, "Rôle": { select: { name: role } },
  "Statut": { select: { name: "Actif" } }, "Crédits": { number: 0 } } });
const pageFacture = () => ({ id: "f1", properties: {
  "Numéro": { title: [{ plain_text: "OD-FAC-2026-001" }] }, "Statut": { select: { name: facture.statut } }, "Montant TTC": { number: facture.montant },
  "Moyen paiement": { select: facture.moyen ? { name: facture.moyen } : null }, "ID transaction": { rich_text: facture.transaction ? [{ plain_text: facture.transaction }] : [] },
  "Email client": { email: "client@exemple.fr" }, "Jeton livraison": { rich_text: [{ plain_text: "jeton" }] } } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.notion.com/")) return vraiFetch(url, init);
  if (u.includes("/pages/u1")) return new Response(JSON.stringify(pageUtilisateur()), { status: 200 });
  if (u.endsWith("/query")) {
    const corps = JSON.parse(init.body || "{}");
    const surUtilisateurs = JSON.stringify(corps).includes("Email") && !JSON.stringify(corps).includes("Numéro");
    return new Response(JSON.stringify({ results: [surUtilisateurs ? pageUtilisateur() : pageFacture()] }), { status: 200 });
  }
  if (init.method === "PATCH" || init.method === "POST") { ecritures.push({ u, corps: JSON.parse(init.body || "{}") }); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 200 });
};

const jeton = auth.signJWT({ sub: "u1", email: "admin@exemple.fr" });
const ev = (o) => ({ httpMethod: "POST", headers: { authorization: "Bearer " + jeton }, queryStringParameters: {}, ...o });
const post = (b, avecSession = true) => ev({ body: JSON.stringify(b), headers: avecSession ? { authorization: "Bearer " + jeton } : {} });
const base = { action: "enregistrer", ref: "OD-FAC-2026-001", moyen: "Espèces", date: "2026-01-10", montant: 250, sans_justificatif: true, note: "Réglé au cabinet." };

beforeEach(() => { role = "Administrateur"; facture = { statut: "À payer", montant: 250 }; ecritures = []; });

test("validerPaiement : moyen, date, montant, écart, justificatif", () => {
  const v = (b, m = 250) => mod.validerPaiement({ ...base, ...b }, m, "2026-06-01");
  assert.equal(v({}).ok, true);
  assert.equal(v({ moyen: "Bitcoin" }).ok, false);
  assert.equal(v({ date: "2026-07-01" }).ok, false, "date future refusée");
  assert.equal(v({ montant: 0 }).ok, false);
  assert.equal(v({ montant: "250,00" }).valeur.montant, 250, "virgule décimale admise");
  assert.equal(v({ montant: 200 }).ok, false, "écart non confirmé");
  assert.equal(v({ montant: 200, ecart_accepte: true, note: "" }).ok, false, "écart confirmé mais non expliqué");
  assert.equal(v({ montant: 200, ecart_accepte: true, note: "Remise accordée." }).valeur.ecart, -50);
  assert.equal(v({ sans_justificatif: false }).ok, false, "ni justificatif ni mention sans justificatif");
  assert.equal(v({ sans_justificatif: false, justificatif: { nom: "r.png", type: "image/png", base64: "aGVsbG8gd29ybGQ=" } }).ok, true);
  assert.equal(v({ justificatif: { nom: "r.exe", type: "application/x-msdownload", base64: "aGVsbG8gd29ybGQ=" } }).ok, false, "type de fichier refusé");
  assert.equal(v({ justificatif: { nom: "r.png", type: "image/png", base64: "A".repeat(4_200_000) } }).ok, false, "fichier trop lourd");
  assert.equal(v({ montant: 1500 }, 1500).valeur.depasse_plafond_especes, true);
  assert.equal(v({ moyen: "Virement", montant: 1500 }, 1500).valeur.depasse_plafond_especes, false);
});

test("session exigée avant tout : 401 sans jeton, 403 pour un collaborateur", async () => {
  assert.equal((await mod.handler(post(base, false))).statusCode, 401);
  assert.equal((await mod.handler(ev({ httpMethod: "GET", headers: {}, queryStringParameters: { ref: "OD-FAC-2026-001", justificatif: "1" } }))).statusCode, 401);
  role = "Collaborateur";
  assert.equal((await mod.handler(post(base))).statusCode, 403);
  assert.equal(ecritures.length, 0);
});

test("facture annulée ou réglée en ligne : aucun paiement manuel", async () => {
  facture = { statut: "Annulée", montant: 250 };
  assert.equal((await mod.handler(post(base))).statusCode, 409);
  facture = { statut: "Payée", montant: 250, moyen: "PayPal", transaction: "8AB12345CD" };
  const r = await mod.handler(post(base));
  assert.equal(r.statusCode, 409);
  assert.equal(JSON.parse(r.body).en_ligne, true);
  const a = await mod.handler(post({ action: "annuler_paiement", ref: "OD-FAC-2026-001", motif: "erreur" }));
  assert.equal(a.statusCode, 409, "un paiement en ligne ne s'annule pas ici");
  assert.equal(ecritures.length, 0);
});

test("stockage indisponible : la facture n'est pas marquée payée", async () => {
  // Hors de Netlify, le store Blobs n'a aucun contexte : l'enregistrement doit échouer AVANT d'écrire dans Notion.
  const r = await mod.handler(post(base));
  assert.ok(r.statusCode >= 500);
  assert.ok(!ecritures.some((e) => JSON.stringify(e.corps).includes("Payée")), "aucune écriture « Payée »");
});

test("annuler une facture exige une session", async () => {
  const sans = await annul.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ ref: "OD-FAC-2026-001" }) });
  assert.equal(sans.statusCode, 401);
  assert.equal(ecritures.length, 0);
  const avec = await annul.handler(post({ ref: "OD-FAC-2026-001", motif: "doublon" }));
  assert.equal(avec.statusCode, 200);
  assert.ok(ecritures.some((e) => JSON.stringify(e.corps).includes("Annulée")));
});
