// Profils territoriaux — paramètres par défaut de l'avis de valeur selon le territoire.
// Toutes les valeurs chiffrées sont des HYPOTHÈSES PROFESSIONNELLES (« à valider »), pas
// des données officielles. Elles restent modifiables dans le formulaire de l'avis.
// Ni notaire ni expert : à confirmer selon le règlement / barèmes en vigueur.

export const TERRITOIRES = {
  "972": {
    libelle: "Martinique",
    dvf_disponible: true,
    droits_mutation_pct: 5.80,          // hypothèse — à valider (droits + taxes annexes)
    frais_notaire_pct: 1.0,             // hypothèse — à valider (émoluments ~ dégressifs)
    tva_honoraires_pct: 8.5,            // DOM — à valider
    honoraires_defaut_pct: 5,           // hypothèse — à valider
    taux_capi: { bas: 6.0, central: 6.5, haut: 7.0 },        // hypothèse — à valider
    cout_construction_m2: { shon: 2200, annexes: 600 },      // hypothèse — à valider
    prime_rarete_pct: { bas: 0, central: 3, haut: 5 },        // hypothèse — à valider
    fiscalite_note: "TVA 8,5 % (DOM) ; taxe foncière et régime plus-value de droit commun. À confirmer.",
  },
  "971": {
    libelle: "Guadeloupe",
    dvf_disponible: true,
    droits_mutation_pct: 5.80, frais_notaire_pct: 1.0, tva_honoraires_pct: 8.5, honoraires_defaut_pct: 5,
    taux_capi: { bas: 6.0, central: 6.5, haut: 7.0 },
    cout_construction_m2: { shon: 2200, annexes: 600 },
    prime_rarete_pct: { bas: 0, central: 3, haut: 5 },
    fiscalite_note: "TVA 8,5 % (DOM) ; régime de droit commun. À confirmer.",
  },
  "973": {
    libelle: "Guyane",
    dvf_disponible: true,
    droits_mutation_pct: 5.80, frais_notaire_pct: 1.0, tva_honoraires_pct: 8.5, honoraires_defaut_pct: 5,
    taux_capi: { bas: 6.5, central: 7.0, haut: 7.5 },
    cout_construction_m2: { shon: 2300, annexes: 650 },
    prime_rarete_pct: { bas: 0, central: 2, haut: 5 },
    fiscalite_note: "TVA 8,5 % (DOM) ; régime de droit commun. À confirmer.",
  },
  "974": {
    libelle: "La Réunion",
    dvf_disponible: true,
    droits_mutation_pct: 5.80, frais_notaire_pct: 1.0, tva_honoraires_pct: 8.5, honoraires_defaut_pct: 5,
    taux_capi: { bas: 5.5, central: 6.0, haut: 6.5 },
    cout_construction_m2: { shon: 2200, annexes: 600 },
    prime_rarete_pct: { bas: 0, central: 3, haut: 6 },
    fiscalite_note: "TVA 8,5 % (DOM) ; régime de droit commun. À confirmer.",
  },
  "976": {
    libelle: "Mayotte",
    dvf_disponible: false,              // DVF non couvert
    droits_mutation_pct: 5.80, frais_notaire_pct: 1.0, tva_honoraires_pct: 0, honoraires_defaut_pct: 5,
    taux_capi: { bas: 6.5, central: 7.0, haut: 7.5 },
    cout_construction_m2: { shon: 2400, annexes: 700 },
    prime_rarete_pct: { bas: 0, central: 3, haut: 6 },
    fiscalite_note: "Territoire non couvert par DVF ; régime fiscal spécifique. À confirmer.",
  },
  "977": {
    libelle: "Saint-Barthélemy",
    dvf_disponible: false,             // collectivité non couverte par DVF
    droits_mutation_pct: 5.0,           // hypothèse — à valider (collectivité)
    frais_notaire_pct: 1.5,
    tva_honoraires_pct: 0,             // pas de TVA collectivité
    honoraires_defaut_pct: 5,
    taux_capi: { bas: 3.5, central: 4.0, haut: 4.5 },
    cout_construction_m2: { shon: 7000, annexes: 1500 },     // marché luxe — à valider
    prime_rarete_pct: { bas: 10, central: 15, haut: 20 },    // rareté forte
    fiscalite_note: "Pas de TVA, pas de taxe foncière ni d'IR/IFI pour les résidents fiscaux de la Collectivité ; plus-value selon le régime de la Collectivité. À confirmer.",
  },
  "978": {
    libelle: "Saint-Martin",
    dvf_disponible: false,
    droits_mutation_pct: 5.0, frais_notaire_pct: 1.5, tva_honoraires_pct: 0, honoraires_defaut_pct: 5,
    taux_capi: { bas: 4.0, central: 4.5, haut: 5.0 },
    cout_construction_m2: { shon: 4500, annexes: 1200 },
    prime_rarete_pct: { bas: 5, central: 10, haut: 15 },
    fiscalite_note: "Collectivité : régime fiscal spécifique (part française). À confirmer.",
  },
  "metropole": {
    libelle: "Métropole",
    dvf_disponible: true,
    droits_mutation_pct: 5.80, frais_notaire_pct: 1.0, tva_honoraires_pct: 20, honoraires_defaut_pct: 5,
    taux_capi: { bas: 4.0, central: 5.0, haut: 6.0 },
    cout_construction_m2: { shon: 2000, annexes: 550 },
    prime_rarete_pct: { bas: 0, central: 0, haut: 5 },
    fiscalite_note: "TVA 20 % ; régime de droit commun. À confirmer.",
  },
};

// Détection du territoire depuis un code INSEE (5) ou un code postal (5).
// 97133 → 977 (Saint-Barthélemy) ; 97150 → 978 (Saint-Martin) ; 971xx→971 … ; sinon métropole.
export function territoirePourCode(codeInsee, codePostal) {
  const insee = String(codeInsee || "").trim();
  const cp = String(codePostal || "").trim();
  // Codes postaux particuliers (collectivités non distinguées par le préfixe départemental).
  if (cp === "97133" || insee.startsWith("977")) return { code: "977", ...TERRITOIRES["977"] };
  if (cp === "97150" || insee.startsWith("978")) return { code: "978", ...TERRITOIRES["978"] };
  const src = insee || cp;
  for (const dep of ["971", "972", "973", "974", "976"]) {
    if (src.startsWith(dep)) return { code: dep, ...TERRITOIRES[dep] };
  }
  return { code: "metropole", ...TERRITOIRES["metropole"] };
}
