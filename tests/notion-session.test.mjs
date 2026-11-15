// Les routes /api/notion-* lisent et écrivent des dossiers contenant des noms de clients :
// elles exigent une session avant tout le reste. Et la copie Notion d'un avis n'est plus jamais
// tronquée (un JSON coupé est illisible) : elle est allégée de ses photos, ou marquée.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";

const { signJWT } = await import("../netlify/functions/_auth.mjs");
const { packBig, unpackBig, tropLourd } = await import("../netlify/functions/_notion.mjs");
const { packAvis, handler: save } = await import("../netlify/functions/notion-save.mjs");
const { handler: list } = await import("../netlify/functions/notion-list.mjs");
const { handler: get } = await import("../netlify/functions/notion-get.mjs");
const { handler: del } = await import("../netlify/functions/notion-delete.mjs");

const vraiFetch = globalThis.fetch;
let appels = [];
let pageAvis = null;
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  appels.push(u);
  const corps = JSON.parse(options.body || "{}");
  if (u.includes("/query")) {
    const email = corps?.filter?.title?.equals || corps?.filter?.rich_text?.equals || corps?.filter?.email?.equals || "";
    if (email === "agent@exemple.fr") {
      return new Response(JSON.stringify({ results: [{ id: "u1", properties: {
        "Email": { title: [{ plain_text: email }] }, "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: "Collaborateur" } },
      } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ results: pageAvis ? [pageAvis] : [] }), { status: 200 });
  }
  return new Response(JSON.stringify({ id: "p1", url: "https://notion.test/p1" }), { status: 200 });
};
after(() => { globalThis.fetch = vraiFetch; });

const session = { cookie: "fidi_session=" + signJWT({ email: "agent@exemple.fr" }) };
const aleatoire = (n) => { let s = ""; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };

test("sans session : 401 sur les quatre routes, et aucun appel à Notion", async () => {
  appels = [];
  const routes = [
    [list, { httpMethod: "GET", headers: {}, queryStringParameters: { kind: "avis" } }],
    [get, { httpMethod: "GET", headers: {}, queryStringParameters: { kind: "avis", ref: "X" } }],
    [del, { httpMethod: "POST", headers: {}, body: JSON.stringify({ kind: "avis", ref: "X" }) }],
    [save, { httpMethod: "POST", headers: {}, body: JSON.stringify({ kind: "avis", ref: "X", data: {} }) }],
  ];
  for (const [h, e] of routes) assert.equal((await h(e)).statusCode, 401);
  assert.equal(appels.length, 0);
});

test("jeton invalide ou compte inconnu : 401", async () => {
  const faux = { cookie: "fidi_session=" + signJWT({ email: "agent@exemple.fr" }).slice(0, -3) + "abc" };
  assert.equal((await list({ httpMethod: "GET", headers: faux, queryStringParameters: {} })).statusCode, 401);
  const inconnu = { cookie: "fidi_session=" + signJWT({ email: "personne@exemple.fr" }) };
  pageAvis = null;
  assert.equal((await get({ httpMethod: "GET", headers: inconnu, queryStringParameters: { ref: "X" } })).statusCode, 401);
});

test("avec session : la lecture passe la garde", async () => {
  pageAvis = { id: "p1", url: "u", properties: { "Donnees JSON": packBig({ metadata: { ref: "X" } }) } };
  const r = await get({ httpMethod: "GET", headers: session, queryStringParameters: { kind: "avis", ref: "X" } });
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).data.metadata.ref, "X");
});

test("garde-fou : la session est vérifiée avant la configuration Notion", () => {
  for (const f of ["notion-list", "notion-get", "notion-delete", "notion-save"]) {
    const src = readFileSync(new URL(`../netlify/functions/${f}.mjs`, import.meta.url), "utf8");
    const h = src.slice(src.indexOf("export const handler"));
    assert.ok(h.indexOf("sessionRequise(event)") > 0, f);
    assert.ok(h.indexOf("sessionRequise(event)") < h.indexOf("hasToken()"), f);
  }
});

