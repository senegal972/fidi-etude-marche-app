/* ════════════════════════════════════════════════════════════════════════
   Inscription par lien d'invitation
   L'administrateur copie un lien (Mon compte → Comptes → « Copier lien inscription »), valable 24 h et utilisable
   une seule fois : https://…/#signup?token=… . La personne qui l'ouvre crée son compte et choisit son mot de passe.
   Serveur : GET /api/signup-link?token= (validation), POST /api/signup-link { action:"inscrire", … }.
   Styles : compte.css (.insc-*).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function jetonDuLien() {
    var m = String(location.hash || '').match(/^#signup\?token=([A-Za-z0-9._-]+)/);
    return m ? m[1] : '';
  }
  function appel(url, corps) {
    var o = { credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (corps) { o.method = 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corps); }
    return fetch(url, o).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; j._ok = r.ok; return j; }); })
      .catch(function () { return { _ok: false, error: 'Réseau indisponible.' }; });
  }
  // Mêmes règles que motDePasseRefuse() dans signup-link.mjs.
  function refusMotDePasse(pw) {
    if (pw.length < 10) return 'Mot de passe : 10 caractères au moins.';
    if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) return 'Mot de passe : au moins une lettre et un chiffre.';
    return '';
  }

  function ouvrir(jeton) {
    var fond = document.createElement('div');
    fond.id = 'inscriptionFond'; fond.className = 'insc-fond';
    fond.innerHTML = '<div class="insc-carte" role="dialog" aria-modal="true" aria-labelledby="inscTitre"><div class="insc-ico"><i class="bi bi-person-plus"></i></div>' +
      '<h1 id="inscTitre">Créer votre compte</h1><div id="inscCorps"><p class="insc-txt"><span class="spinner-border spinner-border-sm me-2"></span>Vérification de votre invitation…</p></div></div>';
    document.body.appendChild(fond);
    var corps = fond.querySelector('#inscCorps');
    var fermer = function () { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } fond.remove(); };

    appel('/api/signup-link?token=' + encodeURIComponent(jeton)).then(function (v) {
      if (!v._ok) {
        corps.innerHTML = '<p class="insc-txt">' + esc(v.error || 'Ce lien d\'inscription n\'est plus valable.') + '</p><p class="insc-txt">Demandez un nouveau lien à la personne qui vous a invité. Si vous avez déjà un compte, connectez-vous.</p>' +
          '<button type="button" class="btn cpt-btn cpt-btn-plein w-100" id="inscFermer">Aller à la connexion</button>';
        corps.querySelector('#inscFermer').onclick = fermer;
        return;
      }
      var heures = Math.max(1, Math.round((v.expires_in_seconds || 0) / 3600));
      corps.innerHTML = '<p class="insc-txt">Vous avez été invité à utiliser l\'application' + (v.reseau ? ' pour le réseau <b>' + esc(v.reseau) + '</b>' : '') + '. Choisissez vos identifiants : vous seul connaîtrez votre mot de passe.</p>' +
        '<form id="inscForm" novalidate>' +
        '<label class="cpt-label" for="inscNom">Nom et prénom</label><input type="text" id="inscNom" class="form-control cpt-input" autocomplete="name" maxlength="80">' +
        '<label class="cpt-label insc-espace" for="inscEmail">E-mail (il servira d\'identifiant)</label><input type="email" id="inscEmail" class="form-control cpt-input" autocomplete="username" inputmode="email" maxlength="120">' +
        (v.reseau_libre ? '<label class="cpt-label insc-espace" for="inscReseau">Réseau ou agence (facultatif)</label><input type="text" id="inscReseau" class="form-control cpt-input" maxlength="100" autocomplete="organization">' : '') +
        '<label class="cpt-label insc-espace" for="inscPwd">Mot de passe</label><input type="password" id="inscPwd" class="form-control cpt-input" autocomplete="new-password" maxlength="200">' +
        '<div class="insc-aide">10 caractères au moins, avec une lettre et un chiffre.</div>' +
        '<label class="cpt-label insc-espace" for="inscPwd2">Confirmez le mot de passe</label><input type="password" id="inscPwd2" class="form-control cpt-input" autocomplete="new-password" maxlength="200">' +
        '<label class="insc-voir"><input type="checkbox" id="inscVoir"> Afficher le mot de passe</label>' +
        '<div class="cpt-erreur d-none" id="inscErr" role="alert"></div>' +
        '<button type="submit" class="btn cpt-btn cpt-btn-plein w-100" id="inscBtn">Créer mon compte</button>' +
        '<p class="insc-pied">Lien valable encore ' + heures + ' h, utilisable une seule fois.</p></form>';
      var $ = function (id) { return corps.querySelector('#' + id); };
      $('inscVoir').onchange = function () { var t = this.checked ? 'text' : 'password'; $('inscPwd').type = t; $('inscPwd2').type = t; };
      $('inscForm').onsubmit = function (e) {
        e.preventDefault();
        var err = $('inscErr'), dire = function (t) { err.textContent = t; err.classList.remove('d-none'); };
        err.classList.add('d-none');
        var nom = $('inscNom').value.trim(), email = $('inscEmail').value.trim(), pw = $('inscPwd').value, pw2 = $('inscPwd2').value;
        if (nom.length < 2) return dire('Indiquez votre nom.');
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return dire('Adresse e-mail invalide.');
        var refus = refusMotDePasse(pw); if (refus) return dire(refus);
        if (pw !== pw2) return dire('Les deux mots de passe ne sont pas identiques.');
        var btn = $('inscBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Création…';
        appel('/api/signup-link', { action: 'inscrire', token: jeton, nom: nom, email: email, password: pw, reseau: ($('inscReseau') || {}).value || '' }).then(function (r) {
          if (!r._ok) { btn.disabled = false; btn.textContent = 'Créer mon compte'; return dire(r.error || 'Inscription impossible.'); }
          // Connexion dans la foulée, puis rechargement sans le lien d'invitation dans l'adresse.
          return appel('/api/auth/login', { email: email, password: pw }).then(function () {
            corps.innerHTML = '<p class="insc-txt insc-ok"><i class="bi bi-check-circle me-1"></i>Votre compte est créé. Bienvenue !</p>';
            try { history.replaceState(null, '', location.pathname); } catch (x) {}
            setTimeout(function () { location.reload(); }, 900);
          });
        });
      };
      $('inscNom').focus();
    });
  }

  // ── Mot de passe oublié ─────────────────────────────────────────────────────
  // 1. oubli(email) : la personne saisit son e-mail, le serveur envoie un lien (POST /api/auth/oubli).
  // 2. …/#reset?token=… : elle choisit son nouveau mot de passe (POST /api/auth/oubli { action:"changer" }).
  function jetonReset() {
    var m = String(location.hash || '').match(/^#reset\?token=([A-Za-z0-9._-]+)/);
    return m ? m[1] : '';
  }
  function cadre(icone, titre) {
    var ancien = document.getElementById('inscriptionFond'); if (ancien) ancien.remove();
    var fond = document.createElement('div');
    fond.id = 'inscriptionFond'; fond.className = 'insc-fond';
    fond.innerHTML = '<div class="insc-carte" role="dialog" aria-modal="true" aria-labelledby="inscTitre"><div class="insc-ico"><i class="bi ' + icone + '"></i></div>' +
      '<h1 id="inscTitre">' + titre + '</h1><div id="inscCorps"></div></div>';
    document.body.appendChild(fond);
    return { fond: fond, corps: fond.querySelector('#inscCorps') };
  }
  function nettoyerAdresse() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } }

  function oubli(emailConnu) {
    var c = cadre('bi-key', 'Mot de passe oublié');
    var fermer = function () { c.fond.remove(); };
    c.corps.innerHTML = '<p class="insc-txt">Indiquez l\'adresse e-mail de votre compte. Vous recevrez un lien pour choisir un nouveau mot de passe.</p>' +
      '<form id="oubliForm" novalidate><label class="cpt-label" for="oubliEmail">E-mail</label>' +
      '<input type="email" id="oubliEmail" class="form-control cpt-input" autocomplete="username" inputmode="email" maxlength="120" value="' + esc(String(emailConnu || '').trim()) + '">' +
      '<div class="cpt-erreur d-none insc-espace" id="oubliErr" role="alert"></div>' +
      '<button type="submit" class="btn cpt-btn cpt-btn-plein w-100 insc-espace" id="oubliBtn">Recevoir le lien</button>' +
      '<button type="button" class="insc-retour" id="oubliRetour">Retour à la connexion</button></form>';
    var $ = function (id) { return c.corps.querySelector('#' + id); };
    $('oubliRetour').onclick = fermer;
    $('oubliForm').onsubmit = function (e) {
      e.preventDefault();
      var err = $('oubliErr'), email = $('oubliEmail').value.trim();
      err.classList.add('d-none');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { err.textContent = 'Adresse e-mail invalide.'; err.classList.remove('d-none'); return; }
      var btn = $('oubliBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Envoi…';
      appel('/api/auth/oubli', { email: email }).then(function (r) {
        if (!r._ok) { btn.disabled = false; btn.textContent = 'Recevoir le lien'; err.textContent = r.error || 'Demande impossible.'; err.classList.remove('d-none'); return; }
        c.corps.innerHTML = '<p class="insc-txt insc-ok"><i class="bi bi-envelope-check me-1"></i>Demande enregistrée</p>' +
          '<p class="insc-txt">Si un compte existe pour <b>' + esc(email) + '</b>, un e-mail vient de partir. Le lien est valable 1 heure.</p>' +
          '<p class="insc-txt">Rien reçu après quelques minutes ? Regardez dans les courriers indésirables, vérifiez l\'adresse, ou demandez un nouveau mot de passe à votre administrateur.</p>' +
          '<button type="button" class="btn cpt-btn cpt-btn-plein w-100" id="oubliFin">Retour à la connexion</button>';
        c.corps.querySelector('#oubliFin').onclick = fermer;
      });
    };
    $('oubliEmail').focus();
  }

  function nouveauMotDePasse(jeton) {
    var c = cadre('bi-shield-lock', 'Nouveau mot de passe');
    c.corps.innerHTML = '<p class="insc-txt">Choisissez votre nouveau mot de passe. Vous serez connecté aussitôt.</p>' +
      '<form id="resetForm" novalidate><label class="cpt-label" for="resetPwd">Nouveau mot de passe</label>' +
      '<input type="password" id="resetPwd" class="form-control cpt-input" autocomplete="new-password" maxlength="200">' +
      '<div class="insc-aide">10 caractères au moins, avec une lettre et un chiffre.</div>' +
      '<label class="cpt-label insc-espace" for="resetPwd2">Confirmez le mot de passe</label>' +
      '<input type="password" id="resetPwd2" class="form-control cpt-input" autocomplete="new-password" maxlength="200">' +
      '<label class="insc-voir"><input type="checkbox" id="resetVoir"> Afficher le mot de passe</label>' +
      '<div class="cpt-erreur d-none" id="resetErr" role="alert"></div>' +
      '<button type="submit" class="btn cpt-btn cpt-btn-plein w-100" id="resetBtn">Enregistrer le mot de passe</button></form>';
    var $ = function (id) { return c.corps.querySelector('#' + id); };
    $('resetVoir').onchange = function () { var t = this.checked ? 'text' : 'password'; $('resetPwd').type = t; $('resetPwd2').type = t; };
    $('resetForm').onsubmit = function (e) {
      e.preventDefault();
      var err = $('resetErr'), dire = function (t) { err.textContent = t; err.classList.remove('d-none'); };
      err.classList.add('d-none');
      var pw = $('resetPwd').value, pw2 = $('resetPwd2').value;
      var refus = refusMotDePasse(pw); if (refus) return dire(refus);
      if (pw !== pw2) return dire('Les deux mots de passe ne sont pas identiques.');
      var btn = $('resetBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enregistrement…';
      appel('/api/auth/oubli', { action: 'changer', token: jeton, password: pw }).then(function (r) {
        if (!r._ok) {
          if (r.expired) {
            c.corps.innerHTML = '<p class="insc-txt">' + esc(r.error) + '</p><button type="button" class="btn cpt-btn cpt-btn-plein w-100" id="resetRefaire">Refaire une demande</button>';
            c.corps.querySelector('#resetRefaire').onclick = function () { nettoyerAdresse(); oubli(''); };
            return;
          }
          btn.disabled = false; btn.textContent = 'Enregistrer le mot de passe'; return dire(r.error || 'Enregistrement impossible.');
        }
        return appel('/api/auth/login', { email: r.email, password: pw }).then(function () {
          c.corps.innerHTML = '<p class="insc-txt insc-ok"><i class="bi bi-check-circle me-1"></i>Mot de passe enregistré. Vous êtes connecté.</p>';
          nettoyerAdresse();
          setTimeout(function () { location.reload(); }, 900);
        });
      });
    };
    $('resetPwd').focus();
  }

  function demarrer() {
    var r = jetonReset();
    if (r) { if (!document.getElementById('resetForm')) nouveauMotDePasse(r); return; }
    var j = jetonDuLien(); if (j && !document.getElementById('inscriptionFond')) ouvrir(j);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
  window.addEventListener('hashchange', demarrer);
  window.FidiInscription = { jetonDuLien: jetonDuLien, jetonReset: jetonReset, refusMotDePasse: refusMotDePasse, oubli: oubli };
})();
