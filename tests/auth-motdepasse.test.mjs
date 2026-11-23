// Changement de son propre mot de passe par un utilisateur connecté.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";

const { handler, ESSAIS_MAX } = await import("../netlify/functions/auth-motdepasse.mjs");
const { signJWT, hashPassword, verifyPassword } = await import("../netlify/functions/_auth.mjs");

const ANCIEN = "AncienMotDePasse1", NOUVEAU = "NouveauMotDePasse2";
let hash, statut, ecritures, pageId = "page-moi";
const vraiFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== "api.notion.com") throw new Error("appel réseau inattendu : " + u.href);
  if (u.pathname.endsWith("/query")) {
    return new Response(JSON.stringify({ results: [{ id: pageId, properties: {
      "Email": { title: [{ plain_text: "moi@exemple.fr" }] }, "Nom": { rich_text: [{ plain_text: "Moi" }] },
      "Statut": { select: { name: statut } }, "Rôle": { select: { name: "Collaborateur" } },
      "Mot de passe": { rich_text: [{ plain_text: hash }] } } }] }), { status: 200 });
  }
  const p = (JSON.parse(options.body || "{}").properties || {})["Mot de passe"];
  if (p) { hash = p.rich_text[0].text.content; ecritures++; }
  return new Response("{}", { status: 200 });
};
after(() => { globalThis.fetch = vraiFetch; });
beforeEach(() => { hash = hashPassword(ANCIEN); statut = "Actif"; ecritures = 0; });

const cookie = (email) => ({ cookie: "fidi_session=" + signJWT({ email }) });
const post = async (b, headers = cookie("moi@exemple.fr")) => { const r = await handler({ httpMethod: "POST", headers, body: JSON.stringify(b) }); return { code: r.statusCode, ...JSON.parse(r.body) }; };

test("sans session, ou compte désactivé : refus, rien n'est écrit", async () => {
  assert.equal((await post({ actuel: ANCIEN, nouveau: NOUVEAU }, {})).code, 401);
  statut = "Désactivé";
  assert.equal((await post({ actuel: ANCIEN, nouveau: NOUVEAU })).code, 401);
  assert.equal(ecritures, 0);
});

test("nouveau mot de passe trop faible, identique à l'ancien, ou champs vides : refus", async () => {
  assert.equal((await post({ actuel: ANCIEN, nouveau: "court1" })).code, 400);
  assert.equal((await post({ actuel: ANCIEN, nouveau: "sanschiffresdutout" })).code, 400);
  assert.equal((await post({ actuel: ANCIEN, nouveau: ANCIEN })).code, 400);
  assert.equal((await post({ actuel: "", nouveau: NOUVEAU })).code, 400);
  assert.equal(ecritures, 0);
});

test("mot de passe changé : le nouveau fonctionne, l'ancien ne fonctionne plus, rien n'est renvoyé en clair", async () => {
  const r = await post({ actuel: ANCIEN, nouveau: NOUVEAU });
  assert.equal(r.code, 200); assert.equal(ecritures, 1);
  assert.equal(verifyPassword(NOUVEAU, hash), true);
  assert.equal(verifyPassword(ANCIEN, hash), false);
  assert.ok(!JSON.stringify(r).includes(NOUVEAU) && !hash.includes(NOUVEAU));
  assert.equal((await post({ actuel: ANCIEN, nouveau: "EncoreUnAutre3" })).code, 403);
});

test("mauvais mot de passe actuel : refus, puis blocage après plusieurs essais", async () => {
  hash = hashPassword("UnAutreCompte9");
  // Un essai manqué a déjà été compté par le test précédent (même compte) : il en reste ESSAIS_MAX - 1 avant le blocage.
  for (let i = 0; i < ESSAIS_MAX - 1; i++) assert.equal((await post({ actuel: "MauvaisMot" + i, nouveau: NOUVEAU })).code, 403);
  const bloque = await post({ actuel: "UnAutreCompte9", nouveau: NOUVEAU });
  assert.equal(bloque.code, 429);
  assert.equal(ecritures, 0);
});

