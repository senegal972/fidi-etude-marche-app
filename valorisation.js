// Estimation vénale — « Valoriser le bien » : fiche descriptive (composition, pièces, annexes, atouts) et plus-value indicative.
//
// Deux natures d'ajustement, toujours modifiables à l'écran :
//   • annexes pondérées : surface × coefficient × prix au m² du bien (terrasse, garage, carbet… ne valent pas le prix du séjour) ;
//   • atouts : pourcentage de la valeur (piscine, vue, prestations…).
// Valeur valorisée = valeur avant valorisation × (1 + somme des %) + valeur des annexes, sur les trois bornes.
// La valorisation s'applique APRÈS la décote d'état ou l'ajustement « ruine » (index.html : etatApply / ruineApply la rappellent).
// Repères tirés de baromètres publics et d'usages d'experts ; il n'existe aucun barème officiel : ce sont des hypothèses à valider.
// Styles : valorisation.css. Aucune donnée n'est envoyée : la fiche vit dans window.__fidiData (fiche_bien, estimation.valorisation).
(function () {
  'use strict';

  // Annexes : coefficient de pondération usuel (0,3 à 0,5 selon les sources ; à ajuster au marché local).
  var ANNEXES = [
    { cle: 'terrasse_couverte', nom: 'Terrasse couverte / varangue', coef: 0.5 },
    { cle: 'terrasse', nom: 'Terrasse non couverte', coef: 0.3 },
    { cle: 'balcon', nom: 'Balcon / loggia', coef: 0.3 },
    { cle: 'veranda', nom: 'Véranda', coef: 0.5 },
    { cle: 'garage', nom: 'Garage fermé', coef: 0.5 },
    { cle: 'carport', nom: 'Abri voiture', coef: 0.2 },
    { cle: 'cave', nom: 'Cave / cellier / buanderie', coef: 0.3 },
    { cle: 'carbet', nom: 'Carbet / kiosque / dépendance', coef: 0.3 },
    { cle: 'soussol', nom: 'Sous-sol aménagé', coef: 0.3 },
    { cle: 'combles', nom: 'Combles aménageables', coef: 0.3 }
  ];
  // Atouts : pourcentage proposé et fourchette de repère.
  var ATOUTS = [
    { groupe: 'Extérieur', cle: 'piscine', nom: 'Piscine', pct: 8, repere: '5 à 20 %' },
    { groupe: 'Extérieur', cle: 'jardin', nom: 'Jardin arboré / paysager', pct: 3, repere: '2 à 5 %' },
    { groupe: 'Extérieur', cle: 'grand_terrain', nom: 'Terrain de grande superficie', pct: 5, repere: '3 à 10 %' },
    { groupe: 'Extérieur', cle: 'parking', nom: 'Stationnement extérieur privatif', pct: 2, repere: '1 à 3 %' },
    { groupe: 'Extérieur', cle: 'portail', nom: 'Clôture et portail automatique', pct: 1, repere: '0 à 2 %' },
    { groupe: 'Vue et environnement', cle: 'vue_mer', nom: 'Vue mer', pct: 15, repere: '10 à 30 %' },
    { groupe: 'Vue et environnement', cle: 'vue_panoramique', nom: 'Vue panoramique / dominante', pct: 8, repere: '5 à 15 %' },
    { groupe: 'Vue et environnement', cle: 'sans_vis_a_vis', nom: 'Sans vis-à-vis', pct: 3, repere: '2 à 5 %' },
    { groupe: 'Vue et environnement', cle: 'calme', nom: 'Calme, impasse, quartier recherché', pct: 2, repere: '1 à 4 %' },
    { groupe: 'Vue et environnement', cle: 'proximite', nom: 'Proximité plage, commerces, écoles', pct: 3, repere: '2 à 6 %' },
    { groupe: 'Vue et environnement', cle: 'exposition', nom: 'Bonne exposition, ventilation naturelle', pct: 2, repere: '1 à 3 %' },
    { groupe: 'Intérieur', cle: 'renove', nom: 'Rénovation récente / prestations de standing', pct: 5, repere: '3 à 10 %' },
    { groupe: 'Intérieur', cle: 'cuisine', nom: 'Cuisine équipée récente', pct: 2, repere: '1 à 3 %' },
    { groupe: 'Intérieur', cle: 'suite', nom: 'Suite parentale (salle d\'eau privative)', pct: 2, repere: '1 à 3 %' },
    { groupe: 'Intérieur', cle: 'rangements', nom: 'Dressing, placards intégrés', pct: 1, repere: '0 à 2 %' },
    { groupe: 'Intérieur', cle: 'plain_pied', nom: 'Plain-pied / accessible', pct: 2, repere: '1 à 3 %' },
    { groupe: 'Équipements', cle: 'clim', nom: 'Climatisation', pct: 2, repere: '1 à 3 %' },
    { groupe: 'Équipements', cle: 'solaire', nom: 'Chauffe-eau solaire', pct: 1, repere: '0 à 2 %' },
    { groupe: 'Équipements', cle: 'photovoltaique', nom: 'Panneaux photovoltaïques', pct: 2, repere: '1 à 4 %' },
    { groupe: 'Équipements', cle: 'citerne', nom: 'Citerne / récupération d\'eau', pct: 1, repere: '0 à 2 %' },
    { groupe: 'Équipements', cle: 'alarme', nom: 'Alarme, vidéosurveillance', pct: 1, repere: '0 à 2 %' },
    { groupe: 'Équipements', cle: 'normes', nom: 'Construction récente aux normes parasismiques et cycloniques', pct: 3, repere: '2 à 5 %' }
  ];
  var PIECES = ['Salon / séjour', 'Salle à manger', 'Cuisine', 'Chambre 1', 'Chambre 2', 'Chambre 3', 'Chambre 4', 'Chambre 5', 'Dressing', 'Bureau',
    'Salle de bain', 'Salle d\'eau', 'WC', 'Couloir / dégagement', 'Buanderie', 'Loggia', 'Garage', 'Terrasse', 'Balcon'];
  var CUMUL_ELEVE = 35; // % : au-delà, les atouts ne s'additionnent plus guère

  var nombre = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  var arrondi = function (n) { return Math.round(n); };

  // Typologie : T + nombre de pièces principales (séjour + chambres ; cuisine, salles d'eau et WC ne comptent pas).
  function typologie(f) {
    var p = Math.round(nombre(f && f.pieces));
    if (!p && f && nombre(f.chambres) > 0) p = Math.round(nombre(f.chambres)) + 1;
    if (p <= 0) return '';
    return p === 1 ? 'T1 / studio' : p >= 7 ? 'T7 et plus' : 'T' + p;
  }
  function surfacePiece(p) { var s = nombre(p.surface); return s > 0 ? s : Math.round(nombre(p.longueur) * nombre(p.largeur) * 100) / 100; }

  // Calcul pur : { pct, annexes_eur, lignes[], med, min, max, gain, cumulEleve }.
  function calculer(fiche, avant, prixM2) {
    var f = fiche || {}, base = avant || {}, pm2 = nombre(prixM2), lignes = [], pct = 0, annexes = 0;
    ATOUTS.forEach(function (a) {
      var s = (f.atouts || {})[a.cle]; if (!s || !s.actif) return;
      var p = Math.max(0, Math.min(60, s.pct === '' || s.pct == null ? a.pct : nombre(s.pct)));
      if (!p) return;
      pct += p; lignes.push({ type: 'atout', cle: a.cle, nom: a.nom, pct: p });
    });
    ANNEXES.forEach(function (a) {
      var s = (f.annexes || {})[a.cle]; if (!s || !s.actif) return;
      var surf = Math.max(0, nombre(s.surface)), coef = Math.max(0, Math.min(1, s.coef === '' || s.coef == null ? a.coef : nombre(s.coef)));
      if (!surf || !coef || !pm2) { if (surf) lignes.push({ type: 'annexe', cle: a.cle, nom: a.nom, surface: surf, coef: coef, valeur: 0 }); return; }
      var v = arrondi(surf * coef * pm2);
      annexes += v; lignes.push({ type: 'annexe', cle: a.cle, nom: a.nom, surface: surf, coef: coef, valeur: v });
    });
    var k = 1 + pct / 100, val = function (x) { return nombre(x) > 0 ? arrondi(nombre(x) * k + annexes) : 0; };
    var med = val(base.med);
    return { pct: Math.round(pct * 10) / 10, annexes_eur: annexes, lignes: lignes, med: med, min: val(base.min), max: val(base.max),
      gain: med - arrondi(nombre(base.med)), cumulEleve: pct > CUMUL_ELEVE };
  }

  // Phrase de synthèse de la fiche (composition), pour l'écran et les documents.
  function resumeComposition(f) {
    var m = [], t = typologie(f || {});
    if (t) m.push(t);
    var n = function (v, un, pl) { var x = Math.round(nombre(v)); return x > 0 ? x + ' ' + (x > 1 ? pl : un) : ''; };
    [n(f.chambres, 'chambre', 'chambres'), n(f.sdb, 'salle de bain', 'salles de bain'), n(f.sde, 'salle d\'eau', 'salles d\'eau'), n(f.wc, 'WC', 'WC'), n(f.niveaux, 'niveau', 'niveaux')]
      .forEach(function (x) { if (x) m.push(x); });
    if (nombre(f.habitable) > 0) m.push(String(nombre(f.habitable)).replace('.', ',') + ' m² habitables');
    return m.join(' · ');
  }

  // ── Fiche du bien pour le rapport A4 (pur : rend du HTML à partir des données de l'étude) ────────────────────────────────
  // Écrit avec les teintes de référence du rapport (#1a3a6e, #eaf0f8…) : la charte les remplace à l'impression (Marque.recolorer).
  var h = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var fr = function (n, d) { return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d == null ? 2 : d }); };
  var euro = function (n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' €'; };
  function htmlRapport(d) {
    var f = (d && d.fiche_bien) || null, v = (d && d.estimation && d.estimation.valorisation) || null;
    if (!f && !v) return '';
    f = f || {};
    var compo = resumeComposition(f);
    var infos = [['Terrain', nombre(f.terrain) > 0 ? fr(nombre(f.terrain)) + ' m²' : ''], ['Exposition', f.exposition], ['Assainissement', f.assainissement], ['Mitoyenneté', f.mitoyennete]]
      .filter(function (x) { return x[1]; }).map(function (x) { return '<span style="margin-right:10pt;"><span style="color:#6a7385;">' + x[0] + ' :</span> <b>' + h(x[1]) + '</b></span>'; }).join('');
    var pieces = (f.listePieces || []).filter(function (p) { return (p.nom || '').trim() || surfacePiece(p) > 0; });
    var total = pieces.reduce(function (t, p) { return t + surfacePiece(p); }, 0);
    var th = 'style="text-align:left;font-size:7.5pt;color:#1a3a6e;border-bottom:1pt solid #1a3a6e;padding:2pt 4pt;"', td = 'style="font-size:8pt;padding:2pt 4pt;border-bottom:.5pt solid #dfe5ee;"', tdr = 'style="font-size:8pt;padding:2pt 4pt;border-bottom:.5pt solid #dfe5ee;text-align:right;white-space:nowrap;"';
    var tablePieces = pieces.length ? '<table style="width:100%;border-collapse:collapse;margin-top:4pt;"><thead><tr><th ' + th + '>Pièce</th><th ' + th + '>Dimensions</th><th ' + th.replace('text-align:left', 'text-align:right') + '>Surface</th></tr></thead><tbody>' +
      pieces.map(function (p) { var L = nombre(p.longueur), l = nombre(p.largeur), sp = surfacePiece(p);
        return '<tr><td ' + td + '>' + h(p.nom || 'Pièce') + '</td><td ' + td + '>' + (L > 0 && l > 0 ? fr(L) + ' × ' + fr(l) + ' m' : '—') + '</td><td ' + tdr + '>' + (sp > 0 ? fr(sp) + ' m²' : '—') + '</td></tr>'; }).join('') +
      (total > 0 ? '<tr><td ' + td + ' colspan="2"><b>Total des pièces décrites</b>' + (nombre(f.habitable) > 0 ? ' <span style="color:#6a7385;">(surface habitable déclarée : ' + fr(nombre(f.habitable)) + ' m²)</span>' : '') + '</td><td ' + tdr + '><b>' + fr(total, 1) + ' m²</b></td></tr>' : '') +
      '</tbody></table>' : '';
    // Valorisation appliquée : chaque ligne avec son effet ; sinon, simple relevé des annexes et atouts cochés.
    var bloc = '';
    if (v && v.lignes && v.lignes.length) {
      bloc = '<table style="width:100%;border-collapse:collapse;margin-top:6pt;"><thead><tr><th ' + th + '>Élément valorisant</th><th ' + th + '>Base</th><th ' + th.replace('text-align:left', 'text-align:right') + '>Effet</th></tr></thead><tbody>' +
        v.lignes.map(function (l) { return l.type === 'atout'
          ? '<tr><td ' + td + '>' + h(l.nom) + '</td><td ' + td + '>pourcentage de la valeur</td><td ' + tdr + '>+ ' + fr(l.pct, 1) + ' %</td></tr>'
          : '<tr><td ' + td + '>' + h(l.nom) + '</td><td ' + td + '>' + fr(l.surface) + ' m² × ' + fr(l.coef) + ' (surface pondérée)</td><td ' + tdr + '>+ ' + euro(l.valeur) + '</td></tr>'; }).join('') +
        '<tr><td ' + td + ' colspan="2"><b>Valeur médiane avant valorisation → valorisée</b></td><td ' + tdr + '><b>' + euro(v.avant_med) + ' → ' + euro(v.med) + '</b></td></tr></tbody></table>';
    } else {
      var releve = [];
      ANNEXES.forEach(function (a) { var x = (f.annexes || {})[a.cle]; if (x && x.actif) releve.push(a.nom + (nombre(x.surface) > 0 ? ' (' + fr(nombre(x.surface)) + ' m²)' : '')); });
      ATOUTS.forEach(function (a) { var x = (f.atouts || {})[a.cle]; if (x && x.actif) releve.push(a.nom); });
      if (releve.length) bloc = '<div style="font-size:8pt;margin-top:5pt;"><span style="color:#6a7385;">Annexes et atouts relevés (non chiffrés dans l\'estimation) :</span> ' + h(releve.join(' · ')) + '</div>';
    }
    if (!compo && !infos && !tablePieces && !bloc) return '';
    return '<div class="rpt-block rpt-sec"><h3>Fiche descriptive du bien</h3>' +
      (compo ? '<div style="font-size:9.5pt;font-weight:700;color:#1a3a6e;">' + h(compo) + '</div>' : '') +
      (infos ? '<div style="font-size:8pt;margin-top:3pt;">' + infos + '</div>' : '') + tablePieces + bloc +
      '<div class="rpt-note">' + (v ? 'Valorisation indicative : annexes retenues pour une fraction de leur surface au prix au m² du bien, atouts en pourcentage de la valeur. Repères d\'usage, sans barème officiel — à confirmer par les ventes comparables. ' : '') +
      'Description déclarative établie lors de l\'étude ; les surfaces ne valent pas mesurage.</div></div>';
  }

  // ── Fiche du bien pour l'avis de valeur (pur) ────────────────────────────────────────────────────────────────────────────
  // L'avis fixe sa valeur par ses propres méthodes : la fiche y est DESCRIPTIVE. Les atouts sont cités comme facteurs d'appréciation,
  // avec leur repère, sans montant — le chiffre de la valorisation de l'étude n'est pas reporté, pour ne pas afficher deux valeurs.
  // Utilise les balises du document de l'avis (h2, table, th, td.center) : sa feuille de style s'y applique.
  function htmlAvis(f) {
    if (!f) return '';
    var compo = resumeComposition(f);
    var infos = [['Terrain', nombre(f.terrain) > 0 ? '≈ ' + fr(nombre(f.terrain)) + ' m²' : ''], ['Exposition', f.exposition], ['Assainissement', f.assainissement], ['Mitoyenneté', f.mitoyennete]].filter(function (x) { return x[1]; });
    var pieces = (f.listePieces || []).filter(function (p) { return (p.nom || '').trim() || surfacePiece(p) > 0; });
    var total = pieces.reduce(function (t, p) { return t + surfacePiece(p); }, 0);
    var annexes = [], atouts = [];
    ANNEXES.forEach(function (a) { var x = (f.annexes || {})[a.cle]; if (x && x.actif) annexes.push({ nom: a.nom, surface: nombre(x.surface) }); });
    ATOUTS.forEach(function (a) { var x = (f.atouts || {})[a.cle]; if (x && x.actif) atouts.push({ nom: a.nom, groupe: a.groupe, repere: a.repere }); });
    if (!compo && !infos.length && !pieces.length && !annexes.length && !atouts.length) return '';
    var o = '<h2>Fiche descriptive du bien</h2>';
    if (compo || infos.length) o += '<table>' + (compo ? '<tr><th>Composition</th><td>' + h(compo) + '</td></tr>' : '') +
      infos.map(function (x) { return '<tr><th>' + x[0] + '</th><td>' + h(x[1]) + '</td></tr>'; }).join('') + '</table>';
    if (pieces.length) o += '<table><thead><tr><th>Pièce</th><th class="center">Dimensions</th><th class="center">Surface</th></tr></thead><tbody>' +
      pieces.map(function (p) { var L = nombre(p.longueur), l = nombre(p.largeur), sp = surfacePiece(p);
        return '<tr><td>' + h(p.nom || 'Pièce') + '</td><td class="center">' + (L > 0 && l > 0 ? fr(L) + ' × ' + fr(l) + ' m' : '—') + '</td><td class="center">' + (sp > 0 ? fr(sp) + ' m²' : '—') + '</td></tr>'; }).join('') +
      (total > 0 ? '<tr class="gold-row"><td colspan="2">TOTAL DES PIÈCES DÉCRITES</td><td class="center">' + fr(total, 1) + ' m²</td></tr>' : '') + '</tbody></table>';
    if (annexes.length) o += '<table><thead><tr><th>Annexe</th><th class="center">Surface</th></tr></thead><tbody>' +
      annexes.map(function (a) { return '<tr><td>' + h(a.nom) + '</td><td class="center">' + (a.surface > 0 ? fr(a.surface) + ' m²' : '—') + '</td></tr>'; }).join('') + '</tbody></table>';
    if (atouts.length) o += '<table><thead><tr><th>Atout relevé</th><th>Nature</th><th class="center">Repère d\'usage</th></tr></thead><tbody>' +
      atouts.map(function (a) { return '<tr><td>' + h(a.nom) + '</td><td>' + h(a.groupe) + '</td><td class="center">' + h(a.repere) + '</td></tr>'; }).join('') + '</tbody></table>';
    return o + '<p style="font-size:8.5pt;color:#5c6470;">Description déclarative relevée lors de l\'étude ; les surfaces ne valent pas mesurage. ' +
      (atouts.length || annexes.length ? 'Les annexes et atouts sont des facteurs d\'appréciation, pris en compte dans le choix des références et l\'arbitrage de la valeur retenue ; les repères d\'usage sont indicatifs, sans barème officiel.' : '') + '</p>';
  }
  // Surface cumulée des terrasses, balcons et loggias de la fiche (pour le champ « Terrasse / Balcon » de l'avis).
  function surfaceExterieure(f) {
    return ['terrasse_couverte', 'terrasse', 'balcon'].reduce(function (t, k) { var x = ((f && f.annexes) || {})[k]; return t + (x && x.actif ? nombre(x.surface) : 0); }, 0);
  }

  var api = { ANNEXES: ANNEXES, ATOUTS: ATOUTS, PIECES: PIECES, calculer: calculer, typologie: typologie, surfacePiece: surfacePiece, resumeComposition: resumeComposition, htmlRapport: htmlRapport,
    htmlAvis: htmlAvis, surfaceExterieure: surfaceExterieure };
  if (typeof window !== 'undefined') window.FidiValorisation = api;
  if (typeof document === 'undefined') return;

  // ── Écran ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { return Math.round(n).toLocaleString('fr-FR') + ' €'; };
  var lireBorne = function (id) { var e = $(id); return e ? (Number((e.textContent || '').replace(/[^\d]/g, '')) || 0) : 0; };
  var etat = { avant: null, actif: false };

  function donnees() { var d = window.__fidiData = window.__fidiData || {}; d.estimation = d.estimation || {}; return d; }
  function fiche() {
    var d = donnees();
    if (!d.fiche_bien) {
      var surf = nombre(d.estimation.surface || (window.__fidiInputs || {}).surface);
      d.fiche_bien = { pieces: '', chambres: '', sdb: '', sde: '', wc: '', niveaux: '', habitable: surf || '', terrain: '', exposition: '', assainissement: '', mitoyennete: '',
        listePieces: [], annexes: {}, atouts: {} };
    }
    var f = d.fiche_bien; f.annexes = f.annexes || {}; f.atouts = f.atouts || {}; f.listePieces = f.listePieces || [];
    return f;
  }
  function prixM2() { return nombre(donnees().estimation.prix_m2); }
  // Valeurs avant valorisation : lues à l'écran (elles portent déjà la décote d'état ou l'ajustement « ruine »).
  function capturer() { etat.avant = { med: lireBorne('est-med'), min: lireBorne('est-min'), max: lireBorne('est-max') }; return etat.avant; }

  function ecrire(r) {
    var poser = function (id, v) { var e = $(id); if (e) e.textContent = eur(v); };
    poser('est-valeur', r.med); poser('est-med', r.med); poser('est-min', r.min); poser('est-max', r.max);
    var d = donnees(); d.estimation.valeur_med = r.med; d.estimation.valeur_min = r.min; d.estimation.valeur_max = r.max;
  }
  function majResume() {
    var f = fiche(), tag = $('valoAppliedTag'), res = $('valoResume'), v = donnees().estimation.valorisation;
    if (tag) tag.textContent = etat.actif && v ? ('valorisation ' + (v.pct ? '+' + String(v.pct).replace('.', ',') + ' %' : '') + (v.pct && v.annexes_eur ? ' et ' : '') + (v.annexes_eur ? '+' + eur(v.annexes_eur) : '') + ' incluse') : '';
    if (!res) return;
    var compo = resumeComposition(f);
    if (!compo && !(etat.actif && v)) { res.classList.add('d-none'); res.innerHTML = ''; return; }
    var lignes = etat.actif && v ? v.lignes.map(function (l) {
      return '<li>' + esc(l.nom) + ' : ' + (l.type === 'atout' ? '+' + String(l.pct).replace('.', ',') + ' %' : String(l.surface).replace('.', ',') + ' m² × ' + String(l.coef).replace('.', ',') + ' = +' + eur(l.valeur)) + '</li>';
    }).join('') : '';
    res.classList.remove('d-none');
    res.innerHTML = '<div class="valo-resume-tete"><i class="bi bi-stars me-1"></i>Fiche du bien' + (compo ? ' — ' + esc(compo) : '') + '</div>' +
      (lignes ? '<ul class="valo-resume-liste">' + lignes + '</ul><div class="valo-resume-note">Valorisation indicative : ' + eur(v.avant_med) + ' → <b>' + eur(v.med) + '</b>. Repères d\'usage, sans barème officiel — à confirmer par les ventes comparables.</div>' : '');
  }
  function appliquer() {
    var d = donnees();
    if (!window.__estBase) window.__estBase = { med: lireBorne('est-med'), min: lireBorne('est-min'), max: lireBorne('est-max') }; // base saine pour l'état / la ruine
    if (!etat.avant || !etat.actif) capturer();
    if (!(etat.avant.med > 0)) return null;
    var r = calculer(fiche(), etat.avant, prixM2());
    etat.actif = r.pct > 0 || r.annexes_eur > 0;
    if (etat.actif) { ecrire(r); d.estimation.valorisation = { pct: r.pct, annexes_eur: r.annexes_eur, lignes: r.lignes, avant_med: etat.avant.med, med: r.med, avant: { med: etat.avant.med, min: etat.avant.min, max: etat.avant.max } }; }
    else { ecrire({ med: etat.avant.med, min: etat.avant.min, max: etat.avant.max }); delete d.estimation.valorisation; }
    majResume();
    if (window.FidiGuard && window.FidiGuard.setDirty) window.FidiGuard.setDirty();
    return r;
  }
  function retirer() {
    if (etat.actif && etat.avant) ecrire({ med: etat.avant.med, min: etat.avant.min, max: etat.avant.max });
    etat.actif = false; delete donnees().estimation.valorisation; majResume();
  }
  // Appelé par index.html après une décote d'état ou un ajustement « ruine » : la valorisation se repose sur la nouvelle valeur.
  api.apresAjustement = function () { var etait = etat.actif; etat.actif = false; capturer(); if (etait) { etat.actif = true; appliquer(); } };
  // Nouvelle analyse : la valorisation de l'étude précédente ne suit pas.
  api.reinitialiser = function () { etat.avant = null; etat.actif = false; var t = $('valoAppliedTag'); if (t) t.textContent = ''; var r = $('valoResume'); if (r) { r.classList.add('d-none'); r.innerHTML = ''; } };
  api.retirer = retirer;
  // Étude rouverte : la fiche et la valorisation enregistrées reprennent leur place (rappel sous l'estimation, valeur de départ).
  api.restaurer = function () {
    var d = donnees(), v = d.estimation.valorisation;
    etat.avant = null; etat.actif = false;
    if (v && v.avant && v.avant.med > 0 && d.fiche_bien) { etat.avant = { med: v.avant.med, min: v.avant.min, max: v.avant.max }; etat.actif = true; window.__estBase = window.__estBase || { med: v.avant.med, min: v.avant.min, max: v.avant.max }; appliquer(); }
    else majResume();
  };

  // ── Fenêtre ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function champN(id, lib, val, attrs) { return '<label class="valo-champ"><span>' + lib + '</span><input type="number" inputmode="decimal" class="form-control" id="' + id + '" value="' + esc(val) + '" ' + (attrs || 'min="0" step="1"') + '></label>'; }
  function champS(id, lib, val, options) {
    return '<label class="valo-champ"><span>' + lib + '</span><select class="form-select" id="' + id + '">' + options.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>';
  }
  function lignePiece(p, i) {
    return '<div class="valo-piece" data-i="' + i + '"><input class="form-control valo-p-nom" list="valoPiecesListe" placeholder="Pièce" maxlength="40" value="' + esc(p.nom || '') + '" aria-label="Nom de la pièce">' +
      '<input type="number" inputmode="decimal" class="form-control valo-p-l" min="0" step="0.05" placeholder="Long." value="' + esc(p.longueur || '') + '" aria-label="Longueur en mètres">' +
      '<input type="number" inputmode="decimal" class="form-control valo-p-w" min="0" step="0.05" placeholder="Larg." value="' + esc(p.largeur || '') + '" aria-label="Largeur en mètres">' +
      '<input type="number" inputmode="decimal" class="form-control valo-p-s" min="0" step="0.1" placeholder="m²" value="' + esc(p.surface || '') + '" aria-label="Surface en mètres carrés">' +
      '<button type="button" class="btn btn-sm btn-outline-danger" data-valo="retirer-piece" aria-label="Retirer cette pièce"><i class="bi bi-trash"></i></button></div>';
  }
  function corps() {
    var f = fiche(), groupes = [], vus = {};
    ATOUTS.forEach(function (a) { if (!vus[a.groupe]) { vus[a.groupe] = { nom: a.groupe, items: [] }; groupes.push(vus[a.groupe]); } vus[a.groupe].items.push(a); });
    return '<datalist id="valoPiecesListe">' + PIECES.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>' +
      '<section class="valo-bloc"><h6><i class="bi bi-house-door me-1"></i>Composition du bien <span class="valo-typo" id="valoTypo"></span></h6>' +
        '<div class="valo-grille">' +
          champN('valoPieces', 'Pièces principales', f.pieces) + champN('valoChambres', 'Chambres', f.chambres) + champN('valoSdb', 'Salles de bain', f.sdb) +
          champN('valoSde', 'Salles d\'eau', f.sde) + champN('valoWc', 'WC', f.wc) + champN('valoNiveaux', 'Niveaux', f.niveaux) +
          champN('valoHabitable', 'Surface habitable (m²)', f.habitable, 'min="0" step="0.5"') + champN('valoTerrain', 'Terrain (m²)', f.terrain, 'min="0" step="1"') +
          champS('valoExposition', 'Exposition', f.exposition || '', ['', 'Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest', 'Traversant']) +
          champS('valoAssainissement', 'Assainissement', f.assainissement || '', ['', 'Collectif (tout-à-l\'égout)', 'Individuel (fosse)']) +
          champS('valoMitoyennete', 'Mitoyenneté', f.mitoyennete || '', ['', 'Indépendant', 'Mitoyen d\'un côté', 'Mitoyen des deux côtés']) +
        '</div><p class="valo-aide">Pièces principales = séjour + chambres (la cuisine, les salles d\'eau et les WC ne comptent pas) : 3 pièces principales = T3.</p></section>' +
      '<section class="valo-bloc"><h6><i class="bi bi-rulers me-1"></i>Surfaces par pièce <span class="valo-typo" id="valoSomme"></span></h6>' +
        '<div class="valo-pieces-tete"><span>Pièce</span><span>Long. (m)</span><span>Larg. (m)</span><span>m²</span><span></span></div>' +
        '<div id="valoPiecesLignes">' + f.listePieces.map(lignePiece).join('') + '</div>' +
        '<button type="button" class="btn btn-sm btn-outline-primary" data-valo="ajouter-piece"><i class="bi bi-plus-lg me-1"></i>Ajouter une pièce</button>' +
        '<p class="valo-aide">Longueur × largeur calcule la surface ; vous pouvez aussi saisir directement les m².</p></section>' +
      '<section class="valo-bloc"><h6><i class="bi bi-bounding-box me-1"></i>Annexes — surface pondérée</h6>' +
        '<p class="valo-aide">Une annexe ne vaut pas le prix du séjour : sa surface est retenue pour une fraction (coefficient), au prix au m² du bien (' + (prixM2() ? eur(prixM2()) + ' / m²' : 'prix au m² non connu') + ').</p>' +
        '<div class="valo-annexes">' + ANNEXES.map(function (a) { var s = f.annexes[a.cle] || {};
          return '<div class="valo-annexe"><label class="valo-case"><input class="form-check-input" type="checkbox" data-annexe="' + a.cle + '"' + (s.actif ? ' checked' : '') + '><span>' + esc(a.nom) + '</span></label>' +
            '<input type="number" inputmode="decimal" class="form-control" data-annexe-surface="' + a.cle + '" min="0" step="0.5" placeholder="m²" value="' + esc(s.surface || '') + '" aria-label="Surface de : ' + esc(a.nom) + '">' +
            '<input type="number" inputmode="decimal" class="form-control" data-annexe-coef="' + a.cle + '" min="0" max="1" step="0.05" value="' + esc(s.coef == null || s.coef === '' ? a.coef : s.coef) + '" aria-label="Coefficient de : ' + esc(a.nom) + '" title="Coefficient de pondération">' +
            '<span class="valo-montant" data-annexe-montant="' + a.cle + '"></span></div>'; }).join('') + '</div></section>' +
      '<section class="valo-bloc"><h6><i class="bi bi-stars me-1"></i>Atouts qui valorisent le bien</h6>' +
        '<p class="valo-aide">Cochez ce qui s\'applique ; le pourcentage proposé se modifie. La fourchette de repère est indiquée pour chaque atout.</p>' +
        groupes.map(function (g) { return '<div class="valo-groupe"><div class="valo-groupe-nom">' + esc(g.nom) + '</div><div class="valo-atouts">' + g.items.map(function (a) { var s = f.atouts[a.cle] || {};
          return '<div class="valo-atout"><label class="valo-case"><input class="form-check-input" type="checkbox" data-atout="' + a.cle + '"' + (s.actif ? ' checked' : '') + '><span>' + esc(a.nom) + ' <small>' + a.repere + '</small></span></label>' +
            '<span class="valo-pct"><input type="number" inputmode="decimal" class="form-control" data-atout-pct="' + a.cle + '" min="0" max="60" step="0.5" value="' + esc(s.pct == null || s.pct === '' ? a.pct : s.pct) + '" aria-label="Pourcentage : ' + esc(a.nom) + '">%</span></div>'; }).join('') + '</div></div>'; }).join('') +
      '</section>';
  }
  function lireFenetre() {
    var f = fiche(), v = function (id) { var e = $(id); return e ? e.value : ''; };
    f.pieces = v('valoPieces'); f.chambres = v('valoChambres'); f.sdb = v('valoSdb'); f.sde = v('valoSde'); f.wc = v('valoWc'); f.niveaux = v('valoNiveaux');
    f.habitable = v('valoHabitable'); f.terrain = v('valoTerrain'); f.exposition = v('valoExposition'); f.assainissement = v('valoAssainissement'); f.mitoyennete = v('valoMitoyennete');
    f.listePieces = [].map.call(document.querySelectorAll('#valoPiecesLignes .valo-piece'), function (l) {
      return { nom: l.querySelector('.valo-p-nom').value.trim(), longueur: l.querySelector('.valo-p-l').value, largeur: l.querySelector('.valo-p-w').value, surface: l.querySelector('.valo-p-s').value };
    });
    ANNEXES.forEach(function (a) {
      var c = document.querySelector('[data-annexe="' + a.cle + '"]'); if (!c) return;
      f.annexes[a.cle] = { actif: c.checked, surface: document.querySelector('[data-annexe-surface="' + a.cle + '"]').value, coef: document.querySelector('[data-annexe-coef="' + a.cle + '"]').value };
    });
    ATOUTS.forEach(function (a) {
      var c = document.querySelector('[data-atout="' + a.cle + '"]'); if (!c) return;
      f.atouts[a.cle] = { actif: c.checked, pct: document.querySelector('[data-atout-pct="' + a.cle + '"]').value };
    });
    return f;
  }
  function majFenetre() {
    var f = lireFenetre(), avant = etat.actif && etat.avant ? etat.avant : { med: lireBorne('est-med'), min: lireBorne('est-min'), max: lireBorne('est-max') };
    var r = calculer(f, avant, prixM2());
    var typo = $('valoTypo'); if (typo) typo.textContent = typologie(f);
    var somme = f.listePieces.reduce(function (s, p) { return s + surfacePiece(p); }, 0), hab = nombre(f.habitable);
    var sm = $('valoSomme'); if (sm) sm.textContent = somme ? (String(Math.round(somme * 10) / 10).replace('.', ',') + ' m² au total' + (hab ? ' — habitable saisie : ' + String(hab).replace('.', ',') + ' m²' : '')) : '';
    r.lignes.forEach(function (l) { if (l.type !== 'annexe') return; var e = document.querySelector('[data-annexe-montant="' + l.cle + '"]'); if (e) e.textContent = l.valeur ? '+' + eur(l.valeur) : ''; });
    ANNEXES.forEach(function (a) { if (!r.lignes.some(function (l) { return l.cle === a.cle && l.type === 'annexe'; })) { var e = document.querySelector('[data-annexe-montant="' + a.cle + '"]'); if (e) e.textContent = ''; } });
    var pied = $('valoTotal');
    if (pied) pied.innerHTML = !(avant.med > 0) ? '<span class="text-danger">Estimation vénale non renseignée : indiquez une surface et relancez l\'analyse.</span>'
      : 'Valeur de départ <b>' + eur(avant.med) + '</b> → valorisée <b class="valo-total-v">' + eur(r.med) + '</b>' +
        ' <span class="valo-total-d">(' + (r.pct ? '+' + String(r.pct).replace('.', ',') + ' %' : 'aucun atout') + (r.annexes_eur ? ', annexes +' + eur(r.annexes_eur) : '') + ')</span>' +
        (r.cumulEleve ? '<div class="valo-alerte"><i class="bi bi-exclamation-triangle me-1"></i>Cumul d\'atouts élevé (plus de ' + CUMUL_ELEVE + ' %) : dans la réalité ils ne s\'additionnent pas entièrement. Vérifiez sur les ventes comparables.</div>' : '');
  }
  function ouvrir() {
    var racine = $('valoRoot'); if (!racine) { racine = document.createElement('div'); racine.id = 'valoRoot'; document.body.appendChild(racine); }
    racine.innerHTML = '<div class="modal fade" id="valoModal" tabindex="-1" aria-labelledby="valoTitre"><div class="modal-dialog modal-lg modal-dialog-scrollable modal-fullscreen-md-down"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title" id="valoTitre"><i class="bi bi-stars me-1"></i>Valoriser le bien — fiche descriptive</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button></div>' +
      '<div class="modal-body valo-corps">' + corps() + '</div>' +
      '<div class="modal-footer valo-pied"><div class="valo-total" id="valoTotal" role="status"></div>' +
        '<div class="valo-boutons"><button type="button" class="btn btn-outline-danger" data-valo="retirer">Retirer la valorisation</button>' +
        '<button type="button" class="btn btn-outline-secondary" data-valo="enregistrer">Enregistrer la fiche seule</button>' +
        '<button type="button" class="btn btn-primary" data-valo="appliquer"><i class="bi bi-check-lg me-1"></i>Appliquer à l\'estimation</button></div></div>' +
      '</div></div></div>';
    var el = $('valoModal');
    el.addEventListener('input', function (e) {
      var l = e.target.closest ? e.target.closest('.valo-piece') : null;
      if (l && (e.target.classList.contains('valo-p-l') || e.target.classList.contains('valo-p-w'))) {
        var s = Math.round(nombre(l.querySelector('.valo-p-l').value) * nombre(l.querySelector('.valo-p-w').value) * 100) / 100;
        if (s > 0) l.querySelector('.valo-p-s').value = s;
      }
      // Saisir une surface ou un pourcentage coche la ligne.
      var k = e.target.getAttribute && (e.target.getAttribute('data-annexe-surface') || e.target.getAttribute('data-atout-pct'));
      if (k && e.target.value !== '') { var c = el.querySelector(e.target.hasAttribute('data-annexe-surface') ? '[data-annexe="' + k + '"]' : '[data-atout="' + k + '"]'); if (c && e.target.hasAttribute('data-annexe-surface')) c.checked = nombre(e.target.value) > 0; }
      majFenetre();
    });
    el.addEventListener('change', majFenetre);
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-valo]') : null; if (!b) return;
      var a = b.getAttribute('data-valo'), M = window.bootstrap && window.bootstrap.Modal.getInstance(el);
      if (a === 'ajouter-piece') { var f = lireFenetre(); f.listePieces.push({ nom: '', longueur: '', largeur: '', surface: '' }); $('valoPiecesLignes').innerHTML = f.listePieces.map(lignePiece).join(''); var n = el.querySelectorAll('.valo-p-nom'); n[n.length - 1].focus(); return; }
      if (a === 'retirer-piece') { b.closest('.valo-piece').remove(); majFenetre(); return; }
      if (a === 'appliquer') { lireFenetre(); appliquer(); if (M) M.hide(); return; }
      if (a === 'enregistrer') { lireFenetre(); majResume(); if (window.FidiGuard && window.FidiGuard.setDirty) window.FidiGuard.setDirty(); if (M) M.hide(); return; }
      if (a === 'retirer') { lireFenetre(); retirer(); if (M) M.hide(); }
    });
    el.addEventListener('hidden.bs.modal', function () { el.remove(); });
    if (typeof window.fidiStackModal === 'function') window.fidiStackModal(el);
    majFenetre();
    if (window.bootstrap && window.bootstrap.Modal) new window.bootstrap.Modal(el).show();
  }
  api.ouvrir = ouvrir;
})();
