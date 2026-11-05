// Garde de /api/pdf-render : sans session valide, rien n'est lu ni rendu ; et Chromium ne doit
// atteindre ni le réseau interne ni le disque local. Aucun réseau réel, Chromium non lancé :
// un corps sans html renvoie 400 juste après la garde, ce qui prouve qu'elle a laissé passer.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";

const { handler } = await import("../netlify/functions/pdf-render.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");
const { isPrivateAddress, urlAllowed, waitForImages, hardenedArgs } = await import("../netlify/functions/_pdf-guard.mjs");

const vraiFetch = globalThis.fetch;
let appels = [];
let compte = { statut: "Actif", absent: false };

globalThis.fetch = async (url) => {
  const u = String(url);
  appels.push(u);
  if (u.startsWith("https://api.notion.com/")) {
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
  throw new Error("appel réseau inattendu : " + u);
};
after(() => { globalThis.fetch = vraiFetch; });

beforeEach(() => {
  appels = [];
  compte = { statut: "Actif", absent: false };
  process.env.JWT_SECRET = "secret-de-test-seulement";
});

const ev = (headers = {}, body = "{}") => ({ httpMethod: "POST", headers, body });
const jeton = (payload = { email: "agent@exemple.fr" }, ttl) => signJWT(payload, ttl);
const bearer = (t) => ({ authorization: "Bearer " + t });

test("anonyme avec html : 401, aucun appel Notion", async () => {
  const r = await handler(ev({}, JSON.stringify({ html: "<p>x</p>" })));
  assert.equal(r.statusCode, 401);
  assert.equal(JSON.parse(r.body).need_auth, true);
  assert.equal(appels.length, 0);
});

test("anonyme avec corps invalide : 401 et non 400 (la session passe avant la lecture du corps)", async () => {
  const r = await handler(ev({}, "{pas du json"));
  assert.equal(r.statusCode, 401);
});

test("jeton à signature fausse : 401", async () => {
  const p = jeton().split(".");
  p[2] = (p[2][0] === "A" ? "B" : "A") + p[2].slice(1);
  assert.equal((await handler(ev(bearer(p.join("."))))).statusCode, 401);
});

test("jeton expiré : 401", async () => {
  assert.equal((await handler(ev(bearer(jeton({ email: "agent@exemple.fr" }, -10))))).statusCode, 401);
});

test("jeton d'un autre usage (lien d'inscription, sans e-mail de compte) : 401", async () => {
  assert.equal((await handler(ev(bearer(jeton({ purpose: "signup", role: "Collaborateur" }))))).statusCode, 401);
});

test("compte désactivé : 401", async () => {
  compte.statut = "Désactivé";
  assert.equal((await handler(ev(bearer(jeton())))).statusCode, 401);
});

test("compte introuvable dans Notion : 401", async () => {
  compte.absent = true;
  assert.equal((await handler(ev(bearer(jeton())))).statusCode, 401);
});

test("sans JWT_SECRET : fermé par défaut (401), même avec un jeton fabriqué avant", async () => {
  const t = jeton();
  delete process.env.JWT_SECRET;
  assert.equal((await handler(ev(bearer(t)))).statusCode, 401);
});

test("Notion en panne : 503 (fermé)", async () => {
  const courant = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("réseau coupé"); };
  try {
    assert.equal((await handler(ev(bearer(jeton())))).statusCode, 503);
  } finally { globalThis.fetch = courant; }
});

test("utilisateur actif (Bearer) : la garde laisse passer jusqu'au contrôle du corps (400)", async () => {
  const r = await handler(ev(bearer(jeton())));
  assert.equal(r.statusCode, 400);
  assert.match(JSON.parse(r.body).error, /html requis/);
});

test("utilisateur actif (cookie fidi_session, comme le navigateur) : passe la garde", async () => {
  const r = await handler(ev({ cookie: "autre=1; fidi_session=" + jeton() }));
  assert.equal(r.statusCode, 400);
});

test("pas d'en-tête CORS et OPTIONS refusé : la route ne sert que la même origine", async () => {
  const r = await handler({ httpMethod: "OPTIONS", headers: {} });
  assert.equal(r.statusCode, 405);
  assert.equal(r.headers["Access-Control-Allow-Origin"], undefined);
  const a = await handler(ev());
  assert.equal(a.headers["Access-Control-Allow-Origin"], undefined);
});

