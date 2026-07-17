// Test round-trip : étude -> champs Notion -> étude reconstruite.
import { etudeToProps, etudeToAnnees, propsToEtude } from "../netlify/functions/_etude_fields.mjs";

const d = {
  localisation: { label: "12 Rue X, 97231 Le Robert", city: "Le Robert", postcode: "97231", citycode: "97231", departement: "972", lon: -60.9, lat: 14.68, score_geo: 98.5, context: "972, Martinique" },
  commune_info: { nom: "Le Robert", population: 24000, superficie: 47.3, codeRegion: "02", codeDepartement: "972", codesPostaux: ["97231"] },
  dvf_annees: [
    { annee: 2021, nb_maison: 30, nb_appart: 10, nb_local: 2, nb_terrain: 5, nb_total: 47, prix_m2_maison: 2100, prix_m2_appart: 2500, prix_m2_local: 1800, prix_m2_terrain: 90 },
    { annee: 2022, nb_maison: 35, nb_appart: 12, nb_local: 1, nb_terrain: 6, nb_total: 54, prix_m2_maison: 2200, prix_m2_appart: 2600, prix_m2_local: null, prix_m2_terrain: 95 },
  ],
  dvf_periodes: [{ periode: "2021–2022", nb_maison: 65, nb_appart: 22, nb_terrain: 11, nb_total: 101, prix_m2_maison: 2150, prix_m2_appart: 2550, prix_m2_local: 1800, prix_m2_terrain: 92 }],
  valoris: { maison: { prix_median_m2: 2150, nb: 60 }, appartement: { prix_median_m2: 2550, nb: 20 }, terrain: { prix_median_m2: 92, nb: 10 }, tous: { prix_median_m2: 2000, nb: 90 } },
  dpe: { A: 2, B: 5, C: 20, D: 30, E: 15, F: 8, G: 3 },
  risques: { sismicite: { zone: "5", libelle: "zone 5 (forte)" }, radon: { classe: "1" }, synthese: ["Séisme", "Cyclone", "Inondation"], icpe: { count: 4, data: [] } },
  score: { total: 72, verdict: "Très bon", couleur: "#0d6efd", axes: {
    activite: { note: 17, max: 20, label: "Activité du marché", detail: "Marché actif (101 transactions)" },
    tendance: { note: 14, max: 20, label: "Tendance des prix", detail: "Hausse modérée +7%" },
    attractivite: { note: 14, max: 20, label: "Attractivité", detail: "Ville moyenne (24 000 hab.)" },
    dpe: { note: 13, max: 20, label: "Parc énergétique", detail: "Parc énergétique moyen" },
    risques: { note: 14, max: 20, label: "Risques naturels", detail: "Sismicité élevée (zone 5) | 3 risques recensés" },
  } },
  estimation: { prix_m2: 2150, surface: 100, valeur_med: 215000, valeur_min: 183000, valeur_max: 258000 },
  estimations: {
    maison: { prix_m2: 2150, surface: 100, valeur_med: 215000, valeur_min: 183000, valeur_max: 258000, nb: 60, standard: false },
    appartement: { prix_m2: 2550, surface: 70, valeur_med: 178000, valeur_min: 151000, valeur_max: 214000, nb: 20, standard: true },
    terrain: { prix_m2: 92, surface: 500, valeur_med: 46000, valeur_min: 39000, valeur_max: 55000, nb: 10, standard: true },
  },
  type_bien: "maison", surface: 100, generated_at: "17/07/2026 14:30",
};

const b = {
  kind: "etude", ref: "FIDI-EM-20260717-LEROBERT-97231", date: "2026-07-17",
  adresse: "12 Rue X, 97231 Le Robert", commune: "Le Robert", code_insee: "97231", perimetre: "rayon_1km",
  type_bien: "Maison", surface: 100, score: 72, prix_m2: 2150, nb_transactions: 101, estimation: 215000,
  client: "M. Test", statut: "Terminé",
  data: { data: d, inputs: { adresse: "12 Rue X", typeBien: "maison", surface: 100, perimetre: "rayon_1km", destinataire: "M. Test" } },
};

