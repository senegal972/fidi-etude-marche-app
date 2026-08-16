// FIDI ACM — service worker : reçoit les annonces des content scripts,
// POST vers l'endpoint FIDI configuré.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'FIDI_SEND') {
    (async () => {
      try {
        const cfg = await chrome.storage.sync.get(['fidiUrl', 'fidiToken']);
        const url = (cfg.fidiUrl || '').replace(/\/$/, '') + '/api/comparables-inbox';
        const token = cfg.fidiToken || '';
        if (!cfg.fidiUrl || !token) throw new Error('Extension non configurée (clic sur icône).');

        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-FIDI-Token': token },
          body: JSON.stringify(msg.data),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j.error || ('HTTP ' + resp.status));

        // Compteur pour badge
        const cur = await chrome.storage.local.get('sent');
        const n = (cur.sent || 0) + 1;
        await chrome.storage.local.set({ sent: n });
        chrome.action.setBadgeText({ text: String(n), tabId: sender.tab && sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#1a3a6e' });

        sendResponse({ ok: true, count: j.count });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // async
  }
});

// Réinit badge à l'install
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});