test("interface : formulaire dans Identité, module chargé, route déclarée, même règle que l'inscription", () => {
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["mdpForm", "mdpActuel", "mdpNouveau", "mdpConfirme", "mdpEtat", "mdpValider"]) assert.ok(page.includes('id="' + id + '"'), id);
  assert.match(page, /<script src="\/compte-motdepasse\.js" defer><\/script>/);
  assert.match(readFileSync(new URL("../netlify.toml", import.meta.url), "utf8"), /\/api\/auth\/mot-de-passe/);
  const mod = readFileSync(new URL("../compte-motdepasse.js", import.meta.url), "utf8");
  new Function(mod);
  assert.ok(mod.includes("s.length < 10") && mod.includes("/api/auth/mot-de-passe"));
});

// Session liée au mot de passe.
test("session : coupée dès que le mot de passe change ; renouvelée sur l'appareil qui a fait le changement", async () => {
  const { empreinteMdp } = await import("../netlify/functions/_auth.mjs");
  pageId = "page-session"; // compteur d'essais distinct de celui saturé par le test précédent
  hash = hashPassword("MotDePasseSession7");
  const session = { cookie: "fidi_session=" + signJWT({ email: "moi@exemple.fr", pv: empreinteMdp(hash) }) };
  const r = await handler({ httpMethod: "POST", headers: session, body: JSON.stringify({ actuel: "MotDePasseSession7", nouveau: "MotDePasseSession8" }) });
  assert.equal(r.statusCode, 200);
  const nouveauCookie = String(r.headers["Set-Cookie"] || "").split(";")[0];
  assert.match(nouveauCookie, /^fidi_session=.+/);
  // L'ancienne session (autre appareil) ne passe plus ; la nouvelle passe.
  const essai = (h) => handler({ httpMethod: "POST", headers: h, body: JSON.stringify({ actuel: "x", nouveau: "y" }) }).then((x) => x.statusCode);
  assert.equal(await essai(session), 401);
  assert.notEqual(await essai({ cookie: nouveauCookie }), 401);
});

test("session : un lien « mot de passe oublié » ou un jeton d'un autre usage n'ouvre pas de session", async () => {
  const jeton = signJWT({ purpose: "reset", email: "moi@exemple.fr", v: "abc" }, 3600);
  const r = await handler({ httpMethod: "POST", headers: { cookie: "fidi_session=" + jeton }, body: JSON.stringify({ actuel: ANCIEN, nouveau: NOUVEAU }) });
  assert.equal(r.statusCode, 401); assert.equal(ecritures, 0);
});

test("session : la connexion pose l'empreinte du mot de passe", () => {
  const login = readFileSync(new URL("../netlify/functions/auth-login.mjs", import.meta.url), "utf8");
  assert.ok(login.includes("pv: empreinteMdp(found.user.hash)"));
});

// Garde-fou de publication : une seule fonction qui ne se charge pas fait échouer tout le déploiement Netlify.
test("toutes les fonctions du serveur se chargent sans erreur de syntaxe", async () => {
  const { readdirSync } = await import("node:fs");
  const dossier = new URL("../netlify/functions/", import.meta.url);
  const echecs = [];
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".mjs"))) {
    try { await import(new URL(f, dossier).href); } catch (e) { echecs.push(f + " : " + String(e.message).slice(0, 120)); }
  }
  assert.deepEqual(echecs, []);
});

test("connexion : la session porte l'empreinte du mot de passe et fonctionne avec le service de changement", async () => {
  const login = await import("../netlify/functions/auth-login.mjs");
  pageId = "page-connexion"; hash = hashPassword("MotDePasseConnexion5");
  const r = await login.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ email: "moi@exemple.fr", password: "MotDePasseConnexion5" }) });
  assert.equal(r.statusCode, 200);
  const cookieSession = String(r.headers["Set-Cookie"]).split(";")[0];
  const ok = await handler({ httpMethod: "POST", headers: { cookie: cookieSession }, body: JSON.stringify({ actuel: "MotDePasseConnexion5", nouveau: "MotDePasseConnexion6" }) });
  assert.equal(ok.statusCode, 200);
  // La session d'avant le changement n'est plus valable.
  const apres = await handler({ httpMethod: "POST", headers: { cookie: cookieSession }, body: JSON.stringify({ actuel: "x", nouveau: "y" }) });
  assert.equal(apres.statusCode, 401);
});
