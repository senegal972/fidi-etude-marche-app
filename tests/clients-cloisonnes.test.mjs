// Carnet de clients, historique des factures d'un client et annulation : mêmes règles de confidentialité que les documents.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
const { signJWT } = await import("../netlify/functions/_auth.mjs");
const { DB } = await import("../netlify/functions/_notion.mjs");
const { handler: crm, PROP_COMPTE } = await import("../netlify/functions/crm-clients.mjs");
const { handler: historique } = await import("../netlify/functions/factures-client.mjs");
const { handler: annuler } = await import("../netlify/functions/facture-cancel.mjs");

const compte = (email, id, role, reseau, partage) => ({ id, properties: { "Email": { title: [{ plain_text: email }] }, "Nom": { rich_text: [{ plain_text: email }] }, "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: role } },
  "Réseau": { rich_text: [{ plain_text: reseau }] }, ...(partage ? { "Partage documents": { select: { name: partage } } } : {}) } });
let partageVoisin = "";
const comptes = () => ({ "agent@x.fr": compte("agent@x.fr", "u1", "Collaborateur", "Agence Nord"), "voisin@x.fr": compte("voisin@x.fr", "u2", "Collaborateur", "Agence Nord", partageVoisin),
  "ailleurs@x.fr": compte("ailleurs@x.fr", "u3", "Collaborateur", "Agence Sud", "Groupe"), "admin@x.fr": compte("admin@x.fr", "u4", "Administrateur", "") });
const contact = (nom, proprietaire) => ({ id: "c-" + nom, properties: { "Nom complet": { title: [{ plain_text: nom }] }, "Email": { email: nom.toLowerCase() + "@client.fr" }, ...(proprietaire ? { [PROP_COMPTE]: { rich_text: [{ plain_text: proprietaire }] } } : {}) } });
const facture = (numero, proprietaire, statut = "À payer") => ({ id: "f-" + numero, properties: { "Numéro": { title: [{ plain_text: numero }] }, "Client": { rich_text: [{ plain_text: "Mme Durand" }] }, "Statut": { select: { name: statut } },
  "Montant TTC": { number: 300 }, ...(proprietaire ? { "Propriétaire": { rich_text: [{ plain_text: proprietaire }] } } : {}) } });
const CONTACTS = [contact("Mien", "agent@x.fr"), contact("DuVoisin", "voisin@x.fr"), contact("Ailleurs", "ailleurs@x.fr"), contact("Origine", "")];
let factures = [];
let requetes = [], ecritures = [];

const vraiFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = String(url), corps = JSON.parse(options.body || "{}"), methode = String(options.method || "GET").toUpperCase();
  const rep = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes("/query")) {
    if (u.includes(String(DB.users))) {
      const email = corps?.filter?.title?.equals || corps?.filter?.rich_text?.equals || corps?.filter?.email?.equals || "";
      return rep({ results: email ? (comptes()[email] ? [comptes()[email]] : []) : Object.values(comptes()) });
    }
    requetes.push({ url: u, filtre: corps.filter || null });
    if (u.includes(String(DB.facture))) return rep({ results: factures });
    // Carnet : le filtre « ou » sur le compte est appliqué comme le ferait Notion.
    const ou = corps.filter && corps.filter.or && corps.filter.or[0] && corps.filter.or[0].property === PROP_COMPTE ? corps.filter.or.map((f) => f.rich_text.equals) : null;
    return rep({ results: ou ? CONTACTS.filter((c) => ou.includes((c.properties[PROP_COMPTE]?.rich_text || [{}])[0].plain_text)) : CONTACTS });
  }
  if (u.includes("/databases/")) return rep({ id: "base", properties: { [PROP_COMPTE]: { rich_text: {} }, "Propriétaire": { rich_text: {} } } });
  if (u.includes("/pages")) { ecritures.push({ methode, corps }); return rep({ id: "p1", url: "u", properties: corps.properties || {} }); }
  return rep({});
};
after(() => { globalThis.fetch = vraiFetch; });
const session = (email) => ({ cookie: "fidi_session=" + signJWT({ email }) });
const noms = (r) => JSON.parse(r.body).items.map((c) => c.nom || c.ref).sort();

