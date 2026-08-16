// FIDI ACM — code partagé : bouton flottant + envoi vers background + toast.
// Les scripts spécifiques par site fournissent window.__fidiExtract() qui
// retourne l'objet annonce à envoyer.
(function () {
  'use strict';
  if (window.__fidiAcmInjected) return;
  window.__fidiAcmInjected = true;

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
    var b = document.createElement('button');
    b.id = 'fidi-acm-btn';
    b.innerHTML = '<span class="fidi-icon">📥</span><span>Envoyer à FIDI</span>';
    b.addEventListener('click', send);
    document.body.appendChild(b);
  }

  function send() {
    var btn = document.getElementById('fidi-acm-btn');
    if (!window.__fidiExtract) { toast('Extracteur absent pour ce site', true); return; }
    var data;
    try { data = window.__fidiExtract(); }
    catch (e) { toast('Extraction impossible : ' + e.message, true); return; }
    if (!data || (!data.prix && !data.titre)) {
      toast('Aucune annonce détectée sur cette page', true); return;
    }
    data.url = data.url || location.href;
    btn.disabled = true;
    var orig = btn.innerHTML;
    btn.innerHTML = '<span class="fidi-icon">⏳</span><span>Envoi…</span>';
    chrome.runtime.sendMessage({ type: 'FIDI_SEND', data: data }, function (resp) {
      btn.disabled = false;
      btn.innerHTML = orig;
      if (chrome.runtime.lastError) { toast('Extension déconnectée', true); return; }
      if (!resp || !resp.ok) { toast('Échec : ' + (resp && resp.error || 'inconnu'), true); return; }
      toast('✓ Envoyé (' + resp.count + ' au total)');
    });
  }

  // Injecte quand le DOM est prêt (attend 500 ms sur SPA)
  function boot() { setTimeout(makeBtn, 500); }
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);

  // Ré-injecte si la SPA re-render (SeLoger, LBC changent l'URL sans reload)
  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(makeBtn, 800);
    }
  }, 1000);
})();
