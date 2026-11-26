// Mon compte → Comptes → « E-mail de bienvenue » : mot d'accueil, liens (vidéo, présentation) et pièces jointes envoyés à
// chaque nouveau compte. Réglages lus et enregistrés par /api/bienvenue (administrateur). Styles : compte.css (.bv-*).
(function () {
  'use strict';
  var etat = { reglages: null, envoi: true, limites: { liens: 6, pieces: 3, taille: 4000000 }, message: '', erreur: false };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var racine = function () { return document.getElementById('bienvenueRoot'); };
  var taille = function (o) { return o >= 1000000 ? String(Math.round(o / 100000) / 10).replace('.', ',') + ' Mo' : Math.max(1, Math.round(o / 1024)) + ' ko'; };

  async function appel(methode, corps) {
    try {
      var r = await fetch('/api/bienvenue', { method: methode, credentials: 'same-origin', headers: corps ? { 'Content-Type': 'application/json' } : {}, body: corps ? JSON.stringify(corps) : undefined });
      var d = await r.json().catch(function () { return {}; });
      return { ok: r.ok, data: d };
    } catch (e) { return { ok: false, data: { error: 'Connexion impossible. Réessayez.' } }; }
  }
  function recevoir(rep, succes) {
    if (rep.ok) { if (rep.data.reglages) { etat.reglages = rep.data.reglages; etat.envoi = rep.data.envoi !== false; etat.limites = rep.data.limites || etat.limites; } etat.message = succes || ''; etat.erreur = false; }
    else { etat.message = rep.data.error || 'Opération impossible.'; etat.erreur = true; }
    afficher();
  }
  // Ce qui est saisi à l'écran (pour ne rien perdre quand on ajoute une ligne ou un fichier).
  function saisie() {
    var el = racine(); if (!el || !el.querySelector('#bvMessage')) return null;
    return { message: el.querySelector('#bvMessage').value, liens: [].map.call(el.querySelectorAll('.bv-lien'), function (l) {
      return { libelle: l.querySelector('.bv-libelle').value.trim(), url: l.querySelector('.bv-url').value.trim() }; }) };
  }
  function ligneLien(l) {
    return '<div class="bv-lien"><input class="form-control form-control-sm bv-libelle" maxlength="80" placeholder="Libellé (ex. Vidéo de présentation)" value="' + esc(l.libelle) + '">' +
      '<input type="url" class="form-control form-control-sm bv-url" maxlength="500" placeholder="https://…" value="' + esc(l.url) + '">' +
      '<button type="button" class="btn btn-sm btn-outline-danger" data-bv="retirer-lien" title="Retirer ce lien" aria-label="Retirer ce lien"><i class="bi bi-trash"></i></button></div>';
  }
  function afficher(brouillon) {
    var el = racine(); if (!el) return;
    var r = etat.reglages;
    if (!r) { el.innerHTML = '<div class="' + (etat.erreur ? 'text-danger' : 'text-muted') + ' small">' + esc(etat.message || 'Chargement…') + '</div>'; return; }
    var b = brouillon || { message: r.message, liens: r.liens };
    var L = etat.limites;
    el.innerHTML =
      '<div class="d-flex align-items-center mb-2"><h3 class="mb-0">E-mail de bienvenue</h3>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary ms-auto" data-bv="fermer" aria-label="Fermer"><i class="bi bi-x"></i></button></div>' +
      '<p class="bv-aide">Envoyé automatiquement à chaque nouveau compte : identifiant, lien de l\'application, installation sur téléphone et sur ordinateur, lien pour choisir son mot de passe. Vous recevez une copie de chaque envoi. Ajoutez ici votre mot d\'accueil, vos liens et vos documents.</p>' +
      (etat.envoi ? '' : '<div class="alert alert-warning py-2 small">L\'envoi d\'e-mails n\'est pas réglé sur ce site : aucun e-mail de bienvenue ne part pour l\'instant.</div>') +
      '<label class="bv-titre d-block" for="bvMessage">Mot d\'accueil (facultatif)</label>' +
      '<textarea class="form-control form-control-sm" id="bvMessage" rows="4" maxlength="1200" placeholder="Ex. Bienvenue ! Regardez la vidéo de présentation avant votre première étude.">' + esc(b.message) + '</textarea>' +
      '<div class="bv-titre">Liens : vidéo, présentation, guide en ligne (' + L.liens + ' au plus)</div>' +
      '<div id="bvLiens">' + b.liens.map(ligneLien).join('') + '</div>' +
      '<button type="button" class="btn btn-sm btn-outline-primary" data-bv="ajouter-lien"' + (b.liens.length >= L.liens ? ' disabled' : '') + '><i class="bi bi-plus-lg me-1"></i>Ajouter un lien</button>' +
      '<div class="bv-titre">Pièces jointes : PDF, PowerPoint, Word, image (' + L.pieces + ' au plus, ' + taille(L.taille) + ' par fichier)</div>' +
      '<p class="bv-aide">Une vidéo est trop lourde pour un e-mail : déposez-la en ligne (YouTube, Dropbox…) et ajoutez son lien ci-dessus.</p>' +
      (r.pieces.length ? r.pieces.map(function (p) {
        return '<div class="bv-piece"><i class="bi bi-paperclip"></i><span>' + esc(p.nom) + '</span><small class="text-muted">' + taille(p.taille || 0) + '</small>' +
          '<a class="btn btn-sm btn-outline-secondary" href="/api/bienvenue?piece=' + esc(p.id) + '" target="_blank" rel="noopener" title="Ouvrir"><i class="bi bi-eye"></i></a>' +
          '<button type="button" class="btn btn-sm btn-outline-danger" data-bv="retirer-piece" data-id="' + esc(p.id) + '" title="Retirer" aria-label="Retirer ' + esc(p.nom) + '"><i class="bi bi-trash"></i></button></div>';
      }).join('') : '<p class="bv-aide">Aucune pièce jointe.</p>') +
      '<input type="file" class="d-none" id="bvFichier" accept=".pdf,.ppt,.pptx,.doc,.docx,.jpg,.jpeg,.png">' +
      '<button type="button" class="btn btn-sm btn-outline-primary" data-bv="ajouter-piece"' + (r.pieces.length >= L.pieces ? ' disabled' : '') + '><i class="bi bi-paperclip me-1"></i>Joindre un fichier</button>' +
      '<div class="bv-pied"><button type="button" class="btn btn-sm btn-primary" data-bv="enregistrer"><i class="bi bi-check-lg me-1"></i>Enregistrer</button>' +
        '<button type="button" class="btn btn-sm btn-outline-primary" data-bv="essai"' + (etat.envoi ? '' : ' disabled') + '><i class="bi bi-send me-1"></i>M\'envoyer un essai</button>' +
        (etat.message ? '<div class="bv-etat ' + (etat.erreur ? 'text-danger' : 'text-success') + '" role="status">' + esc(etat.message) + '</div>' : '') + '</div>';
  }
  function occupe(texte) { etat.message = texte; etat.erreur = false; var e = racine() && racine().querySelector('.bv-pied'); if (e) { var d = e.querySelector('.bv-etat') || e.appendChild(document.createElement('div')); d.className = 'bv-etat text-muted'; d.textContent = texte; } }

  async function enregistrer(silencieux) {
    var s = saisie(); if (!s) return false;
    s.liens = s.liens.filter(function (l) { return l.libelle || l.url; });
    var rep = await appel('POST', { action: 'enregistrer', message: s.message, liens: s.liens });
    if (!rep.ok) { etat.message = rep.data.error || 'Enregistrement impossible.'; etat.erreur = true; afficher(s); return false; }
    if (!silencieux) recevoir(rep, 'Réglages enregistrés. Ils s\'appliquent dès le prochain compte créé.'); else { etat.reglages = rep.data.reglages; }
    return true;
  }
  function lireFichier(f) {
    return new Promise(function (ok, ko) { var l = new FileReader(); l.onload = function () { ok(String(l.result).replace(/^data:[^,]*,/, '')); }; l.onerror = ko; l.readAsDataURL(f); });
  }
  async function clic(e) {
    var bt = e.target.closest('[data-bv]'); if (!bt) return;
    var a = bt.getAttribute('data-bv'), s = saisie();
    if (a === 'fermer') return basculer(false);
    if (a === 'ajouter-lien') { s.liens.push({ libelle: '', url: '' }); etat.message = ''; afficher(s); var d = racine().querySelectorAll('.bv-libelle'); if (d.length) d[d.length - 1].focus(); return; }
    if (a === 'retirer-lien') { var i = [].indexOf.call(racine().querySelectorAll('.bv-lien'), bt.closest('.bv-lien')); s.liens.splice(i, 1); etat.message = ''; return afficher(s); }
    if (a === 'enregistrer') { occupe('Enregistrement…'); return enregistrer(); }
    if (a === 'ajouter-piece') return racine().querySelector('#bvFichier').click();
    if (a === 'retirer-piece') {
      if (!window.confirm('Retirer cette pièce jointe de l\'e-mail de bienvenue ?')) return;
      occupe('Retrait…'); var rep = await appel('POST', { action: 'retirer_piece', id: bt.getAttribute('data-id') });
      if (rep.ok) { etat.reglages = rep.data.reglages; etat.message = 'Pièce jointe retirée.'; etat.erreur = false; } else { etat.message = rep.data.error || 'Retrait impossible.'; etat.erreur = true; }
      return afficher(s);
    }
    if (a === 'essai') {
      occupe('Enregistrement puis envoi de l\'essai…');
      if (!(await enregistrer(true))) return;
      var r2 = await appel('POST', { action: 'essai' });
      etat.message = r2.ok ? 'E-mail d\'essai envoyé à ' + (r2.data.envoye_a || 'votre adresse') + '. Pour un vrai compte, le bouton est « Choisir mon mot de passe ».' : (r2.data.error || 'Envoi impossible.');
      etat.erreur = !r2.ok; afficher();
    }
  }
  async function fichierChoisi(e) {
    if (e.target.id !== 'bvFichier') return;
    var f = e.target.files && e.target.files[0], s = saisie(); if (!f) return;
    if (f.size > etat.limites.taille) { etat.message = 'Fichier trop lourd (' + taille(f.size) + '). ' + taille(etat.limites.taille) + ' au plus : déposez-le en ligne et ajoutez un lien.'; etat.erreur = true; return afficher(s); }
    occupe('Envoi du fichier…');
    var b64; try { b64 = await lireFichier(f); } catch (x) { etat.message = 'Fichier illisible.'; etat.erreur = true; return afficher(s); }
    var rep = await appel('POST', { action: 'ajouter_piece', nom: f.name, base64: b64 });
    if (rep.ok) { etat.reglages = rep.data.reglages; etat.message = '« ' + f.name + ' » sera joint à chaque e-mail de bienvenue.'; etat.erreur = false; } else { etat.message = rep.data.error || 'Envoi du fichier impossible.'; etat.erreur = true; }
    afficher(s);
  }
  async function basculer(ouvrir) {
    var el = racine(); if (!el) return;
    var montrer = ouvrir === undefined ? el.classList.contains('d-none') : !!ouvrir;
    el.classList.toggle('d-none', !montrer);
    if (!montrer) return;
    if (!el.dataset.bvPret) { el.dataset.bvPret = '1'; el.addEventListener('click', clic); el.addEventListener('change', fichierChoisi); }
    etat.reglages = null; etat.message = ''; etat.erreur = false; afficher();
    recevoir(await appel('GET'));
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  window.FidiBienvenue = { basculer: basculer };
})();
