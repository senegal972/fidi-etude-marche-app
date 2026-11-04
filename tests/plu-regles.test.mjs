// Lecture des règles de zone : extraits fidèles de règlements réels (Fort-de-France,
// Le Lamentin, Le Robert). Le cas le plus important : ne jamais renvoyer la règle
// d'un AUTRE secteur, et rester à null quand la lecture n'est pas sûre.
import test from "node:test";
import assert from "node:assert/strict";
import { parseZoneRules, zoneCandidates } from "../netlify/functions/_plu_regles.mjs";

const HEADER = "PLU Fort-de-France Dispositions applicables à la zone UG ";
const FDF = [
  HEADER + "70 ARTICLE UG4 : VOLUMETRIE ET IMPLANTATION 1/ Implantation par rapport aux voies et emprises publiques Secteur UGd : Les constructions doivent être implantées en recul de 4m minimum depuis l’alignement actuel ou futur. Secteur Ugm et Ugf : Les constructions doivent être implantées en recul de 3 mètres minimum depuis l’alignement actuel ou futur. Une implantation différente peut être admise : - pour l’extension.",
  HEADER + "71 2/ Implantation par rapport aux limites séparatives Secteur UGd : Les constructions doivent être implantées en retrait à une distance au minimum égale à la hauteur à l’égout du toit divisée par deux de la construction à édifier sans être inférieure à 3 mètres. Secteur UGm : Les constructions doivent être implantées : - soit en limite, à condition. Secteur UGf : Les constructions doivent être implantées : - soit en limite, à condition que la hauteur à l’égout du toit de la construction n’excède pas 3 mètres en limite. - soit en retrait à une distance au minimum de 4 mètres. 3/ Implantation des constructions les unes par rapport aux autres sur une même unité foncière. Une distance minimale (L), égale à la différence de hauteur.",
  HEADER + "72 4/ Emprise au sol Secteur UGd : L’emprise au sol des constructions (annexes comprises) est limitée à 40% de la superficie de l’unité foncière. Secteur UGm : Au sein du sous-secteur UGm1, l’emprise au sol des constructions (annexes comprises) est limitée à 45% de la superficie de l’unité foncière. Au sein du sous-secteur UGm2, l’emprise au sol des constructions (annexes comprises) est limitée à 40% de la superficie de l’unité foncière. Secteur UGf : Au sein du sous-secteur UGf1, l’emprise au sol des constructions (annexes comprises) est limitée à 30% de la superficie de l’unité foncière. Au sein du sous-secteur UGf2, l’emprise au sol des constructions (annexes comprises) est limitée à 20% de la superficie de l’unité foncière. 5/ Hauteur Dans une bande de 15 mètres tracée parallèlement à l’alignement, la hauteur à l’égout du toit correspond à la différence. Secteur UGd : La hauteur à l’égout du toit est de 22 mètres maximum. La hauteur totale maximale autorisée est de 25 mètres. Secteur UGm : Au sein du sous-secteur UGm1, la hauteur à l’égout du toit est de 12 mètres maximum. La hauteur totale maximale autorisée est de 15 mètres. Secteur UGf : La hauteur à l’égout du toit est de 7 mètres maximum. La hauteur totale maximale autorisée est de 9 mètres. ARTICLE UG5 : QUALITE URBAINE",
];

test("hiérarchie du code de zone", () => {
  assert.deepEqual(zoneCandidates("UGf1"), ["UGf1", "UGf", "UG", "U"]);
  assert.deepEqual(zoneCandidates("UH2"), ["UH2", "UH", "U"]);
  assert.deepEqual(zoneCandidates("AUh1"), ["AUh1", "AUh", "AU"]);
});

test("Fort-de-France UGf1 : chaque règle est celle du secteur, avec sa page", () => {
  const r = parseZoneRules(FDF, "UGf1");
  assert.equal(r.emprise.pct, 30);
  assert.equal(r.emprise.page, 3);
  assert.equal(r.hauteur.egout_m, 7);
  assert.equal(r.hauteur.total_m, 9);
  assert.equal(r.recul_voie.m, 3);
  assert.equal(r.recul_voie.page, 1);
  assert.equal(r.recul_limites.m, 4, "la hauteur « 3 mètres en limite » n'est pas un recul");
  assert.equal(r.recul_limites.en_limite, true);
});

