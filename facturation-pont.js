/* ═══════════════════════════════════════════════════════════════════════════
   Pont de facturation — à inclure dans les AUTRES applications (REA, Fiche découverte,
   HomeStaging PRO, pilotage de chantier…) pour établir une facture dans le service central
   de l'Étude de marché, avec sa numérotation, ses sociétés émettrices et sa charte.

     <script src="https://fidi-etude-marche-app.netlify.app/facturation-pont.js"></script>

     FidiFacturation.ouvrir({
       source: 'REA', type_libelle: 'Mandat', ref: 'REA-MANDAT-123',      // ref : identifiant unique
       client: { nom, email, telephone, adresse }, bien: '12 rue …',
       lignes: [{ designation, description, quantite, prixUnitaire }],    // prix TTC par défaut
       prixSaisis: 'TTC', mode: 'quantite', notes: '', lien_document: '',
       onCreee: function (facture) { … },   // { ref, token, montant, delivery_url }
       onFermee: function () { … }
     });

   Une fenêtre du service central s'ouvre (connexion FIDI si besoin), pré-remplie : l'utilisateur
   vérifie et crée la facture. Les données passent par postMessage, jamais dans l'adresse.
   Pour une application mobile sans fenêtre : FidiFacturation.lienDirect(demande) donne une adresse
   à ouvrir dans le navigateur (données dans le fragment #, non transmis aux serveurs).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var script = document.currentScript;
  var CENTRALE = (function () {
    try { return new URL(script && script.src ? script.src : 'https://fidi-etude-marche-app.netlify.app/').origin; }
    catch (e) { return 'https://fidi-etude-marche-app.netlify.app'; }
  })();

  // Ne transmet que des données (pas de fonctions), bornées.
  function nettoyer(d) {
    var s = function (v, max) { return String(v == null ? '' : v).slice(0, max); };
    var c = d.client || {};
    return {
      source: s(d.source, 60), type_libelle: s(d.type_libelle, 60), ref: s(d.ref, 120),
      client: { nom: s(c.nom, 120), email: s(c.email, 120), telephone: s(c.telephone, 40), adresse: s(c.adresse, 200) },
      bien: s(d.bien, 200), notes: s(d.notes, 1000), lien_document: s(d.lien_document, 500),
      prixSaisis: d.prixSaisis === 'HT' ? 'HT' : 'TTC',
      mode: ['montant', 'quantite', 'heures'].indexOf(d.mode) >= 0 ? d.mode : 'quantite',
      lignes: (Array.isArray(d.lignes) ? d.lignes : []).slice(0, 30).map(function (l) {
        return { designation: s(l.designation, 200), description: s(l.description, 1000),
                 quantite: Number(l.quantite) || 1, prixUnitaire: Number(l.prixUnitaire) || 0 };
      })
    };
  }

  function ouvrir(demande) {
    demande = demande || {};
    var donnees = nettoyer(demande);
    var w = window.open(CENTRALE + '/?facturer=1', 'fidi-facture', 'width=1240,height=900');
    if (!w) return { ok: false, erreur: 'La fenêtre de facturation a été bloquée par le navigateur : autorisez les fenêtres pour ce site.' };
    var envoyee = false;
    function ecoute(ev) {
      if (ev.origin !== CENTRALE || ev.source !== w || !ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'fidi:facture-prete' && !envoyee) {
        envoyee = true;
        w.postMessage({ type: 'fidi:facture-demande', demande: donnees }, CENTRALE);
      } else if (ev.data.type === 'fidi:facture-creee') {
        if (typeof demande.onCreee === 'function') demande.onCreee(ev.data.facture || {});
      }
    }
    window.addEventListener('message', ecoute);
    var veille = setInterval(function () {
      if (w.closed) {
        clearInterval(veille);
        window.removeEventListener('message', ecoute);
        if (typeof demande.onFermee === 'function') demande.onFermee();
      }
    }, 800);
    return { ok: true, fenetre: w };
  }

  // Adresse directe (applications mobiles) : données encodées dans le fragment, effacé dès la lecture.
  function lienDirect(demande) {
    var json = JSON.stringify(nettoyer(demande || {}));
    var b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return CENTRALE + '/?facturer=1#facturer=' + b64;
  }

  window.FidiFacturation = { ouvrir: ouvrir, lienDirect: lienDirect, centrale: CENTRALE, version: 1 };
})();
