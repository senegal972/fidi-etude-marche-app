/* ════════════════════════════════════════════════════════════════════════
   « Nouvelle étude de marché » — choisir la parcelle sur la carte
   Bouton « Carte » (#btnCarteChoix) à côté de Adresse / Réf. cadastrale. Il ouvre, dans la carte « Bien étudié »,
   un panneau (#carteChoix) : ville + carte du cadastre. On clique une parcelle, on lit sa fiche (carte-parcelle.js),
   puis « Étudier cette parcelle » remplit la recherche par référence cadastrale. Rien n'est lancé sans clic sur
   « Lancer l'analyse ».

   Position de départ : la commune déjà saisie ; sinon la position de l'appareil (géolocalisation, si elle est
   accordée) ; sinon la dernière commune utilisée ; sinon une vue d'ensemble, en attendant le nom de la ville.

   Dépend de : Leaflet, FidiParcelle (carte-parcelle.js), fidiChoisirParcelle / fidiParcelleSaisie / fidiCommuneSaisie
   (index.html). Sources : geo.api.gouv.fr (communes), fonds et cadastre de l'IGN et d'OpenStreetMap. Styles : saisie.css.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var GEO = 'https://geo.api.gouv.fr/communes';
  var CHAMPS = '&fields=code,nom,codesPostaux,centre,departement,region';
  var CLE = 'fidi_carte_derniere';
  var carte = null, fiche = null, monte = false, commune = null, minuteur = null, repere = null, selection = null;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var lire = function (url) { return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
  var wmts = function (couche, format) {
    return 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=' + couche + '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=' + (format || 'image/png');
  };
  function dire(texte, type) {
    var e = $('carteChoixEtat'); if (!e) return;
    e.className = 'saisie-carte-etat' + (type ? ' saisie-carte-etat-' + type : '');
    e.innerHTML = texte || '';
  }
  function centreDe(c) { return c && c.centre && c.centre.coordinates ? [c.centre.coordinates[1], c.centre.coordinates[0]] : null; }

  function gabarit() {
    return '<div class="saisie-carte-tete">' +
        '<div class="position-relative saisie-carte-ville"><label class="saisie-label" for="carteChoixVille">Ville</label>' +
          '<input type="text" class="form-control saisie-input" id="carteChoixVille" placeholder="Nom de la commune (ex : Le Robert)" autocomplete="off">' +
          '<div class="autocomplete-dropdown d-none" id="carteChoixListe"></div></div>' +
        '<button type="button" class="btn-pill btn-pill-ghost" id="carteChoixPosition" title="Centrer la carte sur ma position"><i class="bi bi-geo-alt-fill"></i> Ma position</button>' +
        '<button type="button" class="btn-icon" id="carteChoixFermer" title="Fermer la carte" aria-label="Fermer la carte"><i class="bi bi-x-lg"></i></button>' +
      '</div>' +
      '<div id="carteChoixEtat" class="saisie-carte-etat" role="status"></div>' +
      '<div id="carteChoixCarte" class="saisie-carte-carte" aria-label="Carte du cadastre"></div>' +
      '<p class="saisie-hint"><i class="bi bi-hand-index me-1"></i>Indiquez la ville, zoomez, puis cliquez sur la parcelle à étudier. Sa fiche s\'affiche ; « Étudier cette parcelle » la reporte dans la recherche.</p>';
  }

  function actionsParcelle(p) {
    var deja = typeof window.fidiParcelleSaisie === 'function' ? window.fidiParcelleSaisie() : null;
    var a = [{ libelle: 'Étudier cette parcelle', icone: 'bi-check2-circle', principal: true, auClic: function (q) { retenir(q, false); } }];
    // Même commune qu'une parcelle déjà retenue : on peut l'ajouter à la même étude (surfaces additionnées).
    if (deja && deja.commune && deja.commune.code === p.code_insee && !(deja.section.toUpperCase() === String(p.section).toUpperCase() && deja.numero === String(p.numero))) {
      a.push({ libelle: 'Ajouter à l\'étude en cours', icone: 'bi-plus-circle', auClic: function (q) { retenir(q, true); } });
    }
    return a;
  }

  // Reporte la parcelle dans la recherche par référence cadastrale.
  function retenir(p, ajouter) {
    if (!p || !p.code_insee || !p.numero) return;
    dire('<span class="spinner-border spinner-border-sm me-1"></span>Lecture de la commune…');
    var connue = commune && commune.code === p.code_insee ? Promise.resolve(commune) : lire(GEO + '/' + encodeURIComponent(p.code_insee) + '?' + CHAMPS.slice(1));
    connue.then(function (c) {
      if (!c || !c.code) { dire('La commune de cette parcelle n\'a pas pu être lue. Réessayez dans un instant.', 'erreur'); return; }
      commune = c;
      var ok = typeof window.fidiChoisirParcelle === 'function' && window.fidiChoisirParcelle({ commune: c, section: p.section, numero: p.numero, ajouter: !!ajouter });
      if (!ok) { dire('La parcelle n\'a pas pu être reportée dans la recherche.', 'erreur'); return; }
      try { localStorage.setItem(CLE, JSON.stringify({ code: c.code, nom: c.nom, centre: c.centre })); } catch (e) {}
      selection = { ref: ((p.section || '') + ' ' + (p.numero || '')).trim(), commune: c.nom, surface: p.contenance, ajout: !!ajouter };
      fermer();
      var recap = $('carteChoixRetenue');
      if (recap) {
        recap.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Parcelle <b>' + esc(selection.ref) + '</b> — ' + esc(c.nom) +
          (p.contenance ? ' · ' + Number(p.contenance).toLocaleString('fr-FR') + ' m²' : '') + (ajouter ? ' ajoutée à l\'étude.' : ' retenue.') +
          ' <button type="button" class="saisie-link" id="carteChoixRouvrir">Changer sur la carte</button>';
        recap.classList.remove('d-none');
        var b = $('carteChoixRouvrir'); if (b) b.onclick = ouvrir;
      }
      var lancer = $('btnAnalyse'); if (lancer) lancer.focus();
    });
  }

  function allerA(latlng, zoom, avecRepere) {
    if (!carte) return;
    carte.setView(latlng, zoom, { animate: false });
    if (repere) { carte.removeLayer(repere); repere = null; }
    if (avecRepere) repere = window.L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#0d6efd', fillOpacity: 1, interactive: false }).addTo(carte);
  }
  function choisirCommune(c, zoom) {
    commune = c;
    var champ = $('carteChoixVille'); if (champ) champ.value = c.nom;
    var centre = centreDe(c);
    if (centre) allerA(centre, zoom || 15, false);
    dire('<b>' + esc(c.nom) + '</b>' + (c.departement ? ' · ' + esc(c.departement.nom) : '') + ' — zoomez puis cliquez sur une parcelle.');
  }

  // Position de l'appareil → carte centrée dessus, commune déduite.
  function localiser(demandee) {
    if (!('geolocation' in navigator)) { if (demandee) dire('La géolocalisation n\'est pas disponible sur cet appareil. Indiquez la ville.', 'erreur'); return Promise.resolve(false); }
    dire('<span class="spinner-border spinner-border-sm me-1"></span>Recherche de votre position…');
    return new Promise(function (fini) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var ll = [pos.coords.latitude, pos.coords.longitude];
        allerA(ll, 17, true);
        lire(GEO + '?lat=' + ll[0] + '&lon=' + ll[1] + CHAMPS).then(function (j) {
          var c = j && j[0];
          if (c) { commune = c; var champ = $('carteChoixVille'); if (champ) champ.value = c.nom; dire('Vous êtes à <b>' + esc(c.nom) + '</b> — cliquez sur une parcelle, ou indiquez une autre ville.'); }
          else dire('Carte centrée sur votre position. Cliquez sur une parcelle, ou indiquez une ville.');
          fini(true);
        });
      }, function (err) {
        dire(err && err.code === 1 ? 'Position non autorisée : indiquez la ville pour afficher la carte.' : 'Votre position n\'a pas pu être déterminée : indiquez la ville.', demandee ? 'erreur' : '');
        fini(false);
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
    });
  }

  function suggestions(q) {
    lire(GEO + '?nom=' + encodeURIComponent(q) + CHAMPS + '&boost=population&limit=6').then(function (arr) {
      var liste = $('carteChoixListe'); if (!liste) return;
      if (!Array.isArray(arr) || !arr.length) { liste.classList.add('d-none'); return; }
      liste._communes = arr;
      liste.innerHTML = arr.map(function (c, i) {
        return '<div class="autocomplete-item" data-carte-commune="' + i + '"><i class="bi bi-buildings text-muted me-1"></i>' + esc(c.nom) + ' (' + esc((c.codesPostaux || [])[0] || c.code) + ')' +
          ' <span class="text-muted" style="font-size:.78rem;">— ' + esc(c.departement ? c.departement.nom : '') + '</span></div>';
      }).join('');
      liste.classList.remove('d-none');
    });
  }

  function monter() {
    var hote = $('carteChoix'); if (!hote || monte) return;
    monte = true;
    hote.innerHTML = gabarit();
    var L = window.L;
    carte = L.map('carteChoixCarte', { zoomControl: true }).setView([46.6, 2.4], 5);
    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 });
    var photo = L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { attribution: '© IGN Géoplateforme', maxZoom: 20 });
    var cadastre = L.tileLayer(wmts('CADASTRALPARCELS.PARCELLAIRE_EXPRESS'), { maxZoom: 20, opacity: 0.9 });
    osm.addTo(carte); cadastre.addTo(carte);
    L.control.layers({ 'Plan': osm, 'Photo aérienne': photo }, { 'Cadastre': cadastre }, { collapsed: true }).addTo(carte);
    fiche = window.FidiParcelle ? window.FidiParcelle.attacher({ carte: carte, clicFond: true, actions: actionsParcelle, urlRisques: '/api/georisques-adresse' }) : null;
    carte.on('click', function () { if (carte.getZoom() < 14) dire('Zoomez davantage pour distinguer les parcelles.', ''); });

    $('carteChoixFermer').onclick = fermer;
    $('carteChoixPosition').onclick = function () { localiser(true); };
    var champ = $('carteChoixVille'), liste = $('carteChoixListe');
    champ.addEventListener('input', function () {
      clearTimeout(minuteur);
      var q = champ.value.trim();
      if (q.length < 2) { liste.classList.add('d-none'); return; }
      minuteur = setTimeout(function () { suggestions(q); }, 250);
    });
    champ.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();
      var c = liste._communes && liste._communes[0];
      if (c && !liste.classList.contains('d-none')) { liste.classList.add('d-none'); choisirCommune(c); }
    });
    liste.addEventListener('click', function (e) {
      var item = e.target.closest('[data-carte-commune]'); if (!item) return;
      var c = liste._communes[+item.dataset.carteCommune];
      liste.classList.add('d-none');
      if (c) choisirCommune(c);
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.saisie-carte-ville')) liste.classList.add('d-none'); });
  }

  function ouvrir() {
    var hote = $('carteChoix'), bouton = $('btnCarteChoix'); if (!hote || !window.L) return;
    monter();
    hote.classList.remove('d-none');
    if (bouton) { bouton.classList.add('saisie-mode-actif'); bouton.setAttribute('aria-expanded', 'true'); }
    var recap = $('carteChoixRetenue'); if (recap) recap.classList.add('d-none');
    setTimeout(function () { carte.invalidateSize(); }, 60);
    // Point de départ : commune déjà saisie → position de l'appareil → dernière commune utilisée → saisie de la ville.
    var saisie = typeof window.fidiCommuneSaisie === 'function' ? window.fidiCommuneSaisie() : null;
    if (saisie && centreDe(saisie)) { choisirCommune(saisie, 16); return; }
    if (commune && centreDe(commune)) { dire('<b>' + esc(commune.nom) + '</b> — cliquez sur une parcelle.'); return; }
    localiser(false).then(function (trouve) {
      if (trouve) return;
      var derniere = null; try { derniere = JSON.parse(localStorage.getItem(CLE) || 'null'); } catch (e) {}
      if (derniere && centreDe(derniere)) { choisirCommune(derniere, 15); dire('Dernière ville utilisée : <b>' + esc(derniere.nom) + '</b>. Indiquez-en une autre si besoin.'); }
      var champ = $('carteChoixVille'); if (champ) champ.focus();
    });
  }
  function fermer() {
    var hote = $('carteChoix'), bouton = $('btnCarteChoix');
    if (fiche) fiche.fermer();
    if (carte) carte.closePopup();
    if (hote) hote.classList.add('d-none');
    if (bouton) { bouton.classList.remove('saisie-mode-actif'); bouton.setAttribute('aria-expanded', 'false'); }
  }

  function demarrer() {
    var bouton = $('btnCarteChoix'), hote = $('carteChoix'); if (!bouton || !hote) return;
    // Ligne de rappel de la parcelle retenue, sous le panneau.
    var recap = document.createElement('div'); recap.id = 'carteChoixRetenue'; recap.className = 'saisie-carte-retenue d-none'; recap.setAttribute('role', 'status');
    hote.parentNode.insertBefore(recap, hote.nextSibling);
    bouton.addEventListener('click', function () { if (hote.classList.contains('d-none')) ouvrir(); else fermer(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
  window.FidiSaisieCarte = { ouvrir: ouvrir, fermer: fermer, carte: function () { return carte; }, selection: function () { return selection; } };
})();
