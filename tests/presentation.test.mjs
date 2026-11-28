// Présentation des formules : prix lus sur la grille du compte, aide au choix, calcul de marge.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const window = {}; new Function("window", "document", lire("presentation.js"))(window, undefined);
const P = window.FidiPresentation;
const offre = (module, palier, credits, prix, plus = {}) => ({ module, palier, credits, prix, active: true, grille: "Standard", ...plus });

test("les prix affichés sont ceux de la grille du compte, l'économie est recalculée sur ces prix", () => {
  const m = P.modele([offre("Études de marché", "Pro", 10, 300), offre("Études de marché", "Starter", 2, 80, { recommande: true }),
    offre("Avis de valeur", "Starter", 2, 100), offre("Études de marché", "Ancien", 5, 150, { active: false })], "Standard");
  assert.deepEqual(m.etudes.map((p) => [p.palier, p.prix, p.prixCredit, p.economie, p.conseille]), [["Starter", 80, 40, 0, true], ["Pro", 300, 30, 25, false]]);
  assert.equal(m.avis[0].prixCredit, 50);
  assert.equal(m.global.length, 0, "aucune formule globale sur cette grille : elle n'est pas inventée");
});

test("administrateur : seule la grille demandée est présentée", () => {
  const m = P.modele([offre("Avis de valeur", "Starter", 2, 90), offre("Avis de valeur", "Starter", 2, 60, { grille: "Partenaire" })], "Partenaire");
  assert.deepEqual(m.avis.map((p) => p.prix), [60]);
});

test("serveur muet : tarif de référence, signalé comme tel", () => {
  const m = P.modeleOuReference(null);
  assert.equal(m.reference, true);
  assert.deepEqual(m.etudes.map((p) => p.prix), [90, 198, 360, 657, 1508, 2610]);
  assert.equal(m.global[m.global.length - 1].prix, 4590);
  assert.equal(P.modeleOuReference([offre("Avis de valeur", "Starter", 2, 90)]).reference, false);
});

test("aide au choix : jamais plus de crédits que le besoin d'une année", () => {
  const m = P.modeleOuReference(null);
  const r = P.conseiller(m, { documents: "avis", volume: 2 });
  assert.deepEqual([r.formule, r.pack.palier, r.annuel, r.mois], ["avis", "Business", 24, 10]);
  assert.equal(r.globalMemePrix, true, "même prix en formule globale : c'est dit");
  const petit = P.conseiller(m, { documents: "deux", volume: 0.1 });
  assert.deepEqual([petit.formule, petit.pack.palier, petit.petitVolume], ["global", "Starter", true]);
  assert.equal(P.conseiller(m, { documents: "deux", volume: 40 }).pack.palier, "Platinum");
  assert.equal(P.conseiller({ etudes: [], avis: [], global: [] }, { documents: "deux", volume: 3 }), null);
});

test("aide au choix : la formule globale n'est vantée que si elle n'est pas plus chère", () => {
  const m = P.modele([offre("Avis de valeur", "Starter", 2, 80), offre("Cumulatif", "Starter", 2, 90)]);
  assert.equal(P.conseiller(m, { documents: "avis", volume: 1 }).globalMemePrix, false);
});

test("marge : calculée sur le prix de vente saisi, rien sans saisie", () => {
  assert.deepEqual(P.marge("300", 36), { reste: 264, part: 88, rembourse: 0.12 });
  assert.equal(P.marge("", 36), null);
  assert.equal(P.marge(20, 36).reste, -16);
});

test("ni promesse de résultat ni chiffre de marché en dur ; l'achat reste dans Mon compte", () => {
  const js = lire("presentation.js");
  for (const interdit of [/garanti/i, /€\/m²/, /confidentiel/i, /FIDI Conseil/, /ImmoData/i, /paypal\./i, /style="/]) assert.doesNotMatch(js, interdit);
  assert.match(js, /Compte\.rubrique\("tabOffres"\)/);
  const html = lire("index.html");
  assert.match(html, /<script src="\/presentation\.js" defer><\/script>/);
  assert.doesNotMatch(html, /ROI garanti|Pitch modèle économique/);
  assert.ok(html.indexOf("/presentation.css") < html.indexOf("/mobile.css"));
});
