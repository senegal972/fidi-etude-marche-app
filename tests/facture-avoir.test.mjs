// Avoir annulant une facture payée : numérotation propre, détail figé, facture d'origine annulée, document en négatif.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID; delete process.env.NETLIFY_AUTH_TOKEN; delete process.env.NETLIFY_TOKEN; delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler, prefixeAvoir } = await import("../netlify/functions/facture-avoir.mjs");
const suppr = await import("../netlify/functions/facture-delete.mjs");
const fh = await import("../netlify/functions/facture-html.mjs");
const { renderFactureHTML } = await import("../netlify/functions/_facture_doc.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const NUM = "FF-FAC-2026-002";
const vraiFetch = globalThis.fetch;
const blobs = new Map();
let role, pages, creees;
const propsDe = (f) => ({ "Numéro": { title: [{ plain_text: f.numero }] }, "Statut": { select: { name: f.statut } }, "Type": { select: { name: f.type } },
  "Montant TTC": { number: f.ttc }, "Montant HT": { number: f.ht }, "TVA": { number: f.tva }, "Client": { rich_text: [{ plain_text: "Mme Durand" }] },
  "Email client": { email: "client@exemple.fr" }, "Date": { date: { start: "2026-11-20" } }, "Libellé": { rich_text: [{ plain_text: "Étude de marché" }] },
  "Jeton livraison": { rich_text: [{ plain_text: f.jeton }] }, "Référence dossier": { rich_text: [{ plain_text: f.refDossier || "" }] },
  "ID transaction": { rich_text: f.transaction ? [{ plain_text: f.transaction }] : [] }, "Paiement requis": { checkbox: false } });
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}"), brut = JSON.stringify(corps);
    if (u.pathname.endsWith("/query")) {
      if (brut.includes('"Email"') || !brut.includes("Numéro") && !brut.includes("Type") && !brut.includes("Jeton")) {
        return new Response(JSON.stringify({ results: [{ id: "page-moi", properties: { "Email": { title: [{ plain_text: "moi@exemple.fr" }] },
          "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: role } } } }] }), { status: 200 });
      }
      let res = pages;
      const f = corps.filter || {};
      if (f.and) res = pages.filter((p) => p.type === "Avoir" && p.refDossier === f.and[1].rich_text.equals);
      else if (f.title && f.title.equals) res = pages.filter((p) => p.numero === f.title.equals);
      else if (f.title && f.title.starts_with) res = pages.filter((p) => p.numero.startsWith(f.title.starts_with)).sort((a, b) => b.numero.localeCompare(a.numero));
      else if (f.rich_text) res = pages.filter((p) => p.jeton === f.rich_text.equals);
      return new Response(JSON.stringify({ results: res.slice(0, 1).map((p) => ({ id: p.id, properties: propsDe(p) })) }), { status: 200 });
    }
    const pr = corps.properties || {};
    if (options.method === "POST") { // création
      const p = { id: "p" + (pages.length + 1), numero: pr["Numéro"].title[0].text.content, statut: pr["Statut"].select.name, type: pr["Type"].select.name,
        ttc: pr["Montant TTC"].number, ht: pr["Montant HT"].number, tva: pr["TVA"].number, jeton: pr["Jeton livraison"].rich_text[0].text.content,
        refDossier: pr["Référence dossier"].rich_text[0].text.content };
      pages.push(p); creees.push(p);
    } else { // mise à jour
      const p = pages.find((x) => u.pathname.endsWith(x.id));
      if (p && pr["Statut"]) p.statut = pr["Statut"].select.name;
      if (p && pr["ID transaction"]) p.transaction = pr["ID transaction"].rich_text[0].text.content;
      if (p && corps.archived) p.archivee = true;
    }
    return new Response("{}", { status: 200 });
  }
  if (u.hostname === "edge.test") {
    const cle = u.pathname.split("/").filter(Boolean).map(decodeURIComponent).slice(1).join("/");
    const methode = String(options.method || "get").toLowerCase();
    if (methode === "put") { blobs.set(cle, String(options.body)); return new Response(null, { status: 200 }); }
    if (!blobs.has(cle)) return new Response(null, { status: 404 });
    return new Response(methode === "head" ? null : blobs.get(cle), { status: 200 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const base = { "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr" };
const entetes = { ...base, cookie: "fidi_session=" + signJWT({ email: "moi@exemple.fr" }) };
const post = async (b, h = entetes) => { const r = await handler({ httpMethod: "POST", headers: h, blobs: contexte, body: JSON.stringify(b) }); return { code: r.statusCode, ...JSON.parse(r.body) }; };
const detailFacture = () => ({ numero: NUM, date: "2026-11-20", emetteur: { enseigne: "FRANCK FIDI", coordonnees: { raisonSociale: "FRANCK FIDI", adresse: "Les Trois-Îlets" }, facturation: { siren: "123456789", regimeTva: "assujetti", tauxTva: 8.5 }, banque: { iban: "FR7630006000011234567890189" } },
  client: { nom: "Mme Durand" }, facture: { lignes: [{ designation: "Étude de marché", quantite: 1, prixUnitaire: 450 }], mode: "montant", prixSaisis: "TTC", remise: null, tva: { regime: "assujetti", taux: 8.5 } } });

beforeEach(async () => {
  blobs.clear(); role = "Administrateur"; creees = [];
  pages = [{ id: "p1", numero: NUM, statut: "Payée", type: "Étude de marché", ttc: 450, ht: 414.75, tva: 35.25, jeton: "jetonfacture" }];
  const { getNamedStore } = await import("../netlify/functions/_blobs.mjs");
  await (await getNamedStore({ headers: base, blobs: contexte }, "fidi-factures")).setJSON("jetonfacture", detailFacture());
});

test("préfixe de la suite d'avoirs tiré du numéro de la facture", () => {
  assert.equal(prefixeAvoir("FF-FAC-2026-002"), "FF-FAC-AV");
  assert.equal(prefixeAvoir("OD-2027-014"), "OD-AV");
});

test("accès : session et rôle administrateur exigés ; motif obligatoire", async () => {
  assert.equal((await post({ ref: NUM, motif: "Erreur de montant" }, base)).code, 401);
  role = "Collaborateur";
  assert.equal((await post({ ref: NUM, motif: "Erreur de montant" })).code, 403);
  role = "Administrateur";
  assert.equal((await post({ ref: NUM, motif: "" })).code, 400);
  assert.equal(creees.length, 0); assert.equal(pages[0].statut, "Payée");
});

test("avoir émis : numéro propre, montants négatifs, facture annulée, document figé en négatif", async () => {
  const r = await post({ ref: NUM, motif: "Prestation annulée", remboursement: "Virement" });
  assert.equal(r.code, 200);
  assert.match(r.avoir, /^FF-FAC-AV-\d{4}-001$/);
  assert.equal(creees.length, 1);
  const a = creees[0];
  assert.equal(a.type, "Avoir"); assert.equal(a.statut, "Avoir"); assert.equal(a.ttc, -450); assert.equal(a.ht, -414.75); assert.equal(a.tva, -35.25);
  assert.equal(a.refDossier, NUM);
  assert.equal(pages[0].statut, "Annulée"); assert.match(pages[0].transaction, /^AVOIR FF-FAC-AV-\d{4}-001 — Prestation annulée/);
  // Document : le lien rendu ouvre l'avoir, en négatif, sans coordonnées de règlement.
  const u = new URL(r.avoir_url);
  const doc = (await fh.handler({ httpMethod: "GET", headers: base, blobs: contexte, queryStringParameters: Object.fromEntries(u.searchParams) })).body;
  assert.match(doc, /<h1>Avoir<\/h1>/); assert.ok(doc.includes(r.avoir)); assert.ok(doc.includes("Annule la facture n° <strong>" + NUM));
  assert.match(doc, /Total TTC de l'avoir<\/td><td class="num">− 450,00/); assert.ok(doc.includes("Motif : Prestation annulée")); assert.ok(doc.includes("Remboursement : Virement"));
  assert.ok(!doc.includes("Règlement par virement") && !doc.includes("FR76"), "pas de RIB sur un avoir");
  assert.ok(!doc.includes("PAYÉE"));
});

test("second appel : le même avoir est renvoyé, rien n'est recréé ; une facture non payée se refuse", async () => {
  const a = await post({ ref: NUM, motif: "Prestation annulée" });
  const b = await post({ ref: NUM, motif: "Autre motif" });
  assert.equal(b.code, 200); assert.equal(b.deja_emis, true); assert.equal(b.avoir, a.avoir); assert.equal(creees.length, 1);
  pages.push({ id: "p9", numero: "FF-FAC-2026-003", statut: "À payer", type: "Avis de valeur", ttc: 250, ht: 250, tva: 0, jeton: "j3" });
  assert.equal((await post({ ref: "FF-FAC-2026-003", motif: "Erreur" })).code, 409);
  assert.equal((await post({ ref: "INCONNUE", motif: "Erreur" })).code, 404);
});

test("suite d'avoirs : le deuxième avoir de l'année prend le numéro suivant", async () => {
  await post({ ref: NUM, motif: "Prestation annulée" });
  pages.push({ id: "p9", numero: "FF-FAC-2026-005", statut: "Payée", type: "Avis de valeur", ttc: 250, ht: 250, tva: 0, jeton: "j5" });
  const r = await post({ ref: "FF-FAC-2026-005", motif: "Geste commercial" });
  assert.match(r.avoir, /-002$/);
  // Facture ancienne, sans détail figé : l'avoir est reconstitué depuis les montants de la facture.
  assert.equal(JSON.parse(blobs.get([...blobs.keys()].find((k) => k.endsWith(creees[1].jeton)))).totaux.ttc, 250);
});

test("une pièce liée à un avoir ne se supprime jamais, même en purge", async () => {
  await post({ ref: NUM, motif: "Prestation annulée" });
  const del = async (b) => (await suppr.handler({ httpMethod: "POST", headers: entetes, blobs: contexte, body: JSON.stringify(b) })).statusCode;
  assert.equal(await del({ ref: NUM }), 409);
  assert.equal(await del({ ref: NUM, force: true }), 409);
  assert.equal(await del({ ref: creees[0].numero, force: true }), 409);
  assert.ok(!pages.some((p) => p.archivee));
});

test("document : une facture ordinaire n'est pas modifiée par le mode avoir", () => {
  const d = detailFacture();
  const h = renderFactureHTML({ ...d, apercu: false });
  assert.match(h, /<h1>Facture<\/h1>/); assert.match(h, /Total TTC<\/td><td class="num">450,00/); assert.ok(h.includes("Règlement par virement")); assert.ok(!h.includes("− 4"));
});
