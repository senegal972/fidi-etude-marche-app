// Assistance : signalement guidé (nature, partie concernée, gravité, texte, captures), stockage, e-mail, liste de l'administrateur.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test-suffisamment-long-0123456789";
const A = await import("../netlify/functions/assistance.mjs");
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
function magasin() { const m = new Map(); return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); }, list: async ({ prefix }) => ({ blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) }; }
const agent = { user: { email: "agent@exemple.fr", nom: "Agent", role: "Collaborateur" } }, admin = { user: { email: "admin@exemple.fr", nom: "Admin", role: "Administrateur" } };
const PNG = "iVBORw0KGgo=";
const post = (me, s, b) => A.traiter({ httpMethod: "POST", headers: { host: "app.exemple.fr" }, body: JSON.stringify(b) }, me, s);
const obtenir = (me, s, q) => A.traiter({ httpMethod: "GET", headers: {}, queryStringParameters: q }, me, s);
const j = (r) => JSON.parse(r.body);

test("assainirSignalement : la nature d'abord ; texte ou capture exigé ; gravité seulement pour une erreur", () => {
  assert.equal(A.assainirSignalement({ message: "Bonjour, ça ne marche pas" }).ok, false, "sans nature");
  assert.equal(A.assainirSignalement({ nature: "erreur", message: "court" }).ok, false);
  assert.equal(A.assainirSignalement({ nature: "erreur", message: "", captures: [{ nom: "ecran.png", base64: PNG }] }).ok, true, "une capture suffit");
  const e = A.assainirSignalement({ nature: "erreur", module: "avis", gravite: "bloquant", message: "L'aperçu ne s'affiche plus." }).valeur;
  assert.deepEqual([e.nature, e.module, e.gravite], ["erreur", "avis", "bloquant"]);
  const i = A.assainirSignalement({ nature: "amelioration", module: "inconnu", gravite: "bloquant", message: "Ajouter un export vers un tableur." }).valeur;
  assert.deepEqual([i.module, i.gravite], ["autre", ""]);
  assert.equal(A.assainirSignalement({ nature: "erreur", message: "x".repeat(20), captures: [{ nom: "page.html", base64: PNG }] }).ok, false);
  assert.equal(A.assainirSignalement({ nature: "erreur", message: "x".repeat(20), captures: Array(4).fill({ nom: "a.png", base64: PNG }) }).ok, false, "3 captures au plus");
  assert.equal(A.assainirSignalement({ nature: "erreur", message: "x".repeat(20), captures: [{ nom: "a.png", base64: "A".repeat(Math.ceil(A.TAILLE_CAPTURE_MAX / 0.75) + 8) }] }).ok, false);
});

test("signaler : la demande est enregistrée avant l'e-mail, qui part à l'adresse de contact avec les captures", async () => {
  const s = magasin(), av = { f: globalThis.fetch, k: process.env.RESEND_API_KEY, e: process.env.RESEND_FROM, c: process.env.FIDI_CONTACT_EMAIL };
  process.env.RESEND_API_KEY = "x"; process.env.RESEND_FROM = "App <envoi@exemple.fr>"; process.env.FIDI_CONTACT_EMAIL = "assistance@exemple.fr";
  let envoi = null, enregistreAvant = false;
  globalThis.fetch = async (u, o) => { envoi = JSON.parse(o.body); enregistreAvant = [...s.m.keys()].some((k) => k.startsWith("t/")); return { ok: true, status: 200, json: async () => ({ id: "1" }) }; };
  try {
    const r = j(await post(agent, s, { action: "signaler", nature: "erreur", module: "carte", gravite: "genant", message: "La fiche de parcelle ne s'ouvre pas.", captures: [{ nom: "ecran.png", base64: PNG }], contexte: { version: "1.56.0", ecran: "390×760" } }));
    assert.match(r.numero, /^A-\d{8}-[0-9A-F]{6}$/); assert.equal(r.email, "envoye");
    assert.equal(enregistreAvant, true);
    assert.deepEqual(envoi.to, ["assistance@exemple.fr"]);
    assert.match(envoi.subject, /^\[Assistance A-\d{8}-[0-9A-F]{6}\] Une erreur — Carte et parcelles$/);
    assert.match(envoi.html, /agent@exemple\.fr/); assert.match(envoi.html, /La fiche de parcelle/);
    assert.deepEqual(envoi.attachments, [{ filename: "ecran.png", content: PNG }]);
    const fiche = JSON.parse(s.m.get("t/" + r.numero));
    assert.equal(fiche.auteur.email, "agent@exemple.fr"); assert.equal(fiche.etat, "ouvert"); assert.equal(fiche.captures.length, 1);
    assert.equal(fiche.captures[0].base64, undefined, "les images sont rangées à part");
  } finally { globalThis.fetch = av.f; for (const [k, v] of [["RESEND_API_KEY", av.k], ["RESEND_FROM", av.e], ["FIDI_CONTACT_EMAIL", av.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test("sans réglage d'e-mail : la demande est enregistrée quand même", async () => {
  const s = magasin(), k = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  const r = j(await post(agent, s, { action: "signaler", nature: "question", message: "Comment ajouter une seconde parcelle ?" }));
  if (k !== undefined) process.env.RESEND_API_KEY = k;
  assert.equal(r.ok, true); assert.equal(r.email, "non_configure"); assert.equal([...s.m.keys()].filter((x) => x.startsWith("t/")).length, 1);
});

test("liste, lecture, captures et clôture : administrateur seulement", async () => {
  const s = magasin();
  const n = j(await post(agent, s, { action: "signaler", nature: "amelioration", message: "Un export vers un tableur serait utile.", captures: [{ nom: "idee.jpg", base64: PNG }] })).numero;
  assert.equal((await obtenir(agent, s, { liste: "1" })).statusCode, 403);
  assert.equal((await obtenir(agent, s, { id: n })).statusCode, 403);
  assert.equal((await post(agent, s, { action: "etat", id: n, etat: "traite" })).statusCode, 403);
  assert.equal(j(await obtenir(agent, s, {})).natures.erreur, "Une erreur", "tout compte lit le questionnaire");
  assert.deepEqual(j(await obtenir(admin, s, { liste: "1" })).signalements.map((x) => x.numero), [n]);
  const img = await obtenir(admin, s, { id: n, capture: "0" });
  assert.equal(img.statusCode, 200); assert.equal(img.headers["Content-Type"], "image/jpeg"); assert.equal(img.body, PNG);
  assert.equal(j(await post(admin, s, { action: "etat", id: n, etat: "traite" })).signalement.etat, "traite");
  assert.equal((await obtenir(admin, s, { id: "../x" })).statusCode, 400);
});

test("/api/assistance : session exigée ; aucune adresse e-mail écrite dans le code ; branchements de l'écran", async () => {
  assert.equal((await A.handler({ httpMethod: "POST", headers: {}, body: "{}" })).statusCode, 401);
  for (const f of ["assistance.js", "netlify/functions/assistance.mjs"]) assert.doesNotMatch(lire(f).replace(/exemple\.fr/g, ""), /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i, f);
  const page = lire("index.html");
  assert.match(page, /id="btnAssistance" onclick="FidiAssistance\.ouvrir\(\)"/);
  assert.match(page, /<span class="nav-lbl">Aide<\/span>/, "libellé masquable sur téléphone");
  assert.match(page, /\(admin \? '<div class="tab-pane fade" id="tabAssistance">'/);
  assert.match(lire("netlify.toml"), /from\s+=\s+"\/api\/assistance"/);
  assert.doesNotMatch(lire("assistance.js"), /style="/);
});
