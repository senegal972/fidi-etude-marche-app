// Changement de son propre mot de passe par un utilisateur connecté.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";

const { handler, ESSAIS_MAX } = await import("../netlify/functions/auth-motdepasse.mjs");
const { signJWT, hashPassword, verifyPassword } = await import("../netlify/functions/_auth.mjs");

const ANCIEN = "AncienMotDePasse1", NOUVEAU = "NouveauMotDePasse2";
let hash, statut, ecritures;
const vraiFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== "api.notion.com") throw new Error("appel réseau inattendu : " + u.href);
  if (u.pathname.endsWith("/query")) {
    return new Response(JSON.stringify({ results: [{ id: "page-moi", properties: {
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
