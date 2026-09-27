// Avis de valeur v2 — moteur de calcul multi-méthodes EN FOURCHETTE (bas / central / haut).
// Fonctions PURES et déterministes : mêmes entrées → mêmes sorties. Répliquées côté client
// (window.FidiAvisCalcV2 dans avis-valeur.js) et testées par tests/avis-marigot.test.mjs.
//
// Toutes les valeurs monétaires sont en euros. Aucune I/O, aucun accès réseau.
// HYPOTHÈSES (défauts) marquées « à valider » — surchargeables par l'appelant.

export const DEFAULTS = {
  coutShonM2: 7000,          // hypothèse — coût construction neuf par m² SHON — à valider
  coutAnnexesM2: 1500,       // hypothèse — coût par m² d'annexes (SHOB − SHON) — à valider
  vetustePct: 20,            // hypothèse
  gestionSaisonnierePct: 25, // hypothèse
  vacancePct: 5,             // hypothèse
  poids: { comparaison: 40, solConstruction: 20, capitalisation: 40 }, // à valider
};

const n = (v) => { if (v == null || v === '') return 0; const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : 0; };

// Arrondi commercial : au 50 000 € au-dessus de 1 M€, au 1 000 € en dessous.
export function arrondiValeur(v) {
  v = n(v);
  if (v >= 1e6) return Math.round(v / 50000) * 50000;
  return Math.round(v / 1000) * 1000;
}

function triplet(o) { o = o || {}; return { bas: n(o.bas), central: n(o.central), haut: n(o.haut) }; }

// ── Méthode 1 : comparaison ────────────────────────────────────────────────────
// base = SHON autorisée si renseignée, sinon surface habitable. €/m² en fourchette.
export function methodeComparaison(input) {
  const shon = n(input.shon);
  const base = shon > 0 ? shon : n(input.surfaceHab);
  const pm = triplet(input.comparaison);
  return {
    base, baseType: shon > 0 ? 'SHON' : 'habitable',
    bas: base * pm.bas, central: base * pm.central, haut: base * pm.haut,
  };
}

// ── Méthode 2 : sol + construction ─────────────────────────────────────────────
// (charge foncière + bâti neuf déprécié) × (1 + prime de rareté), en fourchette.
export function methodeSolConstruction(input) {
  const shon = n(input.shon), shob = n(input.shob);
  const coutShon = input.coutShonM2 != null ? n(input.coutShonM2) : DEFAULTS.coutShonM2;
  const coutAnnexes = input.coutAnnexesM2 != null ? n(input.coutAnnexesM2) : DEFAULTS.coutAnnexesM2;
  const forfait = n(input.forfait);
  const vetuste = (input.vetustePct != null ? n(input.vetustePct) : DEFAULTS.vetustePct) / 100;
  const batiNeuf = shon * coutShon + Math.max(0, shob - shon) * coutAnnexes + forfait;
  const batiDeprecie = batiNeuf * (1 - vetuste);
  const cf = triplet(input.chargeFonciere);   // totaux € (= €/m² terrain × contenance, ou manuel)
  const prime = triplet(input.prime);          // en %
  const calc = (cfk, pk) => (cfk + batiDeprecie) * (1 + pk / 100);
  return {
    batiNeuf, batiDeprecie,
    bas: calc(cf.bas, prime.bas), central: calc(cf.central, prime.central), haut: calc(cf.haut, prime.haut),
  };
}

// ── Méthode 3 : capitalisation multi-lots ──────────────────────────────────────
// Revenu brut = loyers annuels + revenus saisonniers. Charges paramétrables.
// Valeur = revenu net / taux (taux bas → valeur basse, taux haut → valeur haute).
export function revenusLots(lots) {
  let annuel = 0, saisonnier = 0;
  (lots || []).forEach((l) => {
    const nb = n(l.nombre) || 1;
    if (l.mode === 'saisonnier') saisonnier += nb * n(l.semaines) * n(l.prixSemaine);
    else annuel += nb * n(l.loyerMensuel) * 12;
  });
  return { annuel, saisonnier, brut: annuel + saisonnier };
}

export function methodeCapitalisation(input) {
  const r = revenusLots(input.lots);
  const ch = input.charges || {};
  const gest = (ch.gestionSaisonnierePct != null ? n(ch.gestionSaisonnierePct) : DEFAULTS.gestionSaisonnierePct) / 100;
  const vac = (ch.vacancePct != null ? n(ch.vacancePct) : DEFAULTS.vacancePct) / 100;
  const forfaitCharges = n(ch.forfaitCharges);
  const charges = gest * r.saisonnier + vac * r.annuel + forfaitCharges;
  const revenuNet = r.brut - charges;
  const taux = triplet(input.taux); // %
  const val = (tk) => tk > 0 ? revenuNet / (tk / 100) : 0;
  // taux bas → valeur basse ; taux haut → valeur haute.
  return {
    revenuBrut: r.brut, revenuAnnuel: r.annuel, revenuSaisonnier: r.saisonnier,
    charges, revenuNet,
    bas: val(taux.bas), central: val(taux.central), haut: val(taux.haut),
  };
}

// ── Synthèse : moyenne pondérée séparée pour bas / central / haut ───────────────
export function calculerMethodes(input) {
  input = input || {};
  const comparaison = methodeComparaison(input);
  const solConstruction = methodeSolConstruction(input);
  const capitalisation = methodeCapitalisation(input);

  const actives = {
    comparaison: input.methodes ? input.methodes.comparaison !== false : true,
    solConstruction: input.methodes ? input.methodes.solConstruction !== false : true,
    capitalisation: input.methodes ? input.methodes.capitalisation !== false : true,
  };
  const p = Object.assign({}, DEFAULTS.poids, input.poids || {});
  const byKey = { comparaison, solConstruction, capitalisation };

  function pondere(champ) {
    let somme = 0, poidsTot = 0;
    Object.keys(actives).forEach((k) => {
      if (!actives[k]) return;
      const w = n(p[k]);
      if (w <= 0) return;
      somme += w * byKey[k][champ];
      poidsTot += w;
    });
    return poidsTot > 0 ? somme / poidsTot : 0;
  }

  const bruteBas = pondere('bas'), bruteCentral = pondere('central'), bruteHaut = pondere('haut');
  return {
    comparaison, solConstruction, capitalisation,
    poids: p, actives,
    synthese: {
      bas: arrondiValeur(bruteBas), central: arrondiValeur(bruteCentral), haut: arrondiValeur(bruteHaut),
      brut: { bas: bruteBas, central: bruteCentral, haut: bruteHaut },
    },
  };
}

export default { calculerMethodes, methodeComparaison, methodeSolConstruction, methodeCapitalisation, revenusLots, arrondiValeur, DEFAULTS };
