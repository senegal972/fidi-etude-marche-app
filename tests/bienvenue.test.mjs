// E-mail de bienvenue envoyé à la création d'un compte, et ses réglages (mot d'accueil, liens, pièces jointes).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test-suffisamment-long-0123456789";
const B = await import("../netlify/functions/_bienvenue.mjs");
const R = await import("../netlify/functions/bienvenue.mjs");
const { verifyJWT, empreinteMdp } = await import("../netlify/functions/_auth.mjs");
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

function magasin() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); }, delete: async (k) => { m.delete(k); } };
}
// Remplace Resend le temps d'un essai ; rend les corps envoyés.
async function avecResend(fn, statut = 200) {
  const envois = [], avant = { f: globalThis.fetch, k: process.env.RESEND_API_KEY, e: process.env.RESEND_FROM };
  process.env.RESEND_API_KEY = "cle-de-test"; process.env.RESEND_FROM = "Application <envoi@exemple.fr>";
  globalThis.fetch = async (url, o) => { envois.push({ url: String(url), corps: JSON.parse(o.body) }); return { ok: statut < 300, status: statut, json: async () => ({ id: "x" }) }; };
  try { return { retour: await fn(), envois }; }
  finally { globalThis.fetch = avant.f; if (avant.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = avant.k; if (avant.e === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = avant.e; }
}
const EVENT = { headers: { host: "app.exemple.fr", "x-forwarded-proto": "https" } };

test("compte créé par l'administrateur : lien de l'application, installation, lien de choix du mot de passe — jamais de mot de passe", async () => {
  const { retour, envois } = await avecResend(() => B.envoyerBienvenue({ event: EVENT, email: "nouveau@exemple.fr", nom: "Paul", hash: "sel:hache", choisirMotDePasse: true, store: magasin() }));
  assert.equal(retour, "envoye");
  assert.equal(envois.length, 1);
  const c = envois[0].corps;
  assert.deepEqual(c.to, ["nouveau@exemple.fr"]);
  assert.match(c.html, /Choisir mon mot de passe/);
  assert.match(c.html, /nouveau@exemple\.fr/);
  assert.match(c.html, /Safari/); assert.match(c.html, /Chrome/);
  assert.match(c.html, /https:\/\/app\.exemple\.fr/);
  assert.match(c.html, /<br>/, "les consignes gardent leurs retours à la ligne");
  const jeton = (c.html.match(/#reset\?token=([\w.-]+)/) || [])[1];
  const pl = verifyJWT(jeton);
  assert.equal(pl.purpose, "reset"); assert.equal(pl.email, "nouveau@exemple.fr"); assert.equal(pl.v, empreinteMdp("sel:hache"));
  assert.ok(pl.exp - pl.iat >= 7 * 24 * 3600 - 5, "lien valable 7 jours");
  assert.doesNotMatch(c.html, /sel:hache/);
  const { empreinte } = await import("../netlify/functions/auth-oubli.mjs");
  assert.equal(empreinte("sel:hache"), pl.v, "le lien est accepté par « changer le mot de passe » (même empreinte)");
});

test("inscription par lien d'invitation : bouton « Ouvrir l'application », pas de lien de mot de passe", async () => {
  const { retour, envois } = await avecResend(() => B.envoyerBienvenue({ event: EVENT, email: "invite@exemple.fr", nom: "", choisirMotDePasse: false, store: magasin() }));
  assert.equal(retour, "envoye");
  assert.match(envois[0].corps.html, /Ouvrir l(&#39;|')application/);
  assert.doesNotMatch(envois[0].corps.html, /#reset/);
});

test("l'envoi ne bloque jamais la création : sans réglage d'e-mail, en échec de Resend, sans stockage", async () => {
  const k = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  assert.equal(await B.envoyerBienvenue({ event: EVENT, email: "a@exemple.fr", hash: "h", choisirMotDePasse: true, store: magasin() }), "non_configure");
  if (k !== undefined) process.env.RESEND_API_KEY = k;
  const r = await avecResend(() => B.envoyerBienvenue({ event: EVENT, email: "a@exemple.fr", hash: "h", choisirMotDePasse: true, store: magasin() }), 500);
  assert.equal(r.retour, "echec");
  const casse = { get: async () => { throw new Error("panne"); } };
  const r2 = await avecResend(() => B.envoyerBienvenue({ event: EVENT, email: "a@exemple.fr", hash: "h", choisirMotDePasse: true, store: casse }));
  assert.equal(r2.retour, "envoye", "stockage en panne : l'e-mail part avec son texte de base");
});

test("réglages : mot d'accueil, liens et pièces jointes sont repris dans l'e-mail", async () => {
  const s = magasin();
  await s.setJSON("reglages", { message: "Bienvenue chez nous.\nRegardez la vidéo.", liens: [{ libelle: "Vidéo <1>", url: "https://video.exemple.fr/v?a=1&b=2" }], pieces: [{ id: "0123456789abcdef", nom: "Guide.pdf" }] });
  await s.setJSON("f/0123456789abcdef", { nom: "Guide.pdf", type: "application/pdf", base64: "JVBERi0=" });
  const { envois } = await avecResend(() => B.envoyerBienvenue({ event: EVENT, email: "a@exemple.fr", hash: "h", choisirMotDePasse: true, store: s }));
  const c = envois[0].corps;
  assert.match(c.html, /Bienvenue chez nous\.<br>Regardez la vidéo\./);
  assert.match(c.html, /href="https:\/\/video\.exemple\.fr\/v\?a=1&amp;b=2"/);
  assert.match(c.html, /Vidéo &lt;1&gt;/, "le libellé est échappé");
  assert.match(c.html, /Un document est joint/);
  assert.deepEqual(c.attachments, [{ filename: "Guide.pdf", content: "JVBERi0=" }]);
});

test("assainirReglages : liens en https seulement, 6 au plus, lignes vides ignorées", () => {
  assert.equal(B.assainirReglages({ liens: [{ libelle: "x", url: "javascript:alert(1)" }] }).ok, false);
  assert.equal(B.assainirReglages({ liens: [{ libelle: "x", url: "http://exemple.fr" }] }).ok, false);
  const r = B.assainirReglages({ message: " Bonjour ", liens: [{ libelle: "", url: "" }, { libelle: "", url: "https://exemple.fr/p.pdf" }] });
  assert.deepEqual(r.valeur, { message: "Bonjour", liens: [{ libelle: "https://exemple.fr/p.pdf", url: "https://exemple.fr/p.pdf" }] });
  assert.equal(B.assainirReglages({ liens: Array.from({ length: 7 }, (_, i) => ({ libelle: "l" + i, url: "https://exemple.fr/" + i })) }).ok, false);
});

test("assainirPiece : types admis, taille, contenu", () => {
  assert.equal(B.assainirPiece({ nom: "film.mp4", base64: "AAAA" }).ok, false);
  assert.equal(B.assainirPiece({ nom: "page.html", base64: "AAAA" }).ok, false);
  assert.equal(B.assainirPiece({ nom: "a.pdf", base64: "<script>" }).ok, false);
  const p = B.assainirPiece({ nom: "Présentation 2026.pptx", base64: "data:application/x;base64,AAAA" });
  assert.equal(p.ok, true); assert.match(p.valeur.type, /presentationml/); assert.equal(p.valeur.base64, "AAAA");
  assert.equal(B.assainirPiece({ nom: "gros.pdf", base64: "A".repeat(Math.ceil(B.TAILLE_PIECE_MAX / 0.75) + 8) }).ok, false);
});

test("/api/bienvenue : session exigée, administrateur seulement", async () => {
  assert.equal((await R.handler({ httpMethod: "GET", headers: {} })).statusCode, 401);
  const src = lire("netlify/functions/bienvenue.mjs");
  assert.ok(src.indexOf("currentUser(event)") < src.indexOf("getNamedStore(event"), "la session est vérifiée avant tout accès au stockage");
  assert.match(src, /role !== "Administrateur"/);
});

test("/api/bienvenue : enregistrer, joindre, retirer, essai", async () => {
  const s = magasin(), me = { user: { email: "admin@exemple.fr", nom: "Admin", role: "Administrateur" } };
  const post = (b) => R.traiter({ httpMethod: "POST", headers: EVENT.headers, body: JSON.stringify(b) }, me, s);
  const j = (r) => JSON.parse(r.body);
  assert.equal((await post({ action: "enregistrer", message: "Mot", liens: [{ libelle: "Vidéo", url: "ftp://x" }] })).statusCode, 400);
  let r = await post({ action: "enregistrer", message: "Mot", liens: [{ libelle: "Vidéo", url: "https://exemple.fr/v" }] });
  assert.equal(r.statusCode, 200);
  r = await post({ action: "ajouter_piece", nom: "Guide.pdf", base64: "JVBERi0=" });
  const id = j(r).reglages.pieces[0].id;
  assert.match(id, /^[a-f0-9]{16}$/);
  assert.equal(j(r).reglages.message, "Mot", "joindre un fichier ne perd pas le mot d'accueil");
  r = await post({ action: "enregistrer", message: "Autre", liens: [] });
  assert.equal(j(r).reglages.pieces.length, 1, "enregistrer le texte ne perd pas les pièces");
  const f = await R.traiter({ httpMethod: "GET", headers: {}, queryStringParameters: { piece: id } }, me, s);
  assert.equal(f.statusCode, 200); assert.equal(f.headers["Content-Type"], "application/pdf");
  await post({ action: "ajouter_piece", nom: "b.pdf", base64: "AAAA" }); await post({ action: "ajouter_piece", nom: "c.pdf", base64: "AAAA" });
  assert.equal((await post({ action: "ajouter_piece", nom: "d.pdf", base64: "AAAA" })).statusCode, 400, "3 pièces au plus");
  const e = await avecResend(() => post({ action: "essai" }));
  assert.equal(e.retour.statusCode, 200);
  assert.deepEqual(e.envois[0].corps.to, ["admin@exemple.fr"]);
  assert.equal(e.envois[0].corps.attachments.length, 3);
  assert.match(e.envois[0].corps.subject, /^\[Essai\]/);
  r = await post({ action: "retirer_piece", id });
  assert.equal(j(r).reglages.pieces.length, 2); assert.equal(s.m.has("f/" + id), false);
});

test("branchements : création, inscription, renvoi, écran de réglage", () => {
  const admin = lire("netlify/functions/admin-users.mjs"), insc = lire("netlify/functions/signup-link.mjs"), page = lire("index.html");
  assert.match(admin, /envoyerBienvenue\(\{ event, email, nom: b\.nom \|\| "", hash, choisirMotDePasse: true \}\)/);
  assert.match(admin, /action === "bienvenue"/);
  assert.match(insc, /envoyerBienvenue\(\{ event, email, nom, choisirMotDePasse: false \}\)/);
  assert.match(page, /compte-bienvenue\.js/); assert.match(page, /id="bienvenueRoot"/); assert.match(page, /FidiBienvenue\.basculer\(\)/);
  assert.match(lire("netlify.toml"), /from\s+=\s+"\/api\/bienvenue"/);
  assert.doesNotMatch(lire("compte-bienvenue.js"), /style="/, "pas de style en ligne : les classes sont dans compte.css");
});
