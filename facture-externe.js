/* ═══════════════════════════════════════════════════════════════════════════
   Réception des demandes de facture venant des autres applications (facturation-pont.js)
   - mode actif quand l'adresse contient ?facturer=1
   - demande reçue par postMessage (origines autorisées ci-dessous) ou par le fragment
     #facturer=<base64url> (applications mobiles) — le fragment est effacé dès la lecture
   - ouvre « Nouvelle facture » pré-remplie (proposerFacture('prestation', demande)) une fois
     l'utilisateur connecté ; rien n'est créé sans son clic
   - renvoie la facture créée à l'application d'origine (signalerCreation, appelé par facture.js)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Applications autorisées à demander une facture (sites Netlify de l'exploitant, aperçus compris,
  // et développement local). Ajouter ici le domaine d'une nouvelle application.
  var ORIGINES = [
    /^https:\/\/([a-z0-9-]+--)?(manat-immo-express|pilotage-cafeiere|fiche-decouverte[a-z0-9-]*|homestaging[a-z0-9-]*|boussole[a-z0-9-]*|optimmo[a-z0-9-]*|fidi[a-z0-9-]*|rea[a-z0-9-]*)\.netlify\.app$/,
    /^https:\/\/(www\.)?optimmodom\.(fr|com)$/,
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
  ];
  function autorisee(o) { return ORIGINES.some(function (r) { return r.test(o); }); }

  var params = new URLSearchParams(location.search);
  var actif = params.get('facturer') === '1' || /^#facturer=/.test(location.hash);
  var demande = null, origineDemande = '', ouverte = false;

  function lireFragment() {
    var m = location.hash.match(/^#facturer=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try {
      var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = decodeURIComponent(escape(atob(b64 + '==='.slice((b64.length + 3) % 4))));
      return JSON.parse(json);
    } catch (e) { return null; }
    finally { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  }

  function connecte() { return !!(window.Compte && window.Compte.state && window.Compte.state.authenticated); }

  function tenterOuverture() {
    if (!demande || ouverte) return;
    if (!connecte() || typeof window.proposerFacture !== 'function' || typeof bootstrap === 'undefined') return;
    ouverte = true;
    demande._origine = origineDemande;
    window.proposerFacture('prestation', demande);
  }

  // Appelé par facture.js après la création : la facture repart vers l'application d'origine.
  function signalerCreation(f) {
    if (!origineDemande || origineDemande === 'lien direct' || !window.opener) return;
    try {
      window.opener.postMessage({ type: 'fidi:facture-creee', facture: {
        ref: f.ref || '', token: f.token || '', montant: f.montant || 0, delivery_url: f.delivery_url || '' } }, origineDemande);
    } catch (e) { /* fenêtre d'origine fermée */ }
  }

  if (actif) {
    var frag = lireFragment();
    if (frag) { demande = frag; origineDemande = 'lien direct'; }

    window.addEventListener('message', function (ev) {
      if (!ev.data || ev.data.type !== 'fidi:facture-demande' || demande) return;
      if (ev.source !== window.opener || !autorisee(ev.origin)) return;
      demande = ev.data.demande || {};
      origineDemande = ev.origin;
      tenterOuverture();
    });

    // Signal « prêt » répété quelques secondes : l'application d'origine écoute peut-être un peu plus tard.
    var essais = 0;
    var signal = setInterval(function () {
      essais++;
      if (demande || essais > 40 || !window.opener) { clearInterval(signal); return; }
      try { window.opener.postMessage({ type: 'fidi:facture-prete' }, '*'); } catch (e) { clearInterval(signal); }
    }, 500);

    document.addEventListener('fidi:compte', tenterOuverture);
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tenterOuverture, 300); });
    window.addEventListener('load', function () { setTimeout(tenterOuverture, 300); });
  }

  window.FidiFactureExterne = { actif: actif, signalerCreation: signalerCreation, autorisee: autorisee };
})();
