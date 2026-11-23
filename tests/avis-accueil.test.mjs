// Accueil de l'avis de valeur : lien avec l'étude de marché et destinataire demandé dès la création.
// Le comportement réel se vérifie dans un navigateur ; ces tests gardent les branchements.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../avis-valeur.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../avis-valeur.css", import.meta.url), "utf8");
const mob = readFileSync(new URL("../mobile.css", import.meta.url), "utf8");
const entre = (a, b) => js.slice(js.indexOf(a), js.indexOf(b, js.indexOf(a)));

test("le script de l'avis reste valide", () => { new Function(js); });

test("création : écran d'accueil à la place de la question « 1 ou 2 »", () => {
  assert.ok(!js.includes("window.prompt("), "plus de question par fenêtre du navigateur");
  assert.ok(!js.includes("askNatureAvis"));
  const ouvrir = entre("  function open(refOuNature) {", "  // Applique les paramètres par défaut adaptés à la nature");
  assert.ok(ouvrir.includes("if (!refDemande && !accueil && !avisExistePourEtude()) { accueilAvis(natureDemande || 'vente', 'creation'); return; }"));
  assert.ok(ouvrir.includes("if (accueil) appliquerAccueil(accueil); else demanderDestinataire = synchroniserDestinataire("));
  for (const id of ["avAccueilModal", "avAccNom", "avAccType", "avAccEmail", "avAccTel", "avAccSans", "avAccValider"]) assert.ok(js.includes(id), id);
  assert.ok(js.includes("Repris de l\\'étude de marché") && js.includes("function resumeEtude()"));
});

test("destinataire : lu dans le champ de l'étude, reporté dans l'étude, type rangé là où le calcul le lit", () => {
  const lecture = entre("  function destinataireEtude(inputs) {", "  // Reporte le destinataire de l'avis dans l'étude");
  assert.ok(lecture.indexOf("getElementById('inputDestinataire')") < lecture.indexOf("i.destinataire"), "le champ de l'étude passe avant les entrées d'origine");
  assert.ok(js.includes("var dest = destinataireEtude(inputs);"));
  assert.ok(js.includes("function poserDestinataireEtude(nom)") && js.includes("window.__fidiInputs.destinataire = nom"));
  assert.ok(!js.includes("d.metadata.destinataireType"), "le type de destinataire appartient à « strategie »");
  assert.ok(js.includes("d.strategie.destinataireType = a.type === 'professionnel' ? 'professionnel' : 'particulier';"));
  // Un avis par étude : la clé de rattachement ne dépend pas du destinataire (le renommer ne crée pas un second avis).
  const cle = entre("  function etudeKeyOf(fidi, inputs) {", "  // Ré-injecte les champs");
  assert.ok(!/destinataire/.test(cle));
});

test("le message temporaire ne bloque plus les boutons du bas de l'écran", () => {
  const t = entre("  function toast(msg, isErr) {", "  // ── Génération du document");
  assert.ok(t.includes("pointer-events:none"));
});

test("accueil : styles présents, champs à 16 px et plein écran sur téléphone, couleurs de la charte", () => {
  assert.ok(css.includes(".av-accueil-nature") && css.includes(".av-accueil-etude"));
  assert.ok(css.includes("var(--fidi-blue,#12294d)"));
  assert.match(mob, /#avAccueilModal \.form-control,#avAccueilModal \.form-select\{font-size:16px;min-height:44px;\}/);
});
