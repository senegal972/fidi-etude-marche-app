// Calcul des factures détaillées : logique serveur (_facture_calc.mjs) et miroir navigateur
// (window.FidiFactureCalc dans facture.js) — les deux doivent donner exactement les mêmes résultats.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { calculerFacture, libelleCourt } from "../netlify/functions/_facture_calc.mjs";

// Charge facture.js dans un bac à sable (seule la partie calcul est exercée).
const bac = { window: {}, document: { getElementById: () => null, addEventListener() {} }, console };
vm.createContext(bac);
vm.runInContext(readFileSync(new URL("../facture.js", import.meta.url), "utf8"), bac);
const navigateur = bac.window.FidiFactureCalc;

const CAS = {
  "franchise, prix TTC, une ligne": {
    lignes: [{ designation: "Étude de marché", quantite: 1, prixUnitaire: 450 }], mode: "montant", prixSaisis: "TTC",
    tva: { regime: "franchise" } },
  "TVA 8,5 %, prix TTC, deux lignes et remise 10 %": {
    lignes: [{ designation: "Étude", quantite: 1, prixUnitaire: 450 }, { designation: "Visite", quantite: 2, prixUnitaire: "60,50" }],
    mode: "quantite", prixSaisis: "TTC", remise: { type: "pct", valeur: 10 }, tva: { regime: "assujetti", taux: 8.5 } },
  "TVA 8,5 %, prix HT, heures et remise en euros": {
    lignes: [{ designation: "Conseil", quantite: "3,5", prixUnitaire: 80 }], mode: "heures", prixSaisis: "HT",
    remise: { type: "eur", valeur: 20 }, tva: { regime: "assujetti", taux: 8.5 } },
  "remise supérieure au total, lignes vides ignorées": {
    lignes: [{ designation: "", quantite: 1, prixUnitaire: 0 }, { designation: "A", quantite: 1, prixUnitaire: 30 }],
    remise: { type: "eur", valeur: 999 }, tva: { regime: "franchise" } },
};

test("franchise TTC : HT = TTC, TVA nulle", () => {
  const c = calculerFacture(CAS["franchise, prix TTC, une ligne"]);
  assert.deepEqual(c.totaux, { brut: 450, remise: 0, ht: 450, tva: 0, ttc: 450, htAvantRemise: 450, remiseHT: 0 });
  assert.equal(c.tva.regime, "franchise");
});

test("TVA 8,5 % sur prix TTC : le TTC saisi est conservé, HT et TVA en sont déduits", () => {
  const c = calculerFacture(CAS["TVA 8,5 %, prix TTC, deux lignes et remise 10 %"]);
  assert.equal(c.totaux.brut, 571);           // 450 + 2 × 60,50
  assert.equal(c.totaux.remise, 57.1);
  assert.equal(c.totaux.ttc, 513.9);
  assert.equal(c.totaux.ht, 473.64);          // 513,90 / 1,085
  assert.equal(c.totaux.tva, 40.26);
  assert.equal(Math.round((c.totaux.ht + c.totaux.tva) * 100) / 100, c.totaux.ttc);
});

test("TVA 8,5 % sur prix HT : la TVA s'ajoute", () => {
  const c = calculerFacture(CAS["TVA 8,5 %, prix HT, heures et remise en euros"]);
  assert.equal(c.totaux.brut, 280);
  assert.equal(c.totaux.ht, 260);
  assert.equal(c.totaux.tva, 22.1);
  assert.equal(c.totaux.ttc, 282.1);
});

test("une remise ne dépasse jamais le total ; les lignes vides sont ignorées", () => {
  const c = calculerFacture(CAS["remise supérieure au total, lignes vides ignorées"]);
  assert.equal(c.lignes.length, 1);
  assert.equal(c.totaux.ttc, 0);
});

test("mode « montant uniquement » : la quantité vaut toujours 1", () => {
  const c = calculerFacture({ lignes: [{ designation: "X", quantite: 5, prixUnitaire: 100 }], mode: "montant", tva: { regime: "franchise" } });
  assert.equal(c.totaux.ttc, 100);
});

test("entrées hostiles : bornées sans erreur", () => {
  const c = calculerFacture({ lignes: Array.from({ length: 50 }, () => ({ designation: "x".repeat(500), quantite: -3, prixUnitaire: "abc" })),
    tva: { regime: "assujetti", taux: 99 } });
  assert.equal(c.lignes.length, 30);
  assert.equal(c.lignes[0].designation.length, 200);
  assert.equal(c.tva.taux, 30);
  assert.deepEqual(calculerFacture(null).totaux, { brut: 0, remise: 0, ht: 0, tva: 0, ttc: 0, htAvantRemise: 0, remiseHT: 0 });
});

test("colonnes HT cohérentes au centime : Σ lignes HT − remise HT = total HT (cas 450 + 2 × 60, remise 10 %)", () => {
  const c = calculerFacture({ lignes: [{ designation: "Étude", quantite: 1, prixUnitaire: 450 }, { designation: "Visite", quantite: 2, prixUnitaire: 60 }],
    prixSaisis: "TTC", remise: { type: "pct", valeur: 10 }, tva: { regime: "assujetti", taux: 8.5 } });
  const somme = Math.round(c.lignes.reduce((s, l) => s + l.montantHT, 0) * 100) / 100;
  assert.equal(somme, c.totaux.htAvantRemise);
  assert.equal(Math.round((c.totaux.htAvantRemise - c.totaux.remiseHT) * 100) / 100, c.totaux.ht);
  assert.equal(c.totaux.ttc, 513);
  // Balayage : la cohérence tient pour de nombreux montants et taux.
  for (let p = 1; p < 400; p += 7.13) for (const taux of [2.1, 8.5, 20]) for (const rem of [0, 7, 33]) {
    const x = calculerFacture({ lignes: [{ designation: "a", quantite: 3, prixUnitaire: p }, { designation: "b", quantite: 1, prixUnitaire: p / 3 }],
      prixSaisis: "TTC", remise: { type: "pct", valeur: rem }, tva: { regime: "assujetti", taux } });
    const sx = Math.round(x.lignes.reduce((s, l) => s + l.montantHT, 0) * 100) / 100;
    assert.equal(sx, x.totaux.htAvantRemise);
    assert.equal(Math.round((x.totaux.htAvantRemise - x.totaux.remiseHT) * 100) / 100, x.totaux.ht);
    assert.equal(Math.round((x.totaux.ht + x.totaux.tva) * 100) / 100, x.totaux.ttc);
  }
});

test("libellé court pour les listes", () => {
  const c = calculerFacture(CAS["TVA 8,5 %, prix TTC, deux lignes et remise 10 %"]);
  assert.equal(libelleCourt(c), "Étude (+1 article)");
  assert.equal(libelleCourt(calculerFacture({}), "Repli"), "Repli");
});

test("le miroir navigateur (facture.js) donne exactement les mêmes résultats", () => {
  assert.ok(navigateur, "window.FidiFactureCalc absent de facture.js");
  for (const [nom, cas] of Object.entries(CAS)) {
    assert.deepEqual(JSON.parse(JSON.stringify(navigateur.calculerFacture(cas))), calculerFacture(cas), nom);
  }
});