test("avis trop lourd pour Notion : marqueur lisible, jamais de JSON tronqué", () => {
  const lourd = { metadata: { ref: "X" }, texte: aleatoire(600_000) };
  const prop = packBig(lourd);
  assert.ok(prop.rich_text.length <= 100);
  assert.equal(tropLourd(prop), true);
  assert.deepEqual(JSON.parse(unpackBig({ rich_text: prop.rich_text.map((t) => ({ plain_text: t.text.content })) })), { __trop_lourd: true });
});

test("avis avec photos : la copie Notion garde tout sauf les images", () => {
  const data = { metadata: { ref: "X", client: "Client" }, bien: { surface: 78, photos: [{ dataUrl: aleatoire(400_000) }, { dataUrl: aleatoire(400_000) }] } };
  const prop = packAvis(data);
  assert.equal(tropLourd(prop), false);
  const relu = JSON.parse(unpackBig({ rich_text: prop.rich_text.map((t) => ({ plain_text: t.text.content })) }));
  assert.equal(relu.metadata.client, "Client");
  assert.equal(relu.bien.surface, 78);
  assert.deepEqual(relu.bien.photos, []);
  assert.equal(relu.__photos_retirees, 2);
  assert.equal(data.bien.photos.length, 2, "l'avis d'origine n'est pas modifié");
});

test("avis léger : copie Notion inchangée, photos comprises", () => {
  const data = { metadata: { ref: "X" }, bien: { photos: [{ dataUrl: "petite" }] } };
  const relu = JSON.parse(unpackBig({ rich_text: packAvis(data).rich_text.map((t) => ({ plain_text: t.text.content })) }));
  assert.deepEqual(relu, data);
});

test("lecture d'une copie marquée trop lourde : data null et source explicite", async () => {
  pageAvis = { id: "p1", url: "u", properties: { "Donnees JSON": { rich_text: [{ plain_text: '{"__trop_lourd":true}' }] } } };
  const d = JSON.parse((await get({ httpMethod: "GET", headers: session, queryStringParameters: { kind: "avis", ref: "X" } })).body);
  assert.equal(d.data, null);
  assert.equal(d.source, "trop_lourd");
});

// La référence d'une étude ne contient ni adresse ni parcelle : deux études du même jour dans
// la même commune la partagent. La sauvegarde automatique ne doit pas écraser l'autre.
const etude = (adresse, auto) => save({ httpMethod: "POST", headers: session, body: JSON.stringify({
  kind: "etude", ref: "FIDI-EM-20261115-97230", adresse, commune: "La Trinité", auto, data: { data: {}, inputs: {} },
}) });
const ecritures = () => appels.filter((u) => /\/pages(\/|$)/.test(u)).length;

test("sauvegarde automatique d'une étude : ne remplace pas l'étude d'une autre adresse", async () => {
  pageAvis = { id: "e1", url: "u", properties: { "Adresse": { rich_text: [{ plain_text: "1 rue A" }] } } };
  appels = [];
  const r = await etude("9 rue B", true);
  assert.equal(r.statusCode, 409);
  const d = JSON.parse(r.body);
  assert.equal(d.conflit, true);
  assert.equal(d.adresse_existante, "1 rue A");
  assert.equal(ecritures(), 0, "aucune écriture dans Notion");
});

test("sauvegarde automatique : même adresse mise à jour, étude nouvelle créée", async () => {
  pageAvis = { id: "e1", url: "u", properties: { "Adresse": { rich_text: [{ plain_text: "1 Rue A" }] } } };
  appels = [];
  assert.equal((await etude("1 rue a", true)).statusCode, 200);
  assert.ok(ecritures() >= 1);
  pageAvis = null; appels = [];
  assert.equal((await etude("9 rue B", true)).statusCode, 200);
  assert.ok(ecritures() >= 1);
});

test("sauvegarde manuelle : remplace, comme avant (c'est le choix de l'utilisateur)", async () => {
  pageAvis = { id: "e1", url: "u", properties: { "Adresse": { rich_text: [{ plain_text: "1 rue A" }] } } };
  appels = [];
  assert.equal((await etude("9 rue B", false)).statusCode, 200);
  assert.ok(ecritures() >= 1);
});
