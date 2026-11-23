/* ═══════════════════════════════════════════════════════════════════════════
   Écran de facturation « Nouvelle facture » (inspiré de la création de facture PayPal)
   - le contenu de la facture à gauche : client, articles (montant / quantité / heures),
     récapitulatif HT / remise / TVA / TTC recalculé à chaque frappe, note au client
   - ses options à droite : numéro, échéance, paiement préalable, canaux d'envoi, et la société
     émettrice (plusieurs possibles, recherche par SIRET / nom / dirigeant : emetteurs.js)
   - aperçu du document final avant création (POST /api/facture-html, rien n'est enregistré)
   - génération : POST /api/facture (totaux recalculés côté serveur), puis page de remise
     existante (factAfficherRemise, factGenDocLink, factHistoriqueClient dans index.html)

   Expose window.proposerFacture(kind) — appelé par le bouton « Facturer » de l'étude
   et par l'avis de valeur (window.__factureAvisCtx) — et window.FidiFactureCalc,
   miroir de netlify/functions/_facture_calc.mjs (mêmes règles, tests/facture-calc.test.mjs).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── Calcul (miroir de _facture_calc.mjs) ──────────────────────────────────
  var MAX_LIGNES = 30;
  function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function num(v) {
    var n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : Number(v);
    return isFinite(n) ? n : 0;
  }
  function txt(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
  function nettoyerLignes(lignes, mode) {
    if (!Array.isArray(lignes)) return [];
    return lignes.slice(0, MAX_LIGNES).map(function (l) {
      var o = l && typeof l === 'object' ? l : {};
      var quantite = mode === 'montant' ? 1 : Math.max(0, Math.min(100000, num(o.quantite)));
      var prixUnitaire = Math.max(0, Math.min(10000000, num(o.prixUnitaire)));
      return { designation: txt(o.designation, 200), description: txt(o.description, 1000), quantite: quantite, prixUnitaire: prixUnitaire };
    }).filter(function (l) { return l.designation || l.prixUnitaire > 0; });
  }
  function calculerFacture(entree) {
    var e = entree && typeof entree === 'object' ? entree : {};
    var mode = ['montant', 'quantite', 'heures'].indexOf(e.mode) >= 0 ? e.mode : 'quantite';
    var prixSaisis = e.prixSaisis === 'HT' ? 'HT' : 'TTC';
    var assujetti = !!(e.tva && e.tva.regime === 'assujetti');
    var taux = assujetti ? Math.max(0, Math.min(30, num(e.tva.taux))) : 0;
    var k = 1 + taux / 100;
    var lignes = nettoyerLignes(e.lignes, mode).map(function (l) {
      var montant = r2(l.quantite * l.prixUnitaire);
      return { designation: l.designation, description: l.description, quantite: l.quantite, prixUnitaire: l.prixUnitaire,
               montant: montant, prixUnitaireHT: prixSaisis === 'TTC' ? r2(l.prixUnitaire / k) : l.prixUnitaire,
               montantHT: prixSaisis === 'TTC' ? r2(montant / k) : montant };
    });
    var brut = r2(lignes.reduce(function (s, l) { return s + l.montant; }, 0));
    var remise = null, remiseMontant = 0;
    if (e.remise && num(e.remise.valeur) > 0) {
      var type = e.remise.type === 'eur' ? 'eur' : 'pct';
      var valeur = type === 'pct' ? Math.min(100, num(e.remise.valeur)) : num(e.remise.valeur);
      remiseMontant = r2(Math.min(brut, type === 'pct' ? brut * valeur / 100 : valeur));
      remise = { type: type, valeur: valeur };
      if (e.remise.nature === 'acompte' && type === 'eur') { remise.nature = 'acompte'; remise.reference = String(e.remise.reference == null ? '' : e.remise.reference).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60); }
    }
    var net = r2(brut - remiseMontant), ht, tva, ttc;
    if (prixSaisis === 'TTC') { ttc = net; ht = r2(ttc / k); tva = r2(ttc - ht); }
    else { ht = net; tva = r2(ht * taux / 100); ttc = r2(ht + tva); }
    // Écart d'arrondi reporté sur la dernière ligne (lignes HT − remise HT = total HT).
    var htAvantRemise = prixSaisis === 'TTC' ? r2(brut / k) : brut;
    if (lignes.length) {
      var ecart = r2(htAvantRemise - lignes.reduce(function (s, l) { return s + l.montantHT; }, 0));
      if (ecart) lignes[lignes.length - 1].montantHT = r2(lignes[lignes.length - 1].montantHT + ecart);
    }
    return { mode: mode, prixSaisis: prixSaisis, lignes: lignes, remise: remise,
             tva: { regime: assujetti ? 'assujetti' : 'franchise', taux: taux },
             totaux: { brut: brut, remise: remiseMontant, ht: ht, tva: tva, ttc: ttc,
                       htAvantRemise: htAvantRemise, remiseHT: r2(htAvantRemise - ht) } };
  }
  function libelleCourt(calc, repli) {
    var l = (calc && calc.lignes) || [];
    if (!l.length) return repli || '';
    return l[0].designation + (l.length > 1 ? ' (+' + (l.length - 1) + ' article' + (l.length > 2 ? 's' : '') + ')' : '');
  }
  window.FidiFactureCalc = { calculerFacture: calculerFacture, nettoyerLignes: nettoyerLignes, libelleCourt: libelleCourt };

  // ─── Utilitaires ───────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function eur(n) { return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function charte() { return (window.Marque && window.Marque.get()) || { enseigne: '', coordonnees: {}, facturation: {} }; }
  // Société émettrice choisie (emetteurs.js) ; sans société définie : mentions uniques de la charte.
  var gestion = null;
  function emetteur() { return gestion ? gestion.selection() : null; }
  function fact() {
    var e = emetteur(), fa = charte().facturation || {};
    if (e) return { regimeTva: e.regimeTva, tauxTva: e.tauxTva, delaiJours: fa.delaiJours };
    if (window.FidiEmetteurs && window.FidiEmetteurs.liste().length) return { delaiJours: fa.delaiJours };
    return fa;
  }

  var etat = null; // { ctx, lignes:[], mode, prixSaisis, remise, apercu }

  // ─── Ouverture ─────────────────────────────────────────────────────────────
  // kind : 'etude' | 'avis' | 'prestation' (demande d'une autre application, voir facture-externe.js)
  function proposerFacture(kind, demande) {
    var dm = kind === 'prestation' ? (demande || {}) : null;
    var label = kind === 'avis' ? 'Avis de valeur' : kind === 'etude' ? 'Étude de marché'
      : (String(dm.type_libelle || dm.source || 'Prestation').slice(0, 60));
    var d = window.__fidiData, inputs = window.__fidiInputs || {};
    var adresse = '', ref = '', client = '', email = '', telephone = '', htmlString = '';
    var doc = null;   // identité du document livré (débit du crédit), absente pour une prestation externe
    if (dm) {
      var dc = dm.client || {};
      client = dc.nom || ''; email = dc.email || ''; telephone = dc.telephone || '';
      adresse = dm.bien || ''; ref = dm.ref || '';
    } else if (kind === 'etude' && d) {
      var loc = d.localisation || {};
      adresse = loc.label || inputs.adresse || loc.city || '';
      ref = typeof window.etudeRef === 'function' ? window.etudeRef(d, inputs) : '';
      doc = typeof window.etudeDoc === 'function' ? window.etudeDoc() : null;
    } else if (kind === 'avis' && window.__factureAvisCtx) {
      var c = window.__factureAvisCtx;
      client = c.client || ''; email = c.email || ''; telephone = c.telephone || '';
      adresse = c.adresse || c.commune || ''; ref = c.ref || ''; htmlString = c.htmlString || '';
      doc = c.doc || null;
      window.__factureAvisCtx = null;
    }
    window.__factCtx = { kind: kind, label: label, ref: ref, client: client, email: email, telephone: telephone, adresse: adresse, htmlString: htmlString, doc: doc,
                         externe: !!dm, source: dm ? String(dm.source || '').slice(0, 60) : '', origine: dm ? dm._origine || '' : '',
                         lienDocument: dm ? String(dm.lien_document || '') : '' };
    window.__factRemise = null;
    etat = { ctx: window.__factCtx, lignes: [], mode: 'montant', prixSaisis: 'TTC', remise: null, remiseOuverte: false, apercu: false, lignesImposees: false };
    if (dm && Array.isArray(dm.lignes) && dm.lignes.length) {
      etat.lignes = dm.lignes.slice(0, MAX_LIGNES).map(function (l) {
        return { designation: txt(l.designation, 200), description: txt(l.description, 1000), quantite: num(l.quantite) || 1, prixUnitaire: num(l.prixUnitaire) || '' };
      });
      etat.mode = ['montant', 'quantite', 'heures'].indexOf(dm.mode) >= 0 ? dm.mode : 'quantite';
      etat.prixSaisis = dm.prixSaisis === 'HT' ? 'HT' : 'TTC';
      etat.lignesImposees = true;
    }
    if (typeof bootstrap === 'undefined') return;

    var root = $('factureRoot');
    if (!root) { root = document.createElement('div'); root.id = 'factureRoot'; document.body.appendChild(root); }
    root.innerHTML = gabarit(label, client, email, telephone, adresse);
    var el = $('factureModal');
    if (dm) {
      // Demande d'une autre application : provenance affichée, champs et options pré-remplis.
      var st = el.querySelector('.fx-sous-titre');
      if (st) st.textContent = label + ' · demandée par ' + (window.__factCtx.source || 'une application') +
        (window.__factCtx.origine && window.__factCtx.origine !== 'lien direct' ? ' (' + window.__factCtx.origine.replace(/^https?:\/\//, '') + ')' : '');
      if (dm.client && dm.client.adresse) $('fxAdresseClient').value = String(dm.client.adresse).slice(0, 200);
      if (dm.notes) { $('fxNotes').value = String(dm.notes).slice(0, 1000); $('fxNotesN').textContent = $('fxNotes').value.length + '/1000'; }
      var rm = el.querySelector('input[name="fxMode"][value="' + etat.mode + '"]'); if (rm) rm.checked = true;
      var rp = el.querySelector('input[name="fxPrix"][value="' + etat.prixSaisis + '"]'); if (rp) rp.checked = true;
      rendreLignes();
    }
    el.addEventListener('hidden.bs.modal', function () { el.remove(); document.removeEventListener('marque:change', majEmetteur); });
    if (typeof window.fidiStackModal === 'function') window.fidiStackModal(el);
    brancher(el);
    document.addEventListener('marque:change', majEmetteur);
    gestion = window.FidiEmetteurs ? window.FidiEmetteurs.monter($('fxEmetteurs'), { onChange: majEmetteur }) : null;
    majEcheanceDefaut();
    var m0 = new bootstrap.Modal(el);
    // Aucune société enregistrée : la recherche s'ouvre d'emblée, une fois la fenêtre affichée.
    if (gestion && !emetteur()) el.addEventListener('shown.bs.modal', function () { gestion.ajouter(); }, { once: true });
    m0.show();
    chargerTarifs(kind, label);
  }

  function gabarit(label, client, email, telephone, adresse) {
    return '' +
    '<div class="modal fade fx-modal" id="factureModal" tabindex="-1" aria-labelledby="fxTitre"><div class="modal-dialog modal-xl modal-fullscreen-lg-down modal-dialog-scrollable"><div class="modal-content">' +
    '<div class="modal-header fx-head">' +
      '<div><h5 class="modal-title" id="fxTitre">Nouvelle facture</h5><div class="fx-sous-titre">' + esc(label) + '</div></div>' +
      '<div class="fx-head-actions">' +
        '<button type="button" class="fx-pill fx-pill-ghost" id="fxBtnApercu"><i class="bi bi-eye me-1"></i>Aperçu</button>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button>' +
      '</div></div>' +
    '<div class="modal-body fx-body" id="factBody">' +
      '<div class="fx-grid" id="fxEdition">' +
        '<div class="fx-main">' +
          // Client
          '<section class="fx-card" aria-labelledby="fxTClient"><h6 class="fx-card-t" id="fxTClient">Facturer à</h6>' +
            '<div class="row g-2">' +
              '<div class="col-12"><label class="fx-label" for="factClient">Nom du client</label>' +
                '<input class="form-control fx-input" id="factClient" value="' + esc(client) + '" placeholder="Nom Prénom ou Société"></div>' +
              '<div class="col-md-6"><label class="fx-label" for="factEmail">E-mail</label>' +
                '<input class="form-control fx-input" id="factEmail" type="email" value="' + esc(email) + '" placeholder="client@exemple.com"></div>' +
              '<div class="col-md-6"><label class="fx-label" for="factTel">Téléphone (WhatsApp)</label>' +
                '<input class="form-control fx-input" id="factTel" type="tel" value="' + esc(telephone) + '" placeholder="+596 6 96 …"></div>' +
              '<div class="col-md-6"><label class="fx-label" for="fxAdresseClient">Adresse du client <span class="fx-fac">facultatif</span></label>' +
                '<input class="form-control fx-input" id="fxAdresseClient" placeholder="Obligatoire si le client est un professionnel"></div>' +
              '<div class="col-md-6"><label class="fx-label" for="factAdresse">Bien concerné</label>' +
                '<input class="form-control fx-input" id="factAdresse" value="' + esc(adresse) + '" placeholder="Commune ou adresse du bien"></div>' +
            '</div></section>' +
          // Articles
          '<section class="fx-card" aria-labelledby="fxTArticles">' +
            '<div class="fx-card-head"><h6 class="fx-card-t mb-0" id="fxTArticles">Articles</h6>' +
              '<div class="fx-seg fx-seg-sm" role="radiogroup" aria-label="Prix saisis">' +
                '<input type="radio" class="btn-check" name="fxPrix" id="fxPrixTTC" value="TTC" checked><label for="fxPrixTTC">Prix TTC</label>' +
                '<input type="radio" class="btn-check" name="fxPrix" id="fxPrixHT" value="HT"><label for="fxPrixHT">Prix HT</label>' +
              '</div></div>' +
            '<div class="fx-modes" role="radiogroup" aria-label="Type de facturation">' +
              '<label><input type="radio" name="fxMode" value="montant" checked> Montant uniquement</label>' +
              '<label><input type="radio" name="fxMode" value="quantite"> Quantité</label>' +
              '<label><input type="radio" name="fxMode" value="heures"> Heures</label>' +
            '</div>' +
            '<div id="factTarifsBox" class="fx-tarifs"><span class="text-muted small"><span class="spinner-border spinner-border-sm me-1"></span>Chargement de la grille tarifaire…</span></div>' +
            '<div id="fxLignes"></div>' +
            '<button type="button" class="fx-link" id="fxAjouter"><i class="bi bi-plus-lg"></i> Ajouter un article</button>' +
            '<dl class="fx-totaux" id="fxTotaux"></dl>' +
          '</section>' +
          // Note
          '<section class="fx-card" aria-labelledby="fxTNote"><h6 class="fx-card-t" id="fxTNote">Note à l\'attention du client <span class="fx-fac">facultatif</span></h6>' +
            '<textarea class="form-control fx-input" id="fxNotes" rows="3" maxlength="1000" placeholder="Ex : merci de votre confiance — règlement par virement."></textarea>' +
            '<div class="fx-compteur" id="fxNotesN">0/1000</div></section>' +
        '</div>' +
        // Colonne d'options
        '<aside class="fx-side">' +
          '<section class="fx-card" aria-labelledby="fxTOptions"><h6 class="fx-card-t" id="fxTOptions">Options de facture</h6>' +
            '<div class="fx-tile"><i class="bi bi-hash"></i><div><div class="fx-tile-t">Numéro</div><div class="fx-tile-s">Attribué à la création (suite chronologique)</div></div></div>' +
            '<div class="fx-tile"><i class="bi bi-calendar-event"></i><div class="flex-grow-1"><label class="fx-tile-t" for="fxEcheance">Échéance</label>' +
              '<select class="form-select form-select-sm mt-1" id="fxEcheance">' +
                '<option value="0">À réception</option><option value="15">15 jours</option><option value="30">30 jours</option>' +
                '<option value="45">45 jours</option><option value="60">60 jours</option></select>' +
              '<div class="fx-tile-s" id="fxEcheanceDate"></div></div></div>' +
            '<div class="fx-tile"><i class="bi bi-credit-card"></i><div class="flex-grow-1">' +
              '<div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" id="factPayReq" checked>' +
              '<label class="form-check-label fx-tile-t" for="factPayReq">Paiement préalable</label></div>' +
              '<div class="fx-tile-s" id="factPayHint">Le client règle en ligne (carte / PayPal) avant de recevoir la facture et le document.</div></div></div>' +
            '<div class="fx-tile"><i class="bi bi-send"></i><div><div class="fx-tile-t">Envoi</div>' +
              '<div class="d-flex gap-3 mt-1 small">' +
                '<div class="form-check m-0"><input class="form-check-input" type="checkbox" id="factCanEmail" checked><label class="form-check-label" for="factCanEmail">E-mail</label></div>' +
                '<div class="form-check m-0"><input class="form-check-input" type="checkbox" id="factCanWa" checked><label class="form-check-label" for="factCanWa">WhatsApp</label></div>' +
              '</div></div></div>' +
            '<h6 class="fx-sub">Émetteur</h6>' +
            '<div id="fxEmetteurs" class="fx-emetteur"></div>' +
            '<div class="fx-total-side"><span>Montant dû</span><strong id="fxTotalSide">0,00 €</strong></div>' +
            '<div id="factStatus" class="mt-2"></div>' +
          '</section>' +
        '</aside>' +
      '</div>' +
      '<div class="d-none fx-apercu" id="fxApercu"><iframe title="Aperçu de la facture" id="fxApercuFrame"></iframe></div>' +
    '</div>' +
    '<div class="modal-footer fx-foot">' +
      '<button type="button" class="btn btn-outline-primary btn-sm" onclick="factHistoriqueClient()"><i class="bi bi-clock-history me-1"></i>Historique client</button>' +
      '<div class="d-flex gap-2">' +
        '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Fermer</button>' +
        '<button type="button" class="btn btn-sm fw-bold fx-btn-ok" id="factBtnOk"><i class="bi bi-send me-1"></i>Créer &amp; préparer l\'envoi</button>' +
      '</div></div>' +
    '</div></div></div>';
  }

  // ─── Événements ────────────────────────────────────────────────────────────
  // Remise ou acompte déjà facturé : le menu propose « % », « € » et « € — acompte déjà versé ».
  function lireRemise() {
    var choix = ($('fxRemiseType') || {}).value || 'pct', valeur = ($('fxRemiseVal') || {}).value || 0;
    if (choix === 'acompte') return { type: 'eur', valeur: valeur, nature: 'acompte', reference: ($('fxRemiseRef') || {}).value || (etat.remise && etat.remise.reference) || '' };
    return { type: choix, valeur: valeur };
  }

  function brancher(el) {
    el.addEventListener('input', function (e) {
      var i = e.target.getAttribute('data-l');
      if (i !== null) { etat.lignes[+i][e.target.getAttribute('data-k')] = e.target.value; recalculer(); return; }
      if (e.target.id === 'fxRemiseVal') { etat.remise = lireRemise(); recalculer(); }
      if (e.target.id === 'fxRemiseRef') { etat.remise = lireRemise(); }
      if (e.target.id === 'fxNotes') $('fxNotesN').textContent = e.target.value.length + '/1000';
    });
    el.addEventListener('change', function (e) {
      if (e.target.name === 'fxMode') { etat.mode = e.target.value; rendreLignes(); }
      else if (e.target.name === 'fxPrix') { etat.prixSaisis = e.target.value; rendreLignes(); }
      else if (e.target.id === 'fxRemiseType') { etat.remise = lireRemise(); document.activeElement && document.activeElement.blur(); recalculer(); }
      else if (e.target.id === 'fxEcheance') majEcheanceDate();
      else if (e.target.id === 'factPayReq') {
        $('factPayHint').textContent = e.target.checked
          ? 'Le client règle en ligne (carte / PayPal) avant de recevoir la facture et le document.'
          : 'Envoi immédiat : le client reçoit la facture et le document sans condition de paiement.';
      }
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-action]');
      if (!b) return;
      var a = b.getAttribute('data-action'), i = +b.getAttribute('data-i');
      if (a === 'suppr') { etat.lignes.splice(i, 1); rendreLignes(); }
      else if (a === 'desc') { etat.lignes[i].descOuverte = true; rendreLignes(); var t = document.querySelector('[data-l="' + i + '"][data-k="description"]'); if (t) t.focus(); }
      else if (a === 'tarif') { ajouterLigne(b.getAttribute('data-nom'), num(b.getAttribute('data-prix'))); }
      else if (a === 'remise') { etat.remiseOuverte = true; recalculer(); var r = $('fxRemiseVal'); if (r) r.focus(); }
      else if (a === 'remise-suppr') { etat.remiseOuverte = false; etat.remise = null; recalculer(); }
    });
    $('fxAjouter').addEventListener('click', function () { ajouterLigne('', 0, true); });
    $('fxBtnApercu').addEventListener('click', basculerApercu);
    $('factBtnOk').addEventListener('click', generer);
  }

  // ─── Articles ──────────────────────────────────────────────────────────────
  function ajouterLigne(designation, prix, focus) {
    if (etat.lignes.length >= MAX_LIGNES) return;
    // La première prestation de la grille remplace la ligne vide de départ.
    var vide = etat.lignes.length === 1 && !etat.lignes[0].designation && !num(etat.lignes[0].prixUnitaire);
    var l = { designation: designation || '', description: '', quantite: 1, prixUnitaire: prix || '' };
    if (vide && designation) etat.lignes[0] = l; else etat.lignes.push(l);
    rendreLignes();
    if (focus) { var x = document.querySelector('[data-l="' + (etat.lignes.length - 1) + '"][data-k="designation"]'); if (x) x.focus(); }
  }
  function rendreLignes() {
    var box = $('fxLignes');
    var heures = etat.mode === 'heures', montantSeul = etat.mode === 'montant';
    var base = etat.prixSaisis;
    box.innerHTML = etat.lignes.map(function (l, i) {
      return '<div class="fx-ligne">' +
        '<div class="fx-ligne-row">' +
          '<div class="fx-c-des"><label class="fx-label" for="fxD' + i + '">Désignation</label>' +
            '<input class="form-control fx-input" id="fxD' + i + '" data-l="' + i + '" data-k="designation" value="' + esc(l.designation) + '" maxlength="200" placeholder="Prestation"></div>' +
          (montantSeul ? '' :
          '<div class="fx-c-q"><label class="fx-label" for="fxQ' + i + '">' + (heures ? 'Heures' : 'Qté') + '</label>' +
            '<input class="form-control fx-input text-end" id="fxQ' + i + '" data-l="' + i + '" data-k="quantite" value="' + esc(l.quantite) + '" inputmode="decimal"></div>') +
          '<div class="fx-c-p"><label class="fx-label" for="fxP' + i + '">' + (montantSeul ? 'Montant ' : (heures ? 'Taux horaire ' : 'Prix unitaire ')) + base + '</label>' +
            '<input class="form-control fx-input text-end" id="fxP' + i + '" data-l="' + i + '" data-k="prixUnitaire" value="' + esc(l.prixUnitaire) + '" inputmode="decimal" placeholder="0,00"></div>' +
          '<button type="button" class="fx-suppr" data-action="suppr" data-i="' + i + '" title="Retirer cet article" aria-label="Retirer l\'article ' + (i + 1) + '"><i class="bi bi-trash"></i></button>' +
        '</div>' +
        (l.descOuverte || l.description
          ? '<textarea class="form-control fx-input mt-2" rows="2" maxlength="1000" data-l="' + i + '" data-k="description" placeholder="Description (facultatif)">' + esc(l.description) + '</textarea>'
          : '<button type="button" class="fx-link fx-link-sm" data-action="desc" data-i="' + i + '"><i class="bi bi-plus"></i> Description</button>') +
        '<div class="fx-ligne-total" id="fxLT' + i + '"></div>' +
      '</div>';
    }).join('');
    recalculer();
  }
  function entree() {
    var f = fact();
    return { lignes: etat.lignes, mode: etat.mode, prixSaisis: etat.prixSaisis, remise: etat.remise,
             tva: { regime: f.regimeTva || 'franchise', taux: f.tauxTva } };
  }

  // ─── Récapitulatif en direct ───────────────────────────────────────────────
  function recalculer() {
    var calc = calculerFacture(entree()), t = calc.totaux, f = fact();
    // Totaux de ligne (la ligne vide n'est pas comptée mais garde sa place).
    etat.lignes.forEach(function (l, i) {
      var x = $('fxLT' + i); if (!x) return;
      var m = r2((etat.mode === 'montant' ? 1 : num(l.quantite)) * num(l.prixUnitaire));
      x.textContent = m > 0 ? 'Total : ' + eur(m) + ' ' + etat.prixSaisis : '';
    });
    var rows = [];
    rows.push(ligneTot('Sous-total ' + etat.prixSaisis, eur(t.brut)));
    if (etat.remiseOuverte || t.remise > 0) {
      var r = etat.remise || { type: 'pct', valeur: '' };
      var acompte = r.nature === 'acompte';
      rows.push('<div class="fx-tot fx-tot-remise"><dt>' + (acompte ? 'Acompte ' : 'Remise ') +
        '<span class="fx-remise-in"><input id="fxRemiseVal" class="form-control form-control-sm text-end" inputmode="decimal" value="' + esc(r.valeur) + '" aria-label="Valeur de la remise">' +
        '<select id="fxRemiseType" class="form-select form-select-sm" aria-label="Type de remise"><option value="pct"' + (r.type === 'pct' ? ' selected' : '') + '>%</option><option value="eur"' + (r.type === 'eur' && !acompte ? ' selected' : '') + '>€</option><option value="acompte"' + (acompte ? ' selected' : '') + '>€ — acompte déjà versé</option></select>' +
        '<button type="button" class="fx-suppr" data-action="remise-suppr" title="Retirer la remise" aria-label="Retirer la remise"><i class="bi bi-x-lg"></i></button></span></dt>' +
        '<dd>− ' + eur(t.remise) + '</dd></div>');
      if (acompte) rows.push('<div class="fx-tot fx-tot-acompte"><dt><label for="fxRemiseRef">N° de la facture d\'acompte</label></dt><dd><input id="fxRemiseRef" class="form-control form-control-sm" maxlength="60" placeholder="ex : FF-FAC-2026-004" value="' + esc(r.reference || '') + '"></dd></div>');
    } else {
      rows.push('<div class="fx-tot"><dt>Remise sur la facture</dt><dd><button type="button" class="fx-link" data-action="remise">Ajouter</button></dd></div>');
    }
    rows.push(ligneTot('Total HT', eur(t.ht)));
    if (!f.regimeTva) rows.push('<div class="fx-tot fx-tot-alerte"><dt>TVA</dt><dd><button type="button" class="fx-link" data-action-tva>' + (emetteur() ? 'Régime à choisir' : 'Société émettrice à ajouter') + '</button></dd></div>');
    else if (f.regimeTva === 'assujetti') rows.push(ligneTot('TVA ' + String(calc.tva.taux).replace('.', ',') + ' %', eur(t.tva)));
    else rows.push(ligneTot('TVA non applicable (art. 293 B du CGI)', '0,00 €'));
    rows.push('<div class="fx-tot fx-tot-ttc"><dt>Montant dû <small>(TTC)</small></dt><dd>' + eur(t.ttc) + '</dd></div>');

    // Ne réécrit pas le bloc pendant la saisie de la remise (garde le focus).
    var actif = document.activeElement && document.activeElement.id;
    var box = $('fxTotaux');
    if (actif === 'fxRemiseVal' || actif === 'fxRemiseType' || actif === 'fxRemiseRef') {
      box.querySelectorAll('dd').forEach(function (dd, i) { var tmp = document.createElement('div'); tmp.innerHTML = rows[i] || ''; var n = tmp.querySelector('dd'); if (n && i !== 1) dd.innerHTML = n.innerHTML; });
      var rd = box.querySelector('.fx-tot-remise dd'); if (rd) rd.textContent = '− ' + eur(t.remise);
    } else {
      box.innerHTML = rows.join('');
      var bt = box.querySelector('[data-action-tva]'); if (bt) bt.addEventListener('click', function () { if (gestion) gestion.modifier(); });
    }
    $('fxTotalSide').textContent = eur(t.ttc);
    majBouton(calc);
    return calc;
  }
  function ligneTot(dt, dd) { return '<div class="fx-tot"><dt>' + dt + '</dt><dd>' + dd + '</dd></div>'; }
  function majBouton(calc) {
    var b = $('factBtnOk'); if (!b) return;
    b.disabled = !fact().regimeTva || !(calc.totaux.ttc > 0);
    b.title = !fact().regimeTva ? (emetteur() ? 'Choisissez d\'abord le régime de TVA de la société émettrice' : 'Ajoutez d\'abord une société émettrice')
      : !(calc.totaux.ttc > 0) ? 'Ajoutez au moins un article avec un montant' : '';
  }

  // ─── Échéance ──────────────────────────────────────────────────────────────
  function majEcheanceDefaut() {
    var j = fact().delaiJours; var s = $('fxEcheance');
    if (s && j != null && s.querySelector('option[value="' + j + '"]')) s.value = String(j);
    majEcheanceDate();
  }
  function echeanceJours() { return parseInt(($('fxEcheance') || {}).value, 10) || 0; }
  function majEcheanceDate() {
    var j = echeanceJours(), d = new Date(Date.now() + j * 86400000);
    $('fxEcheanceDate').textContent = j ? 'Due le ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Due dès réception';
  }

  // ─── Émetteur ──────────────────────────────────────────────────────────────
  // La gestion des sociétés (choix, recherche, fiche) est dans emetteurs.js ; ici, on recalcule
  // simplement la facture quand la société ou ses mentions changent.
  function majEmetteur() { if (etat && $('fxTotaux')) recalculer(); }

  // ─── Données envoyées (aperçu et création) ─────────────────────────────────
  function val(id) { return (($(id) || {}).value || '').trim(); }
  function donneesApercu() {
    var m = charte();
    var auj = new Date().toISOString().slice(0, 10);
    return {
      numero: '', date: auj, echeance: new Date(Date.now() + echeanceJours() * 86400000).toISOString().slice(0, 10),
      client: { nom: val('factClient'), email: val('factEmail'), telephone: val('factTel'), adresse: val('fxAdresseClient') },
      bien: val('factAdresse'), refDossier: (etat.ctx || {}).ref || '', notes: val('fxNotes'),
      facture: entree(),
      emetteur: window.FidiEmetteurs ? window.FidiEmetteurs.pourDocument(emetteur())
        : { enseigne: m.enseigne, logo: m.logo, couleurs: m.couleurs, coordonnees: m.coordonnees, facturation: m.facturation }
    };
  }

  // ─── Aperçu ────────────────────────────────────────────────────────────────
  function basculerApercu() {
    etat.apercu = !etat.apercu;
    $('fxEdition').classList.toggle('d-none', etat.apercu);
    $('fxApercu').classList.toggle('d-none', !etat.apercu);
    $('fxBtnApercu').innerHTML = etat.apercu ? '<i class="bi bi-pencil me-1"></i>Modifier' : '<i class="bi bi-eye me-1"></i>Aperçu';
    if (!etat.apercu) return;
    var frame = $('fxApercuFrame');
    frame.srcdoc = '<p style="font-family:sans-serif;color:#666;padding:24px">Préparation de l\'aperçu…</p>';
    fetch('/api/facture-html', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donneesApercu()) })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, t: t }; }); })
      .then(function (x) {
        frame.srcdoc = x.ok ? x.t : '<p style="font-family:sans-serif;color:#9a3412;padding:24px">' +
          (x.status === 401 ? 'Connectez-vous pour afficher l\'aperçu.' : 'Aperçu indisponible (HTTP ' + x.status + ').') + '</p>';
      })
      .catch(function () { frame.srcdoc = '<p style="font-family:sans-serif;color:#9a3412;padding:24px">Aperçu indisponible (réseau).</p>'; });
  }

  // ─── Grille tarifaire ──────────────────────────────────────────────────────
  function chargerTarifs(kind, label) {
    var wantCat = kind === 'avis' ? 'Avis de valeur' : kind === 'etude' ? 'Étude de marché' : '';
    var defMontant = kind === 'avis' ? 250 : kind === 'etude' ? 450 : 0;
    fetch('/api/tarifs', { credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .catch(function () { return {}; })
      .then(function (j) {
        var tarifs = (j && j.ok && j.tarifs) || [];
        var list = tarifs.filter(function (t) { return t.categorie === wantCat || t.categorie === 'Option' || t.categorie === 'Forfait'; });
        var box = $('factTarifsBox'); if (!box) return;
        var designationDefaut = label + (etat.ctx.adresse ? ' — ' + etat.ctx.adresse : '');
        if (!list.length) {
          box.innerHTML = '<span class="text-muted small">Aucune grille tarifaire configurée : saisissez les articles ci-dessous.</span>';
          if (!etat.lignesImposees) etat.lignes = [{ designation: designationDefaut, description: '', quantite: 1, prixUnitaire: defMontant || '' }];
          rendreLignes(); return;
        }
        box.innerHTML = '<span class="fx-tarifs-t">Ajouter depuis la grille :</span>' + list.map(function (t) {
          return '<button type="button" class="fx-chip" data-action="tarif" data-nom="' + esc(t.prestation) + '" data-prix="' + esc(t.prix) + '">' +
            esc(t.prestation) + ' · <b>' + esc(t.prix) + ' €</b></button>';
        }).join('');
        if (etat.lignesImposees) { rendreLignes(); return; } // articles fournis par l'application d'origine
        var pref = list.filter(function (t) { return t.categorie === wantCat; })[0] || list[0];
        etat.lignes = [{ designation: pref ? pref.prestation + (etat.ctx.adresse ? ' — ' + etat.ctx.adresse : '') : designationDefaut,
                         description: '', quantite: 1, prixUnitaire: pref ? pref.prix : defMontant }];
        rendreLignes();
      });
  }

  // ─── Création de la facture ────────────────────────────────────────────────
  function generer() {
    var ctx = window.__factCtx || {};
    var btn = $('factBtnOk'), status = $('factStatus');
    var setStatus = function (h) { if (status) status.innerHTML = h; };
    var calc = calculerFacture(entree());
    if (!fact().regimeTva) { setStatus('<div class="alert alert-warning py-2 small mb-0">' + (emetteur() ? 'Choisissez d\'abord le régime de TVA de la société émettrice.' : 'Ajoutez d\'abord une société émettrice.') + '</div>'); return; }
    if (!(calc.totaux.ttc > 0)) { setStatus('<div class="alert alert-warning py-2 small mb-0">Ajoutez au moins un article avec un montant.</div>'); return; }
    var client = val('factClient'), email = val('factEmail'), tel = val('factTel'), adresse = val('factAdresse');
    if (!client) { setStatus('<div class="alert alert-warning py-2 small mb-0">Indiquez le nom du client (mention obligatoire de la facture).</div>'); var fc = $('factClient'); if (fc) fc.focus(); return; }
    var payReq = !!($('factPayReq') || {}).checked;
    var canal = ['Lien'];
    if (($('factCanEmail') || {}).checked) canal.push('Email');
    if (($('factCanWa') || {}).checked) canal.push('WhatsApp');
    var libelle = libelleCourt(calc, ctx.label);

    // Le document livré au client (étude, avis) est un acte facturé, comme l'impression :
    // 1 crédit, sauf si ce document a déjà été édité. Une prestation externe ne livre pas de document.
    var C = window.Compte;
    var droit = (C && ctx.doc && ctx.kind !== 'prestation')
      ? (C.confirmerCredit('Générer le document à livrer : 1 crédit, sauf s\'il a déjà été édité. Continuer ?')
          ? C.consume(ctx.doc.kind, ctx.doc.ref, ctx.doc.cle) : Promise.resolve(false))
      : Promise.resolve(true);

    Promise.resolve(droit).then(function (autorise) {
      if (!autorise) return null;
      if (btn) btn.disabled = true;
      setStatus('<div class="alert alert-info py-2 small mb-0"><span class="spinner-border spinner-border-sm me-1"></span>Génération du document…</div>');
      // Prestation d'une autre application : pas de document de l'étude à joindre (lien éventuel fourni par elle).
      var genDoc = ctx.kind === 'prestation' ? Promise.resolve(ctx.lienDocument || '')
        : typeof window.factGenDocLink === 'function' ? window.factGenDocLink(ctx) : Promise.resolve('');
      return Promise.resolve(genDoc).catch(function () { return ''; });
    }).then(function (lienDoc) {
      if (lienDoc === null) return;   // crédit refusé ou annulé : rien n'est créé
      setStatus(lienDoc
        ? '<div class="alert alert-info py-2 small mb-0"><span class="spinner-border spinner-border-sm me-1"></span>Création de la facture…</div>'
        : '<div class="alert alert-warning py-2 small mb-0"><i class="bi bi-exclamation-triangle me-1"></i>Document non joint automatiquement ; la facture est créée quand même.</div>');
      var payload = {
        kind: ctx.kind, ref: ctx.ref, client: client, email_client: email, telephone: tel,
        type_libelle: ctx.kind === 'prestation' ? ctx.label : '', source: ctx.source || '',
        adresse: adresse, commune: adresse, montant: calc.totaux.ttc, libelle: libelle,
        paiement_requis: payReq, canal: canal, lien_document: lienDoc || '',
        facture: { lignes: calc.lignes.map(function (l) { return { designation: l.designation, description: l.description, quantite: l.quantite, prixUnitaire: l.prixUnitaire }; }),
                   mode: calc.mode, prixSaisis: calc.prixSaisis, remise: calc.remise },
        echeance_jours: echeanceJours(), notes: val('fxNotes'), client_adresse: val('fxAdresseClient'),
        emetteur_id: (emetteur() || {}).id || '', charte: charte()
      };
      return fetch('/api/facture', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (x) {
          var r = x.r, j = x.j || {};
          if (r.status === 409 && j.autre_emetteur) {
            setStatus('<div class="alert alert-warning py-2 small mb-0"><i class="bi bi-building me-1"></i>' + esc(j.error) + '</div>');
            if (btn) btn.disabled = false; return;
          }
          if (r.status === 409 && j.locked) {
            setStatus('<div class="alert alert-warning py-2 small mb-0"><i class="bi bi-lock-fill me-1"></i><strong>Facture N° ' + esc(j.ref) + ' au statut « ' + esc(j.statut) + ' » — non modifiable.</strong><br>' +
              esc(j.hint || '') + ' ' + (j.delivery_url ? '<a href="' + esc(j.delivery_url) + '" target="_blank" class="alert-link">Voir la facture existante</a>' : '') + '</div>');
            if (btn) btn.disabled = false; return;
          }
          if (!r.ok || !j.ok) {
            setStatus('<div class="alert alert-danger py-2 small mb-0">Erreur : ' + esc(j.error || 'création de la facture impossible') + '</div>');
            if (btn) btn.disabled = false; return;
          }
          window.__factRemise = Object.assign({}, j, { client: client, email: email, tel: tel, libelle: j.libelle || libelle,
            montant: j.montant, payReq: payReq, lienDoc: lienDoc || '', adresse: adresse, kind: ctx.kind, label: ctx.label });
          // La page de remise remplace le contenu : on revient à une fenêtre de taille normale.
          var dlg = document.querySelector('#factureModal .modal-dialog'); if (dlg) dlg.classList.remove('modal-xl');
          var ap = $('fxBtnApercu'); if (ap) ap.remove();
          if (typeof window.factAfficherRemise === 'function') window.factAfficherRemise();
          if (ctx.externe && window.FidiFactureExterne) window.FidiFactureExterne.signalerCreation(j);
        });
    }).catch(function (e) {
      setStatus('<div class="alert alert-danger py-2 small mb-0">Erreur réseau : ' + esc(e && e.message) + '</div>');
      if (btn) btn.disabled = false;
    });
  }

  window.proposerFacture = proposerFacture;
})();
