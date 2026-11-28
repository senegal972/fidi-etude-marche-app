/* ═══════════════════════════════════════════════════════════════════════════
   Module « Mise en page » — marque blanche
   Chaque exploitant applique son enseigne, son logo, ses couleurs et ses
   coordonnées, sans toucher au code.

   Ordre de priorité (du plus faible au plus fort) :
     1. DEFAUT ci-dessous (secours si rien d'autre n'est lisible)
     2. /marque.json            → charte du déploiement (un fichier par client)
     3. réglages du panneau « Mise en page » :
          - utilisateur connecté → charte du compte (/api/marque), retrouvée sur tous ses postes
          - sinon               → localStorage de ce navigateur

   Chargé dans le <head>, sans defer : les couleurs sont posées avant le premier
   affichage. Expose window.Marque (get, couleur, rgba, teinte, encre, recolorer, ouvrir)
   et émet l'événement « marque:change » sur document à chaque changement de charte.
   Se resynchronise avec le compte sur l'événement « fidi:compte » (émis par Compte.refresh).
   Aucune dépendance hors Bootstrap (panneau latéral).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var K_PERSO = 'fidi_marque_perso';   // réglages de l'utilisateur
  var K_CACHE = 'fidi_marque_cache';   // dernière charte appliquée (évite le flash au chargement)
  var LOGO_MAX_W = 480, LOGO_MAX_H = 160;

  var DEFAUT = {
    enseigne: 'OPTIMMO DOM',
    produit: 'Étude de Marché & Avis de valeur',
    baseline: 'Immobilier · Données publiques françaises',
    logo: '',
    couleurs: { principale: '#0C447C', accent: '#993C1D', secondaire: '#0F6E56' },
    coordonnees: { raisonSociale: '', adresse: '', telephone: '', email: '', mentions: '' },
    // Mentions légales des factures émises depuis le module de facturation (facture.js).
    facturation: { formeJuridique: '', capital: '', siren: '', registre: '', tvaIntra: '',
                   regimeTva: '', tauxTva: 8.5, delaiJours: 30, conditions: '' },
    // Sociétés émettrices (plusieurs par compte, choisies dans la fenêtre de facture) — voir emetteurs.js.
    emetteurs: [],
    emetteurDefaut: ''
  };

  var CHARTES = [
    { nom: 'OPTIMMO DOM', couleurs: { principale: '#0C447C', accent: '#993C1D', secondaire: '#0F6E56' } },
    { nom: 'Lagon & marine', couleurs: { principale: '#10243A', accent: '#2BB9DA', secondaire: '#C9A84C' } },
    { nom: 'Bleu & orange (origine)', couleurs: { principale: '#1A3A6E', accent: '#E8491D', secondaire: '#F5A623' } },
    { nom: 'Ardoise & émeraude', couleurs: { principale: '#263238', accent: '#0E8F6A', secondaire: '#D9A441' } }
  ];

  var LIMITES = { enseigne: 40, produit: 60, baseline: 80, raisonSociale: 80, adresse: 160,
                  telephone: 30, email: 80, mentions: 240,
                  formeJuridique: 60, capital: 40, siren: 20, registre: 80, tvaIntra: 20, conditions: 400,
                  siret: 20, prefixe: 16, titulaire: 80 };
  // Mêmes règles que ibanValide() / bicValide() dans netlify/functions/marque.mjs.
  function ibanValide(v) {
    var s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return '';
    var r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
    var reste = 0;
    for (var i = 0; i < r.length; i++) reste = (reste * 10 + Number(r.charAt(i))) % 97;
    return reste === 1 ? s : '';
  }
  function bicValide(v) {
    var s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) ? s : '';
  }
  var MAX_EMETTEURS = 10;

  var base = clone(DEFAUT);      // DEFAUT + marque.json
  var perso = lire(K_PERSO) || {};
  var courante = fusion(lire(K_CACHE) || DEFAUT, perso);
  var panneau = null;
  var compte = null;        // { nom } si l'utilisateur est connecté
  var envoiTimer = null;

  // ─── Utilitaires ────────────────────────────────────────────────────────────
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lire(k) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function hexOk(h) { return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h); }
  function logoOk(l) { return typeof l === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);/.test(l) && l.length < 600000; }
  function texte(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : null; }

  // Ne retient d'un objet (fichier importé, marque.json, stockage) que les champs valides.
  function assainir(src) {
    var out = {};
    if (!src || typeof src !== 'object') return out;
    ['enseigne', 'produit', 'baseline'].forEach(function (k) {
      var t = texte(src[k], LIMITES[k]); if (t !== null) out[k] = t;
    });
    if (src.logo === '' || logoOk(src.logo)) out.logo = src.logo;
    if (src.couleurs && typeof src.couleurs === 'object') {
      out.couleurs = {};
      ['principale', 'accent', 'secondaire'].forEach(function (k) {
        if (hexOk(src.couleurs[k])) out.couleurs[k] = src.couleurs[k].toUpperCase();
      });
    }
    if (src.coordonnees && typeof src.coordonnees === 'object') {
      out.coordonnees = {};
      ['raisonSociale', 'adresse', 'telephone', 'email', 'mentions'].forEach(function (k) {
        var t = texte(src.coordonnees[k], LIMITES[k]); if (t !== null) out.coordonnees[k] = t;
      });
    }
    // Mêmes règles que assainirMarque() dans netlify/functions/marque.mjs.
    if (src.facturation && typeof src.facturation === 'object') {
      var f = src.facturation, o = {};
      ['formeJuridique', 'capital', 'siren', 'registre', 'tvaIntra', 'conditions'].forEach(function (k) {
        var t = texte(f[k], LIMITES[k]); if (t !== null) o[k] = t;
      });
      if (['franchise', 'assujetti', ''].indexOf(f.regimeTva) >= 0) o.regimeTva = f.regimeTva;
      var taux = Number(f.tauxTva);
      if (f.tauxTva !== undefined && f.tauxTva !== '' && isFinite(taux)) o.tauxTva = Math.max(0, Math.min(30, taux));
      var delai = parseInt(f.delaiJours, 10);
      if (isFinite(delai)) o.delaiJours = Math.max(0, Math.min(90, delai));
      out.facturation = o;
    }
    if (Array.isArray(src.emetteurs)) {
      var vus = {};
      out.emetteurs = src.emetteurs.map(assainirEmetteur).filter(function (e) {
        if (!e || vus[e.id]) return false; vus[e.id] = true; return true;
      }).slice(0, MAX_EMETTEURS);
    }
    if (typeof src.emetteurDefaut === 'string') out.emetteurDefaut = src.emetteurDefaut.replace(/[^a-z0-9]/gi, '').slice(0, 16);
    return out;
  }
  // Mêmes règles que assainirEmetteur() dans netlify/functions/marque.mjs.
  function assainirEmetteur(src) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
    var id = String(src.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
    if (!id) return null;
    var o = { id: id };
    ['raisonSociale', 'adresse', 'telephone', 'email', 'formeJuridique', 'capital', 'siren', 'siret', 'registre', 'tvaIntra', 'mentions'].forEach(function (k) {
      var t = texte(src[k], LIMITES[k]); o[k] = t === null ? '' : t;
    });
    o.regimeTva = ['franchise', 'assujetti'].indexOf(src.regimeTva) >= 0 ? src.regimeTva : '';
    var taux = Number(src.tauxTva);
    o.tauxTva = isFinite(taux) ? Math.max(0, Math.min(30, taux)) : 8.5;
    var pre = String(src.prefixe || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, LIMITES.prefixe);
    o.prefixe = pre.length >= 2 ? pre : '';
    o.avecLogo = !!src.avecLogo;
    // Logo propre à la société (redimensionné par l'éditeur) ; à défaut, celui de la charte si « avecLogo ».
    o.logo = logoOk(src.logo) && src.logo.length < 200000 ? src.logo : '';
    o.iban = ibanValide(src.iban);
    o.bic = o.iban ? bicValide(src.bic) : '';
    var tit = texte(src.titulaire, LIMITES.titulaire);
    o.titulaire = o.iban && tit ? tit : '';
    return o;
  }
  function fusion(a, b) {
    var r = clone(DEFAUT);
    [assainir(a), assainir(b)].forEach(function (s) {
      ['enseigne', 'produit', 'baseline', 'logo', 'emetteurs', 'emetteurDefaut'].forEach(function (k) { if (k in s) r[k] = s[k]; });
      ['couleurs', 'coordonnees', 'facturation'].forEach(function (g) {
        if (s[g]) Object.keys(s[g]).forEach(function (k) { r[g][k] = s[g][k]; });
      });
    });
    return r;
  }

  // ─── Couleurs ───────────────────────────────────────────────────────────────
  function rgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); }); }
  function versHex(c) {
    return '#' + c.map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    }).join('');
  }
  function melange(hex, cible, t) { return versHex(rgb(hex).map(function (v) { return v + (cible - v) * t; })); }
  function luminance(hex) {
    var c = rgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contraste(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function encre(fond) { return contraste(fond, '#FFFFFF') >= contraste(fond, '#1A2233') ? '#FFFFFF' : '#1A2233'; }

  // ─── Application ────────────────────────────────────────────────────────────
  function appliquerCouleurs() {
    var c = courante.couleurs, s = document.documentElement.style;
    s.setProperty('--fidi-blue', c.principale);
    s.setProperty('--fidi-blue-light', melange(c.principale, 255, 0.18));
    s.setProperty('--fidi-accent', c.accent);
    s.setProperty('--fidi-accent-hover', melange(c.accent, 0, 0.16));
    s.setProperty('--fidi-on-accent', encre(c.accent));
    s.setProperty('--fidi-gold', c.secondaire);
    s.setProperty('--fidi-on-gold', encre(c.secondaire));
    s.setProperty('--av-blue', c.principale);
    s.setProperty('--av-blue-light', melange(c.principale, 255, 0.18));
    s.setProperty('--av-lightblue', melange(c.principale, 255, 0.9));
    s.setProperty('--av-gold', c.secondaire);
    s.setProperty('--av-on-gold', encre(c.secondaire));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c.principale);
  }

  function logoImg(cls) {
    var img = document.createElement('img');
    img.src = courante.logo;
    img.alt = courante.enseigne;
    img.className = cls;
    return img;
  }

  function appliquerDom() {
    var titre = document.getElementById('marqueTitre');
    if (!titre) return;
    titre.textContent = '';
    if (courante.logo) titre.appendChild(logoImg('marque-logo'));
    else { var i = document.createElement('i'); i.className = 'bi bi-building me-2'; titre.appendChild(i); }
    titre.appendChild(document.createTextNode(courante.enseigne || ''));
    if (courante.produit) {
      var pr = document.createElement('span');
      pr.className = 'marque-produit';
      // Grand écran : l'enseigne sur une ligne, le produit sur la suivante. Téléphone : une seule ligne, avec le séparateur.
      if (courante.enseigne) { var sep = document.createElement('span'); sep.className = 'marque-sep'; sep.textContent = ' · '; pr.appendChild(sep); }
      pr.appendChild(document.createTextNode(courante.produit));
      titre.appendChild(pr);
    }
    var bl = document.getElementById('marqueBaseline');
    if (bl) bl.textContent = courante.baseline;
    document.title = [courante.produit || 'Étude de marché', courante.enseigne].filter(Boolean).join(' – ');
  }

  function appliquer() {
    appliquerCouleurs();
    appliquerDom();
    ecrire(K_CACHE, courante);
    try { document.dispatchEvent(new CustomEvent('marque:change', { detail: clone(courante) })); } catch (e) { /* navigateur ancien */ }
  }

  // Les documents imprimés (rapport A4, avis de valeur, récapitulatif) sont écrits avec les
  // teintes de référence d'origine ; recolorer() les remplace par celles de la charte active.
  // options.secondaire === false : laisse #b8860b intact (dans le corps des documents, cette
  // teinte sert aussi de couleur d'alerte « orange » ; on ne la remplace que dans les feuilles de style).
  function recolorer(html, options) {
    if (typeof html !== 'string' || !html) return html;
    var a = auteurDe(options && options.contexte), c = (a ? a.marque : courante).couleurs;
    var out = html
      .replace(/#1a3a6e/gi, c.principale)
      .replace(/#12294d/gi, melange(c.principale, 0, 0.3))
      .replace(/#2652a0/gi, melange(c.principale, 255, 0.18))
      .replace(/#24508f/gi, melange(c.principale, 255, 0.15))
      .replace(/#eaf0f8/gi, melange(c.principale, 255, 0.9))
      .replace(/rgba\(\s*26\s*,\s*58\s*,\s*110\s*,/gi, 'rgba(' + rgb(c.principale).join(',') + ',');
    if (!options || options.secondaire !== false) out = out.replace(/#b8860b/gi, c.secondaire);
    return out;
  }

  function majPerso(modif) {
    perso = assainir(fusionBrute(perso, modif));
    ecrire(K_PERSO, perso);
    courante = fusion(base, perso);
    appliquer();
    planifierEnvoi();
  }

  // ─── Rattachement au compte ─────────────────────────────────────────────────
  // Le cookie de session suffit en temps normal ; le jeton sert de repli s'il est bloqué.
  // La session (cookie fidi_session, HttpOnly) est envoyée automatiquement.
  function entetes(json) { return json ? { 'Content-Type': 'application/json' } : {}; }
  function planifierEnvoi() {
    if (!compte) return;
    clearTimeout(envoiTimer);
    envoiTimer = setTimeout(envoyer, 800);
  }
  function envoyer() {
    if (!compte) return;
    fetch('/api/marque', { method: 'POST', credentials: 'same-origin', headers: entetes(true), body: JSON.stringify(perso) })
      .then(function (r) {
        if (r.status === 401) { compte = null; majCompteUi(); etat('Session expirée : réglages conservés dans ce navigateur.'); return; }
        etat(r.ok ? 'Enregistré dans votre compte.' : 'Enregistré dans ce navigateur ; l\'envoi vers le compte a échoué.');
      })
      .catch(function () { etat('Enregistré dans ce navigateur ; l\'envoi vers le compte a échoué.'); });
  }
  function chargerCompte() {
    fetch('/api/marque', { credentials: 'same-origin', headers: entetes(false) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.compte) { compte = null; majCompteUi(); return; }
        compte = d.compte;
        var distante = assainir(d.marque);
        if (Object.keys(distante).length) {
          // La charte du compte fait foi : elle remplace les réglages de ce navigateur.
          perso = distante; ecrire(K_PERSO, perso);
          courante = fusion(base, perso); appliquer(); remplir();
        } else if (Object.keys(perso).length) {
          envoyer(); // première connexion : on rattache au compte les réglages déjà faits ici
        }
        majCompteUi();
      })
      .catch(function () { /* hors ligne ou service indisponible : on reste en local */ });
  }
  function majCompteUi() {
    var e = document.getElementById('marqueCompte');
    if (!e) return;
    e.textContent = '';
    var i = document.createElement('i');
    if (compte) {
      i.className = 'bi bi-person-check me-1';
      e.appendChild(i);
      var qui = compte.nom || '';
      e.appendChild(document.createTextNode('Charte rattachée à votre compte' + (qui ? ' (' + qui + ')' : '') +
        ' : vous la retrouvez sur tous vos postes.'));
    } else {
      i.className = 'bi bi-laptop me-1';
      e.appendChild(i);
      e.appendChild(document.createTextNode('Charte enregistrée dans ce navigateur. '));
      var a = document.createElement('a');
      a.href = '#'; a.textContent = 'Connectez-vous';
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (panneau) { var oc = bootstrap.Offcanvas.getInstance(panneau); if (oc) oc.hide(); }
        if (window.Compte && Compte.open) Compte.open();
      });
      e.appendChild(a);
      e.appendChild(document.createTextNode(' pour la retrouver sur tous vos postes.'));
    }
    e.classList.toggle('est-connecte', !!compte);
  }
  function fusionBrute(a, b) {
    var r = clone(a || {});
    Object.keys(b).forEach(function (k) {
      if (Array.isArray(b[k])) r[k] = clone(b[k]);                 // listes (sociétés émettrices) : remplacées
      else if (b[k] && typeof b[k] === 'object') { r[k] = r[k] || {}; Object.keys(b[k]).forEach(function (j) { r[k][j] = b[k][j]; }); }
      else r[k] = b[k];
    });
    return r;
  }

  // ─── Panneau « Mise en page » ───────────────────────────────────────────────
  function champ(id, label, max, zone) {
    return '<div class="mb-2"><label class="marque-label" for="' + id + '">' + label + '</label>' +
      (zone ? '<textarea class="form-control form-control-sm" rows="2" id="' + id + '" maxlength="' + max + '"></textarea>'
            : '<input type="text" class="form-control form-control-sm" id="' + id + '" maxlength="' + max + '"/>') + '</div>';
  }
  function couleur(id, label) {
    return '<div class="marque-couleur"><input type="color" id="' + id + '" aria-label="' + label + '"/>' +
      '<div><div class="marque-label mb-0">' + label + '</div><code id="' + id + 'Hex"></code></div></div>';
  }
  function construirePanneau() {
    var el = document.createElement('div');
    el.className = 'offcanvas offcanvas-end marque-panneau';
    el.id = 'marquePanneau';
    el.tabIndex = -1;
    el.setAttribute('aria-labelledby', 'marquePanneauTitre');
    el.innerHTML =
      '<div class="offcanvas-header"><div><h2 class="offcanvas-title" id="marquePanneauTitre">Mise en page</h2>' +
      '<div class="marque-etat" id="marqueEtat" aria-live="polite">Les réglages s\'appliquent immédiatement.</div></div>' +
      '<button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Fermer"></button></div>' +
      '<div class="offcanvas-body">' +
        '<p class="marque-compte" id="marqueCompte"></p>' +
        '<h3 class="marque-section">Charte de couleurs</h3>' +
        '<div class="marque-chartes" id="marqueChartes"></div>' +
        '<div class="marque-couleurs">' + couleur('mqPrincipale', 'Principale') + couleur('mqAccent', 'Accent') +
          couleur('mqSecondaire', 'Secondaire') + '</div>' +
        '<p class="marque-alerte d-none" id="marqueAlerte" role="alert"></p>' +
        '<h3 class="marque-section">Bandeau</h3>' +
        champ('mqEnseigne', 'Enseigne', LIMITES.enseigne) +
        champ('mqProduit', 'Nom de l\'outil', LIMITES.produit) +
        champ('mqBaseline', 'Signature', LIMITES.baseline) +
        '<label class="marque-label" for="mqLogo">Logo</label>' +
        '<div class="marque-logo-zone"><div class="marque-logo-apercu" id="mqLogoApercu"></div><div>' +
          '<input type="file" class="form-control form-control-sm" id="mqLogo" accept="image/png,image/jpeg,image/webp,image/svg+xml"/>' +
          '<button type="button" class="marque-lien d-none" id="mqLogoRetirer">Retirer le logo</button></div></div>' +
        '<h3 class="marque-section">Coordonnées <small>(en-tête et pied des études imprimées)</small></h3>' +
        champ('mqRaison', 'Raison sociale', LIMITES.raisonSociale) +
        champ('mqAdresse', 'Adresse', LIMITES.adresse) +
        '<div class="row g-2"><div class="col-6">' + champ('mqTel', 'Téléphone', LIMITES.telephone) + '</div>' +
          '<div class="col-6">' + champ('mqEmail', 'E-mail', LIMITES.email) + '</div></div>' +
        champ('mqMentions', 'Mentions légales (RCS, carte professionnelle…)', LIMITES.mentions, true) +
        '<h3 class="marque-section" id="marqueSectionFacturation">Facturation <small>(mentions obligatoires des factures)</small></h3>' +
        '<div class="marque-label">Sociétés émettrices</div>' +
        '<ul class="marque-emetteurs" id="mqEmetteurs"></ul>' +
        '<p class="marque-note mt-1 mb-2">Ajoutez une société par son SIRET, son nom ou son dirigeant, et modifiez ses mentions ' +
        '(TVA, immatriculation, numérotation) depuis la fenêtre « Nouvelle facture ».</p>' +
        '<div class="mb-2"><label class="marque-label" for="mqDelai">Échéance par défaut</label>' +
          '<select class="form-select form-select-sm" id="mqDelai">' +
            [[0, 'À réception'], [15, '15 jours'], [30, '30 jours'], [45, '45 jours'], [60, '60 jours']].map(function (o) {
              return '<option value="' + o[0] + '">' + o[1] + '</option>';
            }).join('') + '</select></div>' +
        champ('mqConditions', 'Conditions de règlement (moyens de paiement, ordre des chèques…)', LIMITES.conditions, true) +
        '<h3 class="marque-section">Transférer la charte</h3>' +
        '<div class="d-flex flex-wrap gap-2">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" id="mqExporter"><i class="bi bi-download me-1"></i>Exporter</button>' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" id="mqImporter"><i class="bi bi-upload me-1"></i>Importer</button>' +
          '<input type="file" class="d-none" id="mqImportFichier" accept="application/json,.json"/>' +
          '<button type="button" class="btn btn-sm btn-outline-danger ms-auto" id="mqRetablir">Rétablir la charte par défaut</button>' +
        '</div>' +
        '<p class="marque-note">Le fichier exporté peut être importé sur un autre poste, ou déposé à la racine du site ' +
        'sous le nom <code>marque.json</code> pour devenir la charte par défaut de tous les utilisateurs.</p>' +
      '</div>';
    document.body.appendChild(el);

    var chartes = el.querySelector('#marqueChartes');
    CHARTES.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'marque-charte';
      ['principale', 'accent', 'secondaire'].forEach(function (k) {
        var p = document.createElement('span'); p.style.background = c.couleurs[k]; b.appendChild(p);
      });
      b.appendChild(document.createTextNode(c.nom));
      b.addEventListener('click', function () { majPerso({ couleurs: c.couleurs }); remplir(); etat('Charte « ' + c.nom + ' » appliquée.'); });
      chartes.appendChild(b);
    });

    var liens = {
      mqEnseigne: ['enseigne'], mqProduit: ['produit'], mqBaseline: ['baseline'],
      mqRaison: ['coordonnees', 'raisonSociale'], mqAdresse: ['coordonnees', 'adresse'],
      mqTel: ['coordonnees', 'telephone'], mqEmail: ['coordonnees', 'email'], mqMentions: ['coordonnees', 'mentions'],
      mqPrincipale: ['couleurs', 'principale'], mqAccent: ['couleurs', 'accent'], mqSecondaire: ['couleurs', 'secondaire'],
      mqDelai: ['facturation', 'delaiJours'], mqConditions: ['facturation', 'conditions']
    };
    Object.keys(liens).forEach(function (id) {
      el.querySelector('#' + id).addEventListener('input', function (e) {
        var ch = liens[id], m = {};
        if (ch.length === 1) m[ch[0]] = e.target.value; else { m[ch[0]] = {}; m[ch[0]][ch[1]] = e.target.value; }
        majPerso(m);
        if (ch[0] === 'couleurs') majCouleursUi();
        etat('Enregistré.');
      });
    });

    el.querySelector('#mqLogo').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) chargerLogo(f);
      e.target.value = '';
    });
    el.querySelector('#mqLogoRetirer').addEventListener('click', function () { majPerso({ logo: '' }); remplir(); etat('Logo retiré.'); });
    el.querySelector('#mqExporter').addEventListener('click', exporter);
    el.querySelector('#mqImporter').addEventListener('click', function () { el.querySelector('#mqImportFichier').click(); });
    el.querySelector('#mqImportFichier').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importer(f);
      e.target.value = '';
    });
    el.querySelector('#mqRetablir').addEventListener('click', function () {
      perso = {}; ecrire(K_PERSO, perso);
      courante = fusion(base, perso); appliquer(); remplir();
      etat('Charte par défaut rétablie.');
      planifierEnvoi();
    });
    return el;
  }

  function etat(msg) { var e = document.getElementById('marqueEtat'); if (e) e.textContent = msg; }

  function majCouleursUi() {
    var c = courante.couleurs;
    [['mqPrincipale', c.principale], ['mqAccent', c.accent], ['mqSecondaire', c.secondaire]].forEach(function (p) {
      document.getElementById(p[0]).value = p[1].toLowerCase();
      document.getElementById(p[0] + 'Hex').textContent = p[1];
    });
    // Le bandeau porte du texte blanc : on prévient si la couleur principale ne le permet pas.
    var a = document.getElementById('marqueAlerte');
    var faible = contraste(c.principale, '#FFFFFF') < 4.5;
    a.textContent = faible ? 'Couleur principale trop claire : le texte blanc du bandeau sera difficile à lire. Choisissez une teinte plus foncée.' : '';
    a.classList.toggle('d-none', !faible);
  }
  function remplir() {
    if (!panneau) return;
    var co = courante.coordonnees;
    var v = { mqEnseigne: courante.enseigne, mqProduit: courante.produit, mqBaseline: courante.baseline,
              mqRaison: co.raisonSociale, mqAdresse: co.adresse, mqTel: co.telephone, mqEmail: co.email, mqMentions: co.mentions };
    var fa = courante.facturation || {};
    v.mqConditions = fa.conditions;
    Object.keys(v).forEach(function (id) { document.getElementById(id).value = v[id] || ''; });
    document.getElementById('mqDelai').value = String(fa.delaiJours != null ? fa.delaiJours : 30);
    var ul = document.getElementById('mqEmetteurs');
    ul.textContent = '';
    (courante.emetteurs || []).forEach(function (e) {
      var li = document.createElement('li');
      li.textContent = e.raisonSociale + (e.siren ? ' · SIREN ' + e.siren : '') + (e.id === courante.emetteurDefaut ? ' (par défaut)' : '');
      ul.appendChild(li);
    });
    if (!ul.children.length) { var li0 = document.createElement('li'); li0.className = 'text-muted'; li0.textContent = 'Aucune société enregistrée.'; ul.appendChild(li0); }
    majCouleursUi();
    var ap = document.getElementById('mqLogoApercu');
    ap.textContent = '';
    if (courante.logo) ap.appendChild(logoImg(''));
    else ap.textContent = 'Aucun logo';
    document.getElementById('mqLogoRetirer').classList.toggle('d-none', !courante.logo);
  }

  // Le logo est redimensionné puis stocké en PNG : léger, et sans contenu actif.
  function chargerLogo(fichier) {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(fichier.type)) { etat('Format non pris en charge (PNG, JPEG, WebP ou SVG).'); return; }
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || 480, h = img.naturalHeight || 160;
        var k = Math.min(1, LOGO_MAX_W / w, LOGO_MAX_H / h);
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        var data;
        try { data = cv.toDataURL('image/png'); } catch (e) { etat('Ce logo n\'a pas pu être lu.'); return; }
        majPerso({ logo: data }); remplir(); etat('Logo enregistré.');
      };
      img.onerror = function () { etat('Ce logo n\'a pas pu être lu.'); };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  }

  function exporter() {
    var blob = new Blob([JSON.stringify(courante, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'marque.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    etat('Charte exportée (marque.json).');
  }
  function importer(fichier) {
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var obj;
      try { obj = JSON.parse(lecteur.result); } catch (e) { etat('Fichier illisible : ce n\'est pas une charte valide.'); return; }
      var propre = assainir(obj);
      if (!Object.keys(propre).length) { etat('Aucun réglage reconnu dans ce fichier.'); return; }
      perso = propre; ecrire(K_PERSO, perso);
      courante = fusion(base, perso); appliquer(); remplir();
      etat('Charte importée.');
      planifierEnvoi();
    };
    lecteur.readAsText(fichier);
  }

  function ouvrir(section) {
    if (!panneau) panneau = construirePanneau();
    remplir();
    majCompteUi();
    if (section === 'facturation') {
      panneau.addEventListener('shown.bs.offcanvas', function vers() {
        panneau.removeEventListener('shown.bs.offcanvas', vers);
        var t = document.getElementById('marqueSectionFacturation'); if (t) t.scrollIntoView({ behavior: 'smooth' });
      });
    }
    bootstrap.Offcanvas.getOrCreateInstance(panneau).show();
  }

  // ─── Démarrage ──────────────────────────────────────────────────────────────
  appliquerCouleurs(); // tout de suite, avant le premier affichage

  function demarrer() {
    appliquerDom();
    var b = document.getElementById('btnMarque');
    if (b) b.addEventListener('click', function () { ouvrir(); });
    fetch('/marque.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { base = fusion(DEFAUT, j); courante = fusion(base, perso); appliquer(); remplir(); } })
      .catch(function () { /* charte de déploiement absente : on garde le défaut */ });
    chargerCompte();
    document.addEventListener('fidi:compte', chargerCompte); // connexion / déconnexion
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();

  // Identité portée par les DOCUMENTS (rapport, récapitulatif, avis de valeur, textes d'envoi) : la société qui agit, c'est-à-dire
  // la société émettrice par défaut du compte (son nom, ses coordonnées, son logo — à défaut celui de la charte si « avecLogo »).
  // Sans société enregistrée : la charte telle quelle. Les écrans de l'application gardent la charte (get()).
  // Document d'un autre compte (ressorti par l'administrateur ou un membre du groupe) : il garde l'identité de son auteur.
  // auteurs[clé] = { marque, nom, email } ; clé = 'etude:<e-mail>' (étude affichée) ou 'avis:<référence>'.
  var auteurs = {};
  function cleEtude() { try { var d = window.__fidiData; return d && d.__auteurEmail ? 'etude:' + d.__auteurEmail : ''; } catch (e) { return ''; } }
  function auteurDe(cle) { return auteurs[cle == null ? cleEtude() : cle] || null; }
  function poserAuteur(cle, info) { if (!cle) return; if (info && info.marque) auteurs[cle] = { marque: fusion(DEFAUT, assainir(info.marque)), nom: info.nom || '', email: info.email || '' }; else delete auteurs[cle]; }
  function chargerAuteur(cle, emailAuteur, nom) {
    if (!cle || !emailAuteur) return Promise.resolve(null);
    if (auteurs[cle] && auteurs[cle].email === emailAuteur) return Promise.resolve(auteurs[cle]);
    return fetch('/api/marque?compte=' + encodeURIComponent(emailAuteur), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.marque) poserAuteur(cle, { marque: j.marque, nom: (j.compte && j.compte.nom) || nom, email: emailAuteur }); return auteurs[cle] || null; })
      .catch(function () { return null; });
  }
  // « Réalisé par … — édité le … par … » : seulement quand celui qui édite n'est pas l'auteur.
  function mentionEdition(cle, nomAuteur) {
    var a = auteurDe(cle), auteur = (a && a.nom) || nomAuteur || '';
    var moi = ''; try { moi = (window.Compte.state.user.nom || '').trim(); } catch (e) {}
    if (!auteur || !moi || auteur.trim().toLowerCase() === moi.toLowerCase()) return '';
    var societe = (function () { var d = identiteDe(courante); return d.coordonnees.raisonSociale || d.enseigne || ''; })();
    return 'Réalisé par ' + auteur + ' — édité le ' + new Date().toLocaleDateString('fr-FR') + ' par ' + moi + (societe ? ' (' + societe + ')' : '');
  }
  function identiteDocument(cle) { var a = auteurDe(cle); return identiteDe(a ? a.marque : courante); }
  function identiteDe(source) {
    var m = clone(source), l = m.emetteurs || [], co = m.coordonnees || {};
    var e = l.filter(function (x) { return x.id === m.emetteurDefaut; })[0] || l[0];
    if (!e || !e.raisonSociale) return m;
    m.enseigne = e.raisonSociale;
    m.logo = e.logo || (e.avecLogo ? (m.logo || '') : '');
    m.coordonnees = { raisonSociale: e.raisonSociale, adresse: e.adresse || '', telephone: e.telephone || '', email: e.email || '',
      mentions: e.mentions || (e.avecLogo ? (co.mentions || '') : '') };
    return m;
  }
  var FABRICANT = 'Optimmo Dom', PRODUIT = 'Étude de marché & Avis de valeur';

  window.Marque = {
    get: function () { return clone(courante); },
    document: identiteDocument,
    auteur: poserAuteur, chargerAuteur: chargerAuteur, mentionEdition: mentionEdition,
    // Le logiciel se signe à part de la société qui agit : produit + fabricant.
    fabricant: FABRICANT, produitLogiciel: PRODUIT,
    signatureLogiciel: function () { return PRODUIT + ' — une application ' + FABRICANT; },
    couleur: function (nom) { return courante.couleurs[nom] || courante.couleurs.principale; },
    recolorer: recolorer,
    // Modifie la charte (mêmes règles que le panneau) : utilisé par l'écran de facturation.
    maj: function (modif) { if (modif && typeof modif === 'object') majPerso(modif); },
    // Nom à faire figurer sur les documents (raison sociale, à défaut l'enseigne).
    nomDoc: function (cle) { var d = identiteDocument(cle); return d.coordonnees.raisonSociale || d.enseigne || ''; },
    // Bloc d'identité (logo ou enseigne + coordonnées) pour l'en-tête des documents imprimés.
    enTeteDoc: function (date, cle) {
      var doc = identiteDocument(cle), co = doc.coordonnees;
      var e = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
      var ident = doc.logo
        ? '<img src="' + e(doc.logo) + '" alt="' + e(doc.enseigne) + '" style="max-height:34px;max-width:150px;object-fit:contain;display:block;margin-left:auto;"/>'
        : '<div class="logo" style="font-size:15px;letter-spacing:-.3px;">' + e(doc.enseigne) + '</div>';
      var ligne = [co.telephone, co.email, date].filter(Boolean).map(e).join(' · ');
      return ident + (ligne ? '<div style="font-size:9px;color:#667">' + ligne + '</div>' : '');
    },
    encre: function (nom) { return encre(window.Marque.couleur(nom)); },
    teinte: function (nom, t) { return melange(window.Marque.couleur(nom), 255, t); },
    rgba: function (nom, alpha) { return 'rgba(' + rgb(window.Marque.couleur(nom)).join(',') + ',' + alpha + ')'; },
    ouvrir: ouvrir
  };
})();
