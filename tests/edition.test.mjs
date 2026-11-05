// Débit à l'édition : pas de PDF serveur sans crédit ou droit de ré-édition, un rendu échoué
// ne coûte rien, et /api/consume applique la même règle. Aucun réseau réel, Chromium non lancé :
// Notion est simulé en mémoire et le rendu est injecté dans traiter().
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";

const { traiter } = await import("../netlify/functions/pdf-render.mjs");
const { handler: consume } = await import("../netlify/functions/consume.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");
const { DB } = await import("../netlify/functions/_notion.mjs");
const { REEDITION_JOURS, REEDITION_RENDUS } = await import("../netlify/functions/_edition.mjs");

const vraiFetch = globalThis.fetch;
let u, lignes, pannes, ecrituresUser;

const texte = (p) => (p?.title || p?.rich_text || []).map((t) => t.text?.content ?? t.plain_text ?? "").join("");

function pageUser() {
  return {
    id: "user-1",
    properties: {
      "Email": { title: [{ plain_text: "agent@exemple.fr" }] },
      "Statut": { select: { name: "Actif" } },
      "Rôle": { select: { name: u.role } },
      "Crédits": { number: u.credits },
      "Recherches utilisées": { number: u.recherches },
      "Dernière réf éditée": { rich_text: u.derniere ? [{ plain_text: u.derniere }] : [] },
      "Illimité": { checkbox: !!u.illimite },
    },
  };
}

globalThis.fetch = async (url, init = {}) => {
  const chemin = String(url).replace("https://api.notion.com/v1", "");
  const corps = init.body ? JSON.parse(init.body) : {};
  const ok = (o) => new Response(JSON.stringify(o), { status: 200 });

  if (chemin === `/databases/${DB.users}/query`) {
    if (pannes.lectureUser) return new Response("{}", { status: 500 });
    if (u.avantLecture) { const f = u.avantLecture; u.avantLecture = null; f(); }
    return ok({ results: [pageUser()] });
  }
  if (chemin === `/databases/${DB.editions}/query`) {
    if (pannes.lectureJournal) return new Response("{}", { status: 500 });
    const titre = corps.filter.and[0].title.equals;
    const user = corps.filter.and[1].relation.contains;
    return ok({ results: lignes.filter((l) => texte(l.properties["Clé"]) === titre && l.user === user) });
  }
  if (chemin === "/pages" && init.method === "POST") {
    if (pannes.journal) return new Response("{}", { status: 500 });
    const l = { id: "ligne-" + (lignes.length + 1), user: corps.properties["Utilisateur"].relation[0].id, properties: corps.properties };
    lignes.push(l);
    return ok(l);
  }
  if (chemin === "/pages/user-1" && init.method === "PATCH") {
    if (pannes.debit) return new Response("{}", { status: 500 });
    ecrituresUser++;
    const p = corps.properties;
    if (p["Crédits"]) u.credits = p["Crédits"].number;
    if (p["Recherches utilisées"]) u.recherches = p["Recherches utilisées"].number;
    if (p["Dernière réf éditée"]) u.derniere = texte(p["Dernière réf éditée"]);
    return ok(pageUser());
  }
  if (chemin.startsWith("/pages/ligne-") && init.method === "PATCH") {
    if (pannes.journal) return new Response("{}", { status: 500 });
    const l = lignes.find((x) => "/pages/" + x.id === chemin);
    Object.assign(l.properties, corps.properties);
    return ok(l);
  }
  throw new Error("appel réseau inattendu : " + chemin);
};
after(() => { globalThis.fetch = vraiFetch; });

beforeEach(() => {
  process.env.PAYWALL_ENABLED = "true";
  u = { role: "Collaborateur", credits: 2, recherches: 3, derniere: "", illimite: false, avantLecture: null };
  lignes = [];
  pannes = {};
  ecrituresUser = 0;
});

const entetes = { authorization: "Bearer " + signJWT({ email: "agent@exemple.fr" }) };
const docA = { kind: "etude", cle: "E-97213-AAA", ref: "FIDI-EM-20261104-97213" };
const docB = { kind: "etude", cle: "E-97213-BBB", ref: "FIDI-EM-20261104-97213" };

let rendus;
const rendreOk = async () => { rendus++; return Buffer.from("%PDF-test"); };
async function rendre(doc, fonction = rendreOk) {
  const body = JSON.stringify({ html: "<p>x</p>", doc });
  return traiter({ httpMethod: "POST", headers: entetes, body }, fonction);
}
const imprimer = (doc) => consume({ httpMethod: "POST", headers: entetes, body: JSON.stringify(doc) });
beforeEach(() => { rendus = 0; });

test("péage inactif : PDF sans débit, sans clé de document et sans lecture du journal", async () => {
  process.env.PAYWALL_ENABLED = "false";
  const r = await rendre(undefined);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["X-Fidi-Facture"], "0");
  assert.equal(u.credits, 2);
  assert.equal(lignes.length, 0);
});

