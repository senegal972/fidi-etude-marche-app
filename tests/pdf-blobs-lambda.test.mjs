// Raccordement à Netlify Blobs de pdf-share et pdf-get, tel qu'en production : le contexte
// arrive dans event.blobs et aucune variable NETLIFY_* n'est utilisée. Avant ce raccordement,
// tous les liens /api/download répondaient 500. Fichier séparé : connectLambda pose un contexte
// global au processus. Aucun réseau réel : le vrai client @netlify/blobs tourne sur un store
// en mémoire derrière un fetch simulé.
import test, { after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID;
delete process.env.NETLIFY_AUTH_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler: deposer } = await import("../netlify/functions/pdf-share.mjs");
const { handler: telecharger } = await import("../netlify/functions/pdf-get.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();
const appelsBlobs = [];

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const page = {
      id: "page-1",
      properties: {
        "Email": { title: [{ plain_text: "agent@exemple.fr" }] },
        "Statut": { select: { name: "Actif" } },
        "Rôle": { select: { name: "Collaborateur" } },
      },
    };
    return new Response(JSON.stringify({ results: [page] }), { status: 200 });
  }
  if (u.hostname === "edge.test") {
    appelsBlobs.push({ url: u.href, auth: options.headers?.authorization });
    const cle = u.pathname.split("/").pop();
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

const PDF = Buffer.from("%PDF-1.3\n%contenu de test\n%%EOF\n").toString("base64");
const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const entetes = { "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr" };
const cookie = () => "fidi_session=" + signJWT({ email: "agent@exemple.fr" });

// Doit rester le premier test : connectLambda laisse ensuite un contexte dans le processus.
test("sans contexte ni variable : 503 lisible, pas 500", async () => {
  const lecture = await telecharger({ path: "/api/download/abc123", headers: {} });
  assert.equal(lecture.statusCode, 503);
  const depot = await deposer({ httpMethod: "POST", headers: { cookie: cookie() }, body: JSON.stringify({ pdf_b64: PDF }) });
  assert.equal(depot.statusCode, 503);
  assert.equal(JSON.parse(depot.body).blobs_error, true);
});

test("identifiant inconnu via event.blobs : 404 et non 500", async () => {
  const r = await telecharger({ path: "/api/download/inexistant000", headers: entetes, blobs: contexte });
  assert.equal(r.statusCode, 404);
  assert.equal(appelsBlobs.at(-1).auth, "Bearer jeton-du-runtime");
});

test("dépôt puis ouverture du lien sans session, uniquement via event.blobs", async () => {
  const depot = await deposer({
    httpMethod: "POST",
    headers: { ...entetes, cookie: cookie() },
    blobs: contexte,
    body: JSON.stringify({ pdf_b64: PDF, filename: "FIDI_Etude_Test.pdf" }),
  });
  assert.equal(depot.statusCode, 200);
  const { id } = JSON.parse(depot.body);

  const r = await telecharger({ path: "/api/download/" + id, headers: entetes, blobs: contexte });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Content-Type"], "application/pdf");
  assert.equal(r.isBase64Encoded, true);
  assert.equal(r.body, PDF);
});

test("event.blobs illisible : réponse propre, pas de plantage", async () => {
  const r = await telecharger({ path: "/api/download/inexistant000", headers: entetes, blobs: "pas-du-json" });
  assert.ok([404, 503].includes(r.statusCode));
});
