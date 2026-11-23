// Calcul d'une facture détaillée — logique pure, sans dépendance.
// Miroir navigateur : window.FidiFactureCalc dans facture.js (mêmes règles, vérifié par
// tests/facture-calc.test.mjs). Toute évolution se fait dans les deux.
//
// Entrée : {
//   lignes:     [{ designation, description?, quantite, prixUnitaire }],
//   mode:       "montant" | "quantite" | "heures"   (affichage ; « montant » force la quantité à 1)
//   prixSaisis: "TTC" | "HT"                         (les tarifs de la grille sont TTC)
//   remise:     { type: "pct" | "eur", valeur, nature?: "acompte", reference? } | null
//               nature "acompte" (type "eur") : déduction d'un acompte déjà facturé ; reference = n° de la facture d'acompte
//   tva:        { regime: "franchise" | "assujetti", taux }   (taux en %)
// }
// Sortie : lignes nettoyées (avec montant et prix unitaire HT), totaux arrondis au centime.

export const MAX_LIGNES = 30;

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = typeof v === "string" ? parseFloat(v.replace(/\s/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const txt = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export function nettoyerLignes(lignes, mode) {
  if (!Array.isArray(lignes)) return [];
  return lignes.slice(0, MAX_LIGNES).map((l) => {
    const o = l && typeof l === "object" ? l : {};
    const quantite = mode === "montant" ? 1 : Math.max(0, Math.min(100000, num(o.quantite)));
    const prixUnitaire = Math.max(0, Math.min(10_000_000, num(o.prixUnitaire)));
    return { designation: txt(o.designation, 200), description: txt(o.description, 1000), quantite, prixUnitaire };
  }).filter((l) => l.designation || l.prixUnitaire > 0);
}

export function calculerFacture(entree) {
  const e = entree && typeof entree === "object" ? entree : {};
  const mode = ["montant", "quantite", "heures"].includes(e.mode) ? e.mode : "quantite";
  const prixSaisis = e.prixSaisis === "HT" ? "HT" : "TTC";
  const assujetti = e.tva && e.tva.regime === "assujetti";
  const taux = assujetti ? Math.max(0, Math.min(30, num(e.tva.taux))) : 0;
  const k = 1 + taux / 100;

  const lignes = nettoyerLignes(e.lignes, mode).map((l) => {
    const montant = r2(l.quantite * l.prixUnitaire);
    const prixUnitaireHT = prixSaisis === "TTC" ? r2(l.prixUnitaire / k) : l.prixUnitaire;
    return { ...l, montant, prixUnitaireHT, montantHT: prixSaisis === "TTC" ? r2(montant / k) : montant };
  });

  const brut = r2(lignes.reduce((s, l) => s + l.montant, 0));
  let remise = null, remiseMontant = 0;
  if (e.remise && num(e.remise.valeur) > 0) {
    const type = e.remise.type === "eur" ? "eur" : "pct";
    const valeur = type === "pct" ? Math.min(100, num(e.remise.valeur)) : num(e.remise.valeur);
    remiseMontant = r2(Math.min(brut, type === "pct" ? brut * valeur / 100 : valeur));
    remise = { type, valeur };
    // Acompte déjà facturé : même calcul qu'une remise en euros (HT et TVA réduits au prorata), libellé différent sur la facture.
    if (e.remise.nature === "acompte" && type === "eur") { remise.nature = "acompte"; remise.reference = txt(e.remise.reference, 60); }
  }
  const net = r2(brut - remiseMontant);

  let ht, tva, ttc;
  if (prixSaisis === "TTC") { ttc = net; ht = r2(ttc / k); tva = r2(ttc - ht); }
  else { ht = net; tva = r2(ht * taux / 100); ttc = r2(ht + tva); }

  // Colonnes HT de la facture : l'écart d'arrondi est reporté sur la dernière ligne, pour que
  // somme des lignes HT − remise HT = total HT, au centime près.
  const htAvantRemise = prixSaisis === "TTC" ? r2(brut / k) : brut;
  if (lignes.length) {
    const ecart = r2(htAvantRemise - lignes.reduce((s, l) => s + l.montantHT, 0));
    if (ecart) lignes[lignes.length - 1].montantHT = r2(lignes[lignes.length - 1].montantHT + ecart);
  }
  const remiseHT = r2(htAvantRemise - ht);

  return {
    mode, prixSaisis, lignes, remise,
    tva: { regime: assujetti ? "assujetti" : "franchise", taux },
    totaux: { brut, remise: remiseMontant, ht, tva, ttc, htAvantRemise, remiseHT },
  };
}

// Libellé court pour les listes (Notion « Libellé ») : première ligne + nombre d'articles restants.
export function libelleCourt(calc, repli) {
  const l = (calc && calc.lignes) || [];
  if (!l.length) return repli || "";
  return l[0].designation + (l.length > 1 ? ` (+${l.length - 1} article${l.length > 2 ? "s" : ""})` : "");
}
