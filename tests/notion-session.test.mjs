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
let partageVoisin = "";
const { DB } = await import("../netlify/functions/_notion.mjs");
const BASE_COMPTES = String(DB.users);
const A_MOI = { "Propriétaire": { rich_text: [{ plain_text: "agent@exemple.fr" }] } };
const de = (email) => ({ "Propriétaire": { rich_text: [{ plain_text: email }] } });
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  appels.push(u);
  const corps = JSON.parse(options.body || "{}");
  if (u.includes("/query")) {
    const email = corps?.filter?.title?.equals || corps?.filter?.rich_text?.equals || corps?.filter?.email?.equals || "";
    const compte = (e, id, reseau, partage) => ({ id, properties: { "Email": { title: [{ plain_text: e }] }, "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: "Collaborateur" } },
      "Réseau": { rich_text: [{ plain_text: reseau }] }, ...(partage ? { "Partage documents": { select: { name: partage } } } : {}) } });
    const COMPTES = { "agent@exemple.fr": compte("agent@exemple.fr", "u1", "Agence Nord"), "voisin@exemple.fr": compte("voisin@exemple.fr", "u2", "Agence Nord", partageVoisin), "ailleurs@exemple.fr": compte("ailleurs@exemple.fr", "u3", "Agence Sud", "Groupe") };
    if (COMPTES[email]) return new Response(JSON.stringify({ results: [COMPTES[email]] }), { status: 200 });
    if (u.includes(BASE_COMPTES) && !corps.filter) return new Response(JSON.stringify({ results: Object.values(COMPTES) }), { status: 200 });
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
  pageAvis = { id: "p1", url: "u", properties: { ...A_MOI, "Donnees JSON": packBig({ metadata: { ref: "X" } }) } };
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
  pageAvis = { id: "p1", url: "u", properties: { ...A_MOI, "Donnees JSON": { rich_text: [{ plain_text: '{"__trop_lourd":true}' }] } } };
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
  pageAvis = { id: "e1", url: "u", properties: { ...A_MOI, "Adresse": { rich_text: [{ plain_text: "1 rue A" }] } } };
  appels = [];
  const r = await etude("9 rue B", true);
  assert.equal(r.statusCode, 409);
  const d = JSON.parse(r.body);
  assert.equal(d.conflit, true);
  assert.equal(d.adresse_existante, "1 rue A");
  assert.equal(ecritures(), 0, "aucune écriture dans Notion");
});

test("sauvegarde automatique : même adresse mise à jour, étude nouvelle créée", async () => {
  pageAvis = { id: "e1", url: "u", properties: { ...A_MOI, "Adresse": { rich_text: [{ plain_text: "1 Rue A" }] } } };
  appels = [];
  assert.equal((await etude("1 rue a", true)).statusCode, 200);
  assert.ok(ecritures() >= 1);
  pageAvis = null; appels = [];
  assert.equal((await etude("9 rue B", true)).statusCode, 200);
  assert.ok(ecritures() >= 1);
});

test("sauvegarde manuelle : remplace, comme avant (c'est le choix de l'utilisateur)", async () => {
  pageAvis = { id: "e1", url: "u", properties: { ...A_MOI, "Adresse": { rich_text: [{ plain_text: "1 rue A" }] } } };
  appels = [];
  assert.equal((await etude("9 rue B", false)).statusCode, 200);
  assert.ok(ecritures() >= 1);
});

// ── Confidentialité : propriétaire, groupe, partage ──────────────────────────
const lireRef = () => get({ httpMethod: "GET", headers: session, queryStringParameters: { kind: "etude", ref: "X" } });

test("dossier d'un autre compte : invisible sauf partage au sein du même groupe ; jamais d'un groupe à l'autre", async () => {
  pageAvis = { id: "p1", url: "u", properties: { ...de("voisin@exemple.fr"), "Donnees JSON": packBig({ data: {} }) } };
  partageVoisin = "";            // privé
  assert.equal((await lireRef()).statusCode, 404, "privé : comme s'il n'existait pas");
  partageVoisin = "Groupe";
  const r = await lireRef();
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).lecture_seule, true);
  assert.equal(JSON.parse(r.body).proprietaire, "voisin@exemple.fr");
  pageAvis = { id: "p1", url: "u", properties: { ...de("ailleurs@exemple.fr"), "Donnees JSON": packBig({ data: {} }) } };
  assert.equal((await lireRef()).statusCode, 404, "autre groupe, même s'il partage avec le sien");
  partageVoisin = "";
});

test("dossier sans propriétaire (antérieur) : invisible, non modifiable et non supprimable pour un compte ordinaire", async () => {
  pageAvis = { id: "p1", url: "u", properties: { "Adresse": { rich_text: [{ plain_text: "1 rue A" }] }, "Donnees JSON": packBig({ data: {} }) } };
  assert.equal((await lireRef()).statusCode, 404);
  appels = [];
  const s1 = await etude("1 rue A", false);
  assert.equal(s1.statusCode, 403); assert.equal(JSON.parse(s1.body).autre_compte, true);
  assert.equal((await del({ httpMethod: "POST", headers: session, body: JSON.stringify({ kind: "etude", ref: "X" }) })).statusCode, 404);
  assert.equal(ecritures(), 0, "aucune écriture dans Notion");
});

test("un partage ne donne que la lecture : ni enregistrement ni suppression du dossier d'un collègue", async () => {
  partageVoisin = "Groupe";
  pageAvis = { id: "e1", url: "u", properties: { ...de("voisin@exemple.fr"), "Adresse": { rich_text: [{ plain_text: "1 rue A" }] } } };
  appels = [];
  assert.equal((await etude("1 rue A", false)).statusCode, 403);
  assert.equal((await del({ httpMethod: "POST", headers: session, body: JSON.stringify({ kind: "etude", ref: "X" }) })).statusCode, 404);
  assert.equal(ecritures(), 0);
  partageVoisin = "";
});

test("nouveau dossier : il est rattaché au compte qui l'enregistre ; la liste ne demande que les comptes visibles", async () => {
  pageAvis = null; appels = [];
  let ecrit = null; const avant = globalThis.fetch;
  globalThis.fetch = async (url, o = {}) => { if (/\/pages$/.test(String(url)) && o.method === "POST") ecrit = JSON.parse(o.body); return avant(url, o); };
  try { assert.equal((await etude("9 rue B", false)).statusCode, 200); } finally { globalThis.fetch = avant; }
  assert.equal(ecrit.properties["Propriétaire"].rich_text[0].text.content, "agent@exemple.fr");
  // Liste : filtre posé dans la requête Notion.
  partageVoisin = "Groupe"; let filtre = null;
  globalThis.fetch = async (url, o = {}) => { const c = JSON.parse(o.body || "{}"); if (String(url).includes("/query") && c.filter && c.filter.or) filtre = c.filter.or; return avant(url, o); };
  try { await list({ httpMethod: "GET", headers: session, queryStringParameters: { kind: "etude" } }); } finally { globalThis.fetch = avant; partageVoisin = ""; }
  assert.deepEqual(filtre.map((f) => f.rich_text.equals).sort(), ["agent@exemple.fr", "voisin@exemple.fr"], "moi et le collègue qui partage — pas l'autre groupe");
});
