/* ═══════════════════════════════════════════════════════════════════════════
   Sociétés émettrices des factures — plusieurs par compte, choisies à chaque facture
   - recherche par SIRET / SIREN, nom de société ou nom du dirigeant :
     POST /api/entreprise (API Recherche d'entreprises de l'État : INSEE Sirene + RNE / INPI,
     les mêmes registres que ceux repris par Infogreffe, Societe.com ou Pappers)
   - complément facultatif par Pappers (capital, greffe, n° de TVA) si la clé est configurée
   - fiche pré-remplie et modifiable : forme juridique, capital, adresse du siège, SIREN / SIRET,
     immatriculation, TVA intracommunautaire (calculée depuis le SIREN), régime de TVA,
     préfixe de numérotation (une suite de factures distincte par société, obligation légale)
   - enregistrement dans la charte du compte (Marque.maj → /api/marque), comme le reste de la marque

   Expose window.FidiEmetteurs : liste, get, defaut, pourDocument, manquantes, monter.
   Utilisé par facture.js. Règles de validation : assainirEmetteur() dans marque.js / marque.mjs.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Catégories juridiques INSEE les plus courantes → libellé de forme juridique.
  var FORMES = {
    '1000': 'Entrepreneur individuel', '5202': 'SNC', '5306': 'SCS', '5385': 'SCA',
    '5410': 'SARL', '5422': 'SARL', '5426': 'SARL', '5485': 'SELARL', '5498': 'EURL', '5499': 'SARL',
    '5505': 'SA', '5510': 'SA', '5515': 'SA', '5520': 'SA', '5599': 'SA', '5699': 'SA',
    '5710': 'SAS', '5720': 'SASU', '5785': 'SELAS', '6540': 'SCI', '6541': 'SCI de construction-vente',
    '6542': 'SCI d\'attribution', '6599': 'Société civile', '9220': 'Association déclarée'
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function charte() { return (window.Marque && window.Marque.get()) || { emetteurs: [], coordonnees: {}, facturation: {} }; }
  function liste() { return charte().emetteurs || []; }
  function get(id) { return liste().filter(function (e) { return e.id === id; })[0] || null; }
  function defaut() { var l = liste(); return get(charte().emetteurDefaut) || l[0] || null; }
  function enregistrer(modif) { if (window.Marque && window.Marque.maj) window.Marque.maj(modif); }
  function nouvelId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function chiffres(s) { return String(s || '').replace(/\D/g, ''); }
  function grouper(siren) { var c = chiffres(siren); return c.length === 9 ? c.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : String(siren || ''); }

  // N° de TVA intracommunautaire français : FR + clé (12 + 3 × (SIREN mod 97)) mod 97 + SIREN.
  function tvaIntra(siren) {
    var c = chiffres(siren);
    if (c.length !== 9) return '';
    var cle = (12 + 3 * (Number(c) % 97)) % 97;
    return 'FR' + String(cle).padStart(2, '0') + c;
  }
  // Préfixe proposé : initiales de la raison sociale + « -FAC », unique dans le compte.
  function prefixePropose(nom, exclureId) {
    var mots = String(nom || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (m) { return m && ['SAS', 'SASU', 'SARL', 'EURL', 'SCI', 'SA', 'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET'].indexOf(m) < 0; });
    var base = (mots.length > 1 ? mots.map(function (m) { return m[0]; }).join('') : (mots[0] || 'SOC').slice(0, 4)).slice(0, 5) + '-FAC';
    var pris = liste().filter(function (e) { return e.id !== exclureId; }).map(function (e) { return e.prefixe; });
    var p = base, n = 2;
    while (pris.indexOf(p) >= 0 || p === 'FIDI-FAC') { p = base + n; n++; }
    return p;
  }

  // Fiche d'une société → forme attendue par le document de facture (_facture_doc.mjs).
  // Mêmes règles que emetteurDe() dans netlify/functions/facture.mjs.
  function pourDocument(e) {
    var m = charte(), co = m.coordonnees || {}, fa = m.facturation || {};
    if (!e) return { enseigne: m.enseigne, logo: m.logo, couleurs: m.couleurs, coordonnees: co, facturation: fa };
    return {
      id: e.id, enseigne: e.raisonSociale, logo: e.avecLogo ? (m.logo || '') : '', couleurs: m.couleurs || {},
      coordonnees: { raisonSociale: e.raisonSociale, adresse: e.adresse, telephone: e.telephone, email: e.email,
                     mentions: e.avecLogo ? (co.mentions || '') : '' },
      facturation: { formeJuridique: e.formeJuridique, capital: e.capital, siren: e.siret || e.siren, registre: e.registre,
                     tvaIntra: e.tvaIntra, regimeTva: e.regimeTva, tauxTva: e.tauxTva, conditions: fa.conditions || '' }
    };
  }
  function manquantes(e) {
    if (!e) return ['société émettrice'];
    var out = [];
    if (!e.raisonSociale) out.push('raison sociale');
    if (!e.adresse) out.push('adresse');
    if (!e.siren && !e.siret) out.push('SIREN / SIRET');
    if (!e.regimeTva) out.push('régime de TVA');
    return out;
  }

  // Première utilisation : les mentions uniques de la charte (version 1.8.0) deviennent la première société.
  function migrer() {
    if (liste().length) return;
    var m = charte(), co = m.coordonnees || {}, fa = m.facturation || {};
    if (!(fa.siren || fa.regimeTva)) return;
    var e = { id: nouvelId(), raisonSociale: co.raisonSociale || m.enseigne || '', adresse: co.adresse || '', telephone: co.telephone || '',
              email: co.email || '', formeJuridique: fa.formeJuridique || '', capital: fa.capital || '', siren: fa.siren || '', siret: '',
              registre: fa.registre || '', tvaIntra: fa.tvaIntra || '', regimeTva: fa.regimeTva || '', tauxTva: fa.tauxTva != null ? fa.tauxTva : 8.5,
              prefixe: '', avecLogo: true };
    e.prefixe = prefixePropose(e.raisonSociale);
    enregistrer({ emetteurs: [e], emetteurDefaut: e.id });
  }

  // Résultat de recherche → fiche pré-remplie (le régime de TVA reste à choisir : il n'est pas public).
  function depuisResultat(r) {
    var code = String(r.forme_juridique || '');
    var ei = code === '1000';
    var siren = grouper(r.siren);
    return {
      id: nouvelId(), raisonSociale: r.nom || '', adresse: r.siege_adresse && r.siege_adresse !== '—' ? r.siege_adresse : '',
      telephone: '', email: '', formeJuridique: FORMES[code] || '', capital: '', siren: siren,
      siret: r.siret_siege ? String(r.siret_siege).replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4') : '',
      // Le n° de TVA n'est pas prérempli : il n'existe que si la société est assujettie (calculé à l'enregistrement).
      registre: ei ? '' : 'RCS ' + siren, tvaIntra: '',
      regimeTva: '', tauxTva: 8.5, prefixe: prefixePropose(r.nom), avecLogo: liste().length === 0,
      _fermee: r.etat_administratif === 'F', _dirigeants: (r.dirigeants || []).slice(0, 3).map(function (d) { return d.nom + (d.qualite && d.qualite !== '—' ? ' (' + d.qualite + ')' : ''); })
    };
  }

  // ─── Interface (montée dans la colonne d'options de la fenêtre de facture) ─────
  // opts : { selection: id, onChange(id) }
  function monter(box, opts) {
    opts = opts || {};
    migrer();
    var sel = (get(opts.selection) || defaut() || {}).id || '';
    var brouillon = null, rechercheTimer = null, derniereRecherche = 0;

    function choisir(id) { sel = id; rendre(); if (opts.onChange) opts.onChange(id); }

    function rendre() {
      var l = liste(), e = get(sel);
      var html = '';
      if (l.length) {
        html += '<label class="fx-label" for="emSelect">Société émettrice</label>' +
          '<select class="form-select form-select-sm" id="emSelect">' + l.map(function (x) {
            return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.raisonSociale || '(sans nom)') + '</option>';
          }).join('') + '</select>';
        if (e) {
          var regime = e.regimeTva === 'assujetti' ? 'TVA ' + String(e.tauxTva).replace('.', ',') + ' %' : e.regimeTva === 'franchise' ? 'Franchise en base (293 B)' : '';
          var miss = manquantes(e);
          html += '<div class="em-resume">' +
            [e.formeJuridique, (e.siret || e.siren) && 'SIREN ' + esc(e.siren || e.siret), regime, e.prefixe && 'N° ' + esc(e.prefixe) + '-AAAA-NNN']
              .filter(Boolean).map(function (x) { return '<div>' + x + '</div>'; }).join('') +
            (miss.length ? '<div class="fx-em-alerte"><i class="bi bi-exclamation-triangle me-1"></i>À compléter : ' + esc(miss.join(', ')) + '</div>' : '') +
            '</div>';
        }
        html += '<div class="em-actions">' +
          (e ? '<button type="button" class="fx-link" data-em="modifier"><i class="bi bi-pencil"></i> Modifier</button>' : '') +
          '<button type="button" class="fx-link" data-em="ajouter"><i class="bi bi-plus-lg"></i> Ajouter une société</button></div>';
      } else {
        html += '<div class="fx-em-alerte mb-2"><i class="bi bi-building-add me-1"></i>Aucune société émettrice : ajoutez la vôtre pour facturer.</div>' +
          '<button type="button" class="fx-link" data-em="ajouter"><i class="bi bi-plus-lg"></i> Ajouter une société</button>';
      }
      html += '<div id="emEditeur"></div>';
      box.innerHTML = html;
      if (brouillon) rendreEditeur();
    }

    // Recherche : SIRET / SIREN, nom de société ou dirigeant.
    function rendreRecherche() {
      var ed = $('emEditeur');
      ed.innerHTML = '<div class="em-edit">' +
        '<label class="fx-label" for="emQ">Rechercher la société</label>' +
        '<input class="form-control form-control-sm" id="emQ" autocomplete="off" placeholder="SIRET, SIREN, nom de la société ou du dirigeant">' +
        '<div class="fx-tile-s mt-1">Registres officiels de l\'État (INSEE Sirene, RNE / INPI).</div>' +
        '<div id="emResultats" class="em-resultats" aria-live="polite"></div>' +
        '<div class="d-flex justify-content-between mt-2">' +
          '<button type="button" class="fx-link" data-em="manuel">Saisir sans recherche</button>' +
          '<button type="button" class="fx-link text-muted" data-em="annuler">Annuler</button></div>' +
        '</div>';
      $('emQ').focus();
    }
    function lancerRecherche(q) {
      var res = $('emResultats'); if (!res) return;
      q = q.trim();
      if (q.length < 3) { res.innerHTML = ''; return; }
      var n = ++derniereRecherche;
      res.innerHTML = '<div class="fx-tile-s py-2"><span class="spinner-border spinner-border-sm me-1"></span>Recherche…</div>';
      fetch('/api/entreprise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: q }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (n !== derniereRecherche || !$('emResultats')) return;
          var items = (x.j && x.j.results) || [];
          if (!x.ok) { res.innerHTML = '<div class="fx-em-alerte">Recherche indisponible : ' + esc((x.j && x.j.error) || 'réessayez') + '. Vous pouvez saisir la société sans recherche.</div>'; return; }
          if (!items.length) { res.innerHTML = '<div class="fx-tile-s py-2">Aucune société trouvée.</div>'; return; }
          window.__emResultats = items;
          res.innerHTML = items.slice(0, 8).map(function (r, i) {
            var dir = (r.dirigeants || []).slice(0, 2).map(function (d) { return d.nom; }).join(', ');
            return '<button type="button" class="em-res" data-em="choisir" data-i="' + i + '">' +
              '<strong>' + esc(r.nom) + '</strong>' + (r.etat_administratif === 'F' ? ' <span class="em-fermee">fermée</span>' : '') +
              '<span>' + esc([FORMES[r.forme_juridique] || '', 'SIREN ' + grouper(r.siren), [r.siege_code_postal, r.siege_commune].filter(Boolean).join(' ')].filter(Boolean).join(' · ')) + '</span>' +
              (dir ? '<span>Dirigeant : ' + esc(dir) + '</span>' : '') + '</button>';
          }).join('');
        })
        .catch(function () { if ($('emResultats')) res.innerHTML = '<div class="fx-em-alerte">Recherche indisponible (réseau). Vous pouvez saisir la société sans recherche.</div>'; });
    }
    // Complément Pappers (capital, greffe, TVA) si la clé est configurée ; silencieux sinon.
    function completerPappers(siren) {
      var c = chiffres(siren); if (c.length !== 9) return;
      fetch('/api/pappers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siren: c }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var p = j && j.entreprise; if (!p || !brouillon || chiffres(brouillon.siren) !== c) return;
          if (p.capital && !brouillon.capital) brouillon.capital = Number(p.capital).toLocaleString('fr-FR') + ' €';
          if (p.greffe && /^RCS \d/.test(brouillon.registre)) brouillon.registre = 'RCS ' + p.greffe + ' ' + grouper(c);
          if (p.numero_tva_intracommunautaire) brouillon.tvaIntra = p.numero_tva_intracommunautaire;
          rendreEditeur();
        }).catch(function () { /* Pappers non configuré : on garde les données publiques */ });
    }

    function champ(k, label, ph, max) {
      return '<label class="fx-label mt-2" for="em_' + k + '">' + label + '</label>' +
        '<input class="form-control form-control-sm" id="em_' + k + '" data-k="' + k + '" value="' + esc(brouillon[k] || '') + '"' +
        (max ? ' maxlength="' + max + '"' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>';
    }
    function rendreEditeur() {
      var ed = $('emEditeur'); if (!ed || !brouillon) return;
      var b = brouillon, existe = !!get(b.id);
      ed.innerHTML = '<div class="em-edit">' +
        (b._fermee ? '<div class="fx-em-alerte mb-2">Cette société est indiquée comme fermée au répertoire Sirene.</div>' : '') +
        (b._dirigeants && b._dirigeants.length ? '<div class="fx-tile-s mb-1">Dirigeant(s) : ' + esc(b._dirigeants.join(', ')) + '</div>' : '') +
        champ('raisonSociale', 'Raison sociale', '', 80) +
        '<div class="row g-2"><div class="col-6">' + champ('formeJuridique', 'Forme juridique', 'SASU, SARL…', 60) + '</div>' +
          '<div class="col-6">' + champ('capital', 'Capital social', 'ex : 1 000 €', 40) + '</div></div>' +
        champ('adresse', 'Adresse du siège', '', 160) +
        '<div class="row g-2"><div class="col-6">' + champ('siren', 'SIREN', '9 chiffres', 20) + '</div>' +
          '<div class="col-6">' + champ('siret', 'SIRET', '14 chiffres', 20) + '</div></div>' +
        champ('registre', 'Immatriculation', 'RCS Fort-de-France 000 000 000 · RSAC…', 80) +
        (/^RCS \d/.test(b.registre || '') ? '<div class="fx-tile-s">Ajoutez la ville du greffe après « RCS ».</div>' : '') +
        champ('tvaIntra', 'N° TVA intracommunautaire', tvaIntra(b.siren) ? tvaIntra(b.siren) + ' (calculé si assujetti)' : 'FR…', 20) +
        '<div class="fx-label mt-2">Régime de TVA</div>' +
        '<label class="fx-radio"><input type="radio" name="emRegime" value="franchise"' + (b.regimeTva === 'franchise' ? ' checked' : '') + '> Franchise en base (art. 293 B du CGI)</label>' +
        '<label class="fx-radio"><input type="radio" name="emRegime" value="assujetti"' + (b.regimeTva === 'assujetti' ? ' checked' : '') + '> Assujetti, taux ' +
          '<input type="number" id="em_tauxTva" data-k="tauxTva" class="form-control form-control-sm d-inline-block" style="width:4.8rem" min="0" max="30" step="0.1" value="' + esc(b.tauxTva) + '" aria-label="Taux de TVA en %"> %</label>' +
        '<div class="row g-2"><div class="col-6">' + champ('email', 'E-mail', '', 80) + '</div>' +
          '<div class="col-6">' + champ('telephone', 'Téléphone', '', 30) + '</div></div>' +
        champ('prefixe', 'Préfixe de numérotation', 'ex : OD-FAC', 16) +
        '<div class="fx-tile-s">Factures numérotées ' + esc((b.prefixe || 'PREFIXE').toUpperCase()) + '-' + new Date().getFullYear() + '-001, 002… — une suite propre à cette société.</div>' +
        '<label class="fx-radio mt-2"><input type="checkbox" id="em_avecLogo"' + (b.avecLogo ? ' checked' : '') + '> Logo et mentions de la charte sur ses factures</label>' +
        '<label class="fx-radio"><input type="checkbox" id="em_defaut"' + ((charte().emetteurDefaut === b.id || (!liste().length)) ? ' checked' : '') + '> Société par défaut</label>' +
        '<div class="fx-em-alerte d-none mt-2" id="emErreur" role="alert"></div>' +
        '<div class="d-flex gap-2 flex-wrap mt-2">' +
          '<button type="button" class="btn btn-sm btn-primary" data-em="enregistrer">Enregistrer la société</button>' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" data-em="annuler">Annuler</button>' +
          (existe && liste().length > 1 ? '<button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-em="supprimer">Retirer</button>' : '') +
        '</div></div>';
    }

    function valider() {
      var b = brouillon, err = [];
      if (!b.raisonSociale.trim()) err.push('la raison sociale');
      var p = String(b.prefixe || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (p.length < 2) err.push('un préfixe de numérotation (2 caractères au moins)');
      else if (p === 'FIDI-FAC' && liste().some(function (e) { return e.id !== b.id && e.prefixe === 'FIDI-FAC'; })) err.push('un préfixe différent');
      else if (liste().some(function (e) { return e.id !== b.id && e.prefixe === p; })) err.push('un préfixe qui n\'est pas déjà utilisé par une autre société');
      if (!b.regimeTva) err.push('le régime de TVA');
      return err;
    }

    box.addEventListener('change', function (e) {
      if (e.target.id === 'emSelect') choisir(e.target.value);
      else if (e.target.name === 'emRegime' && brouillon) brouillon.regimeTva = e.target.value;
      else if (e.target.id === 'em_avecLogo' && brouillon) brouillon.avecLogo = e.target.checked;
    });
    box.addEventListener('input', function (e) {
      if (e.target.id === 'emQ') { clearTimeout(rechercheTimer); var v = e.target.value; rechercheTimer = setTimeout(function () { lancerRecherche(v); }, 350); return; }
      var k = e.target.getAttribute('data-k');
      if (k && brouillon) brouillon[k] = e.target.value;
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-em]'); if (!b) return;
      var a = b.getAttribute('data-em');
      if (a === 'ajouter') { brouillon = null; rendreRecherche(); }
      else if (a === 'modifier') { brouillon = JSON.parse(JSON.stringify(get(sel))); rendreEditeur(); var f = $('em_raisonSociale'); if (f) f.focus(); }
      else if (a === 'manuel') { brouillon = { id: nouvelId(), raisonSociale: '', adresse: '', telephone: '', email: '', formeJuridique: '', capital: '', siren: '', siret: '', registre: '', tvaIntra: '', regimeTva: '', tauxTva: 8.5, prefixe: '', avecLogo: !liste().length }; rendreEditeur(); $('em_raisonSociale').focus(); }
      else if (a === 'choisir') {
        var r = (window.__emResultats || [])[+b.getAttribute('data-i')]; if (!r) return;
        brouillon = depuisResultat(r); rendreEditeur(); completerPappers(r.siren);
      }
      else if (a === 'annuler') { brouillon = null; $('emEditeur').innerHTML = ''; }
      else if (a === 'enregistrer') {
        var err = valider();
        var box2 = $('emErreur');
        if (err.length) { box2.textContent = 'Indiquez ' + err.join(', ') + '.'; box2.classList.remove('d-none'); return; }
        var fiche = {}; Object.keys(brouillon).forEach(function (k) { if (k.charAt(0) !== '_') fiche[k] = brouillon[k]; });
        fiche.prefixe = String(fiche.prefixe).toUpperCase();
        if (!fiche.tvaIntra && fiche.regimeTva === 'assujetti' && fiche.formeJuridique !== 'Entrepreneur individuel') fiche.tvaIntra = tvaIntra(fiche.siren);
        var l = liste().filter(function (x) { return x.id !== fiche.id; });
        var idx = liste().map(function (x) { return x.id; }).indexOf(fiche.id);
        if (idx >= 0) l.splice(idx, 0, fiche); else l.push(fiche);
        if (l.length > 10) { box2.textContent = 'Dix sociétés au maximum.'; box2.classList.remove('d-none'); return; }
        var modif = { emetteurs: l };
        if (($('em_defaut') || {}).checked || l.length === 1) modif.emetteurDefaut = fiche.id;
        enregistrer(modif);
        brouillon = null;
        choisir(fiche.id);
      }
      else if (a === 'supprimer') {
        // Les factures déjà émises gardent leur émetteur : il est figé dans leur détail.
        var reste = liste().filter(function (x) { return x.id !== brouillon.id; });
        var m = { emetteurs: reste };
        if (charte().emetteurDefaut === brouillon.id) m.emetteurDefaut = reste[0] ? reste[0].id : '';
        enregistrer(m);
        brouillon = null;
        choisir((reste[0] || {}).id || '');
      }
    });

    rendre();
    if (opts.onChange) opts.onChange(sel);
    return { selection: function () { return get(sel); }, ajouter: function () { brouillon = null; rendreRecherche(); },
             modifier: function () { if (get(sel)) { brouillon = JSON.parse(JSON.stringify(get(sel))); rendreEditeur(); } else rendreRecherche(); } };
  }

  window.FidiEmetteurs = { liste: liste, get: get, defaut: defaut, pourDocument: pourDocument, manquantes: manquantes,
                           tvaIntra: tvaIntra, depuisResultat: depuisResultat, prefixePropose: prefixePropose, monter: monter };
})();
