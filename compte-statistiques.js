// Mon compte → Statistiques (administrateur) : ce qui se pratique dans l'application — volumes, rythme, secteurs, types de biens, groupes.
// Données : /api/statistiques, qui ne rend que des comptes (jamais un dossier). Styles : compte-statistiques.css.
// Graphique mensuel : deux séries (études, avis) aux couleurs de la palette validée pour les daltoniens (bleu #257de0, orange #f47230),
// légende, étiquettes sur le mois le plus haut, détail au survol, et le même contenu en tableau.
(function () {
  'use strict';
  var etat = { d: null, erreur: '', table: false };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var racine = function () { return document.getElementById('statsRoot'); };
  var nb = function (n) { return Number(n || 0).toLocaleString('fr-FR'); };
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var libMois = function (m) { var p = String(m).split('-'); return MOIS[+p[1] - 1] + ' ' + p[0].slice(2); };

  function tuile(titre, valeur, sous) { return '<div class="st-tuile"><div class="st-tuile-t">' + titre + '</div><div class="st-tuile-v">' + valeur + '</div>' + (sous ? '<div class="st-tuile-s">' + sous + '</div>' : '') + '</div>'; }

  // Barres groupées par mois : une échelle, base à zéro, 2 px entre les barres, sommet arrondi.
  function graphiqueMois(mois) {
    var max = Math.max.apply(null, mois.map(function (m) { return Math.max(m.etudes, m.avis); }).concat(1));
    var pas = max <= 5 ? 1 : max <= 20 ? 5 : max <= 50 ? 10 : max <= 200 ? 50 : Math.pow(10, Math.floor(Math.log10(max)));
    var haut = Math.ceil(max / pas) * pas, W = 640, H = 220, G = 34, B = 26, T = 14, zone = H - B - T, col = (W - G - 6) / mois.length, lb = Math.min(14, (col - 8) / 2);
    var y = function (v) { return T + zone - (v / haut) * zone; };
    var sommet = mois.reduce(function (a, m, i) { return m.etudes + m.avis > a.v ? { v: m.etudes + m.avis, i: i } : a; }, { v: 0, i: -1 }).i;
    var o = '<svg class="st-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Études de marché et avis de valeur par mois, douze derniers mois">';
    for (var g = 0; g <= haut; g += pas) o += '<line x1="' + G + '" x2="' + (W - 4) + '" y1="' + y(g) + '" y2="' + y(g) + '" class="st-grille"/><text x="' + (G - 6) + '" y="' + (y(g) + 3.5) + '" class="st-axe" text-anchor="end">' + g + '</text>';
    var barre = function (x, v, classe) { var h = Math.max(0, T + zone - y(v)), r = Math.min(4, h, lb / 2);
      return v ? '<path class="' + classe + '" d="M' + x + ' ' + (T + zone) + 'V' + (y(v) + r) + 'q0 -' + r + ' ' + r + ' -' + r + 'h' + (lb - 2 * r) + 'q' + r + ' 0 ' + r + ' ' + r + 'V' + (T + zone) + 'Z"/>' : ''; };
    mois.forEach(function (m, i) {
      var x0 = G + i * col + (col - 2 * lb - 2) / 2;
      o += '<g class="st-mois" tabindex="0" data-st-mois="' + i + '"><rect x="' + (G + i * col) + '" y="' + T + '" width="' + col + '" height="' + zone + '" class="st-cible"/>' +
        barre(x0, m.etudes, 'st-s1') + barre(x0 + lb + 2, m.avis, 'st-s2') +
        (i === sommet ? (m.etudes ? '<text x="' + (x0 + lb / 2) + '" y="' + (y(m.etudes) - 4) + '" class="st-val" text-anchor="middle">' + m.etudes + '</text>' : '') + (m.avis ? '<text x="' + (x0 + lb + 2 + lb / 2) + '" y="' + (y(m.avis) - 4) + '" class="st-val" text-anchor="middle">' + m.avis + '</text>' : '') : '') +
        '<text x="' + (G + i * col + col / 2) + '" y="' + (H - 8) + '" class="st-axe" text-anchor="middle">' + libMois(m.mois) + '</text></g>';
    });
    return o + '<line x1="' + G + '" x2="' + (W - 4) + '" y1="' + (T + zone) + '" y2="' + (T + zone) + '" class="st-base"/></svg>';
  }
  function tableMois(mois) {
    return '<table class="st-table"><thead><tr><th>Mois</th><th>Études</th><th>Avis</th><th>Total</th></tr></thead><tbody>' + mois.map(function (m) {
      return '<tr><td>' + libMois(m.mois) + '</td><td>' + nb(m.etudes) + '</td><td>' + nb(m.avis) + '</td><td>' + nb(m.etudes + m.avis) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  // Classement : une seule série (le total), barre de proportion + valeurs en clair.
  function classement(lignes, nom, vide) {
    if (!lignes.length) return '<p class="st-vide">' + vide + '</p>';
    var max = Math.max.apply(null, lignes.map(function (l) { return l.total; }).concat(1));
    return '<div class="st-rang">' + lignes.map(function (l) {
      return '<div class="st-rang-l"><span class="st-rang-n" title="' + esc(l[nom]) + '">' + esc(l[nom]) + '</span><span class="st-rang-b"><i style="width:' + Math.max(2, Math.round(100 * l.total / max)) + '%"></i></span>' +
        '<span class="st-rang-v"><b>' + nb(l.total) + '</b> <small>' + nb(l.etudes) + ' ét. · ' + nb(l.avis) + ' avis</small></span></div>'; }).join('') + '</div>';
  }
  function afficher() {
    var el = racine(); if (!el) return;
    var d = etat.d;
    if (!d) { el.innerHTML = '<div class="' + (etat.erreur ? 'alert alert-danger py-2 small' : 'text-muted small') + '">' + esc(etat.erreur || 'Calcul des statistiques…') + '</div>'; return; }
    var t = d.totaux, e = d.parEcosysteme, c = d.comptes, total = t.etudes + t.avis;
    var jmax = Math.max.apply(null, d.jours.map(function (j) { return j.total; }).concat(1));
    el.innerHTML =
      '<div class="st-tuiles">' +
        tuile('Études de marché', nb(t.etudes), nb(t.etudes30) + ' sur 30 jours') + tuile('Avis de valeur', nb(t.avis), nb(t.avis30) + ' sur 30 jours') +
        tuile('Avis pour 10 études', t.etudes ? String(Math.round(10 * t.avis / t.etudes * 10) / 10).replace('.', ',') : '—', 'part des études suivies d\'un avis') +
        tuile('Comptes actifs', nb(c.actifs30.interne + c.actifs30.public), 'ont produit un dossier en 30 jours, sur ' + nb(c.interne + c.public)) +
      '</div>' +
      '<div class="cpt-carte"><div class="st-carte-tete"><h3>Rythme sur douze mois</h3>' +
        '<div class="st-legende"><span><i class="st-pastille st-s1"></i>Études de marché</span><span><i class="st-pastille st-s2"></i>Avis de valeur</span>' +
        '<button type="button" class="cpt-lien-texte" data-st="table" aria-pressed="' + etat.table + '">' + (etat.table ? 'Voir le graphique' : 'Voir en tableau') + '</button></div></div>' +
        (etat.table ? tableMois(d.parMois) : '<div class="st-graph">' + graphiqueMois(d.parMois) + '<div class="st-bulle d-none" id="stBulle" role="status"></div></div>') + '</div>' +
      '<div class="st-deux">' +
        '<div class="cpt-carte"><h3>Secteurs les plus demandés <small>mon cercle</small></h3>' + classement(d.secteurs, 'commune', 'Aucun dossier pour l\'instant.') + '</div>' +
        '<div class="cpt-carte"><h3>Types de biens</h3>' + classement(d.typesBien, 'bien', 'Aucun dossier pour l\'instant.') + '</div>' +
      '</div>' +
      '<div class="st-deux">' +
        '<div class="cpt-carte"><h3>Par groupe <small>mon cercle</small></h3>' + classement(d.groupes, 'groupe', 'Aucun dossier rattaché à un groupe.') + '</div>' +
        '<div class="cpt-carte"><h3>Jours de travail</h3><div class="st-jours">' + d.jours.map(function (j) {
          return '<div class="st-jour" title="' + esc(j.jour) + ' : ' + nb(j.total) + ' dossier' + (j.total > 1 ? 's' : '') + '"><b>' + nb(j.total) + '</b><span><i style="height:' + Math.max(3, Math.round(100 * j.total / jmax)) + '%"></i></span><small>' + j.jour.slice(0, 3) + '.</small></div>'; }).join('') + '</div>' +
          '<p class="st-note">Jour d\'enregistrement des dossiers.</p></div>' +
      '</div>' +
      '<div class="cpt-carte"><h3>Utilisateurs les plus actifs <small>mon cercle</small></h3>' + (d.utilisateurs.length ? '<div class="table-responsive"><table class="st-table"><thead><tr><th>Utilisateur</th><th>Groupe</th><th>Études</th><th>Avis</th><th>Dernier dossier</th></tr></thead><tbody>' +
        d.utilisateurs.map(function (u) { return '<tr><td>' + esc(u.nom) + '</td><td>' + esc(u.groupe || '—') + '</td><td>' + nb(u.etudes) + '</td><td>' + nb(u.avis) + '</td><td>' + esc(u.dernier ? u.dernier.split('-').reverse().join('/') : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>'
        : '<p class="st-vide">Aucun dossier rattaché à un compte pour l\'instant.</p>') + '</div>' +
      '<div class="cpt-carte st-public"><h3>Clients de l\'écosystème public <small>chiffres seulement</small></h3>' +
        '<div class="st-tuiles st-tuiles-3">' + tuile('Comptes clients', nb(c.public), nb(c.actifs30.public) + ' actifs sur 30 jours') + tuile('Études de marché', nb(e.public.etudes)) + tuile('Avis de valeur', nb(e.public.avis)) + '</div>' +
        '<h3 class="st-sous">Secteurs demandés par les clients</h3>' + classement(d.secteursPublic, 'commune', 'Aucun secteur n\'atteint ' + d.seuil_public + ' dossiers.') +
        '<p class="st-note"><i class="bi bi-shield-lock me-1"></i>Vous n\'avez pas accès aux dossiers des clients publics : seuls des nombres sont comptés ici, sans nom, sans adresse et sans détail par compte. Un secteur n\'apparaît qu\'à partir de ' + d.seuil_public + ' dossiers.</p></div>' +
      '<p class="st-note">' + nb(total) + ' dossiers comptés (les ' + nb(d.plafond) + ' plus récents de chaque base au plus). Un dossier est compté à sa date d\'enregistrement ; une étude non sauvegardée n\'est pas comptée. ' +
        'Calculé le ' + new Date(d.calcule_le).toLocaleString('fr-FR') + '. <button type="button" class="cpt-lien-texte" data-st="actualiser">Actualiser</button></p>';
  }
  function bulle(i, cible) {
    var b = document.getElementById('stBulle'); if (!b || !etat.d) return;
    if (i == null) { b.classList.add('d-none'); return; }
    var m = etat.d.parMois[i], zone = b.parentNode.getBoundingClientRect(), r = cible.getBoundingClientRect();
    b.innerHTML = '<b>' + libMois(m.mois) + '</b><span><i class="st-pastille st-s1"></i>' + nb(m.etudes) + ' étude' + (m.etudes > 1 ? 's' : '') + '</span><span><i class="st-pastille st-s2"></i>' + nb(m.avis) + ' avis</span>';
    b.classList.remove('d-none');
    b.style.left = Math.max(0, Math.min(zone.width - b.offsetWidth, r.left - zone.left + r.width / 2 - b.offsetWidth / 2)) + 'px';
  }
  async function charger() {
    etat.d = null; etat.erreur = ''; afficher();
    try { var r = await fetch('/api/statistiques', { credentials: 'same-origin' }); var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'Statistiques indisponibles.'); etat.d = d; }
    catch (e) { etat.erreur = e.message || 'Statistiques indisponibles.'; }
    afficher();
  }
  function monter() {
    var el = racine(); if (!el) return;
    if (!el.dataset.stPret) {
      el.dataset.stPret = '1';
      el.addEventListener('click', function (e) { var b = e.target.closest('[data-st]'); if (!b) return; if (b.getAttribute('data-st') === 'table') { etat.table = !etat.table; afficher(); } else charger(); });
      var survol = function (e) { var g = e.target.closest ? e.target.closest('[data-st-mois]') : null; bulle(g ? +g.getAttribute('data-st-mois') : null, g); };
      el.addEventListener('mouseover', survol); el.addEventListener('focusin', survol);
      el.addEventListener('mouseleave', function () { bulle(null); }); el.addEventListener('focusout', function () { bulle(null); });
    }
    charger();
  }
  window.FidiStatistiques = { monter: monter };
})();
