// /api/marque — charte de marque rattachée au compte (module « Mise en page », marque.js).
// Même dispositif que pdf-blobs-lambda.test.mjs : contexte Blobs reçu dans event.blobs,
// vrai client @netlify/blobs sur un store en mémoire derrière un fetch simulé, aucun réseau réel.
// Fichier séparé : connectLambda pose un contexte global au processus.
import test, { after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID;
delete process.env.NETLIFY_AUTH_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler, assainirMarque } = await import("../netlify/functions/marque.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();
const COMPTES = { "agent@exemple.fr": "page-agent", "autre@exemple.fr": "page-autre" };

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    const email = corps?.filter?.title?.equals || corps?.filter?.rich_text?.equals || corps?.filter?.email?.equals || "";
    const id = COMPTES[email];
    const results = id ? [{
      id,
      properties: {
        "Email": { title: [{ plain_text: email }] },
        "Nom": { rich_text: [{ plain_text: "Agent Démo" }] },
        "Statut": { select: { name: "Actif" } },
        "Rôle": { select: { name: "Collaborateur" } },
      },
    }] : [];
    return new Response(JSON.stringify({ results }), { status: 200 });
  }
  if (u.hostname === "edge.test") {
    const cle = decodeURIComponent(u.pathname.split("/").pop());
    if (options.method === "put") { blobs.set(cle, String(options.body)); return new Response(null, { status: 200 }); }
    const b = blobs.get(cle);
    return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const entetes = (email) => ({
  "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr",
  ...(email ? { cookie: "fidi_session=" + signJWT({ email }) } : {}),
});
const appel = (methode, email, corps) => handler({
  httpMethod: methode, headers: entetes(email), blobs: contexte,
  body: corps === undefined ? undefined : (typeof corps === "string" ? corps : JSON.stringify(corps)),
});

test("sans session : 401, en lecture comme en écriture", async () => {
  assert.equal((await appel("GET")).statusCode, 401);
  assert.equal((await appel("POST", null, { enseigne: "x" })).statusCode, 401);
});

test("OPTIONS → 200, méthode inconnue → 405", async () => {
  assert.equal((await handler({ httpMethod: "OPTIONS", headers: {} })).statusCode, 200);
  assert.equal((await handler({ httpMethod: "DELETE", headers: {} })).statusCode, 405);
});

test("aucune charte enregistrée : marque null et nom du compte", async () => {
  const r = await appel("GET", "agent@exemple.fr");
  assert.equal(r.statusCode, 200);
  const d = JSON.parse(r.body);
  assert.equal(d.marque, null);
  assert.equal(d.compte.nom, "Agent Démo");
});

test("enregistrement puis relecture : la charte suit le compte, pas un autre", async () => {
  const charte = { enseigne: "Agence Démo", couleurs: { principale: "#263238", accent: "#0e8f6a", secondaire: "#D9A441" },
                   coordonnees: { raisonSociale: "Agence Démo SAS", email: "contact@demo.fr" }, role: "Admin" };
  const w = await appel("POST", "agent@exemple.fr", charte);
  assert.equal(w.statusCode, 200);
  const lu = JSON.parse((await appel("GET", "agent@exemple.fr")).body).marque;
  assert.equal(lu.enseigne, "Agence Démo");
  assert.equal(lu.couleurs.accent, "#0E8F6A");
  assert.ok(!("role" in lu), "un champ inconnu ne doit pas être stocké");
  const autre = JSON.parse((await appel("GET", "autre@exemple.fr")).body);
  assert.equal(autre.marque, null);
});

test("corps invalide ou trop lourd : refus lisible", async () => {
  assert.equal((await appel("POST", "agent@exemple.fr", "pas du json")).statusCode, 400);
  assert.equal((await appel("POST", "agent@exemple.fr", "x".repeat(2_700_000))).statusCode, 413);
});

test("assainirMarque écarte ce qui est invalide", () => {
  const m = assainirMarque({ enseigne: "x".repeat(500), logo: "javascript:alert(1)",
    couleurs: { principale: "red", accent: "#12345" }, coordonnees: { email: 42 } });
  assert.equal(m.enseigne.length, 40);
  assert.ok(!("logo" in m));
  assert.deepEqual(m.couleurs, {});
  assert.deepEqual(m.coordonnees, {});
  assert.deepEqual(assainirMarque([1]), {});
});

test("assainirMarque — sociétés émettrices : champs bornés, préfixe normalisé, doublons et excédent écartés", () => {
  const liste = Array.from({ length: 12 }, (_, i) => ({ id: "e" + i, raisonSociale: "Société " + i, prefixe: "od fac" + i, regimeTva: "assujetti" }));
  const m = assainirMarque({ emetteurs: [{ id: "e0", raisonSociale: "Doublon" }, ...liste, { raisonSociale: "sans id" }], emetteurDefaut: "e<1>" });
  assert.equal(m.emetteurs.length, 10);
  assert.equal(m.emetteurs[0].raisonSociale, "Doublon");
  assert.equal(m.emetteurs[1].prefixe, "ODFAC1");
  assert.equal(m.emetteurs[0].regimeTva, "");
  assert.equal(m.emetteurDefaut, "e1");
});

// Logo propre à chaque société émettrice (plusieurs sociétés, plusieurs logos).
test("société émettrice : logo propre gardé, logo invalide ou trop lourd écarté ; règles identiques côté navigateur", async () => {
  const { assainirEmetteur } = await import("../netlify/functions/marque.mjs");
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const base = { id: "e1", raisonSociale: "Société A", prefixe: "SA" };
  assert.equal(assainirEmetteur({ ...base, logo: PNG }).logo, PNG);
  assert.equal(assainirEmetteur({ ...base, logo: "javascript:alert(1)" }).logo, "");
  assert.equal(assainirEmetteur({ ...base, logo: "data:image/png;base64," + "A".repeat(200_000) }).logo, "");
  assert.equal(assainirEmetteur(base).logo, "");
  const { readFileSync } = await import("node:fs");
  const nav = readFileSync(new URL("../marque.js", import.meta.url), "utf8");
  assert.ok(nav.includes("o.logo = logoOk(src.logo) && src.logo.length < 200000 ? src.logo : '';"));
  // Sur la facture : le logo de la société d'abord, sinon celui de la charte si la case est cochée.
  assert.ok(readFileSync(new URL("../emetteurs.js", import.meta.url), "utf8").includes("logo: e.logo || (e.avecLogo ? (m.logo || '') : '')"));
  assert.ok(readFileSync(new URL("../netlify/functions/facture.mjs", import.meta.url), "utf8").includes('logo: e.logo || (e.avecLogo ? (m.logo || "") : "")'));
});