test("compte illimité et administrateur : jamais débités", async () => {
  u.illimite = true;
  assert.equal((await rendre(docA)).headers["X-Fidi-Facture"], "0");
  u.illimite = false; u.role = "Administrateur";
  assert.equal((await rendre(docA)).headers["X-Fidi-Facture"], "0");
  assert.equal(u.credits, 2);
  assert.equal(lignes.length, 0);
});

test("appel direct sans clé de document, compte facturable : 400, rien de rendu", async () => {
  const r = await rendre(undefined);
  assert.equal(r.statusCode, 400);
  assert.equal(rendus, 0);
  assert.equal((await rendre({ kind: "etude", cle: "x y<" })).statusCode, 400);
  assert.equal((await rendre({ kind: "autre", cle: "abc" })).statusCode, 400);
  assert.equal(u.credits, 2);
});

test("premier rendu : 1 crédit, compteur d'essais remis à zéro, journal écrit, en-têtes lisibles", async () => {
  const r = await rendre(docA);
  assert.equal(r.statusCode, 200);
  assert.equal(r.isBase64Encoded, true);
  assert.equal(r.headers["X-Fidi-Facture"], "1");
  assert.equal(r.headers["X-Fidi-Credits"], "1");
  assert.equal(u.credits, 1);
  assert.equal(u.recherches, 0);
  assert.equal(u.derniere, "etude:E-97213-AAA");
  assert.equal(ecrituresUser, 1, "solde, compteur et clé en une seule écriture");
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].properties["Crédits débités"].number, 1);
  assert.equal(lignes[0].properties["Rendus"].number, 1);
});

test("ré-édition du même document : gratuite, compteur d'essais intact, rendu compté", async () => {
  await rendre(docA);
  u.recherches = 4;
  const r = await rendre(docA);
  assert.equal(r.headers["X-Fidi-Facture"], "0");
  assert.equal(u.credits, 1);
  assert.equal(u.recherches, 4);
  assert.equal(lignes[0].properties["Rendus"].number, 2);
});

test("A, puis B, puis A : A n'est pas facturé deux fois", async () => {
  await rendre(docA);
  await rendre(docB);
  assert.equal(u.credits, 0);
  const r = await rendre(docA);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["X-Fidi-Facture"], "0");
  assert.equal(u.credits, 0);
});

test("même réf affichée mais clé différente : deux documents, deux crédits", async () => {
  assert.equal(docA.ref, docB.ref);
  await rendre(docA);
  assert.equal((await rendre(docB)).headers["X-Fidi-Facture"], "1");
  assert.equal(u.credits, 0);
});

test("même clé pour une étude et un avis : deux documents distincts", async () => {
  await rendre({ kind: "etude", cle: "X-1", ref: "r" });
  assert.equal((await rendre({ kind: "avis", cle: "X-1", ref: "r" })).headers["X-Fidi-Facture"], "1");
});

test("plafond de rendus atteint : nouveau crédit, puis droit rouvert", async () => {
  await rendre(docA);
  lignes[0].properties["Rendus"] = { number: REEDITION_RENDUS };
  const r = await rendre(docA);
  assert.equal(r.headers["X-Fidi-Facture"], "1");
  assert.equal(u.credits, 0);
  assert.equal(lignes.length, 1, "pas de seconde ligne pour le même document");
  assert.equal(lignes[0].properties["Rendus"].number, 1);
  assert.equal(lignes[0].properties["Crédits débités"].number, 2);
  assert.equal((await rendre(docA)).headers["X-Fidi-Facture"], "0");
});

test("droit échu : nouveau crédit, même si la dernière clé est ce document", async () => {
  await rendre(docA);
  const vieux = new Date(Date.now() - (REEDITION_JOURS + 1) * 86400000).toISOString();
  lignes[0].properties["Débité le"] = { date: { start: vieux } };
  assert.equal((await rendre(docA)).headers["X-Fidi-Facture"], "1");
  assert.equal(u.credits, 0);
});

test("0 crédit : 402 sans lancer le rendu", async () => {
  u.credits = 0;
  const r = await rendre(docA);
  assert.equal(r.statusCode, 402);
  assert.equal(JSON.parse(r.body).need_credits, true);
  assert.equal(rendus, 0);
});

test("0 crédit mais ré-édition encore ouverte : le PDF reste possible", async () => {
  u.credits = 1;
  await rendre(docA);
  assert.equal(u.credits, 0);
  assert.equal((await rendre(docA)).statusCode, 200);
});

test("rendu échoué : 500, aucun débit, aucune écriture", async () => {
  const r = await rendre(docA, async () => { throw new Error("Chromium absent"); });
  assert.equal(r.statusCode, 500);
  assert.equal(u.credits, 2);
  assert.equal(ecrituresUser, 0);
  assert.equal(lignes.length, 0);
});

test("débit impossible : 503 et pas de PDF", async () => {
  pannes.debit = true;
  const r = await rendre(docA);
  assert.equal(r.statusCode, 503);
  assert.equal(r.isBase64Encoded, undefined);
  assert.equal(rendus, 1);
});

test("journal illisible : 503 avant le rendu, on ne facture pas à l'aveugle", async () => {
  pannes.lectureJournal = true;
  assert.equal((await rendre(docA)).statusCode, 503);
  assert.equal(rendus, 0);
  assert.equal(u.credits, 2);
});

