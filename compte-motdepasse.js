/* Mon compte → Identité : changer son propre mot de passe (POST /api/auth/mot-de-passe).
   Le formulaire #mdpForm est écrit par la fenêtre Mon compte ; ce module ne fait que le traiter.
   Règle du mot de passe : la même qu'à l'inscription (10 caractères, une lettre, un chiffre) — vérifiée aussi par le serveur. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function refuse(pw) {
    var s = String(pw || '');
    if (s.length < 10) return 'Mot de passe : 10 caractères au moins.';
    if (s.length > 200) return 'Mot de passe trop long.';
    if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'Mot de passe : au moins une lettre et un chiffre.';
    return '';
  }
  function dire(type, texte) {
    var z = $('mdpEtat'); if (!z) return;
    z.className = 'cpt-mdp-etat' + (type ? ' cpt-mdp-' + type : '');
    z.textContent = texte || '';
  }

  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || f.id !== 'mdpForm') return;
    e.preventDefault();
    var actuel = $('mdpActuel').value, nouveau = $('mdpNouveau').value, confirme = $('mdpConfirme').value;
    if (!actuel) { dire('erreur', 'Indiquez votre mot de passe actuel.'); $('mdpActuel').focus(); return; }
    var r = refuse(nouveau);
    if (r) { dire('erreur', r); $('mdpNouveau').focus(); return; }
    if (nouveau !== confirme) { dire('erreur', 'Les deux saisies du nouveau mot de passe ne sont pas identiques.'); $('mdpConfirme').focus(); return; }
    if (nouveau === actuel) { dire('erreur', 'Le nouveau mot de passe doit être différent de l\'actuel.'); $('mdpNouveau').focus(); return; }
    var b = $('mdpValider'); if (b) b.disabled = true;
    dire('', 'Enregistrement…');
    fetch('/api/auth/mot-de-passe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actuel: actuel, nouveau: nouveau }) })
      .then(function (rep) { return rep.json().catch(function () { return {}; }).then(function (j) { return { ok: rep.ok, j: j }; }); })
      .then(function (x) {
        if (b) b.disabled = false;
        if (!x.ok) { dire('erreur', x.j.error || 'Le mot de passe n\'a pas pu être changé.'); var c = $(x.j.champ === 'actuel' ? 'mdpActuel' : 'mdpNouveau'); if (c) c.focus(); return; }
        f.reset();
        dire('ok', x.j.message || 'Mot de passe modifié.');
      })
      .catch(function () { if (b) b.disabled = false; dire('erreur', 'Connexion interrompue. Réessayez.'); });
  });

  // Afficher / masquer la saisie.
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('#mdpVoir') : null; if (!t) return;
    var voir = t.getAttribute('aria-pressed') !== 'true';
    ['mdpActuel', 'mdpNouveau', 'mdpConfirme'].forEach(function (id) { var c = $(id); if (c) c.type = voir ? 'text' : 'password'; });
    t.setAttribute('aria-pressed', voir ? 'true' : 'false');
    t.innerHTML = voir ? '<i class="bi bi-eye-slash"></i> Masquer' : '<i class="bi bi-eye"></i> Afficher';
  });
})();
