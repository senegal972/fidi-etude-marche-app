// Facture détaillée de bout en bout : POST /api/facture (lignes, TVA de la charte, détail figé)
// puis rendu par GET /api/facture-html?t=<jeton> et aperçu POST /api/facture-html.
// Notion et Netlify Blobs sont simulés derrière un fetch ; aucun réseau réel.
import test, { after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "secret-de-test-seulement";
process.env.NOTION_TOKEN = "notion-de-test";
for (const k of ["NETLIFY_SITE_ID", "NETLIFY_AUTH_TOKEN", "NETLIFY_TOKEN", "NETLIFY_BLOBS_CONTEXT"]) delete process.env[k];

const { handler: creer } = await import("../netlify/functions/facture.mjs");
const { handler: rendu } = await import("../netlify/functions/facture-html.mjs");
const { signJWT } = await import("../netlify/functions/_auth.mjs");
const { renderFactureHTML, mentionsManquantes } = await import("../netlify/functions/_facture_doc.mjs");

const vraiFetch = globalThis.fetch;
const blobs = new Map();          // clé "store/clé" → JSON
const pagesCreees = [];
const numeros = ["FIDI-FAC-2026-007", "OD-FAC-2026-004"]; // factures existantes (suites distinctes)
const requetes = [];
const COMPTE = { id: "page-agent", email: "agent@exemple.fr" };

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.notion.com") {
    const corps = JSON.parse(options.body || "{}");
    if (u.pathname.endsWith("/query")) {
      requetes.push(corps);
      const debut = corps?.filter?.title?.starts_with;
      if (debut) {   // numérotation : dernière facture de la suite demandée
        const derniere = numeros.filter((n) => n.startsWith(debut)).sort().at(-1);
        return new Response(JSON.stringify({ results: derniere ? [{ properties: { "Numéro": { title: [{ plain_text: derniere }] } } }] : [] }), { status: 200 });
      }
      const email = corps?.filter?.title?.equals;
      if (email === COMPTE.email) {
        return new Response(JSON.stringify({ results: [{ id: COMPTE.id, properties: {
          "Email": { title: [{ plain_text: COMPTE.email }] }, "Nom": { rich_text: [{ plain_text: "Agent Démo" }] },
          "Statut": { select: { name: "Actif" } }, "Rôle": { select: { name: "Collaborateur" } } } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 }); // pas de doublon, pas de facture précédente
    }
    if (u.pathname.endsWith("/pages") && options.method === "POST") {
      pagesCreees.push(corps.properties);
      numeros.push(corps.properties["Numéro"].title[0].text.content);
      return new Response(JSON.stringify({ id: "page-facture-1" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }
  if (u.hostname === "edge.test") {
    // URL du client Blobs : /<site>/site:<store>/<clé>
    const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const cle = parts[1].replace(/^site:/, "") + "/" + parts.slice(2).join("/");
    if (options.method === "put") { blobs.set(cle, String(options.body)); return new Response(null, { status: 200 }); }
    const b = blobs.get(cle);
    return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
  }
  throw new Error("appel réseau inattendu : " + u.href);
};
after(() => { globalThis.fetch = vraiFetch; });

const contexte = Buffer.from(JSON.stringify({ url: "https://edge.test", token: "jeton-du-runtime" })).toString("base64");
const entetes = { "x-nf-site-id": "site", "x-nf-deploy-id": "deploy", host: "app.exemple.fr",
                  cookie: "fidi_session=" + signJWT({ email: COMPTE.email }) };
const charte = (facturation) => ({ enseigne: "Agence Démo", couleurs: { principale: "#263238" },
  coordonnees: { raisonSociale: "Agence Démo SAS", adresse: "1 rue des Tests, 97200 Fort-de-France", email: "contact@demo.fr" },
  facturation });
const poserCharte = (c) => blobs.set("fidi-marques/" + COMPTE.id, JSON.stringify(c));
const corps = {
  kind: "etude", ref: "FIDI-EM-20261114-97209", client: "Client <Test>", email_client: "client@exemple.fr",
  adresse: "12 rue Victor Hugo", montant: 1,
  facture: { lignes: [{ designation: "Étude de marché", quantite: 1, prixUnitaire: 450 },
                      { designation: "Visite", description: "Déplacement", quantite: 2, prixUnitaire: 60.5 }],
             mode: "quantite", prixSaisis: "TTC", remise: { type: "pct", valeur: 10 } },
  echeance_jours: 30, notes: "Merci de votre confiance", client_adresse: "5 avenue Client",
};
const appelCreer = (b) => creer({ httpMethod: "POST", headers: entetes, blobs: contexte, body: JSON.stringify(b) });

test("sans régime de TVA dans la charte : création refusée avec un message clair", async () => {
  poserCharte(charte({ siren: "000000000" }));
  const r = await appelCreer(corps);
  assert.equal(r.statusCode, 400);
  assert.equal(JSON.parse(r.body).need_regime, true);
  assert.equal(pagesCreees.length, 0);
});

test("TVA 8,5 % : totaux recalculés côté serveur, Notion et détail figé cohérents", async () => {
  poserCharte(charte({ siren: "000000000", registre: "RCS Fort-de-France 000 000 000", regimeTva: "assujetti", tauxTva: 8.5 }));
  const r = await appelCreer(corps);
  assert.equal(r.statusCode, 200, r.body);
  const j = JSON.parse(r.body);
  assert.equal(j.montant, 513.9, "le montant envoyé par le navigateur (1 €) est ignoré");
  assert.equal(j.libelle, "Étude de marché (+1 article)");
  const p = pagesCreees.at(-1);
  assert.equal(p["Montant HT"].number, 473.64);
  assert.equal(p["TVA"].number, 40.26);
  assert.equal(p["Montant TTC"].number, 513.9);
  const detail = JSON.parse(blobs.get("fidi-factures/" + j.token));
  assert.equal(detail.numero, j.ref);
  assert.equal(detail.emetteur.coordonnees.raisonSociale, "Agence Démo SAS");
  assert.equal(detail.facture.lignes.length, 2);
  assert.equal(detail.client.adresse, "5 avenue Client");
  assert.ok(detail.echeance > detail.date);

  // Rendu public par le jeton
  const h = await rendu({ httpMethod: "GET", headers: entetes, blobs: contexte, queryStringParameters: { ref: j.ref, t: j.token } });
  assert.equal(h.statusCode, 200);
  for (const attendu of ["Agence Démo SAS", "000000000", "TVA 8,5 %", "art. 296 du CGI", "513,90", "Visite", "Déplacement",
                          "Merci de votre confiance", "L441-10", "Client &lt;Test&gt;"]) {
    assert.ok(h.body.includes(attendu), "facture : « " + attendu + " » attendu");
  }
  assert.ok(!h.body.includes("Client <Test>"), "le nom du client doit être échappé");
  assert.ok(!h.body.includes("FIDI Conseil"), "aucune identité en dur sur une facture détaillée");
});

test("franchise en base : mention 293 B et TVA nulle", () => {
  const html = renderFactureHTML({ numero: "FIDI-FAC-2026-009", date: "2026-11-14", echeance: "2026-11-14",
    client: { nom: "A" }, facture: { lignes: [{ designation: "Avis", quantite: 1, prixUnitaire: 250 }], mode: "montant", tva: { regime: "franchise" } },
    emetteur: charte({ regimeTva: "franchise", siren: "1" }) });
  assert.ok(html.includes("TVA non applicable, art. 293 B du CGI"));
  assert.ok(html.includes("à réception"));
  assert.ok(!html.includes("art. 296"));
});

test("facture sans détail enregistré : rendu d'origine conservé", async () => {
  const h = await rendu({ httpMethod: "GET", headers: entetes, blobs: contexte,
    queryStringParameters: { ref: "FIDI-FAC-2025-001", t: "jeton-inconnu", montant: "250", kind: "avis" } });
  assert.equal(h.statusCode, 200);
  assert.ok(h.body.includes("FIDI-FAC-2025-001"));
});

test("aperçu : connexion requise, mentions manquantes signalées, rien n'est enregistré", async () => {
  const avant = blobs.size;
  const anonyme = await rendu({ httpMethod: "POST", headers: { host: "app.exemple.fr" }, body: "{}" });
  assert.equal(anonyme.statusCode, 401);
  const r = await rendu({ httpMethod: "POST", headers: entetes, body: JSON.stringify({
    date: "2026-11-14", facture: { lignes: [{ designation: "X", quantite: 1, prixUnitaire: 10 }] }, emetteur: { enseigne: "Démo" } }) });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes("mentions obligatoires à compléter"));
  assert.equal(blobs.size, avant);
  assert.deepEqual(mentionsManquantes({ enseigne: "Démo" }), ["adresse de l'émetteur", "SIREN / SIRET", "régime de TVA"]);
});

test("appel historique sans « facture » : comportement inchangé (une ligne, TVA 0)", async () => {
  const r = await appelCreer({ kind: "avis", ref: "", client: "B", montant: 250, libelle: "Avis de valeur" });
  assert.equal(r.statusCode, 200, r.body);
  const p = pagesCreees.at(-1);
  assert.equal(p["Montant TTC"].number, 250);
  assert.equal(p["TVA"].number, 0);
  assert.equal(p["Libellé"].rich_text[0].text.content, "Avis de valeur");
});

test("plusieurs sociétés : la société choisie émet, avec sa propre suite de numéros", async () => {
  const od = { id: "od1", raisonSociale: "OPTIMMO DOM", formeJuridique: "SASU", adresse: "483 Avenue Démo", siren: "799 493 408",
               registre: "RCS Fort-de-France 799 493 408", regimeTva: "assujetti", tauxTva: 8.5, prefixe: "OD-FAC", avecLogo: true };
  const kc = { id: "kc1", raisonSociale: "KAYOU CARAÏBES", formeJuridique: "SAS", adresse: "1 rue Kayou", siren: "111 222 333",
               regimeTva: "franchise", prefixe: "KC-FAC" };
  poserCharte({ ...charte({ regimeTva: "" }), logo: "data:image/png;base64,AAAA", emetteurs: [od, kc], emetteurDefaut: "od1" });

  const annee = new Date().getFullYear();
  const r1 = await appelCreer({ ...corps, ref: "REF-A", emetteur_id: "kc1" });
  assert.equal(r1.statusCode, 200, r1.body);
  const j1 = JSON.parse(r1.body);
  assert.equal(j1.ref, `KC-FAC-${annee}-001`, "première facture de la suite KAYOU");
  assert.equal(j1.montant, 513.9);
  const d1 = JSON.parse(blobs.get("fidi-factures/" + j1.token));
  assert.equal(d1.emetteur.coordonnees.raisonSociale, "KAYOU CARAÏBES");
  assert.equal(d1.emetteur.facturation.regimeTva, "franchise");
  assert.equal(d1.emetteur.logo, "", "le logo de la charte n'est pas apposé sur les factures d'une autre société");
  assert.equal(pagesCreees.at(-1)["TVA"].number, 0);

  const r2 = await appelCreer({ ...corps, ref: "REF-B" });           // société par défaut
  const j2 = JSON.parse(r2.body);
  assert.equal(j2.ref, `OD-FAC-${annee}-${annee === 2026 ? "005" : "001"}`, "suite OPTIMMO DOM continuée");
  const d2 = JSON.parse(blobs.get("fidi-factures/" + j2.token));
  assert.equal(d2.emetteur.logo, "data:image/png;base64,AAAA");
  assert.equal(d2.emetteur.facturation.siren, "799 493 408");

  const r3 = await appelCreer({ ...corps, ref: "REF-C", emetteur_id: "inconnu" });
  assert.equal(r3.statusCode, 400);
});

test("une prestation déjà facturée par une société ne peut pas reprendre son numéro pour une autre", async () => {
  const marque = JSON.parse(blobs.get("fidi-marques/" + COMPTE.id));
  // Doublon : la recherche par référence de dossier renvoie la facture OD existante.
  const vrai = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    const c = JSON.parse(options.body || "{}");
    if (u.hostname === "api.notion.com" && c?.filter?.property === "Référence dossier") {
      return new Response(JSON.stringify({ results: [{ id: "p-ex", properties: { "Numéro": { title: [{ plain_text: "OD-FAC-2026-005" }] },
        "Statut": { select: { name: "À payer" } }, "Jeton livraison": { rich_text: [{ plain_text: "tok-ex" }] } } }] }), { status: 200 });
    }
    return vrai(url, options);
  };
  try {
    const r = await appelCreer({ ...corps, ref: "REF-B", emetteur_id: "kc1" });
    assert.equal(r.statusCode, 409);
    assert.equal(JSON.parse(r.body).autre_emetteur, true);
  } finally { globalThis.fetch = vrai; }
  assert.ok(marque.emetteurs.length === 2);
});
