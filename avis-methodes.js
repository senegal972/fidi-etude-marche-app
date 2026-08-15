// ═══════════════════════════════════════════════════════════════════════════
// FIDI · Avis de valeur — moteurs de calcul (modèle Saint Joseph / CEE)
// 3 méthodes croisées + pondération finale.
// Module autonome, sans DOM ; entrée = objet plain, sortie = résultats chiffrés.
// API : window.FidiAvisMethodes = { spp, vetuste, sc, coeffEnv, dcf, ponderation,
//                                    defaults, BT01, POSTES_VETUSTE, COEFF_ENV_AXES }
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Table indice BT01 (bâtiment tous corps d'état) — INSEE ────────────────
  // Base janvier 2001 = 587,20 (référence du modèle). Actualisée manuellement
  // depuis les publications INSEE. À rafraîchir 1×/an.
  var BT01 = {
    baseRef: 587.20, // janvier 2001
    parAnnee: {
      2001: 587.20, 2005: 640.00, 2010: 796.00, 2015: 943.00,
      2018: 1029.00, 2020: 1061.00, 2021: 1128.00, 2022: 1234.00,
      2023: 1281.00, 2024: 1289.00, 2025: 1298.00, 2026: 1156.00,
      // 1156 = valeur du rapport Saint Joseph pour 2026 — à recouper INSEE
    },
    valeur: function (annee) {
      var v = this.parAnnee[annee];
      if (v) return v;
      // Interpolation linéaire entre les 2 années connues les plus proches
      var years = Object.keys(this.parAnnee).map(Number).sort(function (a, b) { return a - b; });
      if (annee <= years[0]) return this.parAnnee[years[0]];
      if (annee >= years[years.length - 1]) return this.parAnnee[years[years.length - 1]];
      for (var i = 0; i < years.length - 1; i++) {
        if (annee >= years[i] && annee < years[i + 1]) {
          var y0 = years[i], y1 = years[i + 1];
          var v0 = this.parAnnee[y0], v1 = this.parAnnee[y1];
          return v0 + (v1 - v0) * (annee - y0) / (y1 - y0);
        }
      }
      return this.parAnnee[years[years.length - 1]];
    },
    coefReeval: function (annee) {
      // Coefficient de réévaluation vs base 2001 (587,20)
      return this.valeur(annee) / this.baseRef;
    },
  };

  // ── Postes de vétusté (grille CEE, 16 postes, % max de vétusté) ───────────
  // Chaque poste porte une pondération dans le total vétusté du bâtiment.
  // Le total vétusté = somme (poids × % vétusté saisi / 100) → % global.
  var POSTES_VETUSTE = [
    { key: 'macon',        label: 'Fondations — Maçonnerie',                poids: 16.00 },
    { key: 'charpente',    label: 'Charpente — Poutres, solives',           poids:  2.40 },
    { key: 'couverture',   label: 'Couverture',                             poids:  2.70 },
    { key: 'isolation',    label: 'Isolation thermique',                    poids:  4.00 },
    { key: 'menExtPortes', label: 'Menuiseries extérieures — Portes',       poids:  0.88 },
    { key: 'menExtFen',    label: 'Menuiseries extérieures — Fenêtres',     poids:  1.93 },
    { key: 'menInt',       label: 'Menuiseries intérieures',                poids:  0.75 },
    { key: 'sols',         label: 'Sols',                                   poids:  4.00 },
    { key: 'serrurerie',   label: 'Serrurerie et quincaillerie',            poids:  0.15 },
    { key: 'revetements',  label: 'Revêtement des murs et pièces humides',  poids:  1.50 },
    { key: 'eauChaude',    label: 'Eau chaude',                             poids:  0.30 },
    { key: 'plomb',        label: 'Plomberie — Sanitaire (canalisations)',  poids:  2.40 },
    { key: 'plombApp',     label: 'Plomberie — Appareillage',               poids:  2.40 },
    { key: 'elec',         label: 'Électricité (prises + distribution)',    poids:  1.50 },
    { key: 'etatInt',      label: 'État intérieur (plâtres, peinture)',     poids:  4.00 },
    { key: 'equipCuisine', label: 'Équipement cuisine',                     poids:  1.00 },
    { key: 'viab',         label: 'Viabilisation — Assainissement',         poids:  1.50 },
  ];

  // ── Grille du coefficient environnemental (6 axes socio-économiques) ─────
  // Chaque axe : liste d'options (label + % pondéré). Somme des % = base
  // relative ; la charge foncière donne le coefficient de départ ; la somme
  // des axes ajuste selon la qualité du site.
  var COEFF_ENV_AXES = {
    emploi: {
      label: 'Emploi',
      options: [
        { v: 50, l: 'Secteur touristique / résidences secondaires' },
        { v: 40, l: 'Quartier de cadres sup. (grande ville)' },
        { v: 30, l: 'Emploi de cadres < 30 km' },
        { v: 20, l: 'Emploi entre 10-20 km (pas de cadres)' },
        { v: 10, l: 'Emploi > 20 km, accès difficile' },
      ],
    },
    transport: {
      label: 'Transport',
      options: [
        { v: 15, l: 'Gare TCSP à proximité immédiate' },
        { v: 12, l: 'Gare TCSP à 15-30 min à pied' },
        { v: 10, l: 'Gare à proximité, taxis nombreux' },
        { v:  5, l: 'Gare routière < 5 km' },
        { v:  0, l: 'Gare routière > 5 km' },
      ],
    },
    scolarite: {
      label: 'Scolarité',
      options: [
        { v: 40, l: 'Enseignement universitaire sur place' },
        { v: 35, l: 'Ville universitaire (1er/2e cycle) ou fac < 20 km' },
        { v: 30, l: 'Lycée' },
        { v: 25, l: 'Collège' },
        { v: 20, l: 'Primaires + ramassage secondaire' },
        { v: 15, l: 'Classes primaires' },
        { v: 10, l: 'Ramassage pour primaire' },
        { v:  0, l: 'Pas d\'école' },
      ],
    },
    equipement: {
      label: 'Équipement',
      options: [
        { v: 20, l: 'Tous commerces + grande surface + hôpital' },
        { v: 17, l: 'Tous commerces' },
        { v: 15, l: 'Commerces de base + pharmacie' },
        { v: 10, l: 'Commerces de base (ou grande surface < 10 km)' },
        { v:  5, l: 'Café, dépôt/épicerie' },
        { v:  0, l: 'Isolement total' },
      ],
    },
    agrement: {
      label: 'Agrément',
      options: [
        { v: 25, l: 'Ville à très fort caractère touristique' },
        { v: 20, l: 'Ville touristique' },
        { v: 15, l: 'Ville de renommée / résidences secondaires' },
        { v: 12, l: 'Nature agréable / campagne / périph. métropole' },
        { v:  0, l: 'Ville sans agrément' },
        { v: -10, l: 'Ville peu appréciée' },
      ],
    },
    voisinage: {
      label: 'Voisinage',
      options: [
        { v: 25, l: 'Centre-ville avec parc / villa bord de mer / montagne' },
        { v: 20, l: 'Immeubles beaux quartiers / grands terrains' },
        { v: 15, l: 'Zone pavillonnaire de standing' },
        { v: 12, l: 'Zone pavillonnaire' },
        { v:  5, l: 'Pavillon jumelé avec jardin' },
        { v:  3, l: '> 500 m de toute habitation' },
        { v: -10, l: 'Quartier peu apprécié' },
        { v: -20, l: 'Nuisances bruit / industrie / autoroute' },
      ],
    },
  };

  // ── Pondération des surfaces (coefficients standards) ─────────────────────
  var COEF_SURFACE_STD = {
    'plancher':     1.00,
    'sejour':       1.00,
    'debarras':     0.80,
    'terrasseCouv': 0.60,
    'balcon':       0.50,
    'terrasse':     0.50,
    'abri':         0.50,
    'stationnement':0.40,
    'garage':       0.60,
    'grenier':      0.30,
    'sousSol':      0.40,
  };

  // ── Surfaces pondérées (SPP) ──────────────────────────────────────────────
  // Entrée : [{ label, surface, coef }]
  // Sortie : { lignes, total }
  function spp(lignes) {
    if (!Array.isArray(lignes)) return { lignes: [], total: 0 };
    var out = lignes.map(function (l) {
      var s = Number(l.surface) || 0;
      var c = Number(l.coef);
      if (!(c >= 0)) c = 1;
      return { label: l.label || '', surface: s, coef: c, spp: s * c };
    });
    var total = out.reduce(function (a, x) { return a + x.spp; }, 0);
    return { lignes: out, total: Math.round(total * 100) / 100 };
  }

  // ── Vétusté globale pondérée ──────────────────────────────────────────────
  // Entrée : { key: pct }  (pct = % de vétusté saisi pour ce poste, 0-100)
  // Sortie : { postes: [...], total: % global }
  function vetuste(pcts) {
    pcts = pcts || {};
    var postes = POSTES_VETUSTE.map(function (p) {
      var pct = Number(pcts[p.key]) || 0;
      pct = Math.max(0, Math.min(100, pct));
      return { key: p.key, label: p.label, poids: p.poids, pct: pct, contrib: p.poids * pct / 100 };
    });
    var total = postes.reduce(function (a, p) { return a + p.contrib; }, 0);
    return { postes: postes, total: Math.round(total * 100) / 100 };
  }

  // ── Méthode Sol + Construction ────────────────────────────────────────────
  // input : {
  //   terrain: { surfTotale, surfAgrement, prixAgrementM2, prixResteM2, decotePct },
  //   construction: { spp, prixNeufM2, anneeEval, vetustePct },
  //   amenagements: montantForfait,
  //   coeffEnvPct: 100 (défaut)
  // }
  function sc(input) {
    input = input || {};
    var t = input.terrain || {};
    var c = input.construction || {};
    var surfTot = Number(t.surfTotale) || 0;
    var surfAgr = Number(t.surfAgrement) || 0;
    var surfRest = Math.max(0, surfTot - surfAgr);
    var pAgr = Number(t.prixAgrementM2) || 0;
    var pRest = Number(t.prixResteM2) || 0;
    var decotePct = Number(t.decotePct) || 0;

    var valTerrainBrut = surfAgr * pAgr + surfRest * pRest;
    var valTerrain = valTerrainBrut * (1 - decotePct / 100);

    var sppVal = Number(c.spp) || 0;
    var prixNeuf = Number(c.prixNeufM2) || 0;
    var annee = Number(c.anneeEval) || new Date().getFullYear();
    var coefBT01 = BT01.coefReeval(annee);
    var vetPct = Number(c.vetustePct) || 0;
    var valConstruction = sppVal * prixNeuf * coefBT01 * (1 - vetPct / 100);

    var amenag = Number(input.amenagements) || 0;
    var coeffEnvPct = Number(input.coeffEnvPct);
    if (!(coeffEnvPct > 0)) coeffEnvPct = 100;

    // Formule modèle CEE (Saint Joseph) : le coefficient environnemental
    // s'applique à (terrain + construction), puis on AJOUTE les aménagements
    // extérieurs (qui gardent leur valeur technique brute, non modulée).
    var valTechniqueSol = valTerrain + valConstruction;
    var valTechnique = valTechniqueSol + amenag;
    var valVenale = valTechniqueSol * coeffEnvPct / 100 + amenag;

    return {
      terrain: {
        surfTotale: surfTot, surfAgrement: surfAgr, surfReste: surfRest,
        prixAgrementM2: pAgr, prixResteM2: pRest, decotePct: decotePct,
        valeurBrute: Math.round(valTerrainBrut),
        valeur: Math.round(valTerrain),
      },
      construction: {
        spp: sppVal, prixNeufM2: prixNeuf, anneeEval: annee,
        coefBT01: Math.round(coefBT01 * 10000) / 10000,
        vetustePct: vetPct,
        valeur: Math.round(valConstruction),
      },
      amenagements: Math.round(amenag),
      valeurTechnique: Math.round(valTechnique),
      coeffEnvPct: coeffEnvPct,
      valeurVenale: Math.round(valVenale),
    };
  }

  // ── Coefficient environnemental ───────────────────────────────────────────
  // input : {
  //   chargeFoncierePct: 17 (parcelle base / (parcelle + maison base)),
  //   axes: { emploi: 40, transport: 10, scolarite: 25, equipement: 15,
  //           agrement: 12, voisinage: 12 },
  //   coefBase: null (auto depuis charge foncière) OU valeur forcée
  // }
  // Sortie : { charge, coefBase, sommeAxes, coefFinal }
  //
  // Loi charge foncière → coefficient (courbe empirique du modèle) :
  //   charge foncière faible (bien inséré dans site cher) → coef élevé
  //   ~5%  → 180 %
  //   ~10% → 130 %
  //   ~15% → 100 %
  //   ~20% → 80 %
  //   ~30% → 65 %
  //   ~40% → 55 %
  //   ~50%+ → 45 %
  var CHARGE_COURBE = [
    { c:  5, k: 180 }, { c: 10, k: 130 }, { c: 15, k: 100 }, { c: 17, k:  90 },
    { c: 20, k:  80 }, { c: 25, k:  72 }, { c: 30, k:  65 }, { c: 40, k:  55 },
    { c: 50, k:  48 }, { c: 60, k:  45 }, { c: 80, k:  40 },
  ];
  function courbeChargeFonciere(chargePct) {
    if (chargePct <= CHARGE_COURBE[0].c) return CHARGE_COURBE[0].k;
    var last = CHARGE_COURBE[CHARGE_COURBE.length - 1];
    if (chargePct >= last.c) return last.k;
    for (var i = 0; i < CHARGE_COURBE.length - 1; i++) {
      var a = CHARGE_COURBE[i], b = CHARGE_COURBE[i + 1];
      if (chargePct >= a.c && chargePct < b.c) {
        return a.k + (b.k - a.k) * (chargePct - a.c) / (b.c - a.c);
      }
    }
    return last.k;
  }

  // input : { chargeFoncierePct, axes: {...}, mode, coefManuel }
  //   mode = 'moyenne' (défaut, CEE Saint Joseph) : (coefBase + sommeAxes) / 2
  //   mode = 'critères' : coefFinal = sommeAxes (l'expert privilégie l'analyse socio)
  //   mode = 'charge'   : coefFinal = coefBase (l'expert privilégie la charge foncière)
  //   mode = 'manuel'   : coefFinal = coefManuel (l'expert saisit directement)
  function coeffEnv(input) {
    input = input || {};
    var charge = Number(input.chargeFoncierePct) || 0;
    var coefBase = (input.coefBase != null) ? Number(input.coefBase) : courbeChargeFonciere(charge);
    var axes = input.axes || {};
    var somme = 0;
    var detail = {};
    Object.keys(COEFF_ENV_AXES).forEach(function (k) {
      var v = Number(axes[k]) || 0;
      detail[k] = v;
      somme += v;
    });
    var mode = input.mode || 'moyenne';
    var coefFinal;
    if (mode === 'manuel' && input.coefManuel != null) coefFinal = Number(input.coefManuel);
    else if (mode === 'critères' || mode === 'criteres') coefFinal = somme;
    else if (mode === 'charge') coefFinal = coefBase;
    else coefFinal = (coefBase + somme) / 2; // moyenne (défaut)
    return {
      chargeFoncierePct: charge,
      coefBase: Math.round(coefBase * 10) / 10,
      sommeAxes: somme,
      detail: detail,
      mode: mode,
      coefFinal: Math.round(coefFinal * 10) / 10,
    };
  }

  // ── Méthode DCF (Discounted Cash Flow) — 10 ans par défaut ────────────────
  // input : {
  //   loyerMensuel, tauxRevalLoyer (%), horizonAn (10),
  //   charges: { taxeFonc, pno, gestionPct, impayesPct, vacancePct, maintenanceParM2 },
  //   surface,               // pour le forfait maintenance €/m²
  //   travauxImmediat,       // one-shot année 1
  //   depotGarantie,         // 1 mois par défaut
  //   tauxRemDG (%), tauxActualisation (%), tauxCapitalisationFin (%),
  //   tauxRevalCharges (%)
  // }
  function dcf(input) {
    input = input || {};
    var loyerM = Number(input.loyerMensuel) || 0;
    var revalLoy = (Number(input.tauxRevalLoyer) || 0) / 100;
    var horizon = Number(input.horizonAn) || 10;
    var ch = input.charges || {};
    var tf = Number(ch.taxeFonc) || 0;
    var pno = Number(ch.pno) || 0;
    var gestPct = (Number(ch.gestionPct) || 0) / 100;
    var impPct  = (Number(ch.impayesPct) || 0) / 100;
    var vacPct  = (Number(ch.vacancePct) || 0) / 100;
    var maintM2 = Number(ch.maintenanceParM2) || 0;
    var surface = Number(input.surface) || 0;
    var travImm = Number(input.travauxImmediat) || 0;
    var dg = Number(input.depotGarantie) || loyerM;
    var remDG = (Number(input.tauxRemDG) || 0) / 100;
    var actu = (Number(input.tauxActualisation) || 0) / 100;
    var capFin = (Number(input.tauxCapitalisationFin) || 0) / 100;
    var revalCh = (Number(input.tauxRevalCharges) || 0) / 100;

    var lignes = [];
    var sommeActualisee = 0;
    var loyerAnnuelBase = loyerM * 12;

    for (var t = 1; t <= horizon; t++) {
      var loyer = loyerAnnuelBase * Math.pow(1 + revalLoy, t - 1);
      var rDG = dg * remDG;
      var revenus = loyer + rDG;

      var tfT = tf * Math.pow(1 + revalCh, t - 1);
      var pnoT = pno * Math.pow(1 + revalCh, t - 1);
      var gest = loyer * gestPct;
      var imp = loyer * impPct;
      var vac = loyer * vacPct;
      var maint = surface * maintM2 * Math.pow(1 + revalCh, t - 1);
      var trav = (t === 1) ? travImm : 0;

      var charges = tfT + pnoT + gest + imp + vac + maint + trav;
      var revenuNet = revenus - charges;
      var actuFacteur = Math.pow(1 + actu, t);
      var netActu = revenuNet / actuFacteur;

      sommeActualisee += netActu;
      lignes.push({
        annee: t, loyer: Math.round(loyer), remDG: Math.round(rDG),
        revenus: Math.round(revenus), taxeFonc: Math.round(tfT), pno: Math.round(pnoT),
        gestion: Math.round(gest), impayes: Math.round(imp), vacance: Math.round(vac),
        maintenance: Math.round(maint), travaux: Math.round(trav),
        charges: Math.round(charges), revenuNet: Math.round(revenuNet),
        netActualise: Math.round(netActu),
      });
    }

    // Valeur résiduelle au terme (modèle CEE) : capitalisation du LOYER ANNUEL
    // brut de la dernière année sur le taux de capitalisation en fin d'horizon.
    // (Représente la valeur de la maison à revendre à N ans.)
    var loyerFin = lignes[lignes.length - 1].loyer;
    var valResiduelleBrute = (capFin > 0) ? loyerFin / capFin : 0;
    var valResiduelleActu = valResiduelleBrute / Math.pow(1 + actu, horizon);

    var valeurVenale = sommeActualisee + valResiduelleActu;

    return {
      lignes: lignes,
      sommeActualisee: Math.round(sommeActualisee),
      valeurResiduelleBrute: Math.round(valResiduelleBrute),
      valeurResiduelleActu: Math.round(valResiduelleActu),
      valeurVenale: Math.round(valeurVenale),
    };
  }

  // ── Pondération multi-méthodes ────────────────────────────────────────────
  // input : { sc: valeur, dcf: valeur, comp: valeur, poids: { sc, dcf, comp } }
  // Poids : nombres relatifs (ex 1,1,1 → simple moyenne). null/0 = méthode ignorée.
  function ponderation(input) {
    input = input || {};
    var vals = { sc: input.sc, dcf: input.dcf, comp: input.comp };
    var poids = input.poids || { sc: 1, dcf: 1, comp: 1 };
    var num = 0, den = 0;
    var detail = {};
    ['sc', 'dcf', 'comp'].forEach(function (k) {
      var v = Number(vals[k]);
      var p = Number(poids[k]) || 0;
      if (v > 0 && p > 0) {
        num += v * p;
        den += p;
        detail[k] = { valeur: Math.round(v), poids: p, contrib: Math.round(v * p) };
      }
    });
    var valeur = den > 0 ? num / den : 0;
    // Arrondi à la centaine pour un rendu propre
    var arr = Math.round(valeur / 100) * 100;
    return { valeur: arr, sommePoids: den, detail: detail };
  }

  // ── Valeurs par défaut (mode Simple : pré-remplit sans intervention) ──────
  var defaults = {
    surfacesLignes: function (surfaceHab) {
      surfaceHab = Number(surfaceHab) || 0;
      return [
        { label: 'Rez-de-chaussée (plancher)', surface: surfaceHab, coef: 1.00 },
        { label: 'Balcon / terrasse',          surface: 0,          coef: 0.50 },
        { label: 'Aire de stationnement',      surface: 0,          coef: 0.40 },
      ];
    },
    vetuste: function () {
      // 30 % de vétusté globale par défaut (bien d'occasion en état correct)
      var out = {};
      POSTES_VETUSTE.forEach(function (p) { out[p.key] = 30; });
      return out;
    },
    coeffEnv: function () {
      return {
        chargeFoncierePct: 17,
        axes: { emploi: 20, transport: 5, scolarite: 25, equipement: 15, agrement: 12, voisinage: 12 },
      };
    },
    dcfCharges: function (surface, loyerAnnuel) {
      surface = Number(surface) || 0;
      loyerAnnuel = Number(loyerAnnuel) || 0;
      return {
        taxeFonc: Math.round(loyerAnnuel * 0.10),  // ~1 mois de loyer / an
        pno: Math.round(surface * 2),               // ~2 €/m²/an
        gestionPct: 8,
        impayesPct: 5,
        vacancePct: 5,
        maintenanceParM2: 8,
      };
    },
    dcfTaux: {
      horizonAn: 10,
      tauxRevalLoyer: 1.00,
      tauxRevalCharges: 1.00,
      tauxRemDG: 0.50,
      tauxActualisation: 5.90,
      tauxCapitalisationFin: 5.50,
    },
    scPrixNeufM2: {
      // €/m² valeur janvier 2001 (à multiplier par coef BT01)
      // Le modèle Saint Joseph utilise 850 €/m² pour une maison ordinaire
      maison_ordinaire: 850,
      maison_standing:  1100,
      maison_luxe:      1500,
      appartement:      900,
      local_commercial: 700,
    },
  };

  window.FidiAvisMethodes = {
    BT01: BT01,
    POSTES_VETUSTE: POSTES_VETUSTE,
    COEFF_ENV_AXES: COEFF_ENV_AXES,
    COEF_SURFACE_STD: COEF_SURFACE_STD,
    spp: spp,
    vetuste: vetuste,
    sc: sc,
    coeffEnv: coeffEnv,
    dcf: dcf,
    ponderation: ponderation,
    defaults: defaults,
  };
})();