test("solde vidé pendant le rendu : 402 et pas de PDF", async () => {
  u.credits = 1;
  const r = await rendre(docA, async () => {
    u.avantLecture = () => { u.credits = 0; };
    return Buffer.from("%PDF");
  });
  assert.equal(r.statusCode, 402);
  assert.equal(r.isBase64Encoded, undefined);
  assert.equal(lignes.length, 0);
});

test("journal en échec après débit : PDF livré, la dernière clé garde la ré-édition gratuite", async () => {
  pannes.journal = true;
  const r = await rendre(docA);
  assert.equal(r.statusCode, 200);
  assert.equal(u.credits, 1);
  pannes.journal = false;
  const encore = await rendre(docA);
  assert.equal(encore.headers["X-Fidi-Facture"], "0");
  assert.equal(u.credits, 1);
  assert.equal(lignes.length, 1, "la ligne manquante est recréée");
});

test("impression puis PDF serveur du même document : un seul crédit", async () => {
  const a = JSON.parse((await imprimer(docA)).body);
  assert.equal(a.facture, true);
  assert.equal(a.credits_restants, 1);
  assert.equal((await rendre(docA)).headers["X-Fidi-Facture"], "0");
  assert.equal(u.credits, 1);
});

test("PDF serveur puis impression du même document : un seul crédit", async () => {
  await rendre(docA);
  const a = JSON.parse((await imprimer(docA)).body);
  assert.equal(a.facture, false);
  assert.equal(a.raison, "deja_edite");
  assert.equal(u.credits, 1);
});

test("consume : 402 à 0 crédit, 400 sans clé, gratuit sans péage", async () => {
  assert.equal((await imprimer({ kind: "etude", ref: "x" })).statusCode, 400);
  u.credits = 0;
  const r = await imprimer(docA);
  assert.equal(r.statusCode, 402);
  assert.equal(JSON.parse(r.body).need_credits, true);
  process.env.PAYWALL_ENABLED = "false";
  const libre = JSON.parse((await imprimer({ kind: "etude", ref: "x" })).body);
  assert.equal(libre.ok, true);
  assert.equal(libre.raison, "peage_inactif");
});

const extrait = (doc) => imprimer({ ...doc, extrait: true });

test("extrait d'une étude non payée : 1 crédit, et l'étude est alors payée", async () => {
  const a = JSON.parse((await extrait(docA)).body);
  assert.equal(a.facture, true);
  assert.equal(u.credits, 1);
  assert.equal((await rendre(docA)).headers["X-Fidi-Facture"], "0");
  assert.equal(u.credits, 1);
});

test("extrait d'une étude déjà payée : gratuit, sans user le droit aux 10 rendus", async () => {
  await rendre(docA);
  for (let i = 0; i < REEDITION_RENDUS + 2; i++) {
    assert.equal(JSON.parse((await extrait(docA)).body).facture, false);
  }
  assert.equal(u.credits, 1);
  assert.equal(lignes[0].properties["Rendus"].number, 1);
});

test("extrait : reste gratuit quand les 10 rendus de l'étude payée sont épuisés", async () => {
  await rendre(docA);
  lignes[0].properties["Rendus"] = { number: REEDITION_RENDUS };
  assert.equal(JSON.parse((await extrait(docA)).body).facture, false);
  assert.equal(u.credits, 1);
});

test("extrait : 1 crédit après 30 jours, et 402 à 0 crédit sur une étude non payée", async () => {
  await rendre(docA);
  const vieux = new Date(Date.now() - (REEDITION_JOURS + 1) * 86400000).toISOString();
  lignes[0].properties["Débité le"] = { date: { start: vieux } };
  assert.equal(JSON.parse((await extrait(docA)).body).facture, true);
  assert.equal(u.credits, 0);
  assert.equal((await extrait(docB)).statusCode, 402);
});

test("extrait : une autre étude n'est pas couverte, et le drapeau ne touche que consume", async () => {
  await rendre(docA);
  assert.equal(JSON.parse((await extrait(docB)).body).facture, true);
  lignes[0].properties["Rendus"] = { number: REEDITION_RENDUS };
  u.credits = 1;
  const body = JSON.stringify({ html: "<p>x</p>", doc: { ...docA, extrait: true } });
  const r = await traiter({ httpMethod: "POST", headers: entetes, body }, rendreOk);
  assert.equal(r.headers["X-Fidi-Facture"], "1", "le PDF complet reste plafonné");
});

test("garde-fou : le débit suit le rendu, et 0 crédit coupe avant Chromium", () => {
  const src = readFileSync(new URL("../netlify/functions/pdf-render.mjs", import.meta.url), "utf8");
  const h = src.slice(src.indexOf("export async function traiter"), src.indexOf("async function rendrePdf"));
  assert.ok(h.indexOf("deciderEdition(") < h.indexOf("rendre(options)"));
  assert.ok(h.indexOf("rendre(options)") < h.indexOf("enregistrerEdition("));
});
