// /api/avis-store — avis de valeur et versions, rattachés au compte.
// Vrai client @netlify/blobs sur un store en mémoire derrière un fetch simulé, aucun réseau réel.
// Fichier séparé : connectLambda pose un contexte global au processus.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
delete process.env.NETLIFY_SITE_ID;
delete process.env.NETLIFY_AUTH_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.NETLIFY_BLOBS_CONTEXT;

const { handler, VERSIONS_MANUELLES_MAX, TAILLE_MAX } = await import("../netlify/functions/avis-store.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map(); // clé → { corps, meta }
let panneListe = false;
const COMPTES = {
  "agent@exemple.fr": { id: "page-agent", role: "Collaborateur" },
  "autre@exemple.fr": { id: "page-autre", role: "Collaborateur" },
  "admin@exemple.fr": { id: "page-admin", role: "Administrateur" },
  // Même groupe que « agent » : sert aux essais de partage (réglage posé par chaque essai).
  "collegue@exemple.fr": { id: "page-collegue", role: "Collaborateur", reseau: "Agence Nord" },
};
const pageCompte = (email) => { const c = COMPTES[email]; return { id: c.id, properties: {
  "Email": { title: [{ plain_text: email }] }, "Nom": { rich_text: [{ plain_text: "Agent Démo" }] }, "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: c.role } },
  ...(c.reseau ? { "Réseau": { rich_text: [{ plain_text: c.reseau }] } } : {}),
  ...(c.partage ? { "Partage documents": { select: { name: c.partage } } } : {}),
  ...(c.avec ? { "Partage avec": { rich_text: [{ plain_text: c.avec }] } } : {}),
  ...(c.ecosysteme ? { "Écosystème": { select: { name: c.ecosysteme } } } : {}) } }; };

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    const email = corps?.filter?.title?.equals || corps?.filter?.rich_text?.equals || corps?.filter?.email?.equals || "";
    // Sans filtre : la liste de tous les comptes (règles de partage) ; avec un e-mail : ce compte.
    const results = email ? (COMPTES[email] ? [pageCompte(email)] : []) : Object.keys(COMPTES).map(pageCompte);
    return new Response(JSON.stringify({ results }), { status: 200 });
  }
  if (u.hostname === "edge.test") {
    const morceaux = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const cle = morceaux.slice(2).join("/");
    const methode = String(options.method || "get").toLowerCase();
    if (!cle) {
      if (panneListe) return new Response("{}", { status: 403 }); // 403 : pas de nouvel essai du client
      const prefixe = u.searchParams.get("prefix") || "";
      const liste = [...blobs.keys()].filter((k) => k.startsWith(prefixe)).sort().map((key) => ({ key, etag: "e" }));
      return new Response(JSON.stringify({ blobs: liste, directories: [] }), { status: 200 });
    }
    if (methode === "put") {
      const entetes = new Headers(options.headers || {});
      blobs.set(cle, { corps: String(options.body), meta: entetes.get("x-amz-meta-user") || "" });
      return new Response(null, { status: 200 });
    }
    if (methode === "delete") { blobs.delete(cle); return new Response(null, { status: 204 }); }
    const b = blobs.get(cle);
    if (!b) return new Response(null, { status: 404 });
    const headers = b.meta ? { "x-amz-meta-user": b.meta } : {};
    return new Response(methode === "head" ? null : b.corps, { status: 200, headers });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });
