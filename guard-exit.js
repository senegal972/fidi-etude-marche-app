// ═══════════════════════════════════════════════════════════════════════════
// FIDI · Garde-fou sortie — protège les données non sauvegardées contre :
//   • fermeture d'onglet / F5 (dialogue natif beforeunload)
//   • bouton Retour Android/navigateur (modale custom 3 choix)
// API : window.FidiGuard.setDirty() / setClean() / isDirty()
// Hook facultatif : window.FidiGuard.saveHandler = async ()=>{ ... }
// Sinon appelle saveEtudeCloud() si présent.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var dirty = false;
  var modalOpen = false;

  window.FidiGuard = {
    setDirty: function () { dirty = true; },
    setClean: function () { dirty = false; },
    isDirty: function () { return dirty; },
    saveHandler: null, // remplaçable par le contexte (ex : avis)
  };

  // ── 1. Fermeture d'onglet / F5 / navigation externe : dialogue natif ──────
  // Le navigateur affiche son propre message (texte non customisable depuis
  // Chrome 51+). C'est un garde-fou standard, minimal mais efficace.
  window.addEventListener('beforeunload', function (e) {
    if (!dirty || modalOpen) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // ── 2. Bouton Retour (Android/navigateur) : modale custom 3 choix ─────────
  // On ajoute une entrée d'historique tampon au chargement. Le back de
  // l'utilisateur consomme cette entrée sans quitter la page → on affiche la
  // modale et on ré-injecte l'entrée pour rester dans l'app.
  function pushGuardState() {
    try { history.pushState({ fidiGuard: true }, ''); } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pushGuardState);
  } else {
    pushGuardState();
  }

  window.addEventListener('popstate', function () {
    if (!dirty) {
      // Rien à sauver → on laisse le back suivant sortir de l'app
      return;
    }
    // Ré-injecte immédiatement pour rester dans l'app le temps du choix
    pushGuardState();
    showExitModal();
  });

  // ── Modale 3 boutons : Rester / Enregistrer / Quitter ─────────────────────
  function showExitModal() {
    if (modalOpen) return;
    modalOpen = true;
    var root = document.createElement('div');
    root.id = 'fidiExitGuardRoot';
    root.style.cssText = 'position:fixed;inset:0;z-index:20500;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    root.innerHTML =
      '<div style="background:#fff;border-radius:12px;max-width:460px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden;font-family:inherit;">'
      + '<div style="background:#1a3a6e;color:#fff;padding:14px 18px;">'
      +   '<h5 style="margin:0;font-weight:700;font-size:1.05rem;"><i class="bi bi-exclamation-triangle-fill me-2" style="color:#ffc107;"></i>Quitter l\'application ?</h5>'
      + '</div>'
      + '<div style="padding:18px;">'
      +   '<p style="margin:0 0 6px;color:#1a2233;">Vous avez des <strong>données non sauvegardées</strong>.</p>'
      +   '<p style="margin:0;font-size:.85rem;color:#556;">Que souhaitez-vous faire ?</p>'
      +   '<div id="fidiExitStatus" style="margin-top:10px;"></div>'
      + '</div>'
      + '<div style="padding:12px 18px 16px;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;background:#f8f9fa;border-top:1px solid #dee2e6;">'
      +   '<button type="button" class="btn btn-outline-secondary btn-sm" data-choice="rester">Non — rester</button>'
      +   '<button type="button" class="btn btn-success btn-sm" data-choice="save"><i class="bi bi-cloud-arrow-up me-1"></i>Enregistrer</button>'
      +   '<button type="button" class="btn btn-danger btn-sm" data-choice="quitter">Oui — quitter</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(root);

    var status = root.querySelector('#fidiExitStatus');

    function close() {
      modalOpen = false;
      root.remove();
    }
    function leave() {
      dirty = false;
      close();
      // Simule un back utilisateur (consomme l'entrée tampon et sort de l'app)
      try { history.back(); } catch (e) {}
    }

    root.addEventListener('click', async function (e) {
      // Clic hors carte = équivaut à "rester" (choix conservateur)
      if (e.target === root) { close(); return; }
      var btn = e.target.closest('[data-choice]');
      if (!btn) return;
      var choice = btn.dataset.choice;

      if (choice === 'rester') { close(); return; }

      if (choice === 'quitter') { leave(); return; }

      if (choice === 'save') {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enregistrement…';
        try {
          var handler = window.FidiGuard.saveHandler;
          if (typeof handler === 'function') {
            await handler();
          } else if (typeof window.saveEtudeCloud === 'function') {
            await window.saveEtudeCloud();
          } else {
            throw new Error('Aucune sauvegarde disponible');
          }
          if (status) status.innerHTML = '<div style="color:#198754;font-size:.85rem;"><i class="bi bi-check-circle me-1"></i>Sauvegardé.</div>';
          setTimeout(leave, 700);
        } catch (err) {
          if (status) status.innerHTML = '<div style="color:#b71c1c;font-size:.85rem;"><i class="bi bi-x-circle me-1"></i>Échec : ' + (err && err.message ? err.message : 'inconnu') + '. Réessayez ou choisissez « quitter ».</div>';
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-cloud-arrow-up me-1"></i>Réessayer';
        }
      }
    });

    // Échap = rester
    var esc = function (e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } };
    document.addEventListener('keydown', esc);
  }
})();
