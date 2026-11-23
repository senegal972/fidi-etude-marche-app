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

// Données de l'étude reprises telles quelles dans l'avis.
test("étude → avis : règles du PLU, zonage des risques au point et référence de l'étude sont repris", () => {
  const bac = { window: {}, document: { getElementById() { return null; }, addEventListener() {} } };
  bac.window.window = bac.window;
  // Les deux fonctions de mise en forme sont pures : on les extrait pour les exercer.
  const code = entre("  function reglePluEtude() {", "  // Ré-injecte les champs « ÉTUDE »");
  const f = new Function("window", code + "; return { reglePluTexte: reglePluTexte, aleasEtudeTexte: aleasEtudeTexte, reglePluEtude: reglePluEtude };")(bac.window);
  const regle = { found: true, emprise_pct: 80, emprise_txt: "80 %", hauteur_txt: "12 m", regles: { recul_voie: { m: 5 }, recul_limites: { formule: true }, pleine_terre: { pct: 15 } } };
  const t = f.reglePluTexte(regle, "UE4");
  assert.match(t, /^D'après le règlement du PLU \(zone UE4\)/);
  for (const m of ["emprise au sol 80 %", "hauteur 12 m", "recul sur voie : 5 m minimum", "recul sur limites : H/2", "pleine terre 15 %", "À confirmer"]) assert.ok(t.includes(m), m);
  assert.equal(f.reglePluTexte(null), ""); assert.equal(f.reglePluTexte({ found: true, regles: {} }), "");
  assert.equal(f.reglePluEtude(), null);
  bac.window.__fidiAleas = { source: "mq", reglemente: true, zoneCode: "Orange", aleas: [{ label: "Inondation", niveau: "Moyen" }] };
  assert.equal(f.aleasEtudeTexte(), "Au point étudié : zone Orange du PPRN — Inondation (Moyen)");
  bac.window.__fidiAleas = { source: "mq", reglemente: false, aleas: [] };
  assert.equal(f.aleasEtudeTexte(), "Au point étudié : hors zonage réglementaire du PPRN");
  bac.window.__fidiAleas = { source: "georisques", aleas: [{ label: "Inondation", present: true }, { label: "Séisme", present: false }] };
  assert.equal(f.aleasEtudeTexte(), "Au point étudié : Inondation");
  bac.window.__fidiAleas = null; assert.equal(f.aleasEtudeTexte(), "");
  // Branchements : emprise du règlement avant l'estimation par la médiane ; texte saisi à la main jamais remplacé ; référence de l'étude.
  const inj = entre("  function injectEtudeGeoCadastre(d, fidi, inputs) {", "    // Vigilances / atouts issus du score");
  assert.ok(inj.indexOf("regle.emprise_pct / 100") < inj.indexOf("empriseMedianeZone("));
  assert.ok(inj.includes("/^D'après le règlement du PLU/.test(d.cadastre.droitsResiduels)"));
  assert.ok(inj.includes("d.metadata.refEtude = String(refEt)"));
});

// Avancement : ce qui reste à compléter, rubrique par rubrique.
test("avancement : éléments essentiels manquants par rubrique, onglets marqués, barre et liste", () => {
  const code = entre("  function manquesRubrique(id) {", "  // Marque les onglets, la liste du téléphone");
  let d;
  const f = new Function("state", "natureCourante", "num", "contenanceTotale", code + "; return manquesRubrique;");
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : 0; };
  let nature = "vente";
  const etat = { get data() { return d; } };
  const manques = f(etat, () => nature, num, (c) => num(c.contenance));
  d = { metadata: { date: "2026-11-23", lieuEtablissement: "Le Lamentin" }, bien: { type: "Maison", adresse: "12 rue X", commune: "Le Lamentin", surfaceCarrez: "120" },
        cadastre: { section: "0S", numero: "1359", contenance: "4140" }, loc: { adresse: "12 rue X" }, marche: { moyenneMoyen: "2517" }, comparables: [{ prix: "300000" }],
        conclusion: { texte: "" }, signataire: { nom: "" }, loyers: [] };
  assert.deepEqual(manques("metadata"), ["le destinataire"]);
  d.metadata.sansDestinataire = true; assert.deepEqual(manques("metadata"), []);
  assert.deepEqual(manques("bien"), []); assert.deepEqual(manques("cadastre"), []); assert.deepEqual(manques("marche"), []);
  assert.deepEqual(manques("comparables"), ["au moins 3 comparables (1 saisi)"]);
  assert.deepEqual(manques("conclusion"), ["le texte de conclusion"]); assert.deepEqual(manques("signature"), ["le nom du signataire"]);
  assert.equal(manques("etat"), null, "rubrique sans élément exigé");
  assert.equal(manques("loyers"), null, "les loyers ne sont exigés que pour un avis de location");
  nature = "location"; assert.deepEqual(manques("loyers"), ["un loyer de référence"]);
  d.bien.surfaceCarrez = ""; assert.deepEqual(manques("bien"), ["la surface"]);
  assert.ok(js.includes('id="avAvancement"') && js.includes("try { majAvancement(); } catch (e) {}") && js.includes("planifierAvancement();"));
  assert.ok(css.includes(".av-tab-manque::after") && css.includes(".av-av-jauge"));
});