beforeEach(() => { blobs.clear(); panneListe = false; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const entetes = (email) => ({
  "x-nf-site-id": "site-de-test", "x-nf-deploy-id": "deploy-de-test", host: "app.exemple.fr",
  ...(email ? { cookie: "fidi_session=" + signJWT({ email }) } : {}),
});
const lire = async (email, q) => {
  const r = await handler({ httpMethod: "GET", headers: entetes(email), blobs: contexte, queryStringParameters: q });
  return { code: r.statusCode, ...JSON.parse(r.body) };
};
const ecrire = async (email, corps) => {
  const r = await handler({ httpMethod: "POST", headers: entetes(email), blobs: contexte, body: typeof corps === "string" ? corps : JSON.stringify(corps) });
  return { code: r.statusCode, ...JSON.parse(r.body) };
};
const avis = (n = 1, extra = {}) => ({ metadata: { ref: "FIDI-AV-TEST", client: "Client " + n }, bien: { surface: n }, ...extra });
const enregistrer = (email, data, version, ref = "FIDI-AV-TEST") =>
  ecrire(email, { action: "enregistrer", ref, data, resume: { client: data.metadata.client, commune: "La Trinité", valeur_min: 183000, valeur_max: 202000 }, version });
const AGENT = "agent@exemple.fr", AUTRE = "autre@exemple.fr", ADMIN = "admin@exemple.fr";
const attendre = () => new Promise((ok) => setTimeout(ok, 3));

test("sans session : 401 partout, et rien n'est écrit", async () => {
  assert.equal((await lire(null, { liste: "1" })).code, 401);
  assert.equal((await lire(null, { ref: "FIDI-AV-TEST" })).code, 401);
  assert.equal((await enregistrer(null, avis())).code, 401);
  assert.equal(blobs.size, 0);
});

test("OPTIONS → 200, méthode inconnue → 405", async () => {
  assert.equal((await handler({ httpMethod: "OPTIONS", headers: {} })).statusCode, 200);
  assert.equal((await handler({ httpMethod: "DELETE", headers: {} })).statusCode, 405);
});

test("un avis avec photos lourdes revient intact (le cas que Notion tronquait)", async () => {
  const photo = "data:image/jpeg;base64," + "A".repeat(900_000);
  const data = avis(1, { bien: { photos: [{ dataUrl: photo }, { dataUrl: photo }] } });
  assert.equal((await enregistrer(AGENT, data)).code, 200);
  const r = await lire(AGENT, { ref: "FIDI-AV-TEST" });
  assert.equal(r.code, 200);
  assert.deepEqual(r.data, data);
  assert.equal(r.resume.client, "Client 1");
  assert.ok(r.maj);
});

test("avis trop volumineux : 413 avec un message clair, rien d'écrit", async () => {
  const r = await ecrire(AGENT, JSON.stringify({ action: "enregistrer", ref: "FIDI-AV-TEST", data: avis(), bourrage: "x".repeat(TAILLE_MAX) }));
  assert.equal(r.code, 413);
  assert.match(r.error, /photos/);
  assert.equal(blobs.size, 0);
});

test("référence, avis ou action invalides : 400", async () => {
  assert.equal((await ecrire(AGENT, { action: "enregistrer", ref: "../x", data: avis() })).code, 400);
  assert.equal((await ecrire(AGENT, { action: "enregistrer", ref: "A/B", data: avis() })).code, 400);
  assert.equal((await ecrire(AGENT, { action: "enregistrer", ref: "OK", data: [] })).code, 400);
  assert.equal((await ecrire(AGENT, { action: "enregistrer", ref: "OK", data: { sans: "metadata" } })).code, 400);
  assert.equal((await ecrire(AGENT, { action: "autre", ref: "OK" })).code, 400);
  assert.equal((await ecrire(AGENT, "pas du json")).code, 400);
  assert.equal((await lire(AGENT, { ref: "a b" })).code, 400);
  assert.equal((await lire(AGENT, { ref: "OK", version: "../../d/x" })).code, 400);
  assert.equal(blobs.size, 0);
});

test("enregistrement simple : pas de version ; l'avis courant est remplacé", async () => {
  await enregistrer(AGENT, avis(1));
  await enregistrer(AGENT, avis(2));
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-TEST" })).data.bien.surface, 2);
  assert.deepEqual((await lire(AGENT, { ref: "FIDI-AV-TEST", versions: "1" })).versions, []);
});

test("la version envoyée reste retrouvable après modification de l'avis", async () => {
  const envoi = await enregistrer(AGENT, avis(1), { motif: "pdf", libelle: "Envoyé au partenaire" });
  assert.equal(envoi.version.diffusee, true);
  await attendre();
  await enregistrer(AGENT, avis(2), { motif: "manuel" });
  await attendre();
  await enregistrer(AGENT, avis(3));

  const { versions } = await lire(AGENT, { ref: "FIDI-AV-TEST", versions: "1" });
  assert.deepEqual(versions.map((v) => v.motif), ["manuel", "pdf"], "la plus récente d'abord");
  assert.equal(versions[1].libelle, "Envoyé au partenaire");
  assert.equal(versions[1].auteur, AGENT);
  assert.equal(versions[1].valeur_max, 202000);

  const ancienne = await lire(AGENT, { ref: "FIDI-AV-TEST", version: envoi.version.id });
  assert.equal(ancienne.data.bien.surface, 1, "contenu figé au moment de l'envoi");
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-TEST" })).data.bien.surface, 3);
});

test("version manuelle identique à la dernière : pas de doublon ; version diffusée : toujours tracée", async () => {
  await enregistrer(AGENT, avis(1), { motif: "manuel" });
  await attendre();
  assert.equal((await enregistrer(AGENT, avis(1), { motif: "manuel" })).version, null);
  await attendre();
  assert.ok((await enregistrer(AGENT, avis(1), { motif: "partage" })).version);
  await attendre();
  const r = await enregistrer(AGENT, avis(1), { motif: "pdf" });
  assert.equal(r.diffusions, 2);
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-TEST", versions: "1" })).versions.length, 3);
});

test("motif inconnu : traité comme une version manuelle", async () => {
  const r = await enregistrer(AGENT, avis(1), { motif: "<script>" });
  assert.equal(r.version.motif, "manuel");
});

test("versions manuelles : seules les plus récentes sont gardées, les diffusées ne sont jamais élaguées", async () => {
  await enregistrer(AGENT, avis(0), { motif: "pdf" });
  for (let i = 1; i <= VERSIONS_MANUELLES_MAX + 3; i++) { await attendre(); await enregistrer(AGENT, avis(i), { motif: "manuel" }); }
  const { versions } = await lire(AGENT, { ref: "FIDI-AV-TEST", versions: "1" });
  assert.equal(versions.filter((v) => !v.diffusee).length, VERSIONS_MANUELLES_MAX);
  assert.equal(versions.filter((v) => v.diffusee).length, 1);
  assert.equal(versions[0].client, "Client " + (VERSIONS_MANUELLES_MAX + 3));
});

test("chaque compte ne voit et ne lit que ses avis, même avec le paramètre proprio", async () => {
  await enregistrer(AGENT, avis(1), { motif: "pdf" });
  await enregistrer(AUTRE, avis(9));
  const liste = await lire(AGENT, { liste: "1" });
  assert.equal(liste.documents.length, 1);
  assert.equal(liste.documents[0].client, "Client 1");
  assert.equal(liste.documents[0].diffusions, 1);
  const refus = await lire(AGENT, { ref: "FIDI-AV-TEST", proprio: "page-autre" });
  assert.equal(refus.data, undefined, "l'avis d'un autre compte n'est pas lu");
  assert.match(refus.error, /introuvable/);
  assert.equal((await lire(AUTRE, { ref: "FIDI-AV-TEST", versions: "1", proprio: "page-agent" })).versions, undefined);
  // Même référence chez deux comptes : deux avis distincts, aucun écrasement.
  assert.equal((await lire(AUTRE, { ref: "FIDI-AV-TEST" })).data.bien.surface, 9);
});

test("administrateur : voit tous les avis et peut ouvrir celui d'un autre compte", async () => {
  await enregistrer(AGENT, avis(1));
  await enregistrer(AUTRE, avis(9), undefined, "FIDI-AV-AUTRE");
  const liste = await lire(ADMIN, { liste: "1" });
  assert.equal(liste.admin, true);
  assert.deepEqual(liste.documents.map((d) => d.proprio).sort(), ["page-agent", "page-autre"]);
  assert.equal((await lire(ADMIN, { ref: "FIDI-AV-AUTRE", proprio: "page-autre" })).data.bien.surface, 9);
  assert.equal((await lire(ADMIN, { ref: "FIDI-AV-AUTRE" })).code, 404, "sans proprio : son propre espace");
});

test("suppression : possible sans diffusion, interdite dès qu'une version a été diffusée", async () => {
  await enregistrer(AGENT, avis(1), { motif: "manuel" });
  assert.equal((await ecrire(AGENT, { action: "supprimer", ref: "FIDI-AV-TEST" })).code, 200);
  assert.equal(blobs.size, 0);

  const v = await enregistrer(AGENT, avis(1), { motif: "facture" });
  const r = await ecrire(AGENT, { action: "supprimer", ref: "FIDI-AV-TEST" });
  assert.equal(r.code, 409);
  assert.equal(r.locked, true);
  assert.equal((await ecrire(AGENT, { action: "supprimer_version", ref: "FIDI-AV-TEST", id: v.version.id })).code, 409);
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-TEST" })).code, 200);
});

test("suppression d'une version manuelle : elle seule disparaît", async () => {
  const a = await enregistrer(AGENT, avis(1), { motif: "manuel" });
  await attendre();
  await enregistrer(AGENT, avis(2), { motif: "manuel" });
  assert.equal((await ecrire(AGENT, { action: "supprimer_version", ref: "FIDI-AV-TEST", id: a.version.id })).code, 200);
  const { versions } = await lire(AGENT, { ref: "FIDI-AV-TEST", versions: "1" });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].client, "Client 2");
});

