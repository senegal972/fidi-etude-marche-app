// Garde d'accès de /api/pdf-share : sans session valide rien n'est déposé, et seul un PDF est
// accepté. Sans cette garde, n'importe qui pourrait héberger un contenu sur le domaine et
// obtenir un lien public. Le lien /api/download/<id>, lui, reste public pour les destinataires.
// Aucun réseau réel : fetch est remplacé (Notion et Netlify Blobs simulés, le vrai client
// @netlify/blobs tourne sur un stockage en mémoire).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
process.env.NETLIFY_SITE_ID = "site-de-test";
process.env.NETLIFY_AUTH_TOKEN = "jeton-de-test";

const { handler } = await import("../netlify/functions/pdf-share.mjs");
const { handler: telecharger } = await import("../netlify/functions/pdf-get.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();
let appels = [];
let compte = { statut: "Actif", absent: false };

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  appels.push(u.href);
  if (u.hostname === "api.notion.com") {
    const page = {
      id: "page-1",
      properties: {
        "Email": { title: [{ plain_text: "agent@exemple.fr" }] },
        "Statut": { select: { name: compte.statut } },
        "Rôle": { select: { name: "Collaborateur" } },
      },
    };
    return new Response(JSON.stringify({ results: compte.absent ? [] : [page] }), { status: 200 });
  }
  const cle = u.pathname.split("/").pop();
  if (u.hostname === "api.netlify.com") {
    return new Response(JSON.stringify({ url: "https://blobs.test/" + cle }), { status: 200 });
  }
  if (u.hostname === "blobs.test") {
    if (options.method === "put") {
      blobs.set(cle, { corps: String(options.body), meta: options.headers["x-amz-meta-user"] });
      return new Response(null, { status: 200 });
    }
    const b = blobs.get(cle);
    if (!b) return new Response(null, { status: 404 });
    return new Response(b.corps, { status: 200, headers: { "x-amz-meta-user": b.meta } });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });

beforeEach(() => {
  appels = [];
  blobs.clear();
  compte = { statut: "Actif", absent: false };
  process.env.JWT_SECRET = "secret-de-test-seulement";
});

const PDF = Buffer.from("%PDF-1.3\n%contenu de test\n%%EOF\n").toString("base64");
const corps = { pdf_b64: PDF, filename: "FIDI_Etude_Test.pdf" };
const ev = (headers = {}, body = corps) => ({ httpMethod: "POST", headers: { host: "app.exemple.fr", ...headers }, body: JSON.stringify(body) });
const jeton = (payload = { email: "agent@exemple.fr" }, ttl) => signJWT(payload, ttl);
const bearer = (t) => ({ authorization: "Bearer " + t });
// Le navigateur n'envoie que le cookie de session : c'est le cas de l'appel réel de index.html.
const navigateur = () => ({ cookie: "autre=1; fidi_session=" + jeton() });

test("anonyme : 401, aucun appel Notion ni Blobs", async () => {
  const r = await handler(ev());
  assert.equal(r.statusCode, 401);
  assert.equal(appels.length, 0);
  assert.equal(blobs.size, 0);
});

test("jeton à signature fausse : 401, rien n'est déposé", async () => {
  const p = jeton().split(".");
  p[2] = (p[2][0] === "A" ? "B" : "A") + p[2].slice(1);
  const r = await handler(ev(bearer(p.join("."))));
  assert.equal(r.statusCode, 401);
  assert.equal(blobs.size, 0);
});

test("jeton expiré : 401, rien n'est déposé", async () => {
  const r = await handler(ev(bearer(jeton({ email: "agent@exemple.fr" }, -10))));
  assert.equal(r.statusCode, 401);
  assert.equal(blobs.size, 0);
});

test("jeton d'un autre usage (lien d'inscription, sans e-mail de compte) : 401", async () => {
  const r = await handler(ev(bearer(jeton({ purpose: "signup", role: "Collaborateur" }))));
  assert.equal(r.statusCode, 401);
  assert.equal(blobs.size, 0);
});

test("compte désactivé : 401, rien n'est déposé", async () => {
  compte.statut = "Désactivé";
  const r = await handler(ev(navigateur()));
  assert.equal(r.statusCode, 401);
  assert.equal(blobs.size, 0);
});

test("compte introuvable dans Notion : 401, rien n'est déposé", async () => {
  compte.absent = true;
  const r = await handler(ev(navigateur()));
  assert.equal(r.statusCode, 401);
  assert.equal(blobs.size, 0);
});

test("sans JWT_SECRET : fermé par défaut (401), même avec un jeton fabriqué avant", async () => {
  const t = jeton();
  delete process.env.JWT_SECRET;
  const r = await handler(ev(bearer(t)));
  assert.equal(r.statusCode, 401);
  assert.equal(blobs.size, 0);
});

test("Notion en panne : 503 (fermé), rien n'est déposé", async () => {
  const courant = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("réseau coupé"); };
  try {
    const r = await handler(ev(navigateur()));
    assert.equal(r.statusCode, 503);
    assert.equal(blobs.size, 0);
  } finally { globalThis.fetch = courant; }
});

