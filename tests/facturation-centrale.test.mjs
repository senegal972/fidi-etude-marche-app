// Service central de facturation : prestation demandée par une autre application (kind « prestation »),
// facture automatique de serveur à serveur (/api/facture-auto) et pont navigateur (facturation-pont.js,
// facture-externe.js). Notion et Netlify Blobs sont simulés ; aucun réseau réel.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
for (const k of ["NETLIFY_SITE_ID", "NETLIFY_AUTH_TOKEN", "NETLIFY_TOKEN", "NETLIFY_BLOBS_CONTEXT",
                 "FIDI_FACTURATION_CLE", "FIDI_FACTURATION_COMPTE"]) delete process.env[k];

const { handler: creer } = await import("../netlify/functions/facture.mjs");
const { handler: auto } = await import("../netlify/functions/facture-auto.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();
const pages = [];            // { id, properties } — factures créées
const majs = [];             // mises à jour de pages
const COMPTE = { id: "page-agent", email: "agent@exemple.fr" };
const txt = (p) => (p?.title || p?.rich_text || [])[0]?.text?.content ?? (p?.title || p?.rich_text || [])[0]?.plain_text ?? "";

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    if (u.pathname.endsWith("/query")) {
      const f = corps.filter || {};
      if (f.title?.starts_with) {
        const nums = pages.map((p) => txt(p.properties["Numéro"])).filter((n) => n.startsWith(f.title.starts_with)).sort();
        return Response.json({ results: nums.length ? [{ properties: { "Numéro": { title: [{ plain_text: nums.at(-1) }] } } }] : [] });
      }
      if (f.title?.equals === COMPTE.email) {
        return Response.json({ results: [{ id: COMPTE.id, properties: {
          "Email": { title: [{ plain_text: COMPTE.email }] }, "Nom": { rich_text: [{ plain_text: "Agent Démo" }] },
          "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: "Collaborateur" } } } }] });
      }
      const cherche = (prop, val) => pages.filter((p) => txt(p.properties[prop]) === val).map((p) => ({
        id: p.id, properties: Object.fromEntries(Object.entries(p.properties).map(([k, v]) =>
          [k, v.rich_text ? { rich_text: [{ plain_text: txt(v) }] } : v.title ? { title: [{ plain_text: txt(v) }] } : v])) }));
      if (f.property === "Référence dossier") return Response.json({ results: cherche("Référence dossier", f.rich_text.equals) });
      if (f.property === "Jeton livraison") return Response.json({ results: cherche("Jeton livraison", f.rich_text.equals) });
      return Response.json({ results: [] });
    }
    if (u.pathname.endsWith("/pages") && options.method === "POST") {
      const id = "page-facture-" + (pages.length + 1);
      pages.push({ id, properties: corps.properties });
      return Response.json({ id });
    }
    if (options.method === "PATCH") {
      const id = u.pathname.split("/").at(-1);
      majs.push({ id, properties: corps.properties });
      const p = pages.find((x) => x.id === id);
      if (p) Object.assign(p.properties, corps.properties);
      return Response.json({ id });
    }
    return Response.json({});
  }
  if (u.hostname === "edge.test") {
    const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const cle = parts[1].replace(/^site:/, "") + "/" + parts.slice(2).join("/");
    if (options.method === "put") { blobs.set(cle, String(options.body)); return new Response(null, { status: 200 }); }
    const b = blobs.get(cle);
    return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const base = { "x-nf-site-id": "site", "x-nf-deploy-id": "deploy", host: "app.exemple.fr" };
const session = { ...base, cookie: "fidi_session=" + signJWT({ email: COMPTE.email }) };
blobs.set("fidi-marques/" + COMPTE.id, JSON.stringify({
  enseigne: "Agence Démo", coordonnees: { raisonSociale: "Agence Démo SAS", adresse: "1 rue des Tests, 97200 Fort-de-France" },
  emetteurs: [{ id: "od", raisonSociale: "Agence Démo SAS", adresse: "1 rue des Tests", siren: "000000000",
                registre: "RCS Fort-de-France 000 000 000", regimeTva: "assujetti", tauxTva: 8.5, prefixe: "OD-FAC" }],
  emetteurDefaut: "od",
}));
const lignes = [{ designation: "Home staging — séjour", quantite: 1, prixUnitaire: 850 },
                { designation: "Photos HDR", quantite: 12, prixUnitaire: 15 }];

test("prestation : refusée sans le détail des articles", async () => {
  const r = await creer({ httpMethod: "POST", headers: session, blobs: contexte,
    body: JSON.stringify({ kind: "prestation", ref: "HSP-1", client: "Mme Test", montant: 100 }) });
  assert.equal(r.statusCode, 400);
});

test("prestation demandée par une autre application : type, libellé et source repris", async () => {
  const r = await creer({ httpMethod: "POST", headers: session, blobs: contexte, body: JSON.stringify({
    kind: "prestation", ref: "HSP-2026-001", source: "HomeStaging PRO", type_libelle: "Home staging",
    client: "Mme Test", email_client: "client@exemple.fr", adresse: "Villa Les Hauts",
    facture: { lignes, mode: "quantite", prixSaisis: "TTC" }, emetteur_id: "od" }) });
  assert.equal(r.statusCode, 200, r.body);
  const j = JSON.parse(r.body);
  assert.match(j.ref, /^OD-FAC-\d{4}-001$/);
  assert.equal(j.montant, 1030);
  const p = pages.at(-1).properties;
  assert.equal(p["Type"].select.name, "Home staging");
  assert.equal(txt(p["Référence dossier"]), "HSP-2026-001");
  const detail = JSON.parse(blobs.get("fidi-factures/" + j.token));
  assert.equal(detail.source, "HomeStaging PRO");
});

test("facture-auto : désactivée sans configuration, puis clé exigée", async () => {
  const appel = (h, b) => auto({ httpMethod: "POST", headers: { ...base, ...h }, blobs: contexte, body: JSON.stringify(b || {}) });
  assert.equal((await appel({})).statusCode, 503);
  process.env.FIDI_FACTURATION_CLE = "cle-partagee-de-test-0123456789";
  process.env.FIDI_FACTURATION_COMPTE = COMPTE.email;
  assert.equal((await appel({ "x-fidi-cle": "mauvaise" })).statusCode, 401);
  assert.equal((await appel({ "x-fidi-cle": "cle-partagee-de-test-0123456789" }, { client: { nom: "X" }, lignes })).statusCode, 400); // ref manquante
});

test("facture-auto : achat de crédits facturé, acquitté et idempotent", async () => {
  const appel = () => auto({ httpMethod: "POST", headers: { ...base, "x-fidi-cle": "cle-partagee-de-test-0123456789" }, blobs: contexte,
    body: JSON.stringify({ ref: "PAYPAL-8XY12345", source: "REA", type_libelle: "Crédits REA",
      client: { nom: "Agence Cliente", email: "achat@exemple.fr" },
      lignes: [{ designation: "Pack 20 crédits REA", quantite: 1, prixUnitaire: 49 }], moyen: "PayPal" }) });
  const avant = pages.length;
  const r1 = await appel();
  assert.equal(r1.statusCode, 200, r1.body);
  const j1 = JSON.parse(r1.body);
  assert.equal(j1.montant, 49);
  assert.match(j1.facture_url, /acquittee=1/);
  assert.equal(pages.length, avant + 1);
  const p = pages.at(-1).properties;
  assert.equal(p["Statut"].select.name, "Payée");
  assert.equal(p["Type"].select.name, "Crédits REA");
  const r2 = await appel();
  const j2 = JSON.parse(r2.body);
  assert.equal(r2.statusCode, 200);
  assert.equal(j2.deja, true);
  assert.equal(j2.ref, j1.ref);
  assert.equal(pages.length, avant + 1, "pas de seconde facture pour la même opération");
});

// ── Pont navigateur ─────────────────────────────────────────────────────────
function charger(fichier, url, opener) {
  const ecouteurs = {};
  const fenetre = {
    location: new URL(url), opener: opener || null, document: { addEventListener() {}, currentScript: null },
    history: { replaceState() {} }, addEventListener: (t, f) => { (ecouteurs[t] ||= []).push(f); },
    removeEventListener() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"), atob: (s) => Buffer.from(s, "base64").toString("binary"),
    URLSearchParams, URL, JSON, unescape, escape, encodeURIComponent, decodeURIComponent,
  };
  fenetre.window = fenetre;
  vm.runInNewContext(readFileSync(new URL("../" + fichier, import.meta.url), "utf8"), fenetre);
  return { fenetre, ecouteurs };
}

test("facture-externe : seules les applications de l'exploitant sont acceptées", () => {
  const { fenetre } = charger("facture-externe.js", "https://app.exemple.fr/?facturer=1");
  const ok = fenetre.FidiFactureExterne.autorisee;
  assert.equal(fenetre.FidiFactureExterne.actif, true);
  for (const o of ["https://manat-immo-express.netlify.app", "https://deploy-preview-3--fiche-decouverte-fidiconseil.netlify.app",
                   "https://pilotage-cafeiere.netlify.app", "http://localhost:5173"]) assert.equal(ok(o), true, o);
  for (const o of ["https://evil.netlify.app", "https://manat-immo-express.netlify.app.evil.com", "http://manat-immo-express.netlify.app",
                   "https://exemple.com"]) assert.equal(ok(o), false, o);
});

test("facturation-pont : lien direct décodé par le récepteur, données bornées", () => {
  const { fenetre: pont } = charger("facturation-pont.js", "https://manat-immo-express.netlify.app/");
  const lien = pont.FidiFacturation.lienDirect({ source: "REA", ref: "M-1", client: { nom: "Élodie Ça" },
    lignes: [{ designation: "Mandat", quantite: 1, prixUnitaire: 300 }], onCreee: () => {} });
  assert.match(lien, /\/\?facturer=1#facturer=[A-Za-z0-9_-]+$/);
  assert.equal(lien.length < 4000, true);
  const u = new URL(lien);
  const b64 = u.hash.slice("#facturer=".length).replace(/-/g, "+").replace(/_/g, "/");
  const d = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  assert.equal(d.client.nom, "Élodie Ça");
  assert.equal(d.lignes[0].prixUnitaire, 300);
  assert.equal("onCreee" in d, false);
});

test("interface : récepteur chargé et prestation gérée par l'écran de facture", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<script src="\/facture-externe\.js" defer><\/script>/);
  const fjs = readFileSync(new URL("../facture.js", import.meta.url), "utf8");
  assert.match(fjs, /function proposerFacture\(kind, demande\)/);
  assert.match(fjs, /FidiFactureExterne\.signalerCreation/);
  const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(toml, /from\s*=\s*"\/api\/facture-auto"/);
});
