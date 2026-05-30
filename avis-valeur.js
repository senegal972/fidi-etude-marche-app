/* ============================================================
   FIDI · Avis de valeur — module autonome
   ------------------------------------------------------------
   Récupère les résultats de l'étude de marché (window.__fidiData /
   window.__fidiInputs) pour pré-remplir un avis de valeur
   professionnel, éditable, exportable en PDF (impression) et Word.
   Persistance via localStorage. Aucune dépendance hors Bootstrap.
   Exposé : window.AvisValeur.open()
   ============================================================ */
(function () {
  'use strict';

  // ── Utils ───────────────────────────────────────────────────
  var nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function fmt(n, dec) {
    if (n === '' || n === null || n === undefined || isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }
  function fmtE(n) { return (n === '' || n === null || n === undefined || isNaN(Number(n))) ? '—' : fmt(n) + ' €'; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function formatDateFR(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a && a[k]; }, o); }
  function setPath(o, path, v) {
    var ks = path.split('.'), last = ks.pop(), t = o;
    for (var i = 0; i < ks.length; i++) t = t[ks[i]];
    t[last] = v;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // ── Modèle par défaut ───────────────────────────────────────
  function defaultData() {
    var y = new Date().getFullYear();
    return {
      metadata: { ref: 'FIDI-AV-' + y + '-001', date: new Date().toISOString().slice(0, 10), lieuEtablissement: 'Fort-de-France' },
      bien: {
        type: 'Appartement', adresse: '', cp: '', commune: '', immeuble: '', etage: '',
        surfaceCarrez: '', surfaceShob: '', sejour: '', terrasse: '', parking: '',
        regime: 'Copropriété', nbLots: '', taxeFonciere: '', statut: 'occupe',
        loyer: '', bailDateDebut: '', bailDuree: '36', prixVente: ''
      },
      marche: {
        sources: [{ nom: '', bas: '', moyen: '', haut: '' }],
        moyenneBas: '', moyenneMoyen: '', moyenneHaut: '', evol12m: '', evol3m: '', commentaire: ''
      },
      loyers: [{ type: '', surface: '', loyer: '', secteur: '' }],
      calcul: { tauxCapi: 6.5, decoteOccupation: 10, valeurOccupeeBasseManuel: '', valeurOccupeeHauteManuel: '' },
      comparables: [],
      acm: { prixM2Manuel: '' },
      ponderation: { active: false,
        coefTerrasse: 0.3, coefBalcon: 0.5, coefParking: 0.5, coefJardin: 0.1,
        surfBalcon: '', surfParking: '', surfJardin: '' },
      methodes: {
        comparaison:     { on: true,  poids: 50 },
        surfacePonderee: { on: false, poids: 0 },
        capitalisation:  { on: true,  poids: 20 },
        cout:            { on: false, poids: 0, valeurTerrain: '', coutConstructionM2: '', vetustePct: '' }
      },
      atouts: [''],
      vigilances: [''],
      conclusion: { texte: '', potentielBas: '', potentielHaut: '' },
      reserves: "Le présent avis a été établi sur la base des informations communiquées par le mandant et des données publiques de marché. Il n'engage le rédacteur qu'à hauteur d'un avis indicatif. Il ne se substitue ni à une expertise judiciaire, ni à un rapport d'évaluation au sens de la Charte de l'Expertise en Évaluation Immobilière.\n\nLa valeur retenue est susceptible d'évoluer en fonction : (i) d'éventuels diagnostics techniques défavorables (amiante, termites, électricité, DPE, ERP – risques cycloniques et sismiques en Martinique) non encore portés à notre connaissance ; (ii) de l'état réel du locataire en place (régularité des paiements, durée de bail résiduelle, indexation IRL) ; (iii) de l'évolution du marché immobilier local sur les 12 prochains mois.\n\nAucune visite physique du bien n'a été matérialisée par procès-verbal contradictoire ; l'avis repose sur les éléments documentaires transmis.",
      signataire: {
        nom: 'Franck FIDI', fonction: 'Mandataire en immobilier',
        email: 'franck.fidi@sextantfrance.fr', societe: 'OPTIMMO DOM',
        adresseSociete: '483 Avenue Victor Coridun, 97200 Fort-de-France'
      }
    };
  }

  // ── Persistance ─────────────────────────────────────────────
  var SIGN_KEY = 'fidi:avis:signataire';
  var AVIS_PREFIX = 'fidi:avis:doc:';
  function loadSignataire() {
    try { var s = localStorage.getItem(SIGN_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function saveSignataire(sig) {
    try { localStorage.setItem(SIGN_KEY, JSON.stringify(sig)); return true; } catch (e) { return false; }
  }
  function listSavedAvis() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(AVIS_PREFIX) === 0) out.push(k.slice(AVIS_PREFIX.length));
      }
    } catch (e) {}
    return out.sort();
  }

  // ── Pré-remplissage depuis l'étude de marché ────────────────
  function typeFromInput(t) {
    if (t === 'maison') return 'Maison';
    if (t === 'appartement') return 'Appartement';
    return 'Appartement';
  }
  function evolutionFromDvf(dvfAnnees, typeBien) {
    var field = (typeBien || '').indexOf('maison') >= 0 ? 'prix_m2_maison' : 'prix_m2_appart';
    var pts = (dvfAnnees || []).filter(function (r) { return r[field]; }).map(function (r) { return [r.annee, Number(r[field])]; });
    if (pts.length < 2) return null;
    pts.sort(function (a, b) { return a[0] - b[0]; });
    var p0 = pts[0][1], pn = pts[pts.length - 1][1];
    if (!p0 || !pn) return null;
    var evol = Math.round(((pn - p0) / p0) * 100);
    return { pct: evol, periode: pts[0][0] + '–' + pts[pts.length - 1][0] };
  }
  function risquesToVigilances(risques, scoreAxes) {
    var out = [];
    if (!risques) risques = {};
    var sismo = risques.sismicite, zone = null;
    if (Array.isArray(sismo) && sismo.length) zone = sismo[0].zone_sismicite || sismo[0].zone;
    else if (sismo && typeof sismo === 'object') zone = sismo.zone_sismicite || sismo.zone;
    if (zone) {
      var z = String(zone).replace(/zone/i, '').trim();
      out.push('Zone de sismicité ' + z + ' — application des normes parasismiques (contexte antillais).');
    }
    var radon = risques.radon, cat = null;
    if (Array.isArray(radon) && radon.length) cat = radon[0].categorie || radon[0].classe_potentiel;
    else if (radon && typeof radon === 'object') cat = radon.categorie || radon.classe_potentiel;
    if (cat && String(cat).trim() === '3') out.push('Potentiel radon de catégorie 3 (élevé) sur la commune.');
    if (scoreAxes && scoreAxes.risques && scoreAxes.risques.detail &&
        scoreAxes.risques.detail.toLowerCase().indexOf('aucun risque') < 0) {
      out.push('Risques naturels : ' + scoreAxes.risques.detail + '.');
    }
    if (scoreAxes && scoreAxes.dpe && scoreAxes.dpe.detail &&
        /énergivore|médiocre|F-G/i.test(scoreAxes.dpe.detail)) {
      out.push('Performance énergétique du secteur : ' + scoreAxes.dpe.detail + '.');
    }
    return out;
  }
  function atoutsFromScore(score) {
    var out = [];
    if (!score) return out;
    if (score.verdict && score.total != null) out.push('Potentiel de marché jugé « ' + score.verdict + ' » (' + score.total + '/100, étude FIDI).');
    var ax = score.axes || {};
    if (ax.attractivite && ax.attractivite.detail) out.push(ax.attractivite.detail + '.');
    if (ax.activite && ax.activite.detail) out.push(ax.activite.detail + '.');
    if (ax.tendance && ax.tendance.detail && /hausse/i.test(ax.tendance.detail)) out.push('Tendance des prix : ' + ax.tendance.detail + '.');
    return out;
  }

  function buildPrefillFromEtude(fidi, inputs) {
    var d = defaultData();
    var sig = loadSignataire();
    if (sig) d.signataire = Object.assign({}, d.signataire, sig);
    if (!fidi) return d;

    var loc = fidi.localisation || {};
    var est = fidi.estimation || {};
    var score = fidi.score || {};
    var typeBien = (fidi.type_bien || (inputs && inputs.typeBien) || '').toLowerCase();

    d.bien.type = typeFromInput(typeBien);
    if (typeBien === 'maison') d.bien.regime = 'Monopropriété';
    // Adresse : on tente de séparer la voie du code postal/commune
    d.bien.adresse = (inputs && inputs.adresse) || loc.label || '';
    d.bien.cp = loc.postcode || '';
    d.bien.commune = loc.city || '';
    if (inputs && inputs.surface) d.bien.surfaceCarrez = String(inputs.surface);
    else if (fidi.surface) d.bien.surfaceCarrez = String(fidi.surface);

    var prixM2 = est.prix_m2 || null;
    var surf = num(d.bien.surfaceCarrez);
    if (prixM2) {
      var bas = surf > 0 && est.valeur_min ? Math.round(est.valeur_min / surf) : Math.round(prixM2 * 0.85);
      var haut = surf > 0 && est.valeur_max ? Math.round(est.valeur_max / surf) : Math.round(prixM2 * 1.20);
      d.marche.moyenneBas = String(bas);
      d.marche.moyenneMoyen = String(prixM2);
      d.marche.moyenneHaut = String(haut);
    }
    if (est.valeur_med) d.bien.prixVente = String(est.valeur_med);

    // Sources : médiane locale + une ligne par année DVF
    var sources = [];
    var med = (fidi.valoris && (fidi.valoris[typeBien] || fidi.valoris.tous)) || null;
    if (med && med.prix_median_m2) {
      sources.push({ nom: 'DVF — médiane locale (data.gouv.fr)', bas: '', moyen: String(med.prix_median_m2), haut: '' });
    }
    var field = typeBien.indexOf('maison') >= 0 ? 'prix_m2_maison' : 'prix_m2_appart';
    (fidi.dvf_annees || []).forEach(function (r) {
      if (r[field]) sources.push({ nom: 'DVF ' + r.annee, bas: '', moyen: String(r[field]), haut: '' });
    });
    if (sources.length) d.marche.sources = sources;

    var evo = evolutionFromDvf(fidi.dvf_annees, typeBien);
    var tendDetail = score.axes && score.axes.tendance ? score.axes.tendance.detail : '';
    if (evo) d.marche.commentaire = 'Évolution observée ' + (evo.pct >= 0 ? '+' : '') + evo.pct + ' % sur la période ' + evo.periode + (tendDetail ? ' (' + tendDetail + ')' : '') + '.';
    else if (tendDetail) d.marche.commentaire = tendDetail + '.';

    var vig = risquesToVigilances(fidi.risques, score.axes);
    if (vig.length) d.vigilances = vig;
    var at = atoutsFromScore(score);
    if (at.length) d.atouts = at;

    return d;
  }

  // ── Calculs ─────────────────────────────────────────────────
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // Statistiques ACM : €/m² ajustés des comparables inclus
  function acmStats(data) {
    var arr = [];
    (data.comparables || []).forEach(function (cp) {
      if (cp.inclus === false) return;
      var su = num(cp.surface), pr = num(cp.prix);
      if (su > 0 && pr > 0) arr.push((pr / su) * (1 + num(cp.ajustementPct) / 100));
    });
    var mean = arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0;
    return { count: arr.length, median: arr.length ? Math.round(median(arr)) : 0, mean: Math.round(mean) };
  }
  // €/m² ACM retenu : override manuel > médiane comparables > moyenne de l'étude (fallback)
  function acmRetenuM2(data) {
    if (data.acm && data.acm.prixM2Manuel) return num(data.acm.prixM2Manuel);
    var st = acmStats(data);
    if (st.count) return st.median;
    return num(data.marche.moyenneMoyen);
  }
  function surfacePonderee(data) {
    var b = data.bien, po = data.ponderation || {};
    return num(b.surfaceCarrez)
      + num(b.terrasse) * num(po.coefTerrasse)
      + num(po.surfBalcon) * num(po.coefBalcon)
      + num(po.surfParking) * num(po.coefParking)
      + num(po.surfJardin) * num(po.coefJardin);
  }

  function compute(data) {
    var b = data.bien, m = data.marche, c = data.calcul, M = data.methodes || {};
    var s = num(b.surfaceCarrez), p = num(b.prixVente), loyer = num(b.loyer);
    var taux = num(c.tauxCapi), decote = num(c.decoteOccupation);
    var occ = b.statut === 'occupe';

    var prixM2 = s > 0 && p > 0 ? p / s : 0;
    var rendementBrut = p > 0 && loyer > 0 ? (loyer * 12 / p) * 100 : 0;

    // Référence étude (comparaison brute, conservée pour affichage)
    var vlBas = Math.round(s * num(m.moyenneBas));
    var vlMoy = Math.round(s * num(m.moyenneMoyen));
    var vlHaut = Math.round(s * num(m.moyenneHaut));

    // ── Méthodes ──
    var acm = acmRetenuM2(data);
    var stats = acmStats(data);
    var sPond = surfacePonderee(data);
    var valComparaison = acm > 0 && s > 0 ? Math.round(acm * s / 1000) * 1000 : 0;
    var valSurfPond = acm > 0 && sPond > 0 ? Math.round(acm * sPond / 1000) * 1000 : 0;
    var valeurCapi = loyer > 0 && taux > 0 ? Math.round((loyer * 12 / (taux / 100)) / 500) * 500 : 0;
    var cout = M.cout || {};
    var valCout = (num(cout.coutConstructionM2) > 0 && s > 0)
      ? Math.round((num(cout.valeurTerrain) + num(cout.coutConstructionM2) * s * (1 - num(cout.vetustePct) / 100)) / 1000) * 1000
      : 0;

    var methodes = [
      { key: 'comparaison', label: 'Comparaison directe (ACM)', on: !!(M.comparaison && M.comparaison.on), poids: num(M.comparaison && M.comparaison.poids), val: valComparaison },
      { key: 'surfacePonderee', label: 'Surface pondérée', on: !!(M.surfacePonderee && M.surfacePonderee.on), poids: num(M.surfacePonderee && M.surfacePonderee.poids), val: valSurfPond },
      { key: 'capitalisation', label: 'Capitalisation du revenu', on: !!(M.capitalisation && M.capitalisation.on), poids: num(M.capitalisation && M.capitalisation.poids), val: valeurCapi },
      { key: 'cout', label: 'Coût (sol + construction)', on: !!(M.cout && M.cout.on), poids: num(M.cout && M.cout.poids), val: valCout }
    ];
    var wsum = 0, vsum = 0;
    methodes.forEach(function (e) {
      e.actif = e.on && e.val > 0 && e.poids > 0;
      if (e.actif) { wsum += e.poids; vsum += e.val * e.poids; }
    });
    methodes.forEach(function (e) { e.contribution = e.actif ? Math.round(e.val * e.poids / wsum) : 0; });
    var valPonderee = wsum > 0 ? Math.round((vsum / wsum) / 1000) * 1000 : 0;

    // Valeur retenue (fourchette) — pondérée, décote d'occupation si occupé, override manuel conservé
    var central = valPonderee || vlMoy;
    var centralFinal = occ ? central * (1 - decote / 100) : central;
    var autoBas = Math.round(centralFinal * 0.95 / 1000) * 1000;
    var autoHaut = Math.round(centralFinal * 1.05 / 1000) * 1000;
    var voccBas = c.valeurOccupeeBasseManuel ? num(c.valeurOccupeeBasseManuel) : autoBas;
    var voccHaut = c.valeurOccupeeHauteManuel ? num(c.valeurOccupeeHauteManuel) : autoHaut;

    return {
      prixM2: prixM2, rendementBrut: rendementBrut, valeurCapi: valeurCapi,
      vlBas: vlBas, vlMoy: vlMoy, vlHaut: vlHaut,
      acmM2: acm, acmMedian: stats.median, acmMean: stats.mean, acmCount: stats.count,
      surfacePond: sPond, valComparaison: valComparaison, valSurfPond: valSurfPond, valCout: valCout,
      methodes: methodes, valPonderee: valPonderee,
      voccBas: voccBas, voccHaut: voccHaut
    };
  }

  // ── État ────────────────────────────────────────────────────
  var state = { data: null, section: 'metadata', preview: true, modal: null, built: false };

  var SECTIONS = [
    { id: 'metadata', label: '1. Référence' },
    { id: 'bien', label: '2. Le bien' },
    { id: 'marche', label: '3. Marché' },
    { id: 'comparables', label: '4. Comparables (ACM)' },
    { id: 'loyers', label: '5. Loyers' },
    { id: 'calcul', label: '6. Valeur' },
    { id: 'swot', label: '7. Atouts & vigilance' },
    { id: 'conclusion', label: '8. Conclusion' },
    { id: 'reserves', label: '9. Réserves' },
    { id: 'signature', label: '10. Signataire' }
  ];

  var PORTAILS = ['Leboncoin', 'SeLoger', 'Bien’ici', 'Logic-Immo', 'PAP', 'Figaro Immo', 'DVF', 'Autre'];
  var ETATS = ['', 'Neuf', 'Excellent', 'Bon', 'À rafraîchir', 'À rénover'];
  function comparableTemplate(over) {
    return Object.assign({
      nature: 'annonce', source: 'Leboncoin', type: '', secteur: '', surface: '', prix: '',
      date: '', etat: '', etage: '', exposition: '', annexes: '', lien: '', ajustementPct: '', inclus: true, note: ''
    }, over || {});
  }

  // ── Champs réutilisables ────────────────────────────────────
  function fld(label, path, opts) {
    opts = opts || {};
    var type = opts.type || 'text';
    var v = esc(getPath(state.data, path) || '');
    var attrs = 'data-p="' + path + '"' + (opts.step ? ' step="' + opts.step + '"' : '') + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '');
    var input;
    if (type === 'textarea') input = '<textarea rows="' + (opts.rows || 3) + '" ' + attrs + '>' + v + '</textarea>';
    else if (type === 'select') {
      input = '<select ' + attrs + '>' + opts.options.map(function (o) {
        return '<option' + (String(o) === String(getPath(state.data, path)) ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select>';
    } else input = '<input type="' + type + '" value="' + v + '" ' + attrs + '/>';
    return '<div class="av-field"><label>' + esc(label) + (opts.flag ? '<span class="av-prefill-flag">étude</span>' : '') + '</label>' + input +
      (opts.tip ? '<div class="av-tip">' + esc(opts.tip) + '</div>' : '') + '</div>';
  }

  function fldRaw(path, value, type, step) {
    return '<input type="' + (type || 'text') + '"' + (step ? ' step="' + step + '"' : '') +
      ' value="' + esc(value == null ? '' : value) + '" data-p="' + path + '"/>';
  }

  function renderSection(id) {
    var d = state.data, b = d.bien;
    if (id === 'metadata') {
      return head('Référence et date', "Identifiants administratifs de l'avis") +
        fld('Référence interne', 'metadata.ref', { tip: 'Format conseillé : FIDI-AV-AAAA-NNN' }) +
        '<div class="av-grid-2">' + fld("Date d'établissement", 'metadata.date', { type: 'date' }) +
        fld("Lieu d'établissement", 'metadata.lieuEtablissement') + '</div>';
    }
    if (id === 'bien') {
      var occ = b.statut === 'occupe';
      return head('Identification du bien', 'Description précise et situation locative') +
        '<div class="av-grid-2">' +
        fld('Type de bien', 'bien.type', { type: 'select', options: ['Studio', 'T1', 'T2', 'T3', 'T4', 'T5+', 'Appartement', 'Maison', 'Villa', 'Terrain', 'Local commercial', 'Immeuble'], flag: true }) +
        fld('Régime juridique', 'bien.regime', { type: 'select', options: ['Copropriété', 'Monopropriété', 'Indivision', 'Lotissement'] }) + '</div>' +
        fld('Adresse', 'bien.adresse', { flag: true, ph: 'ex : Chemin Galette' }) +
        '<div class="av-grid-3">' + fld('Code postal', 'bien.cp', { flag: true }) + fld('Commune', 'bien.commune', { flag: true }) + fld('Étage', 'bien.etage', { ph: '4e et dernier' }) + '</div>' +
        fld('Description immeuble', 'bien.immeuble', { tip: 'Année de livraison, niveaux, ascenseur…', ph: 'Résidence 2009 – R+3 – 16 lots' }) +
        '<div class="av-grid-4">' + fld('Surface Carrez (m²)', 'bien.surfaceCarrez', { type: 'number', flag: true }) + fld('Surface SHOB (m²)', 'bien.surfaceShob', { type: 'number' }) + fld('Séjour (m²)', 'bien.sejour', { type: 'number' }) + fld('Terrasse/Balcon (m²)', 'bien.terrasse', { type: 'number', step: '0.01' }) + '</div>' +
        '<div class="av-grid-3">' + fld('Stationnement', 'bien.parking', { ph: '1 place couverte' }) + fld('Nb. lots (copro)', 'bien.nbLots', { type: 'number' }) + fld('Taxe foncière (€/an)', 'bien.taxeFonciere', { type: 'number' }) + '</div>' +
        '<div class="av-box"><div style="display:flex;gap:1rem;margin-bottom:.6rem;">' +
        '<label style="font-weight:600;font-size:.85rem;cursor:pointer;"><input type="radio" name="avStatut" value="libre" data-radio="bien.statut"' + (!occ ? ' checked' : '') + '/> Bien libre</label>' +
        '<label style="font-weight:600;font-size:.85rem;cursor:pointer;"><input type="radio" name="avStatut" value="occupe" data-radio="bien.statut"' + (occ ? ' checked' : '') + '/> Bien occupé</label></div>' +
        (occ ? '<div class="av-grid-3">' + fld('Loyer mensuel (€)', 'bien.loyer', { type: 'number' }) + fld('Début du bail', 'bien.bailDateDebut', { type: 'date' }) + fld('Durée bail (mois)', 'bien.bailDuree', { type: 'number' }) + '</div>' : '') +
        '</div>' +
        fld('Prix de cession / proposé (€)', 'bien.prixVente', { type: 'number', flag: true, tip: "Net vendeur, hors frais d'agence" });
    }
    if (id === 'marche') {
      var rows = d.marche.sources.map(function (s, i) {
        return '<div class="av-row" style="grid-template-columns:1fr 70px 70px 70px 28px;">' +
          '<input type="text" placeholder="ex : DVF 2024" value="' + esc(s.nom) + '" data-list="marche.sources" data-idx="' + i + '" data-key="nom"/>' +
          '<input type="number" placeholder="Bas" value="' + esc(s.bas) + '" data-list="marche.sources" data-idx="' + i + '" data-key="bas"/>' +
          '<input type="number" placeholder="Moyen" value="' + esc(s.moyen) + '" data-list="marche.sources" data-idx="' + i + '" data-key="moyen"/>' +
          '<input type="number" placeholder="Haut" value="' + esc(s.haut) + '" data-list="marche.sources" data-idx="' + i + '" data-key="haut"/>' +
          '<button class="av-del" data-listdel="marche.sources" data-idx="' + i + '" title="Supprimer">✕</button></div>';
      }).join('');
      return head('Analyse du marché local', 'Sources et prix au m² constatés') +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem;"><label style="font-weight:700;font-size:.78rem;">Sources de prix au m² <span class="av-prefill-flag">étude</span></label>' +
        '<button class="av-add" data-listadd="marche.sources">+ Ajouter une source</button></div>' + rows +
        '<div class="av-box"><div class="av-box-title">Moyenne retenue pour le calcul</div><div class="av-grid-3">' +
        fld('Prix bas (€/m²)', 'marche.moyenneBas', { type: 'number', flag: true }) + fld('Prix moyen (€/m²)', 'marche.moyenneMoyen', { type: 'number', flag: true }) + fld('Prix haut (€/m²)', 'marche.moyenneHaut', { type: 'number', flag: true }) + '</div></div>' +
        '<div class="av-grid-2">' + fld('Évolution 12 mois', 'marche.evol12m', { ph: '+3 %' }) + fld('Évolution 3 mois', 'marche.evol3m', { ph: '+6 %' }) + '</div>' +
        fld('Commentaire de tendance', 'marche.commentaire', { type: 'textarea', rows: 2, flag: true });
    }
    if (id === 'comparables') {
      var nbDvf = (window.__fidiTransactions || []).length;
      var cards = (d.comparables || []).map(function (cp, i) {
        var vendu = cp.nature === 'vendu';
        var badge = vendu
          ? '<span style="background:#198754;color:#fff;font-size:.6rem;font-weight:700;border-radius:3px;padding:1px 5px;">VENDU · DVF</span>'
          : '<span style="background:#0d6efd;color:#fff;font-size:.6rem;font-weight:700;border-radius:3px;padding:1px 5px;">ANNONCE</span>';
        function li(key, ph, type) {
          return '<input type="' + (type || 'text') + '" placeholder="' + esc(ph) + '" value="' + esc(cp[key]) + '" data-list="comparables" data-idx="' + i + '" data-key="' + key + '"/>';
        }
        function sel(key, opts) {
          return '<select data-list="comparables" data-idx="' + i + '" data-key="' + key + '">' + opts.map(function (o) {
            return '<option' + (String(o) === String(cp[key]) ? ' selected' : '') + '>' + esc(o) + '</option>';
          }).join('') + '</select>';
        }
        return '<div class="av-cmp' + (cp.inclus === false ? ' av-cmp-off' : '') + '">' +
          '<div class="av-cmp-head">' +
          '<label class="av-cmp-inc"><input type="checkbox"' + (cp.inclus === false ? '' : ' checked') + ' data-list="comparables" data-idx="' + i + '" data-key="inclus"/> inclus</label>' +
          badge + sel('source', PORTAILS) + li('type', 'Type (T2…)') +
          '<button class="av-del" data-listdel="comparables" data-idx="' + i + '" title="Supprimer">✕</button></div>' +
          '<div class="av-grid-4">' +
          '<div class="av-field"><label>Surface (m²)</label>' + li('surface', '', 'number') + '</div>' +
          '<div class="av-field"><label>Prix (€)</label>' + li('prix', '', 'number') + '</div>' +
          '<div class="av-field"><label>€/m²</label><div class="av-cmp-calc" data-acm-m2="' + i + '">—</div></div>' +
          '<div class="av-field"><label>Ajustement %</label>' + li('ajustementPct', '0', 'number') + '</div>' +
          '</div><div class="av-grid-4">' +
          '<div class="av-field"><label>€/m² ajusté</label><div class="av-cmp-calc hl" data-acm-adj="' + i + '">—</div></div>' +
          '<div class="av-field"><label>État</label>' + sel('etat', ETATS) + '</div>' +
          '<div class="av-field"><label>Étage / expo</label>' + li('etage', 'ex : 2e / Sud') + '</div>' +
          '<div class="av-field"><label>Secteur</label>' + li('secteur', 'quartier') + '</div>' +
          '</div>' +
          '<div class="av-field"><label>Lien annonce (traçabilité)</label>' + li('lien', 'https://…') + '</div>' +
          '</div>';
      }).join('');
      return head('Analyse comparative de marché (ACM)', 'Comparables vendus (DVF) et annonces des portails, avec ajustements') +
        '<div class="av-tip" style="margin-bottom:.6rem;">Astuce : un <b>ajustement</b> positif si le comparable est <i>meilleur</i> que le bien (on rehausse sa valeur de référence), négatif s\'il est moins bien. Les comparables « inclus » alimentent le €/m² retenu.</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.6rem;">' +
        '<button class="btn btn-sm btn-outline-success" data-action="import-dvf"><i class="bi bi-download me-1"></i>Importer ventes DVF proches (' + nbDvf + ')</button>' +
        '<button class="av-add" data-listadd="comparables" style="border:1px solid var(--av-blue);border-radius:6px;padding:.25rem .6rem;">+ Ajouter une annonce</button>' +
        '<button class="btn btn-sm btn-outline-secondary" data-action="toggle-paste"><i class="bi bi-clipboard me-1"></i>Coller une annonce</button>' +
        '</div>' +
        '<div id="avPasteWrap" style="display:none;margin-bottom:.6rem;">' +
        '<textarea id="avPasteText" rows="3" placeholder="Collez ici le texte d\'une annonce (le prix, la surface et le type seront extraits automatiquement)…" style="width:100%;font-size:.8rem;"></textarea>' +
        '<button class="btn btn-sm btn-primary mt-1" data-action="parse-paste"><i class="bi bi-magic me-1"></i>Analyser le texte</button></div>' +
        (cards || '<div class="av-tip" style="padding:1rem;text-align:center;">Aucun comparable. Importez les ventes DVF ou ajoutez une annonce.</div>') +
        '<div class="av-box" id="avAcmSynth">' + renderAcmSynth() + '</div>';
    }
    if (id === 'loyers') {
      var lrows = d.loyers.map(function (l, i) {
        return '<div class="av-row" style="grid-template-columns:1fr 70px 70px 1fr 28px;">' +
          '<input type="text" placeholder="Studio T1" value="' + esc(l.type) + '" data-list="loyers" data-idx="' + i + '" data-key="type"/>' +
          '<input type="number" placeholder="Surf." value="' + esc(l.surface) + '" data-list="loyers" data-idx="' + i + '" data-key="surface"/>' +
          '<input type="number" placeholder="Loyer" value="' + esc(l.loyer) + '" data-list="loyers" data-idx="' + i + '" data-key="loyer"/>' +
          '<input type="text" placeholder="Secteur" value="' + esc(l.secteur) + '" data-list="loyers" data-idx="' + i + '" data-key="secteur"/>' +
          '<button class="av-del" data-listdel="loyers" data-idx="' + i + '" title="Supprimer">✕</button></div>';
      }).join('');
      return head('Loyers comparables', b.statut === 'occupe' ? 'Démontre la cohérence du loyer du bien occupé' : 'Optionnel si le bien est libre') +
        '<div style="display:flex;justify-content:flex-end;margin-bottom:.4rem;"><button class="av-add" data-listadd="loyers">+ Ajouter un comparable</button></div>' + lrows;
    }
    if (id === 'calcul') {
      var M = d.methodes, po = d.ponderation;
      function methodRow(key, label) {
        var mm = M[key] || {};
        return '<div class="av-method-row">' +
          '<label class="av-method-on"><input type="checkbox"' + (mm.on ? ' checked' : '') + ' data-p="methodes.' + key + '.on"/> ' + esc(label) + '</label>' +
          '<span class="av-method-poids">poids <input type="number" min="0" max="100" value="' + esc(mm.poids) + '" data-p="methodes.' + key + '.poids"/> %</span>' +
          '<span class="av-method-val" data-method-val="' + key + '">—</span></div>';
      }
      var acmPlace = acmStats(d).median || num(d.marche.moyenneMoyen) || 0;
      return head('Détermination de la valeur vénale', 'Méthodes combinées en une valeur retenue pondérée') +
        '<div class="av-grid-3">' +
        fld('€/m² ACM retenu', 'acm.prixM2Manuel', { type: 'number', tip: 'Vide = médiane comparables (' + (acmPlace ? fmt(acmPlace) + ' €' : '—') + ')', ph: acmPlace ? String(acmPlace) : '' }) +
        fld('Taux de capitalisation (%)', 'calcul.tauxCapi', { type: 'number', step: '0.1', tip: '6 à 7 % typique Martinique' }) +
        fld("Décote d'occupation (%)", 'calcul.decoteOccupation', { type: 'number', step: '1', tip: '0 libre — 5 à 15 % occupé' }) +
        '</div>' +
        '<div class="av-box"><div class="av-box-title">Méthodes & pondération</div>' +
        methodRow('comparaison', 'Comparaison directe (ACM)') +
        methodRow('surfacePonderee', 'Surface pondérée') +
        methodRow('capitalisation', 'Capitalisation du revenu') +
        methodRow('cout', 'Coût (sol + construction)') +
        '<div class="av-tip" style="margin-top:.4rem;">Les méthodes cochées avec un poids &gt; 0 et une valeur calculable sont combinées (moyenne pondérée).</div></div>' +
        (M.surfacePonderee.on ? '<div class="av-box"><div class="av-box-title">Surface pondérée (coefficients)</div><div class="av-grid-4">' +
          '<div class="av-field"><label>Terrasse ' + (d.bien.terrasse ? '(' + esc(d.bien.terrasse) + ' m²)' : '') + '</label>' + fldRaw('ponderation.coefTerrasse', d.ponderation.coefTerrasse, 'number', '0.01') + '</div>' +
          '<div class="av-field"><label>Balcon : m² × coef</label><div class="av-inline2">' + fldRaw('ponderation.surfBalcon', d.ponderation.surfBalcon, 'number') + fldRaw('ponderation.coefBalcon', d.ponderation.coefBalcon, 'number', '0.01') + '</div></div>' +
          '<div class="av-field"><label>Parking : m² × coef</label><div class="av-inline2">' + fldRaw('ponderation.surfParking', d.ponderation.surfParking, 'number') + fldRaw('ponderation.coefParking', d.ponderation.coefParking, 'number', '0.01') + '</div></div>' +
          '<div class="av-field"><label>Jardin : m² × coef</label><div class="av-inline2">' + fldRaw('ponderation.surfJardin', d.ponderation.surfJardin, 'number') + fldRaw('ponderation.coefJardin', d.ponderation.coefJardin, 'number', '0.01') + '</div></div>' +
          '</div></div>' : '') +
        (M.cout.on ? '<div class="av-box"><div class="av-box-title">Méthode du coût</div><div class="av-grid-3">' +
          fld('Valeur du terrain (€)', 'methodes.cout.valeurTerrain', { type: 'number' }) +
          fld('Coût construction (€/m²)', 'methodes.cout.coutConstructionM2', { type: 'number' }) +
          fld('Vétusté (%)', 'methodes.cout.vetustePct', { type: 'number' }) +
          '</div></div>' : '') +
        '<div id="avResultBlock">' + renderResultBlock() + '</div>' +
        '<div class="av-retained"><div class="av-r-label" style="margin-bottom:.5rem;">Valeur retenue ' + (b.statut === 'occupe' ? "en l'état occupé" : 'bien libre') + '</div>' +
        '<div class="av-grid-2">' +
        '<div class="av-field"><label style="color:rgba(255,255,255,.85);">Borne basse (€)</label><input type="number" value="' + esc(d.calcul.valeurOccupeeBasseManuel) + '" data-p="calcul.valeurOccupeeBasseManuel" placeholder="auto"/></div>' +
        '<div class="av-field"><label style="color:rgba(255,255,255,.85);">Borne haute (€)</label><input type="number" value="' + esc(d.calcul.valeurOccupeeHauteManuel) + '" data-p="calcul.valeurOccupeeHauteManuel" placeholder="auto"/></div>' +
        '</div><div style="font-size:.66rem;opacity:.7;">Laisser vide pour calcul automatique selon les paramètres ci-dessus.</div></div>';
    }
    if (id === 'swot') {
      var aRows = d.atouts.map(function (a, i) {
        return '<div class="av-row" style="grid-template-columns:1fr 28px;"><input type="text" placeholder="Atout…" value="' + esc(a) + '" data-simplelist="atouts" data-idx="' + i + '"/><button class="av-del" data-simpledel="atouts" data-idx="' + i + '">✕</button></div>';
      }).join('');
      var vRows = d.vigilances.map(function (v, i) {
        return '<div class="av-row" style="grid-template-columns:1fr 28px;"><input type="text" placeholder="Point de vigilance…" value="' + esc(v) + '" data-simplelist="vigilances" data-idx="' + i + '"/><button class="av-del" data-simpledel="vigilances" data-idx="' + i + '">✕</button></div>';
      }).join('');
      return head('Atouts & points de vigilance', 'Synthèse qualitative') +
        '<div class="av-grid-2"><div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;"><strong style="color:var(--av-green);font-size:.8rem;">✓ ATOUTS <span class="av-prefill-flag">étude</span></strong><button class="av-add" data-simpleadd="atouts" style="color:var(--av-green);">+ Ajouter</button></div>' + aRows + '</div>' +
        '<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;"><strong style="color:var(--av-red);font-size:.8rem;">⚠ VIGILANCE <span class="av-prefill-flag">étude</span></strong><button class="av-add" data-simpleadd="vigilances" style="color:var(--av-red);">+ Ajouter</button></div>' + vRows + '</div></div>';
    }
    if (id === 'conclusion') {
      return head('Conclusion et avis final', 'Texte de synthèse et potentiel de revalorisation') +
        fld('Texte de conclusion', 'conclusion.texte', { type: 'textarea', rows: 6, tip: 'Laisser vide pour génération automatique', ph: 'Le prix de cession de X € constitue une transaction cohérente avec la valeur de marché…' }) +
        '<div class="av-grid-2">' + fld('Potentiel revalorisation – bas (€)', 'conclusion.potentielBas', { type: 'number' }) + fld('Potentiel revalorisation – haut (€)', 'conclusion.potentielHaut', { type: 'number' }) + '</div>';
    }
    if (id === 'reserves') {
      return head("Réserves et limites de l'avis", 'Texte standard éditable') + fld('Texte des réserves', 'reserves', { type: 'textarea', rows: 14 });
    }
    if (id === 'signature') {
      return head('Signataire', 'Identité et coordonnées en bas du document') +
        '<div class="av-grid-2">' + fld('Nom', 'signataire.nom') + fld('Fonction', 'signataire.fonction') + fld('Email', 'signataire.email', { type: 'email' }) + fld('Société', 'signataire.societe') + '</div>' +
        fld('Adresse de la société', 'signataire.adresseSociete') +
        '<button class="btn btn-sm btn-outline-primary mt-2" data-action="save-sign"><i class="bi bi-save me-1"></i>Mémoriser ce signataire par défaut</button>';
    }
    return '';
  }
  function head(t, s) { return '<div class="av-sec-head"><h5>' + esc(t) + '</h5><div class="av-sub">' + esc(s) + '</div></div>'; }

  function renderAcmSynth() {
    var d = state.data, st = acmStats(d), retenu = acmRetenuM2(d);
    return '<div class="av-box-title">€/m² issu des comparables</div>' +
      '<div class="av-live" style="gap:1.2rem;">' +
      liveItem('Comparables inclus', st.count) +
      liveItem('Médiane €/m² ajusté', st.median ? fmt(st.median) + ' €' : '—') +
      liveItem('Moyenne €/m² ajusté', st.mean ? fmt(st.mean) + ' €' : '—') +
      liveItem('€/m² ACM retenu', retenu ? fmt(retenu) + ' €' : '—') +
      '</div>';
  }
  function renderResultBlock() {
    var d = state.data, c = compute(d), occ = d.bien.statut === 'occupe';
    function rr(l, v, hl) { return '<div class="av-r-row' + (hl ? ' hl' : '') + '"><span>' + l + '</span><span>' + v + '</span></div>'; }
    var rows = c.methodes.map(function (e) {
      return rr(e.label + (e.actif ? ' · poids ' + e.poids + '%' : ' (inactif)'),
        e.val ? fmtE(e.val) + (e.actif ? ' → ' + fmtE(e.contribution) : '') : '—');
    }).join('');
    return '<div class="av-result"><div class="av-box-title">✨ Synthèse multi-méthodes</div>' +
      rr('Référence étude (comparaison brute)', fmtE(c.vlBas) + ' – ' + fmtE(c.vlMoy)) +
      rows +
      rr('Valeur pondérée (hors décote)', fmtE(c.valPonderee), true) +
      (occ ? rr("Après décote d'occupation (-" + d.calcul.decoteOccupation + '%)', fmtE(Math.round(c.valPonderee * (1 - num(d.calcul.decoteOccupation) / 100)))) : '') +
      '</div>';
  }

  // ── Refresh des sorties (sans toucher aux inputs en cours) ──
  function refreshOutputs() {
    var c = compute(state.data);
    var live = document.getElementById('avLive');
    if (live) {
      live.innerHTML =
        liveItem('Prix au m²', c.prixM2 ? fmt(c.prixM2) + ' €' : '—') +
        liveItem('Rendement brut', c.rendementBrut ? c.rendementBrut.toFixed(2) + ' %' : '—') +
        liveItem('Capitalisation', fmtE(c.valeurCapi)) +
        liveItem('Valeur retenue', (c.voccBas && c.voccHaut) ? fmt(c.voccBas) + ' – ' + fmt(c.voccHaut) + ' €' : '—');
    }
    var rb = document.getElementById('avResultBlock');
    if (rb) rb.innerHTML = renderResultBlock();
    // €/m² par comparable (cellules de sortie de la grille ACM)
    (state.data.comparables || []).forEach(function (cp, i) {
      var su = num(cp.surface), pr = num(cp.prix);
      var m2 = su > 0 && pr > 0 ? pr / su : 0;
      var adj = m2 * (1 + num(cp.ajustementPct) / 100);
      var e1 = document.querySelector('[data-acm-m2="' + i + '"]'); if (e1) e1.textContent = m2 ? fmt(Math.round(m2)) + ' €' : '—';
      var e2 = document.querySelector('[data-acm-adj="' + i + '"]'); if (e2) e2.textContent = adj ? fmt(Math.round(adj)) + ' €' : '—';
    });
    var synth = document.getElementById('avAcmSynth');
    if (synth) synth.innerHTML = renderAcmSynth();
    // valeurs par méthode (section Valeur)
    c.methodes.forEach(function (e) {
      var sp = document.querySelector('[data-method-val="' + e.key + '"]');
      if (sp) { sp.textContent = e.val ? fmtE(e.val) : '—'; sp.style.opacity = e.actif ? '1' : '.5'; }
    });
    // placeholders auto des bornes retenues
    var pb = document.querySelector('[data-p="calcul.valeurOccupeeBasseManuel"]');
    var ph = document.querySelector('[data-p="calcul.valeurOccupeeHauteManuel"]');
    if (pb) pb.placeholder = fmt(c.voccBas);
    if (ph) ph.placeholder = fmt(c.voccHaut);
    if (state.preview) {
      var pv = document.getElementById('avPreview');
      if (pv) pv.innerHTML = '<div class="av-preview-page"><div class="avis-doc">' + buildAvisDocHTML(state.data, c) + '</div></div>';
    }
  }
  function liveItem(k, v) { return '<div class="av-live-item"><span class="av-live-k">' + k + '</span><span class="av-live-v">' + v + '</span></div>'; }

  // ── Navigation sections ─────────────────────────────────────
  function showSection(id) {
    state.section = id;
    var c = document.getElementById('avFormContent');
    if (c) c.innerHTML = renderSection(id);
    document.querySelectorAll('.av-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.sec === id); });
    refreshOutputs();
  }

  // ── Construction de la modale ───────────────────────────────
  function buildModal() {
    var root = document.getElementById('avisModalRoot');
    if (!root) { root = document.createElement('div'); root.id = 'avisModalRoot'; document.body.appendChild(root); }
    var tabs = SECTIONS.map(function (s) { return '<button class="av-tab" data-sec="' + s.id + '">' + esc(s.label) + '</button>'; }).join('');
    root.innerHTML =
      '<div class="modal fade" id="avisModal" tabindex="-1" aria-hidden="true">' +
      '<div class="modal-dialog modal-fullscreen-lg-down modal-xl modal-dialog-scrollable">' +
      '<div class="modal-content">' +
      '<div class="modal-header"><div><h5 class="modal-title">Avis de valeur<small>FIDI · document professionnel</small></h5></div>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button></div>' +
      '<div class="av-tabs">' + tabs + '</div>' +
      '<div class="modal-body"><div class="av-layout' + (state.preview ? ' av-with-preview' : '') + '" id="avLayout">' +
      '<div class="av-form"><div id="avFormContent"></div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--av-grey-light);">' +
      '<button class="btn btn-sm btn-light" data-action="prev">← Précédent</button>' +
      '<button class="btn btn-sm btn-primary" data-action="next">Suivant →</button></div></div>' +
      '<div class="av-preview" id="avPreviewWrap"><div id="avPreview"></div></div>' +
      '</div></div>' +
      '<div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap;gap:.5rem;">' +
      '<div class="av-live" id="avLive"></div>' +
      '<div class="d-flex gap-1 flex-wrap align-items-center">' +
      '<select id="avSavedSelect" class="form-select form-select-sm" style="width:auto;min-width:140px;"><option value="">— Avis sauvegardés —</option></select>' +
      '<button class="btn btn-sm btn-outline-secondary" data-action="load" title="Charger l\'avis sélectionné"><i class="bi bi-folder2-open"></i></button>' +
      '<button class="btn btn-sm btn-outline-danger" data-action="delete" title="Supprimer l\'avis sélectionné"><i class="bi bi-trash"></i></button>' +
      '<button class="btn btn-sm btn-outline-secondary" data-action="new"><i class="bi bi-plus-lg me-1"></i>Nouveau</button>' +
      '<button class="btn btn-sm btn-outline-primary" data-action="prefill" title="Re-remplir depuis l\'étude en cours"><i class="bi bi-magic me-1"></i>Pré-remplir</button>' +
      '<button class="btn btn-sm btn-outline-success" data-action="save"><i class="bi bi-save me-1"></i>Sauvegarder</button>' +
      '<button class="btn btn-sm btn-outline-dark" data-action="toggle-preview"><i class="bi bi-eye me-1"></i>Aperçu</button>' +
      '<button class="btn btn-sm btn-primary" data-action="word"><i class="bi bi-file-earmark-word me-1"></i>Word</button>' +
      '<button class="btn btn-sm btn-danger" data-action="pdf"><i class="bi bi-file-earmark-pdf me-1"></i>PDF</button>' +
      '</div></div>' +
      '</div></div></div>';

    if (!document.getElementById('avisPrintRoot')) {
      var pr = document.createElement('div'); pr.id = 'avisPrintRoot'; document.body.appendChild(pr);
    }

    var modalEl = document.getElementById('avisModal');
    state.modal = new bootstrap.Modal(modalEl);

    // Délégation d'évènements
    modalEl.addEventListener('input', onInput);
    modalEl.addEventListener('change', onInput);
    modalEl.addEventListener('click', onClick);
    state.built = true;
  }

  function onInput(e) {
    var el = e.target;
    var isCb = el.type === 'checkbox';
    var val = isCb ? el.checked : el.value;
    if (el.dataset.p) setPath(state.data, el.dataset.p, val);
    else if (el.dataset.list) { var arr = getPath(state.data, el.dataset.list); arr[+el.dataset.idx][el.dataset.key] = val; }
    else if (el.dataset.simplelist) { getPath(state.data, el.dataset.simplelist)[+el.dataset.idx] = val; }
    else if (el.dataset.radio) { setPath(state.data, el.dataset.radio, val); showSection(state.section); return; }
    else return;
    // Une case à cocher peut modifier la structure affichée (méthodes, inclus…) → re-render
    if (isCb) { showSection(state.section); return; }
    refreshOutputs();
  }

  function onClick(e) {
    var t = e.target.closest('[data-sec],[data-action],[data-listadd],[data-listdel],[data-simpleadd],[data-simpledel]');
    if (!t) return;
    if (t.dataset.sec) { showSection(t.dataset.sec); return; }
    if (t.dataset.listadd) {
      var key = t.dataset.listadd, tpl;
      if (key === 'loyers') tpl = { type: '', surface: '', loyer: '', secteur: '' };
      else if (key === 'comparables') tpl = comparableTemplate();
      else tpl = { nom: '', bas: '', moyen: '', haut: '' };
      getPath(state.data, key).push(tpl); showSection(state.section); return;
    }
    if (t.dataset.listdel) { getPath(state.data, t.dataset.listdel).splice(+t.dataset.idx, 1); showSection(state.section); return; }
    if (t.dataset.simpleadd) { getPath(state.data, t.dataset.simpleadd).push(''); showSection(state.section); return; }
    if (t.dataset.simpledel) { getPath(state.data, t.dataset.simpledel).splice(+t.dataset.idx, 1); showSection(state.section); return; }
    var a = t.dataset.action;
    if (a === 'prev') navSection(-1);
    else if (a === 'next') navSection(1);
    else if (a === 'toggle-preview') togglePreview();
    else if (a === 'new') doNew();
    else if (a === 'prefill') doPrefill();
    else if (a === 'save') doSave();
    else if (a === 'load') doLoad();
    else if (a === 'delete') doDelete();
    else if (a === 'save-sign') { if (saveSignataire(state.data.signataire)) toast('Signataire mémorisé'); }
    else if (a === 'import-dvf') importDvf();
    else if (a === 'toggle-paste') { var w = document.getElementById('avPasteWrap'); if (w) w.style.display = w.style.display === 'none' ? 'block' : 'none'; }
    else if (a === 'parse-paste') parsePaste();
    else if (a === 'word') exportWord();
    else if (a === 'pdf') exportPdf();
  }

  // Importe les ventes DVF proches (transactions individuelles de l'étude) comme comparables
  function importDvf() {
    var tx = window.__fidiTransactions || [];
    if (!tx.length) { toast('Aucune transaction DVF chargée', true); return; }
    var typeBien = (state.data.bien.type || '').toLowerCase();
    var wantMaison = /maison|villa/.test(typeBien);
    var sref = num(state.data.bien.surfaceCarrez);
    // Filtre par type, surface bâtie présente, puis tri par proximité de surface
    var rows = tx.filter(function (r) {
      if (!num(r.surface_bati) || !num(r.prix)) return false;
      var tl = (r.type_local || '').toLowerCase();
      if (wantMaison) return tl.indexOf('maison') >= 0;
      return tl.indexOf('appartement') >= 0;
    });
    rows.sort(function (x, y) { return Math.abs(num(x.surface_bati) - sref) - Math.abs(num(y.surface_bati) - sref); });
    var top = rows.slice(0, 8);
    if (!top.length) { toast('Aucune vente du même type', true); return; }
    var existing = {};
    state.data.comparables.forEach(function (c) { if (c.nature === 'vendu') existing[c.adresse + '|' + c.prix] = true; });
    var added = 0;
    top.forEach(function (r) {
      var keyD = (r.adresse || '') + '|' + r.prix;
      if (existing[keyD]) return;
      state.data.comparables.push(comparableTemplate({
        nature: 'vendu', source: 'DVF', type: r.type_local || '', secteur: r.adresse || '',
        surface: r.surface_bati, prix: r.prix, date: r.date || '', adresse: r.adresse || ''
      }));
      added++;
    });
    showSection('comparables');
    toast(added + ' vente(s) DVF importée(s)');
  }

  // Extraction best-effort depuis le texte d'une annonce collée
  function parsePaste() {
    var ta = document.getElementById('avPasteText');
    var txt = ta ? ta.value : '';
    if (!txt.trim()) { toast('Collez d\'abord un texte', true); return; }
    var t = txt.replace(/ /g, ' ');
    // Prix : plus grand nombre suivi de € (ou précédé de "prix")
    var prix = '';
    var prixMatches = t.match(/(\d[\d .]{2,})\s*€/g) || [];
    if (prixMatches.length) {
      var vals = prixMatches.map(function (s) { return num(s.replace(/[^\d]/g, '')); });
      prix = String(Math.max.apply(null, vals));
    }
    // Surface : nombre suivi de m²/m2
    var surf = '';
    var sm = t.match(/(\d+(?:[.,]\d+)?)\s*m(?:²|2)/i);
    if (sm) surf = sm[1].replace(',', '.');
    // Type
    var type = '';
    var tm = t.match(/\b(studio|T\s?[1-6]|F\s?[1-6]|maison|villa|appartement)\b/i);
    if (tm) type = tm[1].toUpperCase().replace(/\s+/g, '');
    if (!prix && !surf) { toast('Rien d\'exploitable trouvé', true); return; }
    state.data.comparables.push(comparableTemplate({ nature: 'annonce', source: 'Autre', type: type, surface: surf, prix: prix, note: 'Importé par collage' }));
    if (ta) ta.value = '';
    showSection('comparables');
    toast('Annonce ajoutée (à vérifier)');
  }

  function navSection(dir) {
    var i = SECTIONS.findIndex(function (s) { return s.id === state.section; });
    var j = i + dir;
    if (j >= 0 && j < SECTIONS.length) showSection(SECTIONS[j].id);
  }
  function togglePreview() {
    state.preview = !state.preview;
    var lay = document.getElementById('avLayout');
    var wrap = document.getElementById('avPreviewWrap');
    if (lay) lay.classList.toggle('av-with-preview', state.preview);
    if (wrap) wrap.style.display = state.preview ? '' : 'none';
    refreshOutputs();
  }

  // ── Actions ─────────────────────────────────────────────────
  function refreshSavedSelect() {
    var sel = document.getElementById('avSavedSelect');
    if (!sel) return;
    var keys = listSavedAvis();
    sel.innerHTML = '<option value="">— Avis sauvegardés (' + keys.length + ') —</option>' +
      keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('');
  }
  function doNew() {
    state.data = buildPrefillFromEtude(null, null);
    showSection('metadata'); toast('Nouveau brouillon');
  }
  function doPrefill() {
    if (!window.__fidiData) { toast('Lancez d\'abord une analyse', true); return; }
    state.data = buildPrefillFromEtude(window.__fidiData, window.__fidiInputs);
    showSection(state.section); toast('Pré-rempli depuis l\'étude');
  }
  function doSave() {
    var ref = (state.data.metadata.ref || '').trim();
    if (!ref) { toast('Référence requise', true); return; }
    try { localStorage.setItem(AVIS_PREFIX + ref, JSON.stringify(state.data)); refreshSavedSelect(); toast('Avis sauvegardé'); }
    catch (e) { toast('Erreur de sauvegarde', true); }
  }
  function doLoad() {
    var sel = document.getElementById('avSavedSelect'); var ref = sel && sel.value;
    if (!ref) { toast('Sélectionnez un avis', true); return; }
    try { var raw = localStorage.getItem(AVIS_PREFIX + ref); if (raw) { state.data = JSON.parse(raw); showSection('metadata'); toast('Avis chargé'); } }
    catch (e) { toast('Erreur de chargement', true); }
  }
  function doDelete() {
    var sel = document.getElementById('avSavedSelect'); var ref = sel && sel.value;
    if (!ref) { toast('Sélectionnez un avis', true); return; }
    localStorage.removeItem(AVIS_PREFIX + ref); refreshSavedSelect(); toast('Avis supprimé');
  }

  function exportWord() {
    var html = buildWordDoc(state.data, compute(state.data));
    var blob = new Blob(['﻿', html], { type: 'application/msword;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'Avis_de_valeur_' + (state.data.metadata.ref || 'nouveau') + '.doc';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Document Word exporté');
  }
  function exportPdf() {
    var pr = document.getElementById('avisPrintRoot');
    pr.innerHTML = '<div class="avis-doc">' + buildAvisDocHTML(state.data, compute(state.data)) + '</div>';
    var origTitle = document.title;
    document.title = 'Avis_de_valeur_' + (state.data.metadata.ref || 'rapport');
    document.body.classList.add('avis-print');
    var done = function () {
      document.body.classList.remove('avis-print');
      document.title = origTitle;
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 60);
  }

  // ── Toast léger ─────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg, isErr) {
    var el = document.getElementById('avToast');
    if (!el) {
      el = document.createElement('div'); el.id = 'avToast';
      el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:20000;padding:.6rem 1.2rem;border-radius:8px;color:#fff;font-size:.85rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity .2s;';
      document.body.appendChild(el);
    }
    el.style.background = isErr ? '#b71c1c' : '#198754';
    el.textContent = (isErr ? '⚠ ' : '✓ ') + msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; }, 2200);
  }

  // ── Génération du document (aperçu / PDF / Word) ────────────
  function row(label, value) {
    if (value === '' || value === null || value === undefined) return '';
    return '<tr><td class="lbl">' + esc(label) + '</td><td>' + value + '</td></tr>';
  }
  function buildAvisDocHTML(data, calc) {
    var b = data.bien, m = data.marche, sig = data.signataire;
    var occ = b.statut === 'occupe';
    var adresseComplete = [b.adresse, b.cp, b.commune].filter(Boolean).map(esc).join(' – ');
    var atouts = data.atouts.filter(function (a) { return a && a.trim(); });
    var vigilances = data.vigilances.filter(function (v) { return v && v.trim(); });

    var conclusionTexte = data.conclusion.texte ? esc(data.conclusion.texte) : (
      b.prixVente && calc.voccBas && calc.voccHaut
        ? 'Le prix de cession de ' + fmtE(b.prixVente) + ' constitue une transaction économiquement cohérente et conforme à la valeur de marché du bien ' + (occ ? "dans son état d'occupation" : 'libre') + '.' +
          (occ && calc.rendementBrut ? " Il offre à l'acquéreur un rendement brut de " + calc.rendementBrut.toFixed(2) + ' %.' : '') +
          (data.conclusion.potentielBas && data.conclusion.potentielHaut ? ' Le potentiel de revalorisation à la libération est estimé entre ' + fmtE(data.conclusion.potentielBas) + ' et ' + fmtE(data.conclusion.potentielHaut) + '.' : '')
        : '[Saisir le texte de conclusion]'
    );

    var sourcesNoms = m.sources.filter(function (s) { return s.nom; }).map(function (s) { return esc(s.nom.split(' (')[0]); }).join(', ') || '[sources de marché]';

    var html = '';
    html += '<div class="header-bar"><table style="border:none;width:100%;"><tr style="border:none;">' +
      '<td style="border:none;width:60%;padding:0;"><div class="left">' + esc(sig.societe || 'FIDI') + '</div>' +
      '<div style="color:#5c6470;font-size:9px;font-style:italic;">Avis de valeur immobilière</div>' +
      '<div style="color:#5c6470;font-size:9px;">Martinique – étude de marché FIDI</div></td>' +
      '<td style="border:none;width:40%;padding:0;text-align:right;"><div style="color:#1a3a6e;font-weight:bold;">' + esc(sig.nom) + '</div>' +
      '<div>' + esc(sig.fonction) + '</div><div>' + esc(sig.email) + '</div></td></tr></table></div>';

    html += '<div class="title-block"><div class="t1">AVIS DE VALEUR</div>' +
      '<div class="t2">' + esc(b.type || '[Type de bien]') + (b.cp ? ' – ' + esc(b.commune || '') + ' (' + esc(b.cp) + ')' : '') + (b.adresse ? ', ' + esc(b.adresse) : '') + '</div>' +
      '<div class="t3">Réf. : ' + esc(data.metadata.ref) + '  –  Établi le ' + (formatDateFR(data.metadata.date) || '[date]') + '</div></div>';

    html += '<h1>1. Préambule et cadre de l\'avis</h1>' +
      '<p>Le présent document constitue un <b>avis de valeur</b> établi par <b>' + esc(sig.societe) + '</b>, ' + (data.metadata.lieuEtablissement ? 'à ' + esc(data.metadata.lieuEtablissement) : 'en Martinique') + ', par ' + esc(sig.nom) + ', ' + esc(sig.fonction) + '. Il porte sur ' + (b.type ? 'un ' + esc(b.type.toLowerCase()) : 'le bien') + ' situé ' + (adresseComplete || '[adresse]') + '.</p>' +
      '<p>Conformément aux usages de la profession et à la Charte de l\'Expertise en Évaluation Immobilière, le présent avis <b>ne constitue pas une expertise judiciaire ou réglementée</b>. Il est délivré à titre indicatif et matérialise une opinion motivée sur la valeur vénale du bien au jour de son établissement, sur la base des éléments communiqués et des données de marché disponibles.</p>' +
      (b.prixVente ? '<p style="font-style:italic;color:#5c6470;">Le bien faisant l\'objet du présent avis ' + (occ ? 'a été cédé' : 'est proposé') + ' pour un prix de ' + fmtE(b.prixVente) + ' net vendeur.</p>' : '');

    html += '<h1>2. Identification et description du bien</h1><table>' +
      row('Type de bien', esc(b.type)) +
      row('Adresse', adresseComplete) +
      row('Immeuble', b.immeuble ? esc(b.immeuble) : '') +
      row('Étage', b.etage ? esc(b.etage) : '') +
      row('Surface habitable (loi Carrez)', b.surfaceCarrez ? '≈ ' + esc(b.surfaceCarrez) + ' m²' + (b.sejour ? ' – séjour de ' + esc(b.sejour) + ' m²' : '') : '') +
      row('Surface SHOB annoncée', b.surfaceShob ? '≈ ' + esc(b.surfaceShob) + ' m²' : '') +
      row('Terrasse / Balcon', b.terrasse ? esc(b.terrasse) + ' m²' : '') +
      row('Stationnement', b.parking ? esc(b.parking) : '') +
      row('Régime juridique', esc(b.regime) + (b.nbLots ? ' – ' + esc(b.nbLots) + ' lots' : '')) +
      row('Taxe foncière', b.taxeFonciere ? fmtE(b.taxeFonciere) + ' / an' : '') +
      (occ ? row('Situation locative', 'Bien occupé – loyer ' + fmtE(b.loyer) + '/mois' + (b.bailDateDebut ? ' – bail du ' + formatDateFR(b.bailDateDebut) : '') + (b.bailDuree ? ' (durée ' + esc(b.bailDuree) + ' mois)' : '')) : row('Situation locative', 'Bien libre')) +
      (occ && b.loyer ? row('Rapport locatif annuel', fmtE(num(b.loyer) * 12) + ' / an (hors charges)') : '') +
      '</table>';

    html += '<h1>3. Méthodologie d\'évaluation</h1>' +
      '<p>L\'évaluation a été conduite selon ' + (occ ? 'deux méthodes complémentaires' : 'la méthode par comparaison directe') + ' :</p>' +
      '<p>• <b>Méthode par comparaison directe</b> : analyse des prix au m² constatés sur les transactions et annonces récentes de biens similaires (sources : ' + sourcesNoms + ').</p>' +
      (occ ? '<p>• <b>Méthode par capitalisation du revenu locatif</b> : détermination de la valeur économique à partir du loyer perçu et du taux de rendement attendu. Une décote d\'occupation est appliquée à la valeur de marché libre pour refléter la contrainte locative.</p>' : '');

    html += '<h1>4. Analyse du marché local' + (b.commune ? ' – ' + esc(b.commune) : '') + '</h1>' +
      '<h2>4.1 Prix au m² constatés</h2><table><tr><th>Source</th><th class="center">Prix bas</th><th class="center">Prix moyen</th><th class="center">Prix haut</th></tr>' +
      m.sources.filter(function (s) { return s.nom; }).map(function (s) {
        return '<tr><td>' + esc(s.nom) + '</td><td class="center">' + (s.bas ? fmt(s.bas) + ' €/m²' : '—') + '</td><td class="center bold">' + (s.moyen ? fmt(s.moyen) + ' €/m²' : '—') + '</td><td class="center">' + (s.haut ? fmt(s.haut) + ' €/m²' : '—') + '</td></tr>';
      }).join('') +
      '<tr style="background:#eaf0f8;"><td class="bold">Moyenne retenue</td><td class="center bold">' + (m.moyenneBas ? fmt(m.moyenneBas) + ' €/m²' : '—') + '</td><td class="center bold">' + (m.moyenneMoyen ? fmt(m.moyenneMoyen) + ' €/m²' : '—') + '</td><td class="center bold">' + (m.moyenneHaut ? fmt(m.moyenneHaut) + ' €/m²' : '—') + '</td></tr></table>' +
      ((m.commentaire || m.evol12m || m.evol3m) ? '<p><b>Tendance :</b> ' + [esc(m.commentaire), m.evol12m && 'évolution ' + esc(m.evol12m) + ' sur 12 mois', m.evol3m && esc(m.evol3m) + ' sur 3 mois'].filter(Boolean).join(' ; ') + '.</p>' : '');

    var loyersValid = data.loyers.filter(function (l) { return l.type || l.loyer; });
    if (occ && loyersValid.length) {
      html += '<h2>4.2 Marché locatif – comparables</h2><table><tr><th>Bien</th><th class="center">Surface</th><th class="center">Loyer</th><th class="center">€/m²</th><th>Secteur</th></tr>' +
        loyersValid.map(function (l) {
          return '<tr><td>' + esc(l.type || '—') + '</td><td class="center">' + (l.surface ? esc(l.surface) + ' m²' : '—') + '</td><td class="center">' + (l.loyer ? fmtE(l.loyer) : '—') + '</td><td class="center">' + (l.surface && l.loyer ? (num(l.loyer) / num(l.surface)).toFixed(1) + ' €/m²' : '—') + '</td><td>' + esc(l.secteur || '—') + '</td></tr>';
        }).join('') +
        '<tr style="background:#eaf0f8;"><td class="bold">Bien évalué (occupé)</td><td class="center bold">' + (b.surfaceCarrez ? esc(b.surfaceCarrez) + ' m²' : '—') + '</td><td class="center bold">' + fmtE(b.loyer) + '</td><td class="center bold">' + (b.surfaceCarrez && b.loyer ? (num(b.loyer) / num(b.surfaceCarrez)).toFixed(1) + ' €/m²' : '—') + '</td><td class="bold">' + esc(b.adresse || '—') + '</td></tr></table>';
    }

    // 4.3 — Analyse comparative de marché (comparables inclus)
    var comps = (data.comparables || []).filter(function (cp) { return cp.inclus !== false && num(cp.surface) > 0 && num(cp.prix) > 0; });
    if (comps.length) {
      html += '<h2>4.3 Analyse comparative de marché</h2>' +
        '<p style="font-size:9px;color:#5c6470;">Comparables <b>vendus</b> = prix réels constatés (DVF). <b>Annonces</b> = prix demandés sur les portails, généralement supérieurs au prix de vente final. Les valeurs sont ajustées pour refléter les écarts avec le bien évalué.</p>' +
        '<table><tr><th>Source</th><th>Nature</th><th>Type</th><th class="center">Surface</th><th class="center">Prix</th><th class="center">€/m²</th><th class="center">Ajust.</th><th class="center">€/m² ajusté</th></tr>' +
        comps.map(function (cp) {
          var su = num(cp.surface), pr = num(cp.prix), pm2 = pr / su, adj = pm2 * (1 + num(cp.ajustementPct) / 100);
          return '<tr><td>' + esc(cp.source) + '</td><td>' + (cp.nature === 'vendu' ? 'Vendu' : 'Annonce') + '</td><td>' + esc(cp.type || '—') + '</td>' +
            '<td class="center">' + fmt(su) + ' m²</td><td class="center">' + fmtE(pr) + '</td><td class="center">' + fmt(Math.round(pm2)) + ' €</td>' +
            '<td class="center">' + (cp.ajustementPct ? (num(cp.ajustementPct) > 0 ? '+' : '') + cp.ajustementPct + ' %' : '—') + '</td>' +
            '<td class="center bold">' + fmt(Math.round(adj)) + ' €</td></tr>';
        }).join('') +
        '<tr style="background:#eaf0f8;"><td class="bold" colspan="7">€/m² ACM retenu (médiane des €/m² ajustés)</td><td class="center bold">' + fmt(calc.acmM2) + ' €</td></tr></table>';
    }

    html += '<h1>5. Détermination de la valeur vénale</h1>' +
      '<p>La valeur retenue résulte de la <b>combinaison pondérée</b> des méthodes applicables au bien :</p>' +
      '<table><tr><th>Méthode</th><th class="center">Valeur</th><th class="center">Poids</th><th class="center">Contribution</th></tr>' +
      calc.methodes.map(function (e) {
        return '<tr' + (e.actif ? '' : ' style="color:#9aa0a6;"') + '><td>' + esc(e.label) + '</td>' +
          '<td class="center">' + (e.val ? fmtE(e.val) : '—') + '</td>' +
          '<td class="center">' + (e.actif ? e.poids + ' %' : '—') + '</td>' +
          '<td class="center bold">' + (e.actif ? fmtE(e.contribution) : '—') + '</td></tr>';
      }).join('') +
      '<tr style="background:#eaf0f8;"><td class="bold">Valeur pondérée (hors décote)</td><td class="center bold" colspan="3">' + fmtE(calc.valPonderee) + '</td></tr>' +
      (occ ? '<tr><td>Décote pour occupation locative (-' + data.calcul.decoteOccupation + ' %)</td><td class="center" colspan="3">' + fmtE(Math.round(calc.valPonderee * (1 - num(data.calcul.decoteOccupation) / 100))) + '</td></tr>' : '') +
      '<tr class="gold-row"><td>VALEUR VÉNALE ' + (occ ? "EN L'ÉTAT OCCUPÉ" : 'BIEN LIBRE') + ' – fourchette retenue</td><td class="center" colspan="3">' + fmtE(calc.voccBas) + ' – ' + fmtE(calc.voccHaut) + '</td></tr></table>';

    if (b.prixVente) {
      html += '<h2>Analyse de cohérence – prix de cession</h2>' +
        '<p>Le bien ' + (occ ? 'a été cédé' : 'est proposé') + ' au prix de <b style="color:#1a3a6e;">' + fmtE(b.prixVente) + ' net vendeur</b>' + (b.surfaceCarrez ? ', soit environ <b>' + fmt(calc.prixM2) + ' €/m²</b>' : '') + '. Ce prix s\'inscrit <b>dans la fourchette retenue par notre avis (' + fmtE(calc.voccBas) + ' – ' + fmtE(calc.voccHaut) + ')</b>' + (occ && calc.rendementBrut ? ' et offre à l\'acquéreur un <b>rendement brut de ' + calc.rendementBrut.toFixed(2) + ' %</b>' : '') + '.</p>';
    }

    if (atouts.length || vigilances.length) {
      html += '<h1>6. Atouts et facteurs de décote</h1><table><tr>' +
        '<td style="width:50%;vertical-align:top;" class="atouts"><div class="h">✓ ATOUTS VALORISANTS</div>' + atouts.map(function (a) { return '<div>• ' + esc(a) + '</div>'; }).join('') + '</td>' +
        '<td style="width:50%;vertical-align:top;" class="vigilance"><div class="h">⚠ POINTS DE VIGILANCE</div>' + vigilances.map(function (v) { return '<div>• ' + esc(v) + '</div>'; }).join('') + '</td>' +
        '</tr></table>';
    }

    html += '<h1>7. Avis de valeur</h1>' +
      '<p>Au vu de l\'ensemble des éléments analysés – caractéristiques intrinsèques du bien, ' + (occ ? "état d'occupation locative, " : '') + 'données du marché local' + (occ ? ' et capitalisation du revenu' : '') + ' –, ' + esc(sig.societe) + ' estime la valeur vénale du bien situé ' + (adresseComplete || '[adresse]') + ', <b>au ' + (formatDateFR(data.metadata.date) || '[date]') + '</b>, comme suit :</p>' +
      '<table><tr><td class="synth-occ" style="width:50%;"><div style="text-transform:uppercase;font-size:9px;opacity:.85;">Valeur ' + (occ ? "en l'état d'occupation" : 'vénale') + '</div><div class="v">' + ((calc.voccBas && calc.voccHaut) ? fmt(calc.voccBas) + ' – ' + fmt(calc.voccHaut) + ' €' : '—') + '</div></td>' +
      (occ ? '<td class="synth-libre" style="width:50%;"><div style="text-transform:uppercase;font-size:9px;color:#1a2233;">Valeur bien libre (référence marché)</div><div class="v">' + ((calc.vlBas && calc.vlMoy) ? fmt(calc.vlBas) + ' – ' + fmt(calc.vlMoy) + ' €' : '—') + '</div></td>' : '') +
      '</tr></table>' +
      '<p style="margin-top:12px;"><b style="color:#1a3a6e;">Conclusion :</b> ' + conclusionTexte + '</p>';

    html += '<h1>8. Réserves et limites de l\'avis</h1><div class="reserves">' +
      String(data.reserves || '').split('\n\n').map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';

    html += '<div class="signature"><p style="font-style:italic;">Fait à ' + esc(data.metadata.lieuEtablissement) + ', le ' + formatDateFR(data.metadata.date) + '</p>' +
      '<p class="name">' + esc(sig.nom) + '</p><p>' + esc(sig.fonction) + '</p>' +
      '<p style="color:#5c6470;">' + esc(sig.societe) + ' – ' + esc(sig.adresseSociete) + '</p>' +
      '<p style="color:#5c6470;">' + esc(sig.email) + '</p></div>';

    return html;
  }

  function buildWordDoc(data, calc) {
    return '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Avis de valeur ' + esc(data.metadata.ref) + '</title>' +
      '<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>' +
      '<style>@page{size:A4;margin:2cm;}body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000;line-height:1.4;}' +
      'h1{color:#1a3a6e;font-size:14pt;border-bottom:2pt solid #b8860b;padding-bottom:4pt;margin-top:20pt;}' +
      'h2{color:#1a3a6e;font-size:12pt;margin-top:14pt;}table{border-collapse:collapse;width:100%;margin:8pt 0;}' +
      'th{background:#1a3a6e;color:#fff;padding:6pt;text-align:left;font-size:10pt;}td{padding:6pt;border:.5pt solid #bfbfbf;font-size:10pt;vertical-align:top;}' +
      '.lbl{background:#eaf0f8;font-weight:bold;width:38%;}.center{text-align:center;}.bold{font-weight:bold;}' +
      '.title-block{background:#eaf0f8;border-top:3pt solid #1a3a6e;border-bottom:3pt solid #1a3a6e;padding:14pt;text-align:center;margin:12pt 0;}' +
      '.title-block .t1{color:#1a3a6e;font-size:24pt;font-weight:bold;}.title-block .t2{color:#1a3a6e;font-size:14pt;margin-top:6pt;}.title-block .t3{color:#5c6470;font-style:italic;font-size:10pt;margin-top:4pt;}' +
      '.synth-occ{background:#1a3a6e;color:#fff;padding:12pt;}.synth-occ .v{font-size:22pt;font-weight:bold;text-align:center;}' +
      '.synth-libre{background:#eaf0f8;padding:12pt;}.synth-libre .v{font-size:18pt;font-weight:bold;color:#1a3a6e;text-align:center;}' +
      '.header-bar{border-bottom:2pt solid #b8860b;padding-bottom:8pt;margin-bottom:16pt;}.header-bar .left{color:#1a3a6e;font-weight:bold;font-size:14pt;}' +
      '.atouts{background:#e8f5e9;padding:10pt;}.vigilance{background:#ffebee;padding:10pt;}.atouts .h{color:#198754;font-weight:bold;font-size:10pt;margin-bottom:6pt;}.vigilance .h{color:#b71c1c;font-weight:bold;font-size:10pt;margin-bottom:6pt;}' +
      '.signature{text-align:right;margin-top:24pt;}.signature .name{color:#1a3a6e;font-weight:bold;font-size:12pt;}.reserves p{font-size:9pt;color:#5c6470;}.gold-row{background:#b8860b;color:#fff;font-weight:bold;}</style></head><body>' +
      buildAvisDocHTML(data, calc) + '</body></html>';
  }

  // ── API publique ────────────────────────────────────────────
  function open() {
    if (typeof bootstrap === 'undefined') { alert('Bootstrap non chargé.'); return; }
    if (!state.built) buildModal();
    if (!state.data) {
      state.data = window.__fidiData ? buildPrefillFromEtude(window.__fidiData, window.__fidiInputs) : buildPrefillFromEtude(null, null);
    }
    refreshSavedSelect();
    showSection(state.section);
    state.modal.show();
  }

  window.AvisValeur = { open: open, _compute: compute, _prefill: buildPrefillFromEtude };
})();
