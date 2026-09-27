// Test de non-régression — fixture « Marigot AX 7 » (Saint-Barthélemy).
// Vérifie que le moteur multi-méthodes en fourchette produit la synthèse attendue.
// Exécution : node tests/avis-marigot.test.mjs   (aucune dépendance externe)
import assert from "node:assert/strict";
import { calculerMethodes } from "../netlify/functions/_avis_calcul.mjs";

const TOL = 1000; // € : le test échoue si l'écart dépasse 1 000 €
const near = (label, got, exp) =>
  assert.ok(Math.abs(got - exp) <= TOL, `${label}: attendu ${exp}, obtenu ${Math.round(got)} (écart ${Math.round(Math.abs(got - exp))} €)`);

const input = {
  shon: 169, shob: 370, terrainContenance: 1125,
  comparaison: { bas: 28000, central: 32000, haut: 36000 },       // €/m² SHON
  chargeFonciere: { bas: 2400000, central: 2700000, haut: 3000000 },
  coutShonM2: 7000, coutAnnexesM2: 1500, forfait: 150000, vetustePct: 20,
  prime: { bas: 10, central: 15, haut: 20 },
  lots: [
    { libelle: "Studios", nombre: 2, mode: "annuel", loyerMensuel: 2200 },
    { libelle: "T2", nombre: 2, mode: "annuel", loyerMensuel: 3200 },
    { libelle: "Villa", nombre: 1, mode: "saisonnier", semaines: 20, prixSemaine: 9000 },
  ],
  charges: { gestionSaisonnierePct: 25, vacancePct: 5, forfaitCharges: 35000 },
  taux: { bas: 4.5, central: 4.0, haut: 3.5 },
  poids: { comparaison: 40, solConstruction: 20, capitalisation: 40 },
};

const r = calculerMethodes(input);

// Méthode comparaison
near("comparaison.bas", r.comparaison.bas, 4732000);
near("comparaison.central", r.comparaison.central, 5408000);
near("comparaison.haut", r.comparaison.haut, 6084000);

// Sol + construction
near("solConstruction.bas", r.solConstruction.bas, 4078000);
near("solConstruction.central", r.solConstruction.central, 4609000);
near("solConstruction.haut", r.solConstruction.haut, 5169000);

// Capitalisation
near("capitalisation.revenuBrut", r.capitalisation.revenuBrut, 309600);
near("capitalisation.revenuNet", r.capitalisation.revenuNet, 223120);
near("capitalisation.bas", r.capitalisation.bas, 4958000);
near("capitalisation.central", r.capitalisation.central, 5578000);
near("capitalisation.haut", r.capitalisation.haut, 6375000);

// Synthèse (arrondie au 50 000 €)
assert.equal(r.synthese.bas, 4700000, `synthese.bas: attendu 4700000, obtenu ${r.synthese.bas}`);
assert.equal(r.synthese.central, 5300000, `synthese.central: attendu 5300000, obtenu ${r.synthese.central}`);
assert.equal(r.synthese.haut, 6000000, `synthese.haut: attendu 6000000, obtenu ${r.synthese.haut}`);

console.log("✓ Marigot AX 7 — synthèse 4,70 / 5,30 / 6,00 M€ — tous les asserts passent");