const props = etudeToProps(b);
const annees = etudeToAnnees(b);
const { data: r, inputs } = propsToEtude(props, annees);

let ok = 0, ko = 0;
const check = (label, got, exp) => {
  const pass = JSON.stringify(got) === JSON.stringify(exp);
  if (pass) ok++; else { ko++; console.log(`  ✗ ${label}\n      attendu=${JSON.stringify(exp)}\n      obtenu =${JSON.stringify(got)}`); }
};

console.log("— Localisation / commune —");
check("loc.city", r.localisation.city, "Le Robert");
check("loc.citycode", r.localisation.citycode, "97231");
check("loc.lat", r.localisation.lat, 14.68);
check("loc.departement", r.localisation.departement, "972");
check("info.population", r.commune_info.population, 24000);
check("info.superficie", r.commune_info.superficie, 47.3);

console.log("— Série annuelle (base liée) —");
check("dvf_annees.length", r.dvf_annees.length, 2);
check("dvf_annees[0].annee", r.dvf_annees[0].annee, 2021);
check("dvf_annees[0].prix_m2_maison", r.dvf_annees[0].prix_m2_maison, 2100);
check("dvf_annees[1].nb_total", r.dvf_annees[1].nb_total, 54);

console.log("— Période / valoris —");
check("periode.periode", r.dvf_periodes[0].periode, "2021–2022");
check("periode.nb_total", r.dvf_periodes[0].nb_total, 101);
check("valoris.maison.prix_median_m2", r.valoris.maison.prix_median_m2, 2150);
check("valoris.tous.prix_median_m2", r.valoris.tous.prix_median_m2, 2000);

console.log("— DPE —");
check("dpe", r.dpe, d.dpe);

console.log("— Risques —");
check("risques.sismicite.zone", r.risques.sismicite.zone, "5");
check("risques.radon.classe", r.risques.radon.classe, "1");
check("risques.synthese", r.risques.synthese, ["Séisme", "Cyclone", "Inondation"]);
check("risques.icpe.count", r.risques.icpe.count, 4);

console.log("— Score —");
check("score.total", r.score.total, 72);
check("score.verdict", r.score.verdict, "Très bon");
check("score.couleur", r.score.couleur, "#0d6efd");
check("score.axes.activite.note", r.score.axes.activite.note, 17);
check("score.axes.activite.label", r.score.axes.activite.label, "Activité du marché");
check("score.axes.risques.detail", r.score.axes.risques.detail, "Sismicité élevée (zone 5) | 3 risques recensés");

console.log("— Estimation —");
check("estimation.valeur_med", r.estimation.valeur_med, 215000);
check("estimation.valeur_min", r.estimation.valeur_min, 183000);
check("estimation.valeur_max", r.estimation.valeur_max, 258000);
check("estimations.maison.valeur_med", r.estimations.maison.valeur_med, 215000);
check("estimations.maison.valeur_min (recalc)", r.estimations.maison.valeur_min, 183000);
check("estimations.maison.surface (recalc)", r.estimations.maison.surface, 100);
check("estimations.maison.standard", r.estimations.maison.standard, false);
check("estimations.appartement.standard", r.estimations.appartement.standard, true);

console.log("— Méta / inputs —");
check("type_bien", r.type_bien, "maison");
check("generated_at", r.generated_at, "17/07/2026 14:30");
check("inputs.perimetre", inputs.perimetre, "rayon_1km");
check("inputs.destinataire", inputs.destinataire, "M. Test");

console.log(`\nRésultat : ${ok} OK / ${ko} KO`);
console.log(`Nb lignes annuelles générées : ${annees.length}`);
console.log(`Nb propriétés parent générées : ${Object.keys(props).length}`);
process.exit(ko ? 1 : 0);
