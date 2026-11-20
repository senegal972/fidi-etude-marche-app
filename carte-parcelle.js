/* ════════════════════════════════════════════════════════════════════════
   Fiche d'une parcelle au clic sur une carte Leaflet — module autonome, réutilisable.

   Un clic (ou un toucher) sur la carte ouvre une bulle : référence cadastrale, commune, surface, zonage PLU,
   distance au bien étudié. « Détail de la parcelle » ouvre la fiche complète : cadastre, adresse la plus
   proche, urbanisme (zone, prescriptions, servitudes), ventes enregistrées (DVF), risques, liens officiels.

   Dépendances : Leaflet (L) ; Bootstrap 5 pour la fenêtre de détail. Aucune clé d'API.
   Sources publiques interrogées depuis le navigateur :
     - API Carto IGN — cadastre : https://apicarto.ign.fr/api/cadastre/parcelle
     - API Carto IGN — Géoportail de l'urbanisme : /api/gpu/zone-urba, prescription-surf, info-surf, assiette-sup-s
     - Base adresse nationale : https://api-adresse.data.gouv.fr/reverse/
     - DVF (Etalab) : https://app.dvf.etalab.gouv.fr/api/mutations3/<insee>/<section>
     - Risques : route de l'application (options.urlRisques), facultative

   Utilisation dans une autre interface :
     FidiParcelle.attacher({
       carte: maCarteLeaflet,                 // obligatoire
       clicFond: true,                        // branche le clic sur le fond de carte (défaut : false)
       origine: () => ({ lat, lon }),         // point de référence pour la distance (facultatif)
       parcellePrincipale: () => 'idu',       // identifiant de la parcelle étudiée (facultatif)
       zonePrincipale: () => 'UA',            // zone PLU du bien étudié, pour la comparaison (facultatif)
       ventes: () => [...],                   // ventes déjà chargées par l'hôte : { id_parcelle, date, valeur… } (facultatif)
       urlRisques: '/api/georisques-adresse', // facultatif ; absent = rubrique « Risques » non affichée
       couleurZone: (typezone) => '#rrggbb'   // facultatif
     });
     FidiParcelle.auClic(latlng [, zoneConnue]) — à appeler depuis un calque qui capte le clic (polygones de zonage…).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CARTO = 'https://apicarto.ign.fr/api';
  var opt = { carte: null };
  var contour = null, requete = 0, courante = null;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var nombre = function (n) { return Number(n).toLocaleString('fr-FR'); };
  var appelOption = function (nom) { try { return typeof opt[nom] === 'function' ? opt[nom]() : null; } catch (e) { return null; } };

  // Lecture d'un service public : un second essai après un échec (ces services répondent parfois 500 sans raison).
  function lire(url, essais) {
    var n = essais == null ? 2 : essais;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () {
        if (n <= 1) return null;
        return new Promise(function (ok) { setTimeout(ok, 700); }).then(function () { return lire(url, n - 1); });
      });
  }
  var point = function (lat, lon) { return encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] })); };

  function couleurZone(t) {
    if (typeof opt.couleurZone === 'function') { try { return opt.couleurZone(t); } catch (e) {} }
    if (typeof window.zoneColor === 'function') { try { return window.zoneColor(t); } catch (e) {} }
    t = String(t || '').toUpperCase();
    return t.indexOf('AU') === 0 ? '#e67e22' : t.charAt(0) === 'U' ? '#c0392b' : t.charAt(0) === 'A' ? '#f1c40f' : t.charAt(0) === 'N' ? '#27ae60' : '#7f8c8d';
  }
  function distance(lat, lon) {
    var o = appelOption('origine');
    if (!o || !o.lat || !o.lon) return null;
    var R = 6371000, r = Math.PI / 180;
    var a = Math.pow(Math.sin((lat - o.lat) * r / 2), 2) + Math.cos(o.lat * r) * Math.cos(lat * r) * Math.pow(Math.sin((lon - o.lon) * r / 2), 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }
  var texteDistance = function (d) { return d == null ? '' : (d < 1000 ? d + ' m' : (d / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' km'); };
  var dateCompacte = function (s) { s = String(s || ''); return /^\d{8}$/.test(s) ? s.slice(6, 8) + '/' + s.slice(4, 6) + '/' + s.slice(0, 4) : s; };
  var dateIso = function (s) { s = String(s || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s; };
  function ventesHote(idu) {
    if (!idu) return [];
    return (appelOption('ventes') || []).filter(function (t) { return t && t.id_parcelle === idu; });
  }
  function liens(lat, lon) {
    return {
      urbanisme: 'https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=' + lon + '&lat=' + lat + '&zoom=18&mlon=' + lon + '&mlat=' + lat,
      cadastre: 'https://www.geoportail.gouv.fr/carte?c=' + lon + ',' + lat + '&z=19&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes',
      plan: 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon
    };
  }
  var estPrincipale = function (p) { return !!p && !!p.idu && appelOption('parcellePrincipale') === p.idu; };
  var reference = function (p) { return ((p.section || '') + ' ' + (p.numero || '')).trim(); };

  // ── Bulle ───────────────────────────────────────────────────────────────────
  function bulleHTML(p, z, lat, lon) {
    var d = distance(lat, lon), principale = estPrincipale(p);
    var h = '<div class="fiche-parc">';
    if (p) {
      var v = ventesHote(p.idu);
      h += '<div class="fiche-parc-t">Parcelle ' + esc(reference(p) || '—') + (principale ? ' <span class="badge bg-danger" style="font-size:.6rem;">bien étudié</span>' : '') + '</div>' +
        '<div>' + esc(p.nom_com || '') + (p.code_insee ? ' <span class="text-muted">(' + esc(p.code_insee) + ')</span>' : '') + '</div>' +
        (p.contenance ? '<div><b>' + nombre(p.contenance) + ' m²</b> au cadastre</div>' : '') +
        (v.length ? '<div><i class="bi bi-cash-coin me-1"></i>' + v.length + ' vente' + (v.length > 1 ? 's' : '') + ' enregistrée' + (v.length > 1 ? 's' : '') + '</div>' : '');
    } else {
      h += '<div class="fiche-parc-t">Aucune parcelle à ce point</div><div class="text-muted">Voie, domaine public ou zone non cadastrée.</div>';
    }
    h += z ? '<div class="mt-1"><span class="badge" style="background:' + couleurZone(z.typezone) + ';">' + esc(z.libelle || '?') + '</span> ' + esc(z.libelong || 'Zone ' + (z.typezone || '')) + '</div>'
      : '<div class="mt-1 text-muted">Zonage PLU : non numérisé à ce point</div>';
    if (d != null && !principale) h += '<div class="text-muted">À ' + texteDistance(d) + ' du bien étudié</div>';
    if (p) h += '<button type="button" class="btn btn-sm btn-primary mt-2 w-100" data-fiche-parc="detail" onclick="FidiParcelle.detail()"><i class="bi bi-card-list me-1"></i>Détail de la parcelle</button>';
    return h + '</div>';
  }

  // zoneConnue : zone PLU du polygone cliqué (calque de zonage actif) ; sinon elle est demandée au service.
  function auClic(latlng, zoneConnue) {
    var carte = opt.carte;
    if (!carte || !latlng || !window.L) return Promise.resolve();
    var lat = latlng.lat, lon = latlng.lng, id = ++requete;
    var attente = '<div class="fiche-parc"><span class="spinner-border spinner-border-sm me-2"></span>Lecture du cadastre…</div>';
    // Petit écran : la carte est trop étroite pour une bulle, la fiche s'affiche juste dessous.
    var etroit = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    var bulle;
    if (etroit) {
      try { carte.closePopup(); } catch (e) {}
      var pan = document.getElementById('ficheParcPanneau');
      if (!pan) {
        pan = document.createElement('div'); pan.id = 'ficheParcPanneau';
        var conteneur = carte.getContainer(); conteneur.parentNode.insertBefore(pan, conteneur.nextSibling);
      }
      bulle = { setContent: function (h) {
        pan.innerHTML = '<button type="button" class="btn-close float-end" aria-label="Fermer" onclick="FidiParcelle.fermer()"></button>' + h;
        pan.style.display = 'block';
      } };
      bulle.setContent(attente);
    } else {
      bulle = window.L.popup({ maxWidth: 290, autoPanPadding: [20, 20] }).setLatLng(latlng).setContent(attente).openOn(carte);
    }
    var pt = point(lat, lon);
    return Promise.all([
      lire(CARTO + '/cadastre/parcelle?geom=' + pt),
      zoneConnue ? Promise.resolve(null) : lire(CARTO + '/gpu/zone-urba?geom=' + pt)
    ]).then(function (res) {
      if (id !== requete) return;                       // un autre clic a pris le relais
      var jp = res[0], jz = res[1];
      var f = jp && jp.features && jp.features[0];
      var p = f ? f.properties : null;
      var z = zoneConnue || (jz && jz.features && jz.features[0] && jz.features[0].properties) || null;
      if (contour) { carte.removeLayer(contour); contour = null; }
      if (f && f.geometry) {
        // Contour de la parcelle cliquée — non cliquable : le clic suivant doit atteindre la carte.
        contour = window.L.geoJSON(f, { interactive: false, style: { color: '#0d6efd', weight: 3, fillColor: '#0d6efd', fillOpacity: 0.12 } }).addTo(carte);
      }
      courante = { p: p, z: z, lat: lat, lon: lon, erreur: !jp, complement: null };
      window.__ficheParcelle = courante;
      bulle.setContent(jp ? bulleHTML(p, z, lat, lon)
        : '<div class="fiche-parc"><div class="fiche-parc-t">Cadastre indisponible</div><div class="text-muted">Le service du cadastre ne répond pas. Cliquez de nouveau dans un instant.</div></div>');
    });
  }

  function fermer() {
    var pan = document.getElementById('ficheParcPanneau'); if (pan) { pan.style.display = 'none'; pan.innerHTML = ''; }
    if (contour && opt.carte) { opt.carte.removeLayer(contour); contour = null; }
  }

  // ── Compléments de la fiche détaillée (chargés à l'ouverture, chacun de son côté) ──
  // Servitudes d'utilité publique : libellé courant des catégories les plus fréquentes (code du Géoportail de l'urbanisme).
  var SERVITUDES = {
    ac1: 'Monuments historiques (abords)', ac2: 'Sites inscrits ou classés', ac4: 'Site patrimonial remarquable',
    as1: 'Protection des captages d\'eau potable', el7: 'Alignement des voies', el9: 'Passage des piétons sur le littoral',
    i3: 'Canalisations de gaz', i4: 'Lignes électriques', int1: 'Voisinage des cimetières',
    pm1: 'Plan de prévention des risques naturels', pm3: 'Plan de prévention des risques technologiques',
    pt1: 'Télécommunications (perturbations)', pt2: 'Télécommunications (obstacles)', t5: 'Dégagement aéronautique', t7: 'Servitude aéronautique hors zone de dégagement'
  };
  // Regroupe les lignes DVF d'une parcelle par vente (DVF rend une ligne par lot ; le prix est celui de toute la vente).
  function ventesDeLaParcelle(mutations, idu) {
    var parVente = {};
    (mutations || []).forEach(function (m) {
      if (!m || !m.id_mutation) return;
      var v = parVente[m.id_mutation] || (parVente[m.id_mutation] = { date: m.date_mutation, nature: m.nature_mutation, valeur: parseFloat(m.valeur_fonciere), parcelles: {}, types: {}, bati: {}, terrain: 0, concerne: false });
      if (m.id_parcelle) v.parcelles[m.id_parcelle] = 1;
      if (m.id_parcelle !== idu) return;
      v.concerne = true;
      if (m.type_local && m.type_local !== 'None') v.types[m.type_local] = 1;
      var sb = parseFloat(m.surface_reelle_bati);
      if (sb > 0) v.bati[(m.lot1_numero || '') + '|' + m.type_local + '|' + sb] = sb;
      var st = parseFloat(m.surface_terrain); if (st > v.terrain) v.terrain = st;
    });
    return Object.keys(parVente).map(function (k) { return parVente[k]; }).filter(function (v) { return v.concerne; })
      .map(function (v) {
        var bati = Object.keys(v.bati).reduce(function (a, k) { return a + v.bati[k]; }, 0);
        return { date: v.date, nature: v.nature || 'Vente', valeur: isFinite(v.valeur) ? v.valeur : null, types: Object.keys(v.types), bati: bati, terrain: v.terrain,
                 autresParcelles: Object.keys(v.parcelles).length - 1 };
      }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  }

  function complements(F) {
    var p = F.p, pt = point(F.lat, F.lon), poser = function (id, html) { var e = document.getElementById(id); if (e && courante === F) e.innerHTML = html; };
    var indispo = '<span class="text-muted">Service indisponible pour le moment.</span>';

    // Adresse la plus proche
    lire('https://api-adresse.data.gouv.fr/reverse/?lat=' + F.lat + '&lon=' + F.lon + '&limit=1').then(function (j) {
      var a = j && j.features && j.features[0] && j.features[0].properties;
      poser('ficheParcAdresse', a ? esc(a.label || a.name || '') + (a.distance != null ? ' <span class="text-muted">(à ' + Math.round(a.distance) + ' m du point cliqué)</span>' : '') : (j ? '<span class="text-muted">Aucune adresse connue à proximité.</span>' : indispo));
    });

    // Urbanisme : prescriptions, informations, servitudes
    Promise.all([lire(CARTO + '/gpu/prescription-surf?geom=' + pt), lire(CARTO + '/gpu/info-surf?geom=' + pt), lire(CARTO + '/gpu/assiette-sup-s?geom=' + pt)]).then(function (r) {
      var liste = function (j, f) { return ((j && j.features) || []).map(function (x) { return f(x.properties || {}); }).filter(Boolean); };
      var unique = function (t) { return t.filter(function (x, i) { return t.indexOf(x) === i; }); };
      var presc = unique(liste(r[0], function (q) { return q.libelle || q.txt || ''; }));
      var infos = unique(liste(r[1], function (q) { return q.libelle || q.txt || ''; }));
      var sup = unique(liste(r[2], function (q) { var c = String(q.suptype || '').toLowerCase(); return c ? c.toUpperCase() + (SERVITUDES[c] ? ' — ' + SERVITUDES[c] : '') : ''; }));
      var bloc = function (titre, t) { return t.length ? '<div class="mb-2"><b>' + titre + '</b><ul class="mb-0 ps-3">' + t.slice(0, 12).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : ''; };
      if (!r[0] && !r[1] && !r[2]) return poser('ficheParcUrbaPlus', indispo);
      var h = bloc('Prescriptions', presc) + bloc('Informations', infos) + bloc('Servitudes d\'utilité publique', sup);
      poser('ficheParcUrbaPlus', h || '<span class="text-muted">Aucune prescription ni servitude numérisée à ce point.</span>');
    });

    // Ventes de la parcelle (DVF, toutes années publiées)
    if (p && /^\w{14}$/.test(p.idu || '')) {
      lire('https://app.dvf.etalab.gouv.fr/api/mutations3/' + p.idu.slice(0, 5) + '/' + p.idu.slice(5, 10)).then(function (j) {
        if (!j) return poser('ficheParcVentes', indispo);
        var v = ventesDeLaParcelle(j.mutations || [], p.idu);
        F.complement = { ventes: v };
        if (!v.length) return poser('ficheParcVentes', '<span class="text-muted">Aucune vente publiée pour cette parcelle (DVF couvre les cinq dernières années environ).</span>');
        poser('ficheParcVentes', '<div class="table-responsive"><table class="table table-sm mb-1"><thead><tr><th>Date</th><th>Bien</th><th>Surface</th><th class="text-end">Prix</th></tr></thead><tbody>' +
          v.map(function (t) {
            var s = t.bati ? nombre(Math.round(t.bati)) + ' m² bâti' : (t.terrain ? nombre(Math.round(t.terrain)) + ' m² terrain' : '—');
            return '<tr><td>' + esc(dateIso(t.date)) + '</td><td>' + esc(t.types.join(', ') || (t.nature === 'Vente' ? 'Terrain ou bien non précisé' : t.nature)) +
              (t.autresParcelles > 0 ? '<div class="text-muted" style="font-size:.72rem;">vente groupée avec ' + t.autresParcelles + ' autre' + (t.autresParcelles > 1 ? 's' : '') + ' parcelle' + (t.autresParcelles > 1 ? 's' : '') + '</div>' : '') +
              '</td><td>' + esc(s) + '</td><td class="text-end">' + (t.valeur != null ? nombre(Math.round(t.valeur)) + ' €' : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div><div class="text-muted" style="font-size:.72rem;">Source : DVF (Etalab). Le prix est celui de la vente entière, qui peut porter sur plusieurs lots ou parcelles.</div>');
      });
    } else poser('ficheParcVentes', '<span class="text-muted">Référence de parcelle incomplète : ventes non recherchées.</span>');

    // Risques (route de l'application hôte, facultative)
    if (opt.urlRisques && p) {
      lire(opt.urlRisques + '?lat=' + F.lat + '&lon=' + F.lon + '&insee=' + encodeURIComponent(p.code_insee || ''), 1).then(function (j) {
        var d = j && j.details;
        if (!d) return poser('ficheParcRisques', indispo);
        var lignes = [];
        var n = function (k) { return d[k] && d[k].count ? d[k].count : 0; };
        if (n('ppr')) lignes.push(n('ppr') + ' plan' + (n('ppr') > 1 ? 's' : '') + ' de prévention des risques');
        if (n('mvt')) lignes.push(n('mvt') + ' mouvement' + (n('mvt') > 1 ? 's' : '') + ' de terrain recensé' + (n('mvt') > 1 ? 's' : '') + ' à proximité');
        if (n('cavites')) lignes.push(n('cavites') + ' cavité' + (n('cavites') > 1 ? 's' : '') + ' souterraine' + (n('cavites') > 1 ? 's' : '') + ' à proximité');
        if (n('argiles')) lignes.push('Retrait-gonflement des argiles : exposition signalée');
        var radon = d.radon && d.radon.items && d.radon.items[0] && d.radon.items[0].classe_potentiel;
        if (radon) lignes.push('Radon : potentiel de catégorie ' + esc(radon) + ' (commune)');
        if (n('catnat')) lignes.push(n('catnat') + ' arrêté' + (n('catnat') > 1 ? 's' : '') + ' de catastrophe naturelle sur la commune');
        poser('ficheParcRisques', lignes.length ? '<ul class="mb-1 ps-3">' + lignes.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul><div class="text-muted" style="font-size:.72rem;">Source : Géorisques. Recensement autour du point, à confirmer par un état des risques.</div>'
          : '<span class="text-muted">Aucun risque recensé autour de ce point.</span>');
      });
    }
  }

  // ── Fiche détaillée ─────────────────────────────────────────────────────────
  function detail() {
    var F = courante; if (!F || !F.p) return;
    var p = F.p, z = F.z, d = distance(F.lat, F.lon), l = liens(F.lat, F.lon), ref = reference(p);
    var ligne = function (k, v) { return v ? '<tr><th style="width:42%;font-weight:600;">' + k + '</th><td>' + v + '</td></tr>' : ''; };
    var zonePrincipale = appelOption('zonePrincipale');
    var attente = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Lecture…</span>';
    var hote = ventesHote(p.idu);
    var racine = document.getElementById('ficheParcRoot');
    if (!racine) { racine = document.createElement('div'); racine.id = 'ficheParcRoot'; document.body.appendChild(racine); }
    racine.innerHTML =
      '<div class="modal fade" id="ficheParcModal" tabindex="-1"><div class="modal-dialog modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header" style="background:#12294d;color:#fff;"><h5 class="modal-title"><i class="bi bi-geo me-2"></i>Parcelle ' + esc(ref) + ' — ' + esc(p.nom_com || '') + '</h5>' +
      '<button type="button" class="btn-close" style="filter:invert(1)" data-bs-dismiss="modal" aria-label="Fermer"></button></div>' +
      '<div class="modal-body">' +
        (estPrincipale(p) ? '<div class="alert alert-info py-2 small">Cette parcelle est celle du bien étudié.</div>' : '') +
        '<h6 class="fw-bold">Cadastre</h6>' +
        '<table class="table table-sm mb-3"><tbody>' +
          ligne('Référence', '<b>' + esc(ref) + '</b> <button type="button" class="btn btn-sm btn-link p-0 ms-1" onclick="FidiParcelle.copier(this)" title="Copier la référence"><i class="bi bi-clipboard"></i> copier</button>') +
          ligne('Section / numéro', esc(p.section || '') + ' / ' + esc(p.numero || '')) +
          ligne('Feuille', p.feuille != null ? esc(p.feuille) : '') +
          ligne('Commune', esc(p.nom_com || '') + (p.code_insee ? ' (' + esc(p.code_insee) + ')' : '')) +
          ligne('Surface cadastrale', p.contenance ? '<b>' + nombre(p.contenance) + ' m²</b>' : '') +
          ligne('Identifiant', p.idu ? '<code>' + esc(p.idu) + '</code>' : '') +
          ligne('Adresse la plus proche', '<span id="ficheParcAdresse">' + attente + '</span>') +
          ligne('Coordonnées', F.lat.toFixed(6) + ', ' + F.lon.toFixed(6)) +
          ligne('Distance au bien étudié', d != null && !estPrincipale(p) ? texteDistance(d) : '') +
        '</tbody></table>' +
        '<h6 class="fw-bold">Urbanisme</h6>' +
        (z ? '<table class="table table-sm mb-2"><tbody>' +
              ligne('Zone', '<span class="badge" style="background:' + couleurZone(z.typezone) + ';">' + esc(z.libelle || '?') + '</span> ' + esc(z.libelong || '')) +
              ligne('Type de zone', esc({ U: 'U — urbaine', AUc: 'AU — à urbaniser', AUs: 'AU — à urbaniser', AU: 'AU — à urbaniser', A: 'A — agricole', N: 'N — naturelle' }[z.typezone] || z.typezone || '')) +
              ligne('Document', esc(z.idurba || '') + (z.datvalid ? ' · validé le ' + esc(dateCompacte(z.datvalid)) : '')) +
              ligne('Comparaison', zonePrincipale && !estPrincipale(p) ? (zonePrincipale === z.libelle ? 'Même zone que le bien étudié' : 'Zone différente du bien étudié (' + esc(zonePrincipale) + ')') : '') +
            '</tbody></table>'
          : '<p class="text-muted small">Aucun document d\'urbanisme numérisé à ce point.</p>') +
        '<div class="small mb-3" id="ficheParcUrbaPlus">' + attente + '</div>' +
        '<h6 class="fw-bold">Ventes enregistrées sur cette parcelle</h6>' +
        '<div class="small mb-3" id="ficheParcVentes">' + (hote.length ? '<span class="text-muted">' + hote.length + ' vente' + (hote.length > 1 ? 's' : '') + ' dans l\'étude en cours. Lecture de l\'historique complet…</span>' : attente) + '</div>' +
        (opt.urlRisques ? '<h6 class="fw-bold">Risques</h6><div class="small mb-3" id="ficheParcRisques">' + attente + '</div>' : '') +
        '<h6 class="fw-bold">Consulter</h6>' +
        '<div class="d-flex flex-wrap gap-2">' +
          '<a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="' + esc(l.urbanisme) + '"><i class="bi bi-map me-1"></i>Règlement d\'urbanisme (Géoportail de l\'urbanisme)</a>' +
          '<a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="' + esc(l.cadastre) + '"><i class="bi bi-grid-3x3 me-1"></i>Plan cadastral (Géoportail)</a>' +
          '<a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="' + esc(l.plan) + '"><i class="bi bi-geo-alt me-1"></i>Voir sur Google Maps</a>' +
        '</div>' +
        '<p class="text-muted mt-3 mb-0" style="font-size:.72rem;">Sources : cadastre (IGN, Parcellaire Express), Géoportail de l\'urbanisme, Base adresse nationale, DVF (Etalab)' + (opt.urlRisques ? ', Géorisques' : '') + '. Le propriétaire d\'une parcelle n\'est pas une donnée publique : elle se demande au service de la publicité foncière.</p>' +
      '</div></div></div></div>';
    var el = document.getElementById('ficheParcModal');
    el.addEventListener('hidden.bs.modal', function () { el.remove(); });
    if (typeof window.fidiStackModal === 'function') window.fidiStackModal(el);
    if (window.bootstrap && window.bootstrap.Modal) new window.bootstrap.Modal(el).show();
    complements(F);
  }

  function copier(bouton) {
    var F = courante; if (!F || !F.p) return;
    var txt = reference(F.p) + ' — ' + (F.p.nom_com || '') + (F.p.contenance ? ' — ' + F.p.contenance + ' m²' : '');
    try { navigator.clipboard.writeText(txt).then(function () { if (bouton) bouton.innerHTML = '<i class="bi bi-check2"></i> copié'; }); } catch (e) {}
  }

  // Styles de la bulle et du panneau : posés une fois, pour que le module fonctionne tel quel sur une autre page.
  function styles() {
    if (document.getElementById('ficheParcStyles')) return;
    var st = document.createElement('style'); st.id = 'ficheParcStyles';
    st.textContent = '.fiche-parc{font-size:.85rem;line-height:1.45;}.fiche-parc-t{font-weight:700;font-size:.95rem;color:#12294d;}' +
      '#ficheParcPanneau{display:none;background:#f6f9ff;border:1px solid #c9d9f5;border-left:4px solid #0d6efd;border-radius:8px;padding:.6rem .7rem;margin:.5rem .5rem 0;}' +
      '#ficheParcPanneau .fiche-parc{font-size:.9rem;}#ficheParcPanneau .btn{min-height:42px;}' +
      '@media print{#ficheParcPanneau{display:none!important;}}';
    document.head.appendChild(st);
  }

  function attacher(options) {
    opt = options || {};
    if (!opt.carte) return;
    styles();
    if (opt.clicFond) {
      // Clic sur le fond : les repères, contours et commandes déjà cliquables gardent leur propre comportement.
      opt.carte.on('click', function (e) {
        var cible = e.originalEvent && e.originalEvent.target;
        if (cible && cible.closest && cible.closest('.leaflet-interactive, .leaflet-control, .leaflet-popup')) return;
        auClic(e.latlng);
      });
    }
  }

  window.FidiParcelle = { attacher: attacher, auClic: auClic, fermer: fermer, detail: detail, copier: copier,
    ventesDeLaParcelle: ventesDeLaParcelle, bulleHTML: bulleHTML, courante: function () { return courante; }, contourAffiche: function () { return !!contour; } };
  // Noms historiques, encore appelés par l'écran de l'étude.
  window.ficheParcelleAuClic = auClic;
  window.ficheParcFermer = fermer;
  window.ficheParcDetail = detail;
  window.ficheParcCopier = copier;
})();