test("OPTIONS reste 200 et les autres méthodes 405, sans session", async () => {
  assert.equal((await handler({ httpMethod: "OPTIONS", headers: {} })).statusCode, 200);
  assert.equal((await handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
});

for (const [nom, contenu] of [
  ["page HTML", Buffer.from("<html><script>alert(1)</script></html>").toString("base64")],
  ["exécutable", Buffer.from("MZ\x90\x00\x03").toString("base64")],
  ["texte qui contient %PDF- plus loin", Buffer.from("xx%PDF-1.3").toString("base64")],
  ["base64 invalide", "!!!!!!!!"],
]) {
  test(`utilisateur connecté, contenu non PDF (${nom}) : 400, rien n'est déposé`, async () => {
    const r = await handler(ev(navigateur(), { pdf_b64: contenu, filename: "x.pdf" }));
    assert.equal(r.statusCode, 400);
    assert.equal(blobs.size, 0);
  });
}

for (const [nom, valeur] of [["absent", undefined], ["vide", ""], ["nombre", 123], ["objet", { a: 1 }]]) {
  test(`utilisateur connecté, pdf_b64 ${nom} : 400 sans plantage`, async () => {
    const r = await handler(ev(navigateur(), { pdf_b64: valeur }));
    assert.equal(r.statusCode, 400);
    assert.equal(blobs.size, 0);
  });
}

test("utilisateur connecté, corps invalide : 400", async () => {
  const r = await handler({ httpMethod: "POST", headers: navigateur(), body: "{pas du json" });
  assert.equal(r.statusCode, 400);
});

test("PDF au-delà de 9 Mo : 413 et message juste, rien n'est déposé", async () => {
  const r = await handler(ev(navigateur(), { pdf_b64: PDF + "A".repeat(13 * 1024 * 1024) }));
  assert.equal(r.statusCode, 413);
  assert.match(JSON.parse(r.body).error, /max 9 Mo/);
  assert.equal(blobs.size, 0);
});

test("utilisateur connecté par cookie : PDF déposé, lien public sur le domaine", async () => {
  const r = await handler(ev(navigateur()));
  assert.equal(r.statusCode, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.match(j.id, /^[0-9a-f]{32}$/);
  assert.equal(j.url, "https://app.exemple.fr/api/download/" + j.id);
  assert.equal(j.filename, "FIDI_Etude_Test.pdf");
  assert.equal(blobs.size, 1);
});

test("préfixe data URL toléré : le PDF est accepté", async () => {
  const r = await handler(ev(navigateur(), { pdf_b64: "data:application/pdf;base64," + PDF, filename: "a.pdf" }));
  assert.equal(r.statusCode, 200);
});

test("aller-retour : le destinataire ouvre le lien SANS session et reçoit le PDF", async () => {
  const j = JSON.parse((await handler(ev(navigateur()))).body);
  const r = await telecharger({ path: "/api/download/" + j.id, headers: {} });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Content-Type"], "application/pdf");
  assert.match(r.headers["Content-Disposition"], /FIDI_Etude_Test\.pdf/);
  assert.equal(r.isBase64Encoded, true);
  assert.equal(r.body, PDF);
});

test("lien déjà envoyé (ancien identifiant à 16 caractères) : toujours servi", async () => {
  const ancien = "abc123def456gh78";
  const meta = "b64;" + Buffer.from(JSON.stringify({ ts: Date.now(), filename: "ancien.pdf" })).toString("base64");
  blobs.set(ancien, { corps: PDF, meta });
  const r = await telecharger({ path: "/api/download/" + ancien, headers: {} });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, PDF);
});

test("identifiants tous différents d'un dépôt à l'autre", async () => {
  const a = JSON.parse((await handler(ev(navigateur()))).body).id;
  const b = JSON.parse((await handler(ev(navigateur()))).body).id;
  assert.notEqual(a, b);
});

test("garde-fou : la session est vérifiée avant toute lecture du corps et tout dépôt", () => {
  const src = readFileSync(new URL("../netlify/functions/pdf-share.mjs", import.meta.url), "utf8");
  const h = src.slice(src.indexOf("export const handler"));
  assert.ok(h.indexOf("currentUser(") > 0, "currentUser absent du handler");
  assert.ok(h.indexOf("currentUser(") < h.indexOf("JSON.parse("), "la garde doit précéder la lecture du corps");
  assert.ok(h.indexOf("currentUser(") < h.indexOf("store.set("), "la garde doit précéder le dépôt");
  assert.doesNotMatch(src, /Math\.random/);
});

test("garde-fou : l'appel réel de index.html reste même origine, donc avec le cookie", () => {
  const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const appel = src.match(/fetch\('\/api\/pdf-share',\s*\{[^}]*\}/);
  assert.ok(appel, "appel /api/pdf-share introuvable dans index.html");
  assert.doesNotMatch(appel[0], /credentials:\s*'omit'/);
});
