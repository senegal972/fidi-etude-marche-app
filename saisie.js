/* ═══════════════════════════════════════════════════════════════════════════
   Écran de saisie « Nouvelle étude de marché »
   - famille de bien → filtre la liste des natures et adapte le libellé de surface
   - récapitulatif recalculé à chaque frappe (adresse ou référence cadastrale)
   - vérifications complémentaires repliées, avertissement si un identifiant manque
   - modèles de critères (nature, périmètre, vérifications) — jamais d'adresse
   - contrôle de saisie dans la page au lieu d'une boîte d'alerte
   - formulaire replié en résumé une fois l'analyse affichée

   Ne modifie ni lancerAnalyse() ni la recherche cadastrale : tous les identifiants
   historiques sont conservés (voir CLAUDE.md, « Écran de saisie »).
   Les champs restent vidés à l'ouverture (fidiResetSearchFields) : aucun brouillon
   n'est restauré automatiquement, pour ne jamais imprimer une ancienne saisie.
   Persistance : localStorage « fidi_em_modeles » (critères seulement).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var K_MODELES = 'fidi_em_modeles';

  // Familles = libellés des <optgroup> de #selectType ; '' = tous types.
  var SURFACES = {
    'Résidentiel': ['Surface habitable', 'Ex : 120', 9999],
    'Terrain': ['Surface du terrain', 'Ex : 800', 999999],
    'Professionnel': ['Surface utile', 'Ex : 250', 99999],
    '': ['Surface', 'Ex : 120', 999999]
  };

  // Sources affichées dans le récapitulatif — à tenir à jour avec les données réellement
  // interrogées par l'analyse (voir aussi la page « Sources officielles » du rapport A4).
  var SOURCES = ['DVF', 'Cadastre IGN', 'Urbanisme GPU', 'INSEE', 'ADEME DPE', 'Géorisques',
                 'Carte des loyers', 'Fiscalité & sécurité'];

  var MODELES_BASE = [
    { nom: 'Maison — quartier', typeLabel: 'Maison', perimetre: 'rayon_500m' },
    { nom: 'Appartement — proximité', typeLabel: 'Appartement', perimetre: 'rayon_500m' },
    { nom: 'Terrain à bâtir — commune', typeLabel: 'Terrain à bâtir', perimetre: 'commune', mode: 'cadastre' },
    { nom: 'Local commercial — secteur', typeLabel: 'Local commercial', perimetre: 'rayon_5km' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var abandonArme = false;

  function load(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // ─── Mode de recherche ──────────────────────────────────────────────────────
  function mode() {
    var r = document.querySelector('input[name="searchMode"]:checked');
    return r ? r.value : 'adresse';
  }
  function setMode(m) {
    var r = $(m === 'cadastre' ? 'modeCadastre' : 'modeAdresse');
    if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  // ─── Famille ⇄ nature du bien ───────────────────────────────────────────────
  function famille() {
    var c = document.querySelector('input[name="famille"]:checked');
    return c ? c.value : 'Résidentiel';
  }
  function familleDe(opt) {
    return opt && opt.parentNode && opt.parentNode.tagName === 'OPTGROUP' ? opt.parentNode.label : '';
  }
  // Masque les natures hors famille ; la liste d'origine reste intacte (valeurs et ordre).
  function appliquerFamille(f, garderSelection) {
    var radio = document.querySelector('input[name="famille"][value="' + f + '"]');
    if (radio) radio.checked = true;
    var premier = null;
    Array.prototype.forEach.call(el.type.options, function (o) {
      var visible = !f || familleDe(o) === f;
      o.hidden = !visible;
      o.disabled = !visible;
      if (visible && !premier) premier = o;
    });
    Array.prototype.forEach.call(el.type.querySelectorAll('optgroup'), function (g) { g.hidden = !!f && g.label !== f; });
    var sel = el.type.options[el.type.selectedIndex];
    if (!garderSelection || !sel || sel.hidden) { if (premier) premier.selected = true; }
    var s = SURFACES[f] || SURFACES[''];
    $('surfaceLabel').textContent = s[0];
    el.surface.placeholder = s[1];
    el.surface.max = s[2];
  }
  // Quand la nature est choisie par un script (réinitialisation, réouverture d'étude),
  // la famille suit.
  function familleDepuisSelect() {
    var f = familleDe(el.type.options[el.type.selectedIndex]);
    if (f !== famille() && !(famille() === '' )) appliquerFamille(f, true);
  }
  function choisirNature(label) {
    var o = Array.prototype.find.call(el.type.options, function (x) { return x.textContent === label; });
    if (!o) return;
    appliquerFamille(familleDe(o), true);
    o.selected = true;
  }
  function natureLabel() {
    var o = el.type.options[el.type.selectedIndex];
    return o ? o.textContent : '';
  }
  function perimetreLabel(valeur) {
    var o = valeur ? el.perimetre.querySelector('option[value="' + valeur + '"]') : el.perimetre.options[el.perimetre.selectedIndex];
    if (!o) return valeur || '';
    return ((o.value || '').indexOf('rayon_') === 0 ? 'Rayon ' : '') + o.textContent;
  }

  // ─── Désignation du bien ────────────────────────────────────────────────────
  function bien() {
    if (mode() !== 'cadastre') return el.adresse.value.trim();
    var c = ($('inputCommune').value || '').trim();
    var sec = ($('inputSection').value || '').trim().toUpperCase();
    var num = ($('inputParcelle').value || '').trim();
    if (!c && !sec && !num) return '';
    var extra = (window.__searchParcelles || []).filter(function (p) { return p && (p.section || p.numero); }).length;
    return 'Parcelle ' + [sec, num].filter(Boolean).join(' ') + (c ? ' — ' + c : '') + (extra ? ' (+' + extra + ' parcelle' + (extra > 1 ? 's' : '') + ')' : '');
  }

  // ─── Récapitulatif en direct ────────────────────────────────────────────────
  function refresh() {
    var surf = parseFloat(el.surface.value);
    $('recapAdresse').textContent = bien() || '—';
    $('recapType').textContent = natureLabel() || '—';
    $('recapSurface').textContent = surf > 0 ? surf.toLocaleString('fr-FR') + ' m²' : 'Non renseignée';
    $('recapPerimetre').textContent = perimetreLabel() || '—';

    var opts = [], extra = [];
    if (el.optE.checked) { opts.push('Société'); extra.push('RNE / INPI'); }
    if (el.optF.checked) { opts.push('Finances'); extra.push('Pappers'); }
    if (el.optP.checked) { opts.push('Permis'); extra.push('SITADEL'); }
    $('recapOptions').textContent = opts.length ? opts.join(' · ') : 'Aucune';
    $('recapSources').textContent = SOURCES.length + extra.length;

    var chips = $('recapChips');
    chips.textContent = '';
    SOURCES.forEach(function (n) { chips.appendChild(chip(n, false)); });
    extra.forEach(function (n) { chips.appendChild(chip(n, true)); });

    $('surfaceHint').classList.toggle('d-none', surf > 0);
    majCout();

    // Avertissements non bloquants : une option cochée sans identifiant est ignorée par l'analyse.
    var warn = [];
    if (el.optE.checked && !el.entQ.value.trim()) warn.push('Indiquez un SIREN, un SIRET ou une raison sociale pour la vérification de société.');
    if (el.optF.checked && !/^\d{9}$/.test(el.finS.value.replace(/\s+/g, ''))) warn.push('Indiquez un SIREN à 9 chiffres pour la santé financière.');
    alerte(warn.join(' '));
    if (bien()) document.querySelectorAll('#saisie .is-missing').forEach(function (x) { x.classList.remove('is-missing'); });
  }
  function chip(text, opt) {
    var c = document.createElement('span');
    c.textContent = text;
    if (opt) c.className = 'opt';
    return c;
  }
  function alerte(msg) {
    var a = $('saisieAlerte');
    a.textContent = msg || '';
    a.classList.toggle('d-none', !msg);
  }
  // Solde de crédits, seulement si la facturation est active et l'utilisateur connecté.
  function majCout() {
    var p = $('recapCout');
    var st = window.Compte && window.Compte.state;
    if (!st || !st.paywall || !st.user) { p.classList.add('d-none'); return; }
    var u = st.user, cout = st.cost || 1;
    p.textContent = u.illimite
      ? 'Compte illimité : l\'édition du rapport ne consomme pas de crédit.'
      : 'Solde : ' + (u.credits || 0) + ' crédit' + ((u.credits || 0) > 1 ? 's' : '') +
        ' · l\'édition du rapport en consomme ' + cout + '.';
    p.classList.remove('d-none');
  }

  // ─── Vérifications complémentaires ──────────────────────────────────────────
  function openCompl(open) {
    $('complBloc').classList.toggle('d-none', !open);
    el.plus.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.plus.classList.toggle('d-none', open);
  }
  function syncOptions() {
    $('entrepriseQueryWrap').classList.toggle('d-none', !el.optE.checked);
    $('financeQueryWrap').classList.toggle('d-none', !el.optF.checked);
    if (el.optE.checked || el.optF.checked || el.optP.checked) openCompl(true);
  }

  // ─── Modèles de critères ────────────────────────────────────────────────────
  function appliquerModele(m) {
    if (m.mode) setMode(m.mode);
    if (m.typeLabel) choisirNature(m.typeLabel);
    if (m.perimetre) el.perimetre.value = m.perimetre;
    el.optE.checked = !!m.optEntreprise;
    el.optF.checked = !!m.optFinance;
    el.optP.checked = !!m.optPermis;
    syncOptions();
    refresh();
  }
  function renderModeles() {
    var box = $('modelesList');
    var perso = load(K_MODELES, []);
    box.textContent = '';
    MODELES_BASE.concat(perso).forEach(function (m, idx) {
      var row = document.createElement('div');
      row.className = 'saisie-modele';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dropdown-item';
      b.textContent = m.nom;
      var sub = document.createElement('small');
      sub.textContent = [m.typeLabel, perimetreLabel(m.perimetre), m.mode === 'cadastre' ? 'réf. cadastrale' : '']
        .filter(Boolean).join(' · ');
      b.appendChild(sub);
      b.addEventListener('click', function () {
        appliquerModele(m);
        var dd = window.bootstrap && bootstrap.Dropdown.getInstance($('btnModele'));
        if (dd) dd.hide();
      });
      row.appendChild(b);
      var persoIdx = idx - MODELES_BASE.length;
      if (persoIdx >= 0) {
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'saisie-modele-del';
        del.title = 'Supprimer ce modèle';
        del.setAttribute('aria-label', 'Supprimer le modèle ' + m.nom);
        del.innerHTML = '<i class="bi bi-x-lg"></i>';
        del.addEventListener('click', function () {
          var l = load(K_MODELES, []);
          l.splice(persoIdx, 1);
          store(K_MODELES, l);
          renderModeles();
        });
        row.appendChild(del);
      }
      box.appendChild(row);
    });
  }
  function saveModele() {
    var input = $('inputModeleNom');
    var nom = input.value.trim();
    if (!nom) { input.focus(); return; }
    var l = load(K_MODELES, []);
    l.push({ nom: nom, mode: mode(), typeLabel: natureLabel(), perimetre: el.perimetre.value,
             optEntreprise: el.optE.checked, optFinance: el.optF.checked, optPermis: el.optP.checked });
    store(K_MODELES, l);
    input.value = '';
    renderModeles();
  }

  // ─── Contrôle avant lancement (message dans la page, pas de boîte d'alerte) ──
  function manque() {
    if (mode() !== 'cadastre') return el.adresse.value.trim() ? null : [el.adresse, 'Saisissez l\'adresse du bien pour lancer l\'analyse.'];
    var champs = [['inputCommune', 'la commune'], ['inputSection', 'la section'], ['inputParcelle', 'le numéro de parcelle']];
    for (var i = 0; i < champs.length; i++) {
      var c = $(champs[i][0]);
      if (!c.value.trim()) return [c, 'Indiquez ' + champs[i][1] + ' pour lancer l\'analyse.'];
    }
    return null;
  }
  function guard(e) {
    var m = manque();
    if (!m) return true;
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
    m[0].classList.add('is-missing');
    alerte(m[1]);
    m[0].focus();
    return false;
  }

  // ─── Formulaire ⇄ résumé compact ────────────────────────────────────────────
  function collapse() {
    var inp = window.__fidiInputs || {};
    var surf = parseFloat(inp.surface || el.surface.value);
    var ref = (typeof window.currentEtudeRef === 'function') ? window.currentEtudeRef() : '';
    $('resumeRef').textContent = ref || '';
    $('resumeRef').classList.toggle('d-none', !ref);
    $('resumeAdresse').textContent = inp.adresse || bien();
    $('resumeDetails').textContent = [natureLabel(), surf > 0 ? surf.toLocaleString('fr-FR') + ' m²' : '',
      perimetreLabel(inp.perimetre)].filter(Boolean).join(' · ');
    $('saisieForm').classList.add('d-none');
    $('saisieResume').classList.remove('d-none');
  }
  function expand() {
    $('saisieResume').classList.add('d-none');
    $('saisieForm').classList.remove('d-none');
    desarmerAbandon();
  }
  function reset() {
    if (typeof window.fidiResetSearchFields === 'function') window.fidiResetSearchFields();
    setMode('adresse');
    appliquerFamille('Résidentiel');
    el.optE.checked = el.optF.checked = el.optP.checked = false;
    syncOptions();
    openCompl(false);
    document.querySelectorAll('#saisie .is-missing').forEach(function (x) { x.classList.remove('is-missing'); });
    refresh();
  }
  // Une étude affichée et non enregistrée n'est abandonnée qu'au second clic.
  function desarmerAbandon() {
    abandonArme = false;
    $('btnNouvelle').innerHTML = '<i class="bi bi-plus-lg me-1"></i>Nouvelle étude';
  }
  function nouvelleEtude() {
    if (window.FidiGuard && window.FidiGuard.isDirty() && !abandonArme) {
      abandonArme = true;
      $('btnNouvelle').innerHTML = '<i class="bi bi-exclamation-triangle me-1"></i>Étude non enregistrée — cliquer pour l\'abandonner';
      return;
    }
    if (window.FidiGuard) window.FidiGuard.setClean();
    reset();
    $('results-panel').classList.add('d-none');
    $('init-panel').classList.remove('d-none');
    var dd = $('ddResultsWrap'); if (dd) dd.classList.add('d-none');
    expand();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    el.adresse.focus();
  }

  // ─── Initialisation ─────────────────────────────────────────────────────────
  function init() {
    el = {
      adresse: $('inputAdresse'), type: $('selectType'), surface: $('inputSurface'),
      perimetre: $('selectPerimetre'), optE: $('optEntreprise'), optF: $('optFinance'),
      optP: $('optPermis'), entQ: $('inputEntrepriseQ'), finS: $('inputFinanceSiren'), plus: $('btnPlus')
    };
    if (!el.adresse || !$('saisie')) return;

    appliquerFamille('Résidentiel');
    renderModeles();
    refresh();

    var form = $('saisieForm');
    form.addEventListener('input', refresh);
    form.addEventListener('change', function (e) {
      if (e.target.name === 'famille') appliquerFamille(e.target.value);
      else if (e.target === el.type) familleDepuisSelect();
      else if (e.target.id === 'optEntreprise' || e.target.id === 'optFinance') syncOptions();
      refresh();
    });
    // Les parcelles supplémentaires et l'autocomplétion modifient les champs par script.
    form.addEventListener('click', function () { setTimeout(refresh, 0); });
    window.addEventListener('pageshow', function () { setTimeout(function () { familleDepuisSelect(); refresh(); }, 0); });
    document.addEventListener('fidi:compte', majCout);

    el.plus.addEventListener('click', function () { openCompl(true); });
    $('btnReset').addEventListener('click', reset);
    $('btnModeleSave').addEventListener('click', saveModele);
    $('inputModeleNom').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveModele(); }
    });
    $('btnModifier').addEventListener('click', function () { expand(); (mode() === 'cadastre' ? $('inputCommune') : el.adresse).focus(); });
    $('btnNouvelle').addEventListener('click', nouvelleEtude);
    $('btnAnalyseTete').addEventListener('click', function () { $('btnAnalyse').click(); });

    // Contrôle en phase de capture : passe avant lancerAnalyse() (bouton et touche Entrée).
    $('btnAnalyse').addEventListener('click', function (e) { guard(e); }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var t = e.target && e.target.id;
      if (t === 'inputAdresse' || t === 'inputCommune') guard(e);
    }, true);

    // Résultats affichés → résumé compact ; retour à l'écran d'accueil (erreur) → formulaire.
    var results = $('results-panel');
    var initPanel = $('init-panel');
    var visible = false;
    new MutationObserver(function () {
      var v = !results.classList.contains('d-none');
      if (v && !visible) collapse();
      visible = v;
    }).observe(results, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(function () {
      if (!initPanel.classList.contains('d-none')) expand();
    }).observe(initPanel, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