test("les sous-secteurs voisins ne se mélangent pas", () => {
  assert.equal(parseZoneRules(FDF, "UGf2").emprise.pct, 20);
  assert.equal(parseZoneRules(FDF, "UGm1").emprise.pct, 45);
  assert.equal(parseZoneRules(FDF, "UGm2").emprise.pct, 40);
  assert.equal(parseZoneRules(FDF, "UGd").recul_voie.m, 4);
  assert.equal(parseZoneRules(FDF, "UGd").hauteur.egout_m, 22);
  assert.equal(parseZoneRules(FDF, "UGd").recul_limites.formule, "H/2");
});

test("secteur absent du règlement : aucune valeur d'un autre secteur", () => {
  const r = parseZoneRules(FDF, "UGz");
  assert.equal(r.emprise && r.emprise.pct, null);
});

test("Le Lamentin : tableau d'emprise, plusieurs valeurs = ambigu, recul depuis l'axe signalé", () => {
  const pages = [
    "Article U – 6. Implantation par rapport aux voies et emprises publiques les constructions doivent s’implanter : 1) Dans la zone UH1, à la limite de l’emprise publique ; 2) Dans les autres zones UH et AUH, avec un retrait minimum de huit mètres par rapport à l’axe de la voie ; 3) Dans les zones UE et AUE, avec un retrait minimum de cinq mètres.",
    "Article U – 7. Implantation par rapport aux limites séparatives 2) Dans les autres zones UH et AUH, soit en limite de propriété, soit avec un recul minimal de trois mètres par rapport aux limites.",
    "Article U – 8. Emprise au sol des constructions et imperméabilisation l’emprise au sol est limitée selon le tableau suivant Zones Emprise au sol et imperméabilisation UH2 Centre-ville AUH2 Vieux-Pont et zones UE et AUE (sauf UE5) 80 % UH2 Acajou, UH3, AUH2 Acajou 50 % UH4 et AUH4 30 % UH5 25 % Le taux",
  ];
  const r4 = parseZoneRules(pages, "UH4");
  assert.equal(r4.emprise.pct, 30);
  assert.equal(r4.recul_voie.m, 8);
  assert.equal(r4.recul_voie.reference, "axe de la voie");
  assert.equal(r4.recul_limites.m, 3);
  const r2 = parseZoneRules(pages, "UH2");
  assert.equal(r2.emprise.pct, null);
  assert.equal(r2.emprise.ambigu, true);
});

test("Le Robert : emprise « n'est pas règlementée » reconnue, recul général hors exceptions", () => {
  const h = "ZONE UA Ville du ROBERT Règlement – PLU approuvé ";
  const pages = [
    h + "14 ARTICLE UA 4 1/ L’implantation des constructions par rapport aux voies et emprises publiques Règle générale Les constructions sont implantées soit à l'alignement, soit avec un recul au moins égal à 2 mètres par rapport à la limite du domaine public.",
    h + "15 2/ L’implantation des constructions par rapport aux limites séparatives Lorsqu'une construction est implantée en retrait par rapport à la limite séparative, elle doit respecter une marge de recul au moins égale à 2 mètres. Règles particulières Cette distance de retrait minimal peut être réduite à 1,5 mètre.",
    h + "16 4/ L’emprise au sol des constructions L’emprise au sol des constructions n’est pas règlementée. 5/ La hauteur maximale des constructions Règle générale un bâtiment comportant au plus 4 niveaux (R+3), hors sous-sols.",
  ];
  const r = parseZoneRules(pages, "UA");
  assert.equal(r.emprise.pct, null);
  assert.equal(r.emprise.non_reglemente, true);
  assert.equal(r.recul_voie.m, 2);
  assert.equal(r.recul_voie.en_limite, true);
  assert.equal(r.recul_limites.m, 2);
  assert.equal(r.hauteur.r_plus, 3);
});

test("recul plafonné (« 5 mètres maximum ») : pas présenté comme un minimum", () => {
  const h = "ZONE UA ";
  const pages = [h + "1", h + "2", h + "3 Article UA 6 – Implantation des constructions par rapport aux voies et emprises publiques Le nu des constructions doit être implanté à l’alignement ou en retrait de 5 mètres maximum de l’alignement."];
  const r = parseZoneRules(pages, "UA");
  assert.equal(r.recul_voie.m, null);
  assert.equal(r.recul_voie.maximum, true);
});

test("clôtures et m² ne sont pas des hauteurs de construction", () => {
  const h = "ZONE UD ";
  const pages = [h + "1", h + "2", h + "3 5/ Hauteur des constructions Les annexes ont une hauteur maximale de 2 mètres. La clôture a une hauteur totale de 2 m. Les abris de 25 m² sont admis."];
  const r = parseZoneRules(pages, "UD");
  assert.equal(r.hauteur, null);
});
