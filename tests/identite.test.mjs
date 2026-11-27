// Identité portée par les e-mails et les pages client : la société qui agit ; le logiciel se signe à part (produit + fabricant).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test-suffisamment-long-0123456789";
const I = await import("../netlify/functions/_identite.mjs");
const M = await import("../netlify/functions/send-email.mjs");
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const CHARTE = { enseigne: "OPTIMMO DOM", baseline: "Immobilier", logo: PNG, couleurs: { principale: "#0C447C" }, coordonnees: { raisonSociale: "OPTIMMO DOM", email: "charte@exemple.fr" },
  emetteurs: [{ id: "a1", raisonSociale: "Société A", email: "a@exemple.fr" }, { id: "b2", raisonSociale: "Cabinet B", email: "b@exemple.fr", telephone: "0596000000", avecLogo: true }], emetteurDefaut: "b2" };

test("identité = société émettrice par défaut ; sans société, la charte ; sans rien, vide", () => {
  const b = I.identiteDeCharte(CHARTE);
  assert.equal(b.nom, "Cabinet B"); assert.equal(b.email, "b@exemple.fr"); assert.equal(b.couleur, "#0C447C");
  assert.equal(b.logo, PNG, "avecLogo : logo de la charte");
  assert.equal(I.identiteDeCharte({ ...CHARTE, emetteurDefaut: "a1" }).logo, "", "société sans logo ni « avecLogo » : aucun logo");
  assert.equal(I.identiteDeCharte({ ...CHARTE, emetteurs: [] }).nom, "OPTIMMO DOM");
  assert.equal(I.identiteDeCharte(null).nom, "");
  assert.equal(I.identiteDEmetteur({ enseigne: "Société figée", coordonnees: { email: "f@exemple.fr" } }).nom, "Société figée");
});

test("identiteCompte / identiteFacture ne lèvent jamais", async () => {
  const casse = { get: async () => { throw new Error("panne"); } };
  assert.equal((await I.identiteCompte({}, { user: { id: "x" } }, casse)).nom, "");
  assert.equal((await I.identiteFacture({}, "jeton", casse)).nom, "");
  const s = { get: async () => ({ emetteur: { enseigne: "Cabinet B" } }) };
  assert.equal((await I.identiteFacture({}, "jeton", s)).nom, "Cabinet B");
});

test("e-mail : bandeau et expéditeur au nom de la société, pied signé du logiciel, logo intégré", async () => {
  const av = { f: globalThis.fetch, k: process.env.RESEND_API_KEY, e: process.env.RESEND_FROM };
  process.env.RESEND_API_KEY = "x"; process.env.RESEND_FROM = "Ancien Nom <envoi@mail.exemple.fr>";
  let corps; globalThis.fetch = async (u, o) => { corps = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ id: "1" }) }; };
  try {
    await M.envoyerEmail({ to: "c@exemple.fr", subject: "Essai", lien: "https://exemple.fr/l/x", identite: I.identiteDeCharte(CHARTE) });
    assert.equal(corps.from, '"Cabinet B" <envoi@mail.exemple.fr>');
    assert.equal(corps.reply_to, "b@exemple.fr");
    assert.match(corps.html, /<h2[^>]*>Cabinet B<\/h2>/);
    assert.match(corps.html, /Étude de marché &amp; Avis de valeur — une application Optimmo Dom/);
    assert.doesNotMatch(corps.html, /FIDI/);
    assert.match(corps.html, /cid:logo-societe/);
    assert.deepEqual(corps.attachments, [{ filename: "logo.png", content: "iVBORw0KGgo=", content_id: "logo-societe" }]);
    await M.envoyerEmail({ to: "c@exemple.fr", subject: "Essai", lien: "https://exemple.fr/l/x" });
    assert.equal(corps.from, "Ancien Nom <envoi@mail.exemple.fr>", "sans identité : expéditeur du site");
    assert.match(corps.html, /<h2[^>]*>Étude de marché &amp; Avis de valeur<\/h2>/);
    assert.equal(corps.attachments, undefined);
  } finally { globalThis.fetch = av.f; if (av.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = av.k; if (av.e === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = av.e; }
});

test("la route publique d'envoi impose l'identité du compte : celle de la demande est ignorée", () => {
  const src = lire("netlify/functions/send-email.mjs"); const hd = src.slice(src.indexOf("export const handler"));
  assert.match(hd, /delete b\.corpsHtml;/); assert.match(hd, /b\.identite = await identiteCompte\(event, moi\);/);
  assert.ok(hd.indexOf("currentUser(") < hd.indexOf("identiteCompte("));
});

test("aucun nom de société en dur dans les envois et les pages client ; produit et fabricant nommés", () => {
  for (const f of ["netlify/functions/send-email.mjs", "netlify/functions/livraison.mjs", "netlify/functions/facture-autorelance.mjs", "netlify/functions/facture-pay-capture.mjs", "netlify/functions/pdf-get.mjs", "netlify/functions/_bienvenue.mjs"])
    assert.doesNotMatch(lire(f).replace(/\/\/.*$/gm, ""), /FIDI Conseil|ImmoData/, f);
  const page = lire("index.html");
  assert.doesNotMatch(page, /ImmoData|FIDI Conseil/);
  assert.match(lire("marque.js"), /FABRICANT = 'Optimmo Dom'/);
  assert.equal(I.FABRICANT, "Optimmo Dom"); assert.equal(I.PRODUIT, "Étude de marché & Avis de valeur");
});

test("carte : une seule fenêtre de détail de parcelle à la fois", () => {
  const src = lire("carte-parcelle.js");
  assert.match(src, /function retirerDetail\(\)/);
  assert.match(src, /if \(Date\.now\(\) - detailOuvertA < 1200\) return;/);
});