test("garde-fou : la session précède la lecture du corps et le lancement de Chromium", () => {
  const src = readFileSync(new URL("../netlify/functions/pdf-render.mjs", import.meta.url), "utf8");
  const h = src.slice(src.indexOf("export const handler"));
  assert.ok(h.indexOf("currentUser(") > 0, "currentUser absent du handler");
  assert.ok(h.indexOf("currentUser(") < h.indexOf("JSON.parse("));
  assert.ok(h.indexOf("currentUser(") < h.indexOf("puppeteer.launch("));
  assert.ok(h.indexOf("installRequestGuard(page)") < h.indexOf("page.setContent("));
  assert.match(src, /hardenedArgs\(/);
});

// ─── Garde réseau ─────────────────────────────────────────────────────────────
test("adresses internes bloquées, IPv4 et IPv6", () => {
  for (const ip of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::7f00:1", "2002:7f00:1::",
    "pas-une-adresse",
  ]) assert.equal(isPrivateAddress(ip), true, ip);
});

test("adresses publiques autorisées, IPv4 et IPv6", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.167.1.1", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

const publique = async () => [{ address: "93.184.216.34", family: 4 }];
const interdit = async () => { throw new Error("DNS ne doit pas être interrogé"); };

test("urlAllowed : schémas locaux autorisés, fichiers et autres refusés", async () => {
  for (const u of ["data:image/png;base64,AA", "blob:https://x.fr/1", "about:blank"]) {
    assert.equal(await urlAllowed(u, { lookup: interdit }), true, u);
  }
  for (const u of ["file:///proc/self/environ", "ftp://exemple.fr/a", "chrome://version", "pas une url"]) {
    assert.equal(await urlAllowed(u, { lookup: interdit }), false, u);
  }
});

test("urlAllowed : formes détournées d'adresses internes refusées sans DNS", async () => {
  for (const u of [
    "http://127.0.0.1:9001/2018-06-01/runtime/invocation/next", "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", "http://0x7f.0.0.1/", "http://017700000001/", "http://[::1]/", "http://[::ffff:7f00:1]/",
    "http://localhost/", "http://LOCALHOST./", "http://app.localhost/", "http://service.internal/", "http://intranet/",
  ]) assert.equal(await urlAllowed(u, { lookup: interdit }), false, u);
});

test("urlAllowed : domaine public accepté ; refusé s'il résout, même en partie, vers une adresse interne", async () => {
  assert.equal(await urlAllowed("https://data.geopf.fr/wms", { lookup: publique }), true);
  const mixte = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
  assert.equal(await urlAllowed("https://piege.exemple.fr/", { lookup: mixte }), false);
  const panne = async () => { throw new Error("ENOTFOUND"); };
  assert.equal(await urlAllowed("https://inconnu.exemple.fr/", { lookup: panne }), false);
  const vide = async () => [];
  assert.equal(await urlAllowed("https://vide.exemple.fr/", { lookup: vide }), false);
});

test("urlAllowed : un hôte n'est résolu qu'une fois par rendu", async () => {
  let n = 0;
  const lookup = async () => { n++; return [{ address: "93.184.216.34", family: 4 }]; };
  const cache = new Map();
  await urlAllowed("https://a.exemple.fr/1", { lookup, cache });
  await urlAllowed("https://a.exemple.fr/2", { lookup, cache });
  assert.equal(n, 1);
});

test("waitForImages : s'arrête quand les images sont finies, et à la date limite sinon", async () => {
  let n = 0;
  assert.equal(await waitForImages({ evaluate: async () => ++n >= 2 }, 1000, 1), true);
  assert.equal(n, 2);
  assert.equal(await waitForImages({ evaluate: async () => false }, 20, 1), false);
});

test("garde-fou : aucune promesse attendue dans la page, JavaScript y étant coupé", () => {
  const src = readFileSync(new URL("../netlify/functions/pdf-render.mjs", import.meta.url), "utf8");
  assert.match(src, /await waitForImages\(page\)/);
  assert.doesNotMatch(src, /addEventListener|new Promise/);
});

test("hardenedArgs retire --disable-web-security et garde le reste", () => {
  assert.deepEqual(hardenedArgs(["--a", "--disable-web-security", "--no-sandbox"]), ["--a", "--no-sandbox"]);
});