test("avis ou version absents : 404", async () => {
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-ABSENT" })).code, 404);
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-ABSENT", version: "1700000000000-pdf" })).code, 404);
});

test("stockage en panne : 503 signalé, jamais un 200 trompeur", async () => {
  await enregistrer(AGENT, avis(1));
  panneListe = true;
  const r = await lire(AGENT, { liste: "1" });
  assert.equal(r.code, 503);
  assert.equal(r.blobs_error, true);
});

// ── Partage au sein d'un groupe (confidentialité des documents) ──────────────
const COLLEGUE = "collegue@exemple.fr";
const reglage = (email, r) => { Object.assign(COMPTES[email], { reseau: undefined, partage: undefined, avec: undefined }, r); };

test("partage au groupe : un membre du même groupe lit l'avis, sans pouvoir l'écrire ni le supprimer", async () => {
  reglage(AGENT, { reseau: "Agence Nord", partage: "Groupe" }); reglage(COLLEGUE, { reseau: "agence nord" }); reglage(AUTRE, { reseau: "Agence Sud" });
  await enregistrer(AGENT, avis(1));
  const liste = await lire(COLLEGUE, { liste: "1" });
  assert.deepEqual(liste.documents.map((d) => [d.proprio, d.a_moi, d.proprietaire]), [["page-agent", false, AGENT]]);
  assert.equal((await lire(COLLEGUE, { ref: "FIDI-AV-TEST", proprio: "page-agent" })).data.bien.surface, 1);
  // Écriture visant le compte d'un autre : elle retombe sur le compte de celui qui écrit, l'original est intact.
  await ecrire(COLLEGUE, { action: "enregistrer", ref: "FIDI-AV-TEST", proprio: "page-agent", data: avis(7), resume: {} });
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-TEST" })).data.bien.surface, 1, "l'avis du propriétaire n'est pas modifié");
  await ecrire(COLLEGUE, { action: "supprimer", ref: "FIDI-AV-TEST", proprio: "page-agent" });
  assert.equal((await lire(AGENT, { ref: "FIDI-AV-TEST" })).data.bien.surface, 1, "ni supprimé");
  // Un autre groupe ne voit rien, même avec l'identifiant du compte.
  assert.equal((await lire(AUTRE, { liste: "1" })).documents.length, 0);
  assert.equal((await lire(AUTRE, { ref: "FIDI-AV-TEST", proprio: "page-agent" })).code, 404);
  reglage(AGENT, {}); reglage(COLLEGUE, { reseau: "Agence Nord" }); reglage(AUTRE, {});
});

