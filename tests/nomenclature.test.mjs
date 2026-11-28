// Nomenclature : initiales de l'auteur (2 lettres du nom + 2 du prénom) à la place de « FIDI », à l'affichage seulement.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const window = {}; new Function("window", lire("nomenclature.js"))(window);
const N = window.FidiNomenclature;

test("initiales : deux lettres du nom puis deux lettres du prénom", () => {
  assert.equal(N.initiales("Laura Fidi"), "FILA");
  assert.equal(N.initiales("Fred Ibené"), "IBFR");
  assert.equal(N.initiales("FIDI Laura"), "FILA", "nom écrit en capitales en premier");
  assert.equal(N.initiales("Élodie Été"), "ETEL", "accents retirés");
  assert.equal(N.initiales("Jean-Pierre de La Tour"), "TOJE");
  assert.equal(N.initiales("Admin"), "ADMI");
  assert.equal(N.initiales("quelqu.un@exemple.fr"), "", "une adresse e-mail n'est pas un nom");
  assert.equal(N.initiales(""), "");
});

test("référence affichée : seul le préfixe change, et seulement pour une étude ou un avis", () => {
  assert.equal(N.afficher("FIDI-EM-20261128-DUPONT-97209", "Laura Fidi"), "FILA-EM-20261128-DUPONT-97209");
  assert.equal(N.afficher("FIDI-AV-1X2Y3Z", "Fred Ibené"), "IBFR-AV-1X2Y3Z");
  assert.equal(N.afficher("FIDI-AV-1X2Y3Z", ""), "FIDI-AV-1X2Y3Z", "auteur inconnu : référence inchangée");
  assert.equal(N.afficher("FIDI-FAC-2026-001", "Laura Fidi"), "FIDI-FAC-2026-001", "les factures gardent leur numéro");
  assert.equal(N.afficher(null, "Laura Fidi"), "");
});

test("la clé enregistrée ne change pas : les références sont toujours fabriquées en FIDI-EM / FIDI-AV", () => {
  assert.match(lire("index.html"), /return 'FIDI-EM-' \+ day/);
  assert.match(lire("avis-valeur.js"), /return 'FIDI-AV-' \+ hashStr\(k\)/);
});

test("branchements : listes, rapport, avis, et nom de l'auteur renvoyé par le serveur", () => {
  const html = lire("index.html");
  assert.ok(html.indexOf('<script src="/nomenclature.js"></script>') > 0 && html.indexOf("/nomenclature.js") < html.indexOf("/carte-parcelle.js"));
  assert.match(lire("mes-documents.js"), /esc\(nomRef\(d\)\)/);
  assert.match(lire("avis-dossiers.js"), /esc\(nomRef\(d\)\)/);
  assert.match(lire("rapport-a4.js"), /FidiNomenclature\.afficher\(refCle/);
  assert.match(lire("avis-valeur.js"), /refAff\(data\.metadata\.ref, data\.metadata\.auteur\)/);
  assert.match(lire("netlify/functions/notion-get.mjs"), /proprietaire_nom: acces\.nom/);
});

// ── Document d'un autre compte : identité de l'auteur, mention de la personne qui édite ──
test("charte de l'auteur : seulement pour qui peut voir ses documents, sans coordonnées bancaires", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test-suffisamment-long-0123456789";
  const M = await import("../netlify/functions/marque.mjs");
  const admin = { email: "admin@exemple.fr", role: "Administrateur", groupe: "", ecosysteme: "interne" };
  const collegue = { email: "col@exemple.fr", role: "Collaborateur", groupe: "Agence", ecosysteme: "interne" };
  const comptes = [
    { id: "1", email: "laura@exemple.fr", nom: "Laura Fidi", role: "Collaborateur", groupe: "Agence", partage: "prive", ecosysteme: "interne" },
    { id: "2", email: "client@exemple.fr", nom: "Client Public", role: "Collaborateur", groupe: "", partage: "prive", ecosysteme: "public" },
  ];
  assert.equal(M.compteAuteur(admin, comptes, "Laura@exemple.fr").id, "1", "l'administrateur ressort le document d'un collaborateur");
  assert.equal(M.compteAuteur(admin, comptes, "client@exemple.fr"), null, "jamais la charte d'un client public");
  assert.equal(M.compteAuteur(collegue, comptes, "laura@exemple.fr"), null, "documents privés : pas de charte non plus");
  assert.equal(M.compteAuteur(admin, comptes, "inconnu@exemple.fr"), null);
  const m = M.sansBanque({ enseigne: "Agence", emetteurs: [{ id: "a", raisonSociale: "Agence SARL", iban: "FR7630006000011234567890189", bic: "AGRIFRPP", titulaire: "Agence" }] });
  assert.equal(m.emetteurs[0].raisonSociale, "Agence SARL");
  assert.ok(!("iban" in m.emetteurs[0]) && !("bic" in m.emetteurs[0]) && !("titulaire" in m.emetteurs[0]));
});

test("branchements : étude et avis d'un autre compte chargent la charte de leur auteur ; mention d'édition imprimée", () => {
  assert.match(lire("index.html"), /Marque\.chargerAuteur\('etude:' \+ d\.__auteurEmail/);
  assert.match(lire("avis-dossiers.js"), /Marque\.chargerAuteur\('avis:' \+ d\.ref, d\.emailAuteur/);
  assert.match(lire("avis-valeur.js"), /Marque\.mentionEdition\(cleAuteur\(\)/);
  assert.match(lire("rapport-a4.js"), /Marque\.mentionEdition\(null/);
  assert.match(lire("marque.js"), /'Réalisé par ' \+ auteur \+ ' — édité le '/);
});
