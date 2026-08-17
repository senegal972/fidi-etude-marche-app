// FIDI ACM — code partagé : bouton flottant + envoi vers background + toast.
// Les scripts spécifiques par site fournissent window.__fidiExtract() qui
// retourne l'objet annonce à envoyer.
(function () {
  'use strict';
  if (window.__fidiAcmInjected) return;
  window.__fidiAcmInjected = true;

  // Détecte vente / location depuis URL + texte page (utilitaire partagé)
  window.__fidiDetectNature = function () {
    var u = location.href.toLowerCase();
    if (/\blocations?\b|\blouer\b|\/location\/|\/locations\//.test(u)) return 'location';
    if (/\bventes?\b|\bachat\b|\bacheter\b|\/vente\/|\/ventes?_immobilieres|\/achat\//.test(u)) return 'vente';
    // Fallback : lit meta / titre pour "à louer" vs "à vendre"
    var t = (document.title || '').toLowerCase();
    if (/à louer|a louer|location|loyer/.test(t)) return 'location';
    return 'vente';
  };

  function toast(msg, err) {
    var old = document.getElementById('fidi-acm-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'fidi-acm-toast';
    if (err) t.className = 'fidi-err';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  function makeBtn() {
    if (document.getElementById('fidi-acm-btn')) return;
    var nature = window.__fidiDetectNature();
    var label = nature === 'location' ? 'Envoyer à FIDI (loyer)' : 'Envoyer à FIDI';
    var b = document.createElement('button');
    b.id = 'fidi-acm-btn';
    b.innerHTML = '<span class="fidi-icon">📥</span><span>' + label + '</span>';
    b.addEventListener('click', send);
    document.body.appendChild(b);
  }

  function send() {
    var btn = document.getElementById('fidi-acm-btn');
    if (!window.__fidiExtract) { toast('Extracteur absent pour ce site', true); return; }
    var data;
    try { data = window.__fidiExtract(); }
    catch (e) { toast('Extraction impossible : ' + e.message, true); return; }
    if (!data || (!data.prix && !data.loyer && !data.titre)) {
      toast('Aucune annonce détectée sur cette page', true); return;
    }
    data.url = data.url || location.href;
    if (!data.nature) data.nature = window.__fidiDetectNature();
    btn.disabled = true;
    var orig = btn.innerHTML;
    btn.innerHTML = '<span class="fidi-icon">⏳</span><span>Envoi…</span>';
    chrome.runtime.sendMessage({ type: 'FIDI_SEND', data: data }, function (resp) {
      btn.disabled = false;
      btn.innerHTML = orig;
      if (chrome.runtime.lastError) { toast('Extension déconnectée', true); return; }
      if (!resp || !resp.ok) { toast('Échec : ' + (resp && resp.error || 'inconnu'), true); return; }
      var kind = data.nature === 'location' ? 'loyer' : 'vente';
      toast('✓ Envoyé (' + kind + ', ' + resp.count + ' au total)');
    });
  }

  function boot() { setTimeout(makeBtn, 500); }
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);

  // Ré-injecte si la SPA re-render
  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // recréé pour changer le libellé si vente↔location
      var old = document.getElementById('fidi-acm-btn'); if (old) old.remove();
      setTimeout(makeBtn, 800);
    }
  }, 1000);
})();
