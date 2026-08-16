// FIDI ACM — popup config
(async function () {
  var url = document.getElementById('fidiUrl');
  var tok = document.getElementById('fidiToken');
  var sent = document.getElementById('sent');
  var msg = document.getElementById('msg');

  var sync = await chrome.storage.sync.get(['fidiUrl', 'fidiToken']);
  url.value = sync.fidiUrl || 'https://fidi-etude-marche-app.netlify.app';
  tok.value = sync.fidiToken || '';
  var local = await chrome.storage.local.get('sent');
  sent.textContent = local.sent || 0;

  document.getElementById('save').addEventListener('click', async function () {
    var u = url.value.trim().replace(/\/+$/, '');
    var t = tok.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!u || !t) { msg.innerHTML = '<span class="err">⚠ URL et token requis.</span>'; return; }
    tok.value = t; url.value = u;
    await chrome.storage.sync.set({ fidiUrl: u, fidiToken: t });
    msg.innerHTML = '<span class="ok">✓ Configuration enregistrée. Notez le token pour l\'app FIDI.</span>';
  });

  document.getElementById('reset').addEventListener('click', async function () {
    await chrome.storage.local.set({ sent: 0 });
    sent.textContent = 0;
    try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
    msg.innerHTML = '<span class="ok">✓ Compteur remis à zéro.</span>';
  });
})();