test("privé ou personnes choisies : seuls les membres désignés du groupe lisent", async () => {
  reglage(AGENT, { reseau: "Agence Nord", partage: "Privé" }); reglage(COLLEGUE, { reseau: "Agence Nord" });
  await enregistrer(AGENT, avis(1));
  assert.equal((await lire(COLLEGUE, { liste: "1" })).documents.length, 0, "privé : personne d'autre");
  assert.equal((await lire(COLLEGUE, { ref: "FIDI-AV-TEST", proprio: "page-agent" })).code, 404);
  reglage(AGENT, { reseau: "Agence Nord", partage: "Personnes choisies", avec: "quelquun@exemple.fr" });
  assert.equal((await lire(COLLEGUE, { liste: "1" })).documents.length, 0, "non désigné");
  reglage(AGENT, { reseau: "Agence Nord", partage: "Personnes choisies", avec: "quelquun@exemple.fr, collegue@exemple.fr" });
  assert.equal((await lire(COLLEGUE, { liste: "1" })).documents.length, 1, "désigné");
  // Désigné mais d'un autre groupe : jamais.
  reglage(AGENT, { reseau: "Agence Nord", partage: "Personnes choisies", avec: "autre@exemple.fr" }); reglage(AUTRE, { reseau: "Agence Sud" });
  assert.equal((await lire(AUTRE, { liste: "1" })).documents.length, 0);
  reglage(AGENT, {}); reglage(AUTRE, {});
});

test("client de l'écosystème public : l'administrateur ne liste pas ses avis, ne les ouvre pas et n'y écrit pas", async () => {
  COMPTES[AUTRE].ecosysteme = "Public";
  await enregistrer(AGENT, avis(1));
  await enregistrer(AUTRE, avis(9), undefined, "FIDI-AV-CLIENT");
  const liste = await lire(ADMIN, { liste: "1" });
  assert.deepEqual(liste.documents.map((d) => d.proprio), ["page-agent"], "seul le cercle interne est listé");
  assert.equal((await lire(ADMIN, { ref: "FIDI-AV-CLIENT", proprio: "page-autre" })).code, 404);
  assert.equal((await lire(ADMIN, { ref: "FIDI-AV-CLIENT", versions: "1", proprio: "page-autre" })).code, 404);
  assert.equal((await ecrire(ADMIN, { action: "supprimer", ref: "FIDI-AV-CLIENT", proprio: "page-autre" })).code, 404);
  assert.equal((await lire(AUTRE, { ref: "FIDI-AV-CLIENT" })).data.bien.surface, 9, "le client, lui, garde ses avis");
  assert.equal((await lire(ADMIN, { ref: "FIDI-AV-TEST", proprio: "page-agent" })).data.bien.surface, 1, "le cercle interne reste ouvert à l'administrateur");
  delete COMPTES[AUTRE].ecosysteme;
});