test("carnet de clients : chacun les siens ; ceux d'un collègue seulement s'il ouvre ses documents ; jamais un autre groupe ni le carnet d'origine", async () => {
  partageVoisin = "";
  assert.deepEqual(noms(await crm({ httpMethod: "GET", headers: session("agent@x.fr") })), ["Mien"]);
  partageVoisin = "Groupe";
  assert.deepEqual(noms(await crm({ httpMethod: "GET", headers: session("agent@x.fr") })), ["DuVoisin", "Mien"]);
  partageVoisin = "";
  assert.deepEqual(noms(await crm({ httpMethod: "GET", headers: session("admin@x.fr") })), ["Ailleurs", "DuVoisin", "Mien", "Origine"], "l'administrateur voit tout");
  assert.equal((await crm({ httpMethod: "GET", headers: {} })).statusCode, 401);
});

test("carnet : la requête elle-même est restreinte aux comptes visibles, et un contact créé est rattaché à son auteur", async () => {
  requetes = []; partageVoisin = "Groupe";
  await crm({ httpMethod: "GET", headers: session("agent@x.fr") });
  assert.deepEqual(requetes[0].filtre.or.map((f) => f.rich_text.equals).sort(), ["agent@x.fr", "voisin@x.fr"]);
  partageVoisin = ""; ecritures = [];
  const r = await crm({ httpMethod: "POST", headers: session("agent@x.fr"), body: JSON.stringify({ nom: "Nouveau Client" }) });
  assert.equal(r.statusCode, 200);
  assert.equal(ecritures[0].corps.properties[PROP_COMPTE].rich_text[0].text.content, "agent@x.fr");
});

test("historique des factures d'un client : seulement celles des comptes visibles ; sans compte émetteur : administrateur", async () => {
  factures = [facture("A-1", "agent@x.fr"), facture("V-1", "voisin@x.fr"), facture("S-1", "ailleurs@x.fr"), facture("ANC-1", "")];
  const q = { httpMethod: "GET", queryStringParameters: { client: "Durand" } };
  partageVoisin = "";
  assert.deepEqual(noms(await historique({ ...q, headers: session("agent@x.fr") })), ["A-1"]);
  partageVoisin = "Groupe";
  assert.deepEqual(noms(await historique({ ...q, headers: session("agent@x.fr") })), ["A-1", "V-1"]);
  partageVoisin = "";
  assert.deepEqual(noms(await historique({ ...q, headers: session("admin@x.fr") })), ["A-1", "ANC-1", "S-1", "V-1"]);
  assert.equal(JSON.parse((await historique({ ...q, headers: session("agent@x.fr") })).body).count, 1, "les totaux suivent le filtre");
});

test("annuler une facture : son émetteur ou l'administrateur — un partage ne donne que la lecture", async () => {
  const demande = (email, f) => { factures = [f]; ecritures = []; return annuler({ httpMethod: "POST", headers: session(email), body: JSON.stringify({ ref: "X", motif: "essai" }) }); };
  partageVoisin = "Groupe";
  assert.equal((await demande("agent@x.fr", facture("V-1", "voisin@x.fr"))).statusCode, 404, "facture d'un collègue, même partagée");
  assert.equal(ecritures.length, 0);
  assert.equal((await demande("agent@x.fr", facture("ANC-1", ""))).statusCode, 404, "facture sans compte émetteur");
  assert.equal((await demande("agent@x.fr", facture("A-1", "agent@x.fr"))).statusCode, 200);
  assert.equal((await demande("admin@x.fr", facture("V-1", "voisin@x.fr"))).statusCode, 200);
  partageVoisin = "";
});

test("une nouvelle facture porte le compte qui l'émet ; l'ancien cache du carnet est abandonné", () => {
  const src = readFileSync(new URL("../netlify/functions/facture.mjs", import.meta.url), "utf8");
  assert.match(src, /\[PROP_PROPRIETAIRE\]: P\.text\(String\(me\.user\.email \|\| ""\)\.toLowerCase\(\)\)/);
  assert.match(src, /avecCompte \? \{/, "sans la colonne, la facture est créée quand même");
  const avis = readFileSync(new URL("../avis-valeur.js", import.meta.url), "utf8");
  assert.match(avis, /fidi:crm:cache:clients:v2/); assert.match(avis, /removeItem\('fidi:crm:cache:clients'\)/);
});
