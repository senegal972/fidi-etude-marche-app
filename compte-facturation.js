/* ════════════════════════════════════════════════════════════════════════
   Mon compte → Facturation (administrateur)
   Vue d'ensemble · Factures (liste + fiche) · Encaissement pour compte · Réglages.
   Monté dans #factAdminRoot par Compte.loadFactAdmin(). Styles : compte-facturation.css.

   Serveur : GET /api/factures-admin (liste + totaux), /api/facture/paiement (paiement enregistré à la main,
   justificatif), /api/facture/cancel, /api/facture/relance, /api/send-email.
   Réutilise : window.relancerFacture, Compte.factDelete, Compte.factFicheClient, Compte.openRapportCompta,
   Compte.adminCommission, Compte.collaborateurs.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MOYENS = [
    { id: 'Espèces', icone: 'bi-cash-coin' }, { id: 'Virement', icone: 'bi-bank' }, { id: 'Chèque', icone: 'bi-pencil-square' },
    { id: 'Carte', icone: 'bi-credit-card' }, { id: 'PayPal', icone: 'bi-paypal' }, { id: 'Autre', icone: 'bi-three-dots' }
  ];
  var PLAFOND_ESPECES = 1000;           // même valeur que facture-paiement.mjs
  var TAILLE_MAX = 3000000;             // justificatif : 3 Mo
  var TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  var AIDES = {
    'Espèces': 'Remettez un reçu au client et gardez-en un double. Un particulier résidant en France ne peut pas régler plus de ' + PLAFOND_ESPECES.toLocaleString('fr-FR') + ' € en espèces à un professionnel (art. L112-6 et D112-3 du Code monétaire et financier).',
    'Virement': 'Notez le libellé du virement ou la date de valeur : c\'est ce qui permet de le retrouver sur le relevé. Une capture du relevé fait un bon justificatif.',
    'Chèque': 'Notez le numéro du chèque et la banque. La facture est soldée à la remise du chèque ; s\'il revient impayé, annulez le paiement ici.',
    'Carte': 'À utiliser pour un paiement par carte reçu hors de l\'application (terminal, lien d\'une autre banque). Les paiements par carte faits sur la page du client s\'enregistrent tout seuls.',
    'PayPal': 'À utiliser pour un paiement PayPal reçu hors de la page du client (envoi direct). Les paiements faits sur la page du client s\'enregistrent tout seuls.',
    'Autre': 'Précisez le moyen dans la note (compensation, avoir, plateforme…).'
  };

  var etat = { items: [], stats: {}, collabs: [], vue: 'apercu', filtre: 'toutes', q: '', tri: 'recent', choisi: null,
               fiche: null, panneau: null, message: null, charge: false, erreur: '' };

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; };
  var eur0 = function (n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' €'; };
  var jour = function (v) {
    if (!v) return '';
    var d = new Date(String(v).length === 10 ? v + 'T12:00:00' : v);
    return isNaN(d) ? String(v) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  var jourHeure = function (v) {
    var d = v ? new Date(v) : null;
    return !d || isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };
  var aujourdhui = function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  var racine = function () { return document.getElementById('factAdminRoot'); };

  // ── Seuils d'alerte (mémorisés sur ce poste, mêmes clés qu'avant) ───────────
  function seuils() {
    var a = 3, b = 7;
    try { a = parseInt(localStorage.getItem('fidi:relance:seuilA'), 10) || 3; b = parseInt(localStorage.getItem('fidi:relance:seuilB'), 10) || 7; } catch (e) {}
    return { a: a, b: b };
  }
  function age(f) {
    if (!f.date) return null;
    var d = new Date(f.date + 'T12:00:00'); if (isNaN(d)) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }
  // Situation d'une facture : payee | annulee | brouillon | critique | retard | attente
  function situation(f) {
    if (f.statut === 'Payée') return 'payee';
    if (f.statut === 'Annulée') return 'annulee';
    if (f.statut === 'Brouillon') return 'brouillon';
    var j = age(f), s = seuils();
    if (j != null && j >= s.b) return 'critique';
    if (j != null && j >= s.a) return 'retard';
    return 'attente';
  }
  var LIBELLE = { payee: 'Payée', annulee: 'Annulée', brouillon: 'Brouillon', critique: 'En retard', retard: 'En retard', attente: 'À payer' };
  function enRetard(f) { var s = situation(f); return s === 'retard' || s === 'critique'; }
  function trouver(ref) { return etat.items.filter(function (f) { return f.ref === ref; })[0] || null; }

  // ── Serveur ─────────────────────────────────────────────────────────────────
  function appel(url, corps) {
    var o = { credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (corps) { o.method = 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corps); }
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; j._ok = r.ok; j._code = r.status; return j; });
    }).catch(function () { return { _ok: false, _code: 0, error: 'Réseau indisponible.' }; });
  }

  function charger() {
    var r = racine(); if (!r) return Promise.resolve();
    if (!r.dataset.monte) { r.dataset.monte = '1'; r.addEventListener('click', surClic); r.addEventListener('input', surSaisie); r.addEventListener('change', surChangement); r.addEventListener('submit', surEnvoi); }
    etat.charge = true; etat.erreur = ''; afficher();
    var collabs = window.Compte && Compte.collaborateurs ? Compte.collaborateurs().catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([appel('/api/factures-admin'), collabs]).then(function (res) {
      var d = res[0];
      etat.charge = false;
      if (!d._ok) { etat.erreur = d.error || 'Chargement impossible.'; afficher(); return; }
      etat.items = d.items || []; etat.stats = d.stats || {}; etat.collabs = res[1] || [];
      window._factCache = etat.items; // lu par le rapport comptable et la fenêtre de relance
      if (etat.choisi && !trouver(etat.choisi)) { etat.choisi = null; etat.fiche = null; etat.panneau = null; }
      afficher();
    });
  }

  // ── Calculs d'affichage ─────────────────────────────────────────────────────
  function totaux() {
    var t = { encaisse: 0, nEncaisse: 0, attente: 0, nAttente: 0, retard: 0, nRetard: 0, commissions: 0, aReverser: 0, parMoyen: {}, parMois: {} };
    etat.items.forEach(function (f) {
      var m = Number(f.montant) || 0, s = situation(f);
      if (s === 'payee') {
        t.encaisse += m; t.nEncaisse++;
        t.commissions += Number(f.commission_eur) || 0;
        if (f.fidi_encaisse) t.aReverser += Number(f.reverser_eur) || 0;
        var moyen = f.moyen || 'Non précisé';
        t.parMoyen[moyen] = (t.parMoyen[moyen] || 0) + m;
        var mois = String(f.date_paiement || f.date || '').slice(0, 7);
        if (mois) t.parMois[mois] = (t.parMois[mois] || 0) + m;
      } else if (s === 'attente' || s === 'retard' || s === 'critique') {
        t.attente += m; t.nAttente++;
        if (s !== 'attente') { t.retard += m; t.nRetard++; }
      }
    });
    return t;
  }
  function sixMois(parMois) {
    var out = [], d = new Date(); d.setDate(1);
    for (var i = 5; i >= 0; i--) {
      var x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      var cle = x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2);
      out.push({ cle: cle, nom: x.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''), total: parMois[cle] || 0 });
    }
    return out;
  }
  var FILTRES = [
    { id: 'toutes', nom: 'Toutes', test: function () { return true; } },
    { id: 'apayer', nom: 'À payer', test: function (f) { var s = situation(f); return s === 'attente' || s === 'retard' || s === 'critique'; } },
    { id: 'retard', nom: 'En retard', test: enRetard },
    { id: 'payees', nom: 'Payées', test: function (f) { return f.statut === 'Payée'; } },
    { id: 'annulees', nom: 'Annulées', test: function (f) { return f.statut === 'Annulée'; } },
    { id: 'compte', nom: 'Encaissées pour compte', test: function (f) { return !!f.fidi_encaisse; } }
  ];
  function liste() {
    var filtre = FILTRES.filter(function (x) { return x.id === etat.filtre; })[0] || FILTRES[0];
    var q = etat.q.trim().toLowerCase();
    var l = etat.items.filter(function (f) {
      if (!filtre.test(f)) return false;
      if (!q) return true;
      return [f.ref, f.client, f.email, f.type, f.libelle, f.adresse, f.moyen].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var cmp = {
      recent: function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); },
      ancien: function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); },
      montant: function (a, b) { return (Number(b.montant) || 0) - (Number(a.montant) || 0); },
      client: function (a, b) { return String(a.client || '').localeCompare(String(b.client || ''), 'fr'); }
    }[etat.tri] || null;
    if (cmp) l = l.slice().sort(cmp);
    return l;
  }

  // ── Rendu ───────────────────────────────────────────────────────────────────
  var VUES = [
    { id: 'apercu', nom: 'Vue d\'ensemble', icone: 'bi-speedometer2' },
    { id: 'factures', nom: 'Factures', icone: 'bi-receipt-cutoff' },
    { id: 'collab', nom: 'Encaissement pour compte', icone: 'bi-people' },
    { id: 'reglages', nom: 'Réglages', icone: 'bi-sliders' }
  ];

  function afficher() {
    var r = racine(); if (!r) return;
    var t = totaux();
    var nav = '<div class="fa-nav" role="tablist" aria-label="Rubriques de la facturation">' + VUES.map(function (v) {
      var pastille = v.id === 'factures' && t.nRetard ? '<span class="fa-pastille" title="' + t.nRetard + ' facture(s) en retard">' + t.nRetard + '</span>' : '';
      return '<button type="button" role="tab" class="fa-onglet' + (etat.vue === v.id ? ' fa-actif' : '') + '" aria-selected="' + (etat.vue === v.id) + '" data-fa-vue="' + v.id + '"><i class="bi ' + v.icone + '"></i><span>' + v.nom + '</span>' + pastille + '</button>';
    }).join('') + '<button type="button" class="fa-rafraichir" data-fa="recharger" title="Recharger les factures" aria-label="Recharger"><i class="bi bi-arrow-clockwise"></i></button></div>';

    var corps;
    if (etat.erreur) corps = '<div class="fa-vide fa-erreur"><i class="bi bi-exclamation-triangle"></i><p>' + esc(etat.erreur) + '</p><button type="button" class="btn cpt-btn" data-fa="recharger">Réessayer</button></div>';
    else if (etat.charge && !etat.items.length) corps = '<div class="fa-vide"><span class="spinner-border spinner-border-sm"></span><p>Chargement des factures…</p></div>';
    else corps = { apercu: vueApercu, factures: vueFactures, collab: vueCollab, reglages: vueReglages }[etat.vue](t);
    r.innerHTML = nav + '<div class="fa-corps' + (etat.charge ? ' fa-en-charge' : '') + '">' + corps + '</div>';
  }

  function tuile(cle, valeur, sous, classe, action) {
    return '<button type="button" class="fa-tuile ' + (classe || '') + '"' + (action ? ' data-fa-filtre="' + action + '"' : ' disabled') + '>' +
      '<span class="fa-tuile-k">' + cle + '</span><span class="fa-tuile-v">' + valeur + '</span><span class="fa-tuile-s">' + sous + '</span></button>';
  }

  function vueApercu(t) {
    var s = seuils();
    var mois = sixMois(t.parMois), max = Math.max.apply(null, mois.map(function (m) { return m.total; }).concat([1]));
    var barres = '<div class="fa-barres" role="img" aria-label="Encaissements des six derniers mois">' + mois.map(function (m) {
      var h = Math.round(100 * m.total / max);
      return '<div class="fa-barre" title="' + esc(m.nom) + ' : ' + eur(m.total) + '"><span class="fa-barre-v">' + (m.total ? eur0(m.total) : '') + '</span><i style="height:' + Math.max(m.total ? 6 : 2, h) + '%"></i><span class="fa-barre-n">' + esc(m.nom) + '</span></div>';
    }).join('') + '</div>';

    var moyens = Object.keys(t.parMoyen).sort(function (a, b) { return t.parMoyen[b] - t.parMoyen[a]; });
    var repart = moyens.length ? moyens.map(function (m) {
      var p = t.encaisse ? Math.round(100 * t.parMoyen[m] / t.encaisse) : 0;
      return '<div class="fa-ligne-moyen"><span class="fa-lm-nom">' + esc(m) + '</span><span class="fa-lm-jauge"><i style="width:' + Math.max(2, p) + '%"></i></span><span class="fa-lm-v">' + eur0(t.parMoyen[m]) + ' · ' + p + ' %</span></div>';
    }).join('') : '<p class="fa-muet">Aucun encaissement pour le moment.</p>';

    var retards = etat.items.filter(enRetard).sort(function (a, b) { return (age(b) || 0) - (age(a) || 0); });
    var aTraiter = retards.length ? retards.slice(0, 6).map(function (f) {
      return '<div class="fa-traiter"><button type="button" class="fa-traiter-qui" data-fa-ouvrir="' + esc(f.ref) + '">' +
        '<span class="fa-etat fa-etat-' + situation(f) + '">J+' + age(f) + '</span><span class="fa-traiter-nom">' + esc(f.client || f.ref) + '</span>' +
        '<span class="fa-traiter-det">' + esc(f.ref) + ' · ' + eur(f.montant) + (f.relances ? ' · ' + f.relances + ' relance' + (f.relances > 1 ? 's' : '') : '') + '</span></button>' +
        '<span class="fa-traiter-actions"><button type="button" class="btn btn-sm fa-btn" data-fa-relancer="' + esc(f.ref) + '"><i class="bi bi-bell me-1"></i>Relancer</button>' +
        '<button type="button" class="btn btn-sm fa-btn fa-btn-plein" data-fa-encaisser="' + esc(f.ref) + '"><i class="bi bi-check2-circle me-1"></i>Encaisser</button></span></div>';
    }).join('') + (retards.length > 6 ? '<button type="button" class="fa-lien" data-fa-filtre="retard">Voir les ' + retards.length + ' factures en retard</button>' : '')
      : '<div class="fa-ok"><i class="bi bi-check-circle"></i>Aucun règlement en retard au-delà de J+' + s.a + '.</div>';

    return '<div class="fa-tuiles" id="factStatsBox">' +
        tuile('Encaissé', eur0(t.encaisse), t.nEncaisse + ' facture' + (t.nEncaisse > 1 ? 's' : '') + ' payée' + (t.nEncaisse > 1 ? 's' : ''), 'fa-tuile-forte', 'payees') +
        tuile('En attente', eur0(t.attente), t.nAttente + ' facture' + (t.nAttente > 1 ? 's' : '') + ' à payer', '', 'apayer') +
        tuile('En retard', eur0(t.retard), t.nRetard ? t.nRetard + ' facture' + (t.nRetard > 1 ? 's' : '') + ' au-delà de J+' + s.a : 'Rien en retard', t.nRetard ? 'fa-tuile-alerte' : 'fa-tuile-calme', 'retard') +
        tuile('À reverser', eur0(t.aReverser), 'Commissions conservées : ' + eur0(t.commissions), '', 'compte') +
      '</div>' +
      '<div class="fa-deux">' +
        '<section class="fa-carte"><h3>Encaissements des six derniers mois</h3>' + barres + '</section>' +
        '<section class="fa-carte"><h3>Moyens de paiement</h3>' + repart + '</section>' +
      '</div>' +
      '<section class="fa-carte" id="factAlertsBox"><div class="fa-carte-tete"><h3>À traiter</h3><span class="fa-muet">Factures impayées depuis ' + s.a + ' jours ou plus</span></div>' + aTraiter + '</section>';
  }

  function ligneFacture(f) {
    var s = situation(f), j = age(f);
    var sous = s === 'payee' ? (f.moyen ? esc(f.moyen) : '') + (f.date_paiement ? ' · ' + jour(f.date_paiement) : '')
      : (s === 'retard' || s === 'critique' ? 'J+' + j : (s === 'attente' && j != null ? 'depuis ' + j + ' j' : ''));
    return '<button type="button" class="fa-ligne fa-s-' + s + (etat.choisi === f.ref ? ' fa-choisie' : '') + '" title="' + LIBELLE[s] + '" data-fa-ouvrir="' + esc(f.ref) + '">' +
      '<span class="fa-l-ref"><b>' + esc(f.ref || '—') + '</b><small>' + jour(f.date) + '</small></span>' +
      '<span class="fa-l-client"><b>' + esc(f.client || 'Client non renseigné') + '</b><small>' + esc(f.libelle || f.type || '') + '</small></span>' +
      '<span class="fa-l-montant"><b>' + eur(f.montant) + '</b>' + (f.fidi_encaisse ? '<small title="Encaissée pour le compte d\'un collaborateur"><i class="bi bi-people"></i> pour compte</small>' : '') + '</span>' +
      '<span class="fa-l-etat"><span class="fa-etat fa-etat-' + s + '">' + LIBELLE[s] + '</span><small>' + sous + '</small></span>' +
      '<i class="bi bi-chevron-right fa-l-fleche" aria-hidden="true"></i></button>';
  }

  function vueFactures() {
    var l = liste();
    var puces = FILTRES.map(function (x) {
      var n = etat.items.filter(x.test).length;
      return '<button type="button" class="fa-puce' + (etat.filtre === x.id ? ' fa-actif' : '') + '" data-fa-filtre="' + x.id + '">' + x.nom + '<span>' + n + '</span></button>';
    }).join('');
    var total = l.reduce(function (a, f) { return a + (Number(f.montant) || 0); }, 0);
    var listeHtml = l.length ? l.map(ligneFacture).join('')
      : '<div class="fa-vide"><i class="bi bi-inbox"></i><p>' + (etat.items.length ? 'Aucune facture ne correspond à cette recherche.' : 'Aucune facture pour le moment.') + '</p></div>';
    var f = etat.choisi ? trouver(etat.choisi) : null;
    return '<div class="fa-factures' + (f ? ' fa-ouvert' : '') + '">' +
      '<div class="fa-col-liste">' +
        '<div class="fa-outils"><div class="fa-recherche"><i class="bi bi-search"></i><input type="search" id="faRecherche" class="form-control" placeholder="Client, numéro, prestation…" value="' + esc(etat.q) + '" autocomplete="off" aria-label="Rechercher une facture"></div>' +
          '<select id="faTri" class="form-select" aria-label="Trier les factures">' +
            [['recent', 'Plus récentes'], ['ancien', 'Plus anciennes'], ['montant', 'Montant décroissant'], ['client', 'Client A → Z']].map(function (o) { return '<option value="' + o[0] + '"' + (etat.tri === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="fa-puces">' + puces + '</div>' +
        '<div class="fa-compte-liste">' + l.length + ' facture' + (l.length > 1 ? 's' : '') + ' · ' + eur(total) + '</div>' +
        '<div class="fa-liste" id="factListBody">' + listeHtml + '</div>' +
      '</div>' +
      (f ? '<div class="fa-col-fiche" id="faFiche">' + ficheFacture(f) + '</div>' : '<div class="fa-col-fiche fa-fiche-vide"><i class="bi bi-receipt"></i><p>Choisissez une facture pour voir son détail, enregistrer un paiement, la renvoyer ou la relancer.</p></div>') +
    '</div>';
  }

  function ligneInfo(k, v) { return v ? '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>' : ''; }

  function ficheFacture(f) {
    var s = situation(f), p = etat.fiche && etat.fiche.ref === f.ref ? etat.fiche.paiement : undefined;
    var impayee = s === 'attente' || s === 'retard' || s === 'critique';
    var msg = etat.message ? '<div class="fa-message fa-message-' + etat.message.type + '" role="status">' + etat.message.html + '</div>' : '';

    // Suivi chronologique
    var etapes = ['<li class="fa-fait"><b>Facture émise</b><span>' + jour(f.date) + (f.paiement_requis ? ' · paiement exigé avant remise' : '') + '</span></li>'];
    if (f.relances) etapes.push('<li class="fa-fait"><b>' + f.relances + ' relance' + (f.relances > 1 ? 's' : '') + '</b><span>' + (f.derniere_relance ? 'dernière le ' + jour(f.derniere_relance) : '') + '</span></li>');
    if (s === 'payee') {
      var det = [f.moyen || 'Moyen non précisé', f.montant_paye != null ? eur(f.montant_paye) : '', f.paiement_manuel ? 'enregistré à la main' : 'encaissé en ligne'].filter(Boolean).join(' · ');
      etapes.push('<li class="fa-fait fa-paye"><b>Payée le ' + jour(f.date_paiement) + '</b><span>' + esc(det) + '</span></li>');
    } else if (s === 'annulee') etapes.push('<li class="fa-fait fa-annule"><b>Annulée</b><span>' + jour(f.date_paiement) + '</span></li>');
    else etapes.push('<li class="fa-attente"><b>En attente de règlement</b><span>' + (age(f) != null ? 'depuis ' + age(f) + ' jour' + (age(f) > 1 ? 's' : '') : '') + '</span></li>');

    // Détail du paiement enregistré à la main (note, justificatif, auteur)
    var detail = '';
    if (s === 'payee' && f.paiement_manuel) {
      if (p === undefined) detail = '<p class="fa-muet"><span class="spinner-border spinner-border-sm me-1"></span>Lecture du détail du paiement…</p>';
      else if (p) {
        detail = '<dl class="fa-infos">' +
          ligneInfo('Référence', esc(p.reference)) +
          ligneInfo('Justificatif', p.justificatif ? '<a href="/api/facture/paiement?ref=' + encodeURIComponent(f.ref) + '&justificatif=1" target="_blank" rel="noopener"><i class="bi bi-paperclip me-1"></i>' + esc(p.justificatif.nom) + '</a>' : '<span class="fa-sans">Sans justificatif</span>') +
          ligneInfo('Reçu remis', p.moyen === 'Espèces' ? (p.recu_remis ? 'Oui' : 'Non') : '') +
          ligneInfo('Écart', p.ecart && Math.abs(p.ecart) > 0.5 ? eur(p.ecart) + ' par rapport à la facture' : '') +
          ligneInfo('Enregistré', p.enregistre ? jourHeure(p.enregistre.le) + ' par ' + esc(p.enregistre.par.nom || p.enregistre.par.email) : '') +
          ligneInfo('Modifié', p.modifie ? jourHeure(p.modifie.le) + ' par ' + esc(p.modifie.par.nom || p.modifie.par.email) : '') +
          '</dl>' + (p.note ? '<div class="fa-note"><b>Note</b>' + esc(p.note).replace(/\n/g, '<br>') + '</div>' : '');
      } else detail = '<p class="fa-muet">Aucun détail enregistré pour ce paiement.</p>';
    }

    var actions = [];
    var bouton = function (act, icone, nom, classe) { return '<button type="button" class="fa-action ' + (classe || '') + (etat.panneau === act ? ' fa-actif' : '') + '" data-fa-action="' + act + '"><i class="bi ' + icone + '"></i><span>' + nom + '</span></button>'; };
    var lien = function (url, icone, nom) { return '<a class="fa-action" href="' + esc(url) + '" target="_blank" rel="noopener"><i class="bi ' + icone + '"></i><span>' + nom + '</span></a>'; };
    if (impayee) actions.push(bouton('paiement', 'bi-check2-circle', 'Enregistrer un paiement', 'fa-action-forte'));
    if (s === 'payee' && f.paiement_manuel) actions.push(bouton('paiement', 'bi-pencil', 'Modifier le paiement'));
    if (f.facture_url) actions.push(lien(f.facture_url, 'bi-file-earmark-text', 'Voir la facture'));
    if (f.delivery_url) actions.push(lien(f.delivery_url, 'bi-box-arrow-up-right', 'Page du client'));
    if (f.delivery_url) actions.push(bouton('copier', 'bi-link-45deg', 'Copier le lien'));
    if (s !== 'annulee' && s !== 'brouillon') actions.push(bouton('renvoyer', 'bi-envelope', 'Renvoyer au client'));
    if (impayee) actions.push(bouton('relancer', 'bi-bell', 'Relancer'));
    if (s === 'payee' && f.paiement_manuel) actions.push(bouton('annulerPaiement', 'bi-arrow-counterclockwise', 'Annuler le paiement', 'fa-action-danger'));
    if (impayee || s === 'brouillon') actions.push(bouton('annuler', 'bi-x-circle', 'Annuler la facture', 'fa-action-danger'));
    if (s === 'annulee') actions.push(bouton('supprimer', 'bi-trash', 'Supprimer', 'fa-action-danger'));

    return '<button type="button" class="fa-retour" data-fa="fermer"><i class="bi bi-arrow-left me-1"></i>Toutes les factures</button>' +
      '<div class="fa-fiche-tete"><div><div class="fa-fiche-ref">' + esc(f.ref) + '</div><div class="fa-fiche-client">' + esc(f.client || 'Client non renseigné') + '</div></div>' +
        '<div class="fa-fiche-montant"><b>' + eur(f.montant) + '</b><span class="fa-etat fa-etat-' + s + '">' + LIBELLE[s] + (enRetard(f) ? ' · J+' + age(f) : '') + '</span></div></div>' +
      msg +
      '<div class="fa-actions">' + actions.join('') + '</div>' +
      panneau(f) +
      '<section class="fa-bloc"><h4>Suivi</h4><ol class="fa-suivi">' + etapes.join('') + '</ol>' + detail + '</section>' +
      '<section class="fa-bloc"><h4>Client et prestation</h4><dl class="fa-infos">' +
        ligneInfo('Client', f.client ? '<button type="button" class="fa-lien" data-fa-action="client">' + esc(f.client) + '</button>' : '') +
        ligneInfo('E-mail', esc(f.email)) + ligneInfo('Téléphone', esc(f.telephone)) +
        ligneInfo('Prestation', esc(f.libelle || f.type)) + ligneInfo('Bien', esc(f.adresse)) + ligneInfo('Dossier', esc(f.ref_dossier)) +
        ligneInfo('Encaissement', f.fidi_encaisse ? 'Pour le compte de ' + esc(f.collab || 'un collaborateur') + ' · commission ' + (f.commission_pct || 0) + ' % (' + eur(f.commission_eur) + '), à reverser ' + eur(f.reverser_eur) : '') +
      '</dl></section>';
  }

  // Panneau ouvert sous les actions : formulaire de paiement ou confirmation.
  function panneau(f) {
    if (etat.panneau === 'paiement') return formulairePaiement(f);
    var confirmer = function (titre, texte, champ, bouton, classe) {
      return '<form class="fa-panneau" data-fa-form="' + etat.panneau + '"><h4>' + titre + '</h4><p>' + texte + '</p>' +
        (champ ? '<label class="fa-label" for="faMotif">' + champ + '</label><input type="text" id="faMotif" class="form-control fa-champ" maxlength="200" autocomplete="off">' : '') +
        '<div class="fa-panneau-pied"><button type="button" class="btn fa-btn" data-fa="fermerPanneau">Ne rien faire</button><button type="submit" class="btn fa-btn ' + (classe || 'fa-btn-plein') + '">' + bouton + '</button></div></form>';
    };
    if (etat.panneau === 'renvoyer') {
      return f.email
        ? confirmer('Renvoyer au client', 'Un e-mail avec le lien vers ' + (f.paye ? 'la facture acquittée et les documents' : 'la facture et son règlement') + ' sera envoyé à <b>' + esc(f.email) + '</b>.', '', '<i class="bi bi-envelope me-1"></i>Envoyer l\'e-mail')
        : '<div class="fa-panneau"><h4>Renvoyer au client</h4><p>Aucune adresse e-mail n\'est enregistrée pour ce client. Copiez le lien de la page du client et envoyez-le par le moyen de votre choix.</p><div class="fa-panneau-pied"><button type="button" class="btn fa-btn" data-fa="fermerPanneau">Fermer</button><button type="button" class="btn fa-btn fa-btn-plein" data-fa-action="copier">Copier le lien</button></div></div>';
    }
    if (etat.panneau === 'annulerPaiement') return confirmer('Annuler le paiement', 'La facture repassera « À payer ». À utiliser pour une erreur de saisie ou un chèque revenu impayé. Le détail du paiement reste conservé.', 'Motif', 'Annuler le paiement', 'fa-btn-danger');
    if (etat.panneau === 'annuler') return confirmer('Annuler la facture', 'La facture passera « Annulée » et restera consultable. Une facture annulée ne peut plus être réglée.', 'Motif (facultatif)', 'Annuler la facture', 'fa-btn-danger');
    return '';
  }

  function formulairePaiement(f) {
    var p = (etat.fiche && etat.fiche.ref === f.ref && etat.fiche.paiement) || {};
    var b = etat.brouillon || (etat.brouillon = {
      moyen: p.moyen || '', date: p.date || aujourdhui(), montant: p.montant != null ? p.montant : f.montant, reference: p.reference || '',
      note: p.note || '', justif: p.justificatif ? 'garder' : (p.sans_justificatif ? 'sans' : 'avec'), recu: !!p.recu_remis, ecart: false, envoyer: false, fichier: null
    });
    var modif = f.statut === 'Payée';
    var ecart = Math.round(((Number(String(b.montant).replace(',', '.')) || 0) - (Number(f.montant) || 0)) * 100) / 100;
    var especes = b.moyen === 'Espèces';
    var plafond = especes && (Number(String(b.montant).replace(',', '.')) || 0) > PLAFOND_ESPECES;

    return '<form class="fa-panneau fa-paiement" data-fa-form="paiement" novalidate>' +
      '<h4>' + (modif ? 'Modifier le paiement' : 'Enregistrer un paiement') + '</h4>' +
      '<p>Pour un règlement reçu hors de la page du client : espèces, virement, chèque…</p>' +
      '<div class="fa-label">Moyen de paiement</div>' +
      '<div class="fa-moyens" role="radiogroup" aria-label="Moyen de paiement">' + MOYENS.map(function (m) {
        return '<label class="fa-moyen' + (b.moyen === m.id ? ' fa-actif' : '') + '"><input type="radio" name="faMoyen" value="' + m.id + '"' + (b.moyen === m.id ? ' checked' : '') + '><i class="bi ' + m.icone + '"></i><span>' + m.id + '</span></label>';
      }).join('') + '</div>' +
      (b.moyen ? '<div class="fa-aide' + (plafond ? ' fa-aide-alerte' : '') + '"><i class="bi ' + (plafond ? 'bi-exclamation-triangle' : 'bi-info-circle') + '"></i><span>' +
        (plafond ? '<b>Montant supérieur au plafond légal des espèces (' + PLAFOND_ESPECES.toLocaleString('fr-FR') + ' €).</b> ' : '') + esc(AIDES[b.moyen]) + '</span></div>' : '') +
      '<div class="fa-grille">' +
        '<div><label class="fa-label" for="faDate">Date du paiement</label><input type="date" id="faDate" class="form-control fa-champ" max="' + aujourdhui() + '" value="' + esc(b.date) + '"></div>' +
        '<div><label class="fa-label" for="faMontant">Montant reçu (€)</label><input type="text" inputmode="decimal" id="faMontant" class="form-control fa-champ" value="' + esc(String(b.montant).replace('.', ',')) + '"></div>' +
      '</div>' +
      (Math.abs(ecart) > 0.5 ? '<label class="fa-coche fa-coche-alerte"><input type="checkbox" id="faEcart"' + (b.ecart ? ' checked' : '') + '><span>Le montant reçu diffère de la facture de <b>' + eur(ecart) + '</b>. Je solde la facture malgré cet écart et je l\'explique dans la note.</span></label>' : '') +
      '<label class="fa-label" for="faReference">' + ({ 'Chèque': 'N° du chèque et banque', 'Virement': 'Libellé ou référence du virement', 'Espèces': 'N° du reçu (facultatif)' }[b.moyen] || 'Référence (facultatif)') + '</label>' +
      '<input type="text" id="faReference" class="form-control fa-champ" maxlength="80" value="' + esc(b.reference) + '" autocomplete="off">' +
      (especes ? '<label class="fa-coche"><input type="checkbox" id="faRecu"' + (b.recu ? ' checked' : '') + '><span>Un reçu a été remis au client</span></label>' : '') +
      '<div class="fa-label">Justificatif</div>' +
      '<div class="fa-bascule" role="radiogroup" aria-label="Justificatif">' +
        (p.justificatif ? '<label class="' + (b.justif === 'garder' ? 'fa-actif' : '') + '"><input type="radio" name="faJustif" value="garder"' + (b.justif === 'garder' ? ' checked' : '') + '>Garder l\'actuel</label>' : '') +
        '<label class="' + (b.justif === 'avec' ? 'fa-actif' : '') + '"><input type="radio" name="faJustif" value="avec"' + (b.justif === 'avec' ? ' checked' : '') + '>' + (p.justificatif ? 'Remplacer' : 'Avec justificatif') + '</label>' +
        '<label class="' + (b.justif === 'sans' ? 'fa-actif' : '') + '"><input type="radio" name="faJustif" value="sans"' + (b.justif === 'sans' ? ' checked' : '') + '>Sans justificatif</label></div>' +
      (b.justif === 'avec' ? '<label class="fa-depot" for="faFichier"><i class="bi bi-cloud-arrow-up"></i><span id="faFichierNom">' + (b.fichier ? esc(b.fichier.nom) + ' · ' + Math.round(b.fichier.taille / 1024) + ' Ko' : 'Photo, capture ou PDF (3 Mo au plus) : reçu signé, relevé, chèque…') + '</span><input type="file" id="faFichier" accept="image/jpeg,image/png,image/webp,application/pdf"></label>' : '') +
      (b.justif === 'garder' && p.justificatif ? '<p class="fa-muet"><i class="bi bi-paperclip me-1"></i>' + esc(p.justificatif.nom) + '</p>' : '') +
      (b.justif === 'sans' ? '<p class="fa-muet">Le paiement sera enregistré sans pièce. Indiquez dans la note comment il a été constaté.</p>' : '') +
      '<label class="fa-label" for="faNote">Note interne' + (b.justif === 'sans' || Math.abs(ecart) > 0.5 ? '' : ' (facultatif)') + '</label>' +
      '<textarea id="faNote" class="form-control fa-champ" rows="3" maxlength="600" placeholder="Ex. : réglé en espèces au cabinet le jour de la remise du rapport.">' + esc(b.note) + '</textarea>' +
      (f.email && !modif ? '<label class="fa-coche"><input type="checkbox" id="faEnvoyer"' + (b.envoyer ? ' checked' : '') + '><span>Envoyer la facture acquittée à ' + esc(f.email) + '</span></label>' : '') +
      '<div class="fa-erreur-form d-none" id="faErreur" role="alert"></div>' +
      '<div class="fa-panneau-pied"><button type="button" class="btn fa-btn" data-fa="fermerPanneau">Annuler</button>' +
        '<button type="submit" class="btn fa-btn fa-btn-plein" id="faValider"><i class="bi bi-check2-circle me-1"></i>' + (modif ? 'Enregistrer les modifications' : 'Marquer la facture payée') + '</button></div>' +
    '</form>';
  }

  function vueCollab() {
    var l = etat.collabs.filter(function (u) { return u.fidi_encaisse; });
    var cartes = l.length ? l.map(function (u) {
      var siennes = etat.items.filter(function (f) { return f.fidi_encaisse && String(f.collab || '').toLowerCase() === String(u.email || '').toLowerCase() && f.statut === 'Payée'; });
      var enc = siennes.reduce(function (a, f) { return a + (Number(f.montant) || 0); }, 0), com = siennes.reduce(function (a, f) { return a + (Number(f.commission_eur) || 0); }, 0), rev = siennes.reduce(function (a, f) { return a + (Number(f.reverser_eur) || 0); }, 0);
      var pct = u.commission != null ? u.commission : 25;
      return '<div class="fa-collab"><div class="fa-collab-tete"><div class="fa-avatar" aria-hidden="true">' + esc(String(u.nom || u.email || '?').trim().charAt(0).toUpperCase()) + '</div>' +
          '<div class="fa-collab-qui"><b>' + esc(u.nom || String(u.email || '').split('@')[0]) + '</b><small>' + esc(u.email) + (u.reseau ? ' · ' + esc(u.reseau) : '') + '</small></div>' +
          '<span class="fa-pct">' + pct + ' %</span></div>' +
        '<dl class="fa-collab-chiffres"><div><dt>Encaissé</dt><dd>' + eur0(enc) + '</dd></div><div><dt>Commission</dt><dd>' + eur0(com) + '</dd></div><div><dt>À reverser</dt><dd>' + eur0(rev) + '</dd></div></dl>' +
        '<button type="button" class="btn btn-sm fa-btn" data-fa-commission="' + esc(u.email) + '" data-pct="' + pct + '"><i class="bi bi-pencil me-1"></i>Modifier la commission</button></div>';
    }).join('') : '<div class="fa-vide"><i class="bi bi-people"></i><p>Aucun collaborateur n\'est en encaissement pour compte. Activez-le dans la rubrique « Comptes », avec le bouton <i class="bi bi-bank"></i> de la ligne du collaborateur.</p></div>';
    return '<section class="fa-carte fa-carte-info"><i class="bi bi-info-circle"></i><p>Quand vous encaissez à la place d\'un collaborateur, vous gardez une commission (25 % par défaut, réglable pour chacun) et vous lui reversez le reste : prix TTC moins commission.</p></section>' +
      '<div class="fa-collabs" id="factCollabBody">' + cartes + '</div>';
  }

  function vueReglages() {
    var s = seuils();
    return '<section class="fa-carte"><h3>Alertes de règlement</h3><p class="fa-muet">Une facture impayée passe « en retard » au premier seuil, puis en rouge au second. Ces seuils sont mémorisés sur ce poste.</p>' +
        '<form class="fa-seuils" data-fa-form="seuils"><label class="fa-label" for="factSeuilA">Rappel à partir de J+</label><input type="number" id="factSeuilA" class="form-control fa-champ" min="1" max="365" value="' + s.a + '">' +
        '<label class="fa-label" for="factSeuilB">Retard marqué à partir de J+</label><input type="number" id="factSeuilB" class="form-control fa-champ" min="1" max="365" value="' + s.b + '">' +
        '<button type="submit" class="btn fa-btn fa-btn-plein">Appliquer</button></form>' +
        '<p class="fa-muet">Les relances restent manuelles : bouton « Relancer » sur une facture.</p></section>' +
      '<section class="fa-carte fa-carte-ligne"><div><h3>Rapport comptable</h3><p class="fa-muet">Récapitulatif mensuel ou annuel des encaissements, à imprimer ou enregistrer en PDF.</p></div>' +
        '<button type="button" class="btn fa-btn" data-fa="rapport"><i class="bi bi-file-earmark-bar-graph me-1"></i>Ouvrir le rapport</button></section>';
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  function dire(type, html) { etat.message = { type: type, html: html }; }
  function ouvrir(ref, panneauVoulu) {
    var f = trouver(ref); if (!f) return;
    etat.vue = 'factures'; etat.choisi = ref; etat.panneau = panneauVoulu || null; etat.brouillon = null; etat.message = null;
    if (!etat.fiche || etat.fiche.ref !== ref) etat.fiche = { ref: ref, paiement: undefined };
    afficher();
    var fiche = document.getElementById('faFiche');
    if (fiche && window.matchMedia('(max-width: 1099px)').matches) fiche.scrollIntoView({ block: 'start' });
    if (f.statut === 'Payée' && f.paiement_manuel && etat.fiche.paiement === undefined) {
      appel('/api/facture/paiement?ref=' + encodeURIComponent(ref)).then(function (r) {
        if (!etat.fiche || etat.fiche.ref !== ref) return;
        etat.fiche.paiement = r._ok ? (r.paiement || null) : null;
        if (etat.panneau !== 'paiement') afficher();
      });
    } else if (etat.fiche.paiement === undefined) etat.fiche.paiement = null;
  }
  function copier(texte) {
    var fait = function () { dire('ok', 'Lien copié.'); afficher(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texte).then(fait, function () { dire('info', 'Lien : ' + esc(texte)); afficher(); });
    else { dire('info', 'Lien : ' + esc(texte)); afficher(); }
  }
  function relancer(ref) {
    var f = trouver(ref);
    if (f && typeof window.relancerFacture === 'function') window.relancerFacture(f, function () { charger(); });
  }
  function lireFormulaire() {
    var b = etat.brouillon; if (!b) return;
    var v = function (id) { var e = document.getElementById(id); return e ? e.value : undefined; };
    var c = function (id) { var e = document.getElementById(id); return e ? e.checked : undefined; };
    var m = document.querySelector('#factAdminRoot input[name="faMoyen"]:checked'); if (m) b.moyen = m.value;
    var j = document.querySelector('#factAdminRoot input[name="faJustif"]:checked'); if (j) b.justif = j.value;
    if (v('faDate') !== undefined) b.date = v('faDate');
    if (v('faMontant') !== undefined) b.montant = v('faMontant');
    if (v('faReference') !== undefined) b.reference = v('faReference');
    if (v('faNote') !== undefined) b.note = v('faNote');
    if (c('faRecu') !== undefined) b.recu = c('faRecu');
    if (c('faEcart') !== undefined) b.ecart = c('faEcart');
    if (c('faEnvoyer') !== undefined) b.envoyer = c('faEnvoyer');
  }
  function erreurForm(txt) { var e = document.getElementById('faErreur'); if (e) { e.textContent = txt; e.classList.remove('d-none'); e.scrollIntoView({ block: 'nearest' }); } }

  function envoyerAuClient(f, message) {
    return appel('/api/send-email', { to: f.email, subject: (f.paye || message ? 'Votre facture acquittée' : 'Votre facture') + ' ' + f.ref, lien: f.delivery_url || f.facture_url,
      kind: f.type || 'facture', titre: f.libelle || f.adresse || f.ref,
      message: message || (f.paye ? 'Voici le lien vers votre facture acquittée et vos documents.' : 'Voici le lien vers votre facture. Vous pouvez la consulter et la régler depuis cette page.') });
  }

  function validerPaiement(f) {
    lireFormulaire();
    var b = etat.brouillon;
    var montant = Number(String(b.montant).replace(',', '.'));
    if (!b.moyen) return erreurForm('Choisissez le moyen de paiement.');
    if (!b.date) return erreurForm('Indiquez la date du paiement.');
    if (!(montant > 0)) return erreurForm('Indiquez le montant reçu.');
    var ecart = Math.abs(montant - (Number(f.montant) || 0)) > 0.5;
    if (ecart && !b.ecart) return erreurForm('Le montant reçu diffère de la facture : cochez la case de confirmation de l\'écart.');
    if (ecart && b.note.trim().length < 5) return erreurForm('Expliquez l\'écart de montant dans la note.');
    if (b.justif === 'avec' && !b.fichier) return erreurForm('Ajoutez le justificatif, ou choisissez « Sans justificatif ».');
    if (b.justif === 'sans' && b.note.trim().length < 5) return erreurForm('Sans justificatif, indiquez dans la note comment le paiement a été constaté.');
    var corps = { action: 'enregistrer', ref: f.ref, moyen: b.moyen, date: b.date, montant: montant, reference: b.reference, note: b.note,
      recu_remis: b.moyen === 'Espèces' && b.recu, ecart_accepte: ecart && b.ecart, sans_justificatif: b.justif === 'sans', garder_justificatif: b.justif === 'garder' };
    if (b.justif === 'avec' && b.fichier) corps.justificatif = { nom: b.fichier.nom, type: b.fichier.type, base64: b.fichier.base64 };
    var bouton = document.getElementById('faValider'); if (bouton) { bouton.disabled = true; bouton.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enregistrement…'; }
    var envoi = b.envoyer && f.email;
    appel('/api/facture/paiement', corps).then(function (r) {
      if (!r._ok) { if (bouton) { bouton.disabled = false; bouton.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Réessayer'; } return erreurForm(r.error || 'Enregistrement impossible.'); }
      etat.panneau = null; etat.brouillon = null; etat.fiche = { ref: f.ref, paiement: r.paiement || null };
      dire('ok', '<i class="bi bi-check-circle me-1"></i>Paiement enregistré : ' + esc(b.moyen) + ', ' + eur(montant) + '.' + (r.depasse_plafond_especes ? ' Attention : montant supérieur au plafond légal des espèces.' : ''));
      var suite = envoi ? envoyerAuClient(Object.assign({}, f, { paye: true }), 'Votre règlement de ' + eur(montant) + ' a bien été reçu. Voici le lien vers votre facture acquittée et vos documents.').then(function (e) {
        etat.message.html += e._ok ? ' Facture acquittée envoyée à ' + esc(f.email) + '.' : ' L\'e-mail au client n\'a pas pu partir : ' + esc(e.error || 'erreur') + '.';
      }) : Promise.resolve();
      return suite.then(charger);
    });
  }

  function surEnvoi(e) {
    var form = e.target.closest('[data-fa-form]'); if (!form) return;
    e.preventDefault();
    var type = form.dataset.faForm, f = etat.choisi ? trouver(etat.choisi) : null;
    if (type === 'seuils') {
      var a = parseInt((document.getElementById('factSeuilA') || {}).value, 10) || 3, b = parseInt((document.getElementById('factSeuilB') || {}).value, 10) || 7;
      if (b < a) b = a;
      try { localStorage.setItem('fidi:relance:seuilA', a); localStorage.setItem('fidi:relance:seuilB', b); } catch (x) {}
      afficher(); return;
    }
    if (!f) return;
    if (type === 'paiement') return validerPaiement(f);
    var motif = (document.getElementById('faMotif') || {}).value || '';
    var bouton = form.querySelector('[type=submit]'); if (bouton) bouton.disabled = true;
    var fin = function (r, ok) {
      etat.panneau = null;
      if (r._ok) dire('ok', ok); else dire('erreur', esc(r.error || 'Action impossible.'));
      return charger();
    };
    if (type === 'renvoyer') return envoyerAuClient(f).then(function (r) { return fin(r, 'E-mail envoyé à ' + esc(f.email) + '.'); });
    if (type === 'annulerPaiement') {
      if (motif.trim().length < 3) { if (bouton) bouton.disabled = false; var m = document.getElementById('faMotif'); if (m) m.focus(); return; }
      return appel('/api/facture/paiement', { action: 'annuler_paiement', ref: f.ref, motif: motif }).then(function (r) { etat.fiche = null; return fin(r, 'Paiement annulé : la facture est de nouveau « À payer ».'); });
    }
    if (type === 'annuler') return appel('/api/facture/cancel', { ref: f.ref, motif: motif }).then(function (r) { return fin(r, 'Facture annulée.'); });
  }

  function surClic(e) {
    var t = e.target.closest('[data-fa-vue],[data-fa-filtre],[data-fa-ouvrir],[data-fa-relancer],[data-fa-encaisser],[data-fa-action],[data-fa-commission],[data-fa]');
    if (!t) return;
    var d = t.dataset;
    if (d.faVue) { etat.vue = d.faVue; afficher(); return; }
    if (d.faFiltre) { etat.vue = 'factures'; etat.filtre = d.faFiltre; etat.choisi = null; etat.panneau = null; afficher(); return; }
    if (d.faOuvrir) { ouvrir(d.faOuvrir); return; }
    if (d.faRelancer) { relancer(d.faRelancer); return; }
    if (d.faEncaisser) { ouvrir(d.faEncaisser, 'paiement'); return; }
    if (d.faCommission) { if (window.Compte && Compte.adminCommission) Compte.adminCommission(d.faCommission, true, Number(d.pct) || 25); return; }
    if (d.fa === 'recharger') { charger(); return; }
    if (d.fa === 'rapport') { if (window.Compte && Compte.openRapportCompta) Compte.openRapportCompta(); return; }
    if (d.fa === 'fermer') { etat.choisi = null; etat.panneau = null; etat.message = null; afficher(); return; }
    if (d.fa === 'fermerPanneau') { etat.panneau = null; etat.brouillon = null; afficher(); return; }
    var f = etat.choisi ? trouver(etat.choisi) : null; if (!f || !d.faAction) return;
    etat.message = null;
    if (d.faAction === 'copier') return copier(f.delivery_url);
    if (d.faAction === 'relancer') return relancer(f.ref);
    if (d.faAction === 'client') { if (window.Compte && Compte.factFicheClient) Compte.factFicheClient(f.client, f.email || ''); return; }
    if (d.faAction === 'supprimer') { if (window.Compte && Compte.factDelete) Compte.factDelete(f.ref); return; }
    etat.brouillon = null;
    etat.panneau = etat.panneau === d.faAction ? null : d.faAction;
    afficher();
    var p = document.querySelector('#factAdminRoot .fa-panneau'); if (p) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  var minuteur;
  function surSaisie(e) {
    if (e.target.id === 'faRecherche') {
      etat.q = e.target.value; clearTimeout(minuteur);
      minuteur = setTimeout(function () {
        var pos = e.target.selectionStart; afficher();
        var c = document.getElementById('faRecherche'); if (c) { c.focus(); try { c.setSelectionRange(pos, pos); } catch (x) {} }
      }, 200);
    }
  }
  function surChangement(e) {
    var id = e.target.id, nom = e.target.name;
    if (id === 'faTri') { etat.tri = e.target.value; afficher(); return; }
    if (id === 'faFichier') {
      var fichier = e.target.files && e.target.files[0], b = etat.brouillon; if (!fichier || !b) return;
      if (TYPES.indexOf(fichier.type) < 0) { e.target.value = ''; return erreurForm('Justificatif : image (JPEG, PNG, WebP) ou PDF seulement.'); }
      if (fichier.size > TAILLE_MAX) { e.target.value = ''; return erreurForm('Justificatif trop lourd : 3 Mo au plus.'); }
      var lecteur = new FileReader();
      lecteur.onload = function () {
        lireFormulaire();
        b.fichier = { nom: fichier.name, type: fichier.type, taille: fichier.size, base64: String(lecteur.result).replace(/^data:[^,]*,/, '') };
        afficher();
      };
      lecteur.readAsDataURL(fichier);
      return;
    }
    // Le moyen, le justificatif ou le montant changent l'aide et les champs affichés : on redessine en gardant la saisie.
    if (nom === 'faMoyen' || nom === 'faJustif' || id === 'faMontant') { lireFormulaire(); afficher(); var c = document.getElementById(id); if (c && id === 'faMontant') c.focus(); }
  }

  window.FidiFactures = { charger: charger, ouvrir: ouvrir, situation: situation, MOYENS: MOYENS.map(function (m) { return m.id; }) };
})();
