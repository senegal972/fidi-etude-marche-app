// Entreprises installées autour du bien étudié (option « Vérifications légales d'entreprise » cochée sans SIREN ni nom).
// Source : /api/entreprises-adresse (Recherche d'entreprises, INSEE Sirene — établissements actifs géolocalisés, sans clé).
// Affiché dans #entrepriseSection ; « Fiche légale » appelle loadEntrepriseAsync(siren) (index.html).
// Limite à dire à l'écran : Sirene situe un établissement par son adresse déclarée ; une adresse mal géolocalisée ou une
// domiciliation peut manquer ou figurer à tort. C'est un relevé, pas un constat d'occupation.
(function () {
  'use strict';
  var RAYON_M = 100, SUR_PLACE_M = 30;
  var dernier = null;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function distanceM(a, b) {
    var R = 6371000, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  // Établissements classés du plus proche au plus loin ; un même SIRET n'apparaît qu'une fois ; hors rayon écarté.
  function classer(results, point, rayon) {
    var vus = {}, out = [];
    (results || []).forEach(function (e) {
      var cle = e.siret || (e.siren + '|' + e.adresse);
      if (vus[cle]) return; vus[cle] = 1;
      var lat = parseFloat(e.lat), lon = parseFloat(e.lon);
      var d = isFinite(lat) && isFinite(lon) ? distanceM(point, { lat: lat, lon: lon }) : null;
      if (d != null && d > (rayon || RAYON_M)) return;
      out.push(Object.assign({}, e, { distance: d }));
    });
    return out.sort(function (a, b) { return (a.distance == null ? 1e9 : a.distance) - (b.distance == null ? 1e9 : b.distance); });
  }
  function carte(e) {
    var surPlace = e.distance != null && e.distance <= SUR_PLACE_M;
    var nom = e.enseigne && e.enseigne.toUpperCase() !== String(e.nom).toUpperCase() ? esc(e.enseigne) + ' <span class="text-muted fw-normal">(' + esc(e.nom) + ')</span>' : esc(e.nom);
    return '<div class="border rounded p-2 mb-2"><div class="d-flex flex-wrap align-items-start gap-2">' +
      '<div class="flex-grow-1"><div class="fw-semibold">' + nom + '</div>' +
        '<div class="small text-muted">' + esc(e.adresse) + '</div>' +
        '<div class="small">' + (e.siret ? 'SIRET ' + esc(e.siret) : 'SIREN ' + esc(e.siren)) + (e.activite && e.activite !== '—' ? ' · activité ' + esc(e.activite) : '') + ' · ' + (e.est_siege ? 'siège' : 'établissement') + '</div></div>' +
      '<span class="badge ' + (surPlace ? 'bg-success' : 'bg-light text-dark border') + '">' + (e.distance == null ? 'distance inconnue' : surPlace ? 'à cette adresse ou tout près (' + e.distance + ' m)' : 'à ' + e.distance + ' m') + '</span>' +
      (e.siren ? '<button type="button" class="btn btn-sm btn-outline-primary" data-ep-fiche="' + esc(e.siren) + '"><i class="bi bi-building-check me-1"></i>Fiche légale</button>' : '') +
      '</div></div>';
  }
  function rendre(liste) {
    var sur = liste.filter(function (e) { return e.distance != null && e.distance <= SUR_PLACE_M; }).length;
    if (!liste.length) return '<div class="text-muted text-center py-3"><i class="bi bi-search me-1"></i>Aucun établissement actif n\'est déclaré dans un rayon de ' + RAYON_M + ' m autour du point étudié.</div>' + note();
    return '<p class="small mb-2"><strong>' + liste.length + ' établissement' + (liste.length > 1 ? 's' : '') + ' actif' + (liste.length > 1 ? 's' : '') + '</strong> dans un rayon de ' + RAYON_M + ' m, dont <strong>' + sur + '</strong> à l\'adresse étudiée ou tout près (' + SUR_PLACE_M + ' m). « Fiche légale » donne l\'identité, les dirigeants et les bénéficiaires.</p>' +
      liste.map(carte).join('') + note();
  }
  function note() {
    return '<p class="small text-muted mb-0 mt-2"><i class="bi bi-info-circle me-1"></i>Relevé du répertoire Sirene (INSEE) : un établissement y est situé par son adresse déclarée. Une adresse mal localisée, une domiciliation ou une activité non déclarée peuvent manquer ou figurer à tort — à confirmer sur place.</p>';
  }
  function zones() { return { sec: document.getElementById('entrepriseSection'), body: document.getElementById('entrepriseBody'), cnt: document.getElementById('entrepriseCount') }; }
  function afficherListe() { var z = zones(); if (!dernier || !z.body) return; z.cnt.textContent = String(dernier.length); z.body.innerHTML = rendre(dernier); }

  async function charger(loc) {
    var z = zones(); if (!z.sec) return;
    var lat = parseFloat(loc && loc.lat), lon = parseFloat(loc && loc.lon);
    if (!isFinite(lat) || !isFinite(lon)) { z.sec.classList.add('d-none'); return; }
    z.sec.classList.remove('d-none'); z.cnt.textContent = '…';
    z.body.innerHTML = '<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm me-2"></div>Recherche des entreprises installées autour du bien…</div>';
    if (!z.body.dataset.epPret) {
      z.body.dataset.epPret = '1';
      z.body.addEventListener('click', async function (e) {
        var f = e.target.closest('[data-ep-fiche]'), r = e.target.closest('[data-ep-retour]');
        if (r) return afficherListe();
        if (!f || typeof window.loadEntrepriseAsync !== 'function') return;
        await window.loadEntrepriseAsync(f.getAttribute('data-ep-fiche'));
        if (dernier) z.body.insertAdjacentHTML('afterbegin', '<button type="button" class="btn btn-sm btn-outline-secondary mb-2" data-ep-retour="1"><i class="bi bi-arrow-left me-1"></i>Entreprises autour du bien</button>');
      });
    }
    try {
      var r = await fetch('/api/entreprises-adresse?lat=' + lat + '&lon=' + lon + '&radius=' + (RAYON_M / 1000));
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'service indisponible');
      dernier = classer(d.results, { lat: lat, lon: lon }, RAYON_M);
      afficherListe();
    } catch (x) {
      dernier = null; z.cnt.textContent = '—';
      z.body.innerHTML = '<div class="text-muted text-center py-3"><i class="bi bi-exclamation-triangle me-1"></i>Le répertoire des entreprises ne répond pas pour l\'instant. Relancez l\'analyse, ou indiquez un SIREN ou un nom.</div>';
    }
  }
  window.FidiEntreprisesProches = { charger: charger, classer: classer, distanceM: distanceM, rendre: rendre, RAYON_M: RAYON_M, SUR_PLACE_M: SUR_PLACE_M };
})();
