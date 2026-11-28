// Confidentialité des documents : règles (_documents.mjs), réglage par compte, branchements de l'écran « Mes documents ».
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test-suffisamment-long-0123456789";
const D = await import("../netlify/functions/_documents.mjs");
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const c = (email, groupe, partage = "prive", avec = [], role = "Collaborateur") => ({ id: "id-" + email, email, nom: email, role, statut: "Actif", groupe, partage, avec });
const MOI = c("moi@x.fr", "Agence Nord");

test("peutVoir : soi-même, administrateur, groupe, personnes choisies — jamais d'un groupe à l'autre", () => {
  assert.equal(D.peutVoir(MOI, c("moi@x.fr", "Agence Nord")), true, "mes documents");
  assert.equal(D.peutVoir(c("admin@x.fr", "", "prive", [], "Administrateur"), c("a@x.fr", "Autre")), true, "l'administrateur voit tout");
  assert.equal(D.peutVoir(c("admin@x.fr", "", "prive", [], "Administrateur"), null), true, "y compris un dossier sans propriétaire");
  assert.equal(D.peutVoir(MOI, null), false, "dossier sans propriétaire : pas pour un compte ordinaire");
  assert.equal(D.peutVoir(MOI, c("a@x.fr", "Agence Nord", "prive")), false);
  assert.equal(D.peutVoir(MOI, c("a@x.fr", "agence  nord", "groupe")), true, "même groupe, casse et espaces indifférents");
  assert.equal(D.peutVoir(MOI, c("a@x.fr", "Agence Sud", "groupe")), false, "autre groupe");
  assert.equal(D.peutVoir(MOI, c("a@x.fr", "", "groupe")), false, "sans groupe : aucun partage");
  assert.equal(D.peutVoir(c("moi@x.fr", ""), c("a@x.fr", "", "groupe")), false, "deux comptes sans groupe ne forment pas un groupe");
  assert.equal(D.peutVoir(MOI, c("a@x.fr", "Agence Nord", "choisi", ["autre@x.fr"])), false);
  assert.equal(D.peutVoir(MOI, c("a@x.fr", "Agence Nord", "choisi", ["MOI@x.fr"])), true);
  assert.equal(D.peutVoir(MOI, c("a@x.fr", "Agence Sud", "choisi", ["moi@x.fr"])), false, "désigné mais d'un autre groupe");
  assert.equal(D.peutVoir(null, MOI), false);
});

test("peutModifier : le propriétaire et l'administrateur seulement", () => {
  assert.equal(D.peutModifier(MOI, "moi@x.fr"), true);
  assert.equal(D.peutModifier(MOI, "a@x.fr"), false, "un partage ne donne que la lecture");
  assert.equal(D.peutModifier(MOI, ""), false, "dossier sans propriétaire");
  assert.equal(D.peutModifier(c("admin@x.fr", "", "prive", [], "Administrateur"), ""), true);
});

test("assainirPartage : le partage reste dans le groupe du compte", () => {
  const comptes = [MOI, c("a@x.fr", "Agence Nord"), c("b@x.fr", "Agence Sud")];
  assert.deepEqual(D.assainirPartage(MOI, { mode: "groupe" }, comptes).valeur, { mode: "groupe", avec: [] });
  assert.deepEqual(D.assainirPartage(MOI, { mode: "choisi", avec: ["A@x.fr", "a@x.fr"] }, comptes).valeur, { mode: "choisi", avec: ["a@x.fr"] });
  assert.equal(D.assainirPartage(MOI, { mode: "choisi", avec: ["b@x.fr"] }, comptes).ok, false, "personne d'un autre groupe refusée");
  assert.equal(D.assainirPartage(c("seul@x.fr", ""), { mode: "groupe" }, comptes).ok, false, "sans groupe : pas de partage");
  assert.deepEqual(D.assainirPartage(c("seul@x.fr", ""), { mode: "prive" }, comptes).valeur, { mode: "prive", avec: [] });
  assert.equal(D.assainirPartage(MOI, { mode: "n'importe quoi" }, comptes).valeur.mode, "prive", "valeur inconnue : privé");
});

test("lecture du réglage dans la fiche du compte : privé par défaut", () => {
  assert.deepEqual(D.lirePartage({}), { mode: "prive", avec: [] });
  assert.equal(D.lirePartage({ "Partage documents": { select: { name: "Groupe" } } }).mode, "groupe");
  const r = D.lirePartage({ "Partage documents": { select: { name: "Personnes choisies" } }, "Partage avec": { rich_text: [{ plain_text: "a@x.fr, B@x.fr ; pas-une-adresse" }] } });
  assert.deepEqual(r, { mode: "choisi", avec: ["a@x.fr", "b@x.fr"] });
  assert.deepEqual(D.comptesVisibles(MOI, [MOI, c("a@x.fr", "Agence Nord", "groupe"), c("b@x.fr", "Agence Sud", "groupe")]).map((x) => x.email), ["moi@x.fr", "a@x.fr"]);
});

test("/api/documents : session exigée ; attribution réservée à l'administrateur", async () => {
  const R = await import("../netlify/functions/documents.mjs");
  assert.equal((await R.handler({ httpMethod: "GET", headers: {} })).statusCode, 401);
  const src = lire("netlify/functions/documents.mjs");
  assert.ok(src.indexOf("currentUser(event)") < src.indexOf("chargerComptes()"));
  assert.match(src, /if \(!admin\) return authResp\(403/);
});

test("les quatre routes des dossiers et les avis en ligne appliquent les règles", () => {
  for (const f of ["notion-list", "notion-get", "notion-delete", "notion-save", "avis-store"]) assert.match(lire(`netlify/functions/${f}.mjs`), /from "\.\/_documents\.mjs"/, f);
  assert.match(lire("netlify/functions/notion-get.mjs"), /if \(!acces\.voir\) return jsonResp\(404/);
  assert.match(lire("netlify/functions/notion-delete.mjs"), /peutModifier\(lecteur, proprietaireDePage\(dossier\)\)/);
  assert.match(lire("netlify/functions/notion-save.mjs"), /props\[PROP_PROPRIETAIRE\] = P\.text\(proprietaire \|\| lecteur\.email\)/);
});

test("écran : un seul bouton « Mes documents », module chargé, réglages de l'administrateur", () => {
  const page = lire("index.html");
  assert.match(page, /id="ddDocs" onclick="FidiDocuments\.ouvrir\(\)"/);
  assert.match(page, /mes-documents\.js/); assert.match(page, /mes-documents\.css/);
  assert.match(page, /id="adPartage"/); assert.match(page, /id="fcPartage"/);
  const js = lire("mes-documents.js");
  assert.doesNotMatch(js, /style="/);
  for (const m of ["Les miens", "Mon groupe", "Tous les comptes", "Qui peut voir mes documents"]) assert.ok(js.includes(m), m);
});
