// Assistance : signalement guidé. Trois étapes — 1) nature de la demande (questionnaire), 2) où et à quel point, 3) description,
// captures d'écran (fichier ou collage) ou e-mail. Envoi par /api/assistance ; l'administrateur lit les demandes dans
// Mon compte → Assistance (FidiAssistance.monterAdmin). Styles : assistance.css.
(function () {
  'use strict';
  var NATURES = [['erreur', 'bi-bug', 'Une erreur', 'Quelque chose ne fonctionne pas ou donne un mauvais résultat.'],
    ['amelioration', 'bi-lightbulb', 'Une idée d\'amélioration', 'Une fonction qui manque, un écran à simplifier, une proposition.'],
    ['question', 'bi-question-circle', 'Une question d\'utilisation', 'Je ne sais pas comment faire quelque chose.'],
    ['compte', 'bi-person-gear', 'Mon compte ou ma facturation', 'Connexion, mot de passe, crédits, facture, paiement.']];
  var MODULES = [['saisie', 'Nouvelle étude (saisie)'], ['etude', 'Résultats de l\'étude'], ['carte', 'Carte et parcelles'], ['avis', 'Avis de valeur'],
    ['facturation', 'Facturation et paiement'], ['documents', 'Mes documents'], ['compte', 'Mon compte'], ['autre', 'Autre / je ne sais pas']];
  var GRAVITES = [['bloquant', 'Oui, je ne peux plus travailler'], ['genant', 'C\'est gênant, mais je contourne'], ['mineur', 'Non, c\'est un détail']];
  var TAILLE_MAX = 1400000, CAPTURES_MAX = 3;
  var etat = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var lib = function (liste, cle) { var x = liste.filter(function (l) { return l[0] === cle; })[0]; return x ? x[x.length === 4 ? 2 : 1] : cle; };

  async function appel(methode, url, corps) {
    try { var r = await fetch(url, { method: methode, credentials: 'same-origin', headers: corps ? { 'Content-Type': 'application/json' } : {}, body: corps ? JSON.stringify(corps) : undefined });
      var d = await r.json().catch(function () { return {}; }); return { ok: r.ok, data: d }; }
    catch (e) { return { ok: false, data: { error: 'Connexion impossible. Réessayez.' } }; }
  }
  // Réduit une image trop lourde (capture d'écran d'un grand écran) avant l'envoi : JPEG, 1 600 px de large au plus.
  function preparerImage(fichier) {
    return new Promise(function (ok, ko) {
      var l = new FileReader();
      l.onerror = function () { ko(new Error('Image illisible.')); };
      l.onload = function () {
        if (fichier.size <= TAILLE_MAX && /^image\/(png|jpeg|webp)$/.test(fichier.type)) return ok({ nom: fichier.name || 'capture.png', base64: String(l.result).split(',')[1], apercu: String(l.result) });
        var img = new Image();
        img.onerror = function () { ko(new Error('Image illisible.')); };
        img.onload = function () {
          var k = Math.min(1, 1600 / img.width), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var url = c.toDataURL('image/jpeg', 0.8);
          ok({ nom: String(fichier.name || 'capture').replace(/\.[a-z0-9]+$/i, '') + '.jpg', base64: url.split(',')[1], apercu: url });
        };
        img.src = String(l.result);
      };
      l.readAsDataURL(fichier);
    });
  }
  async function ajouterImages(fichiers) {
    for (var i = 0; i < fichiers.length; i++) {
      if (etat.captures.length >= CAPTURES_MAX) { etat.message = CAPTURES_MAX + ' captures au plus.'; break; }
      if (!/^image\//.test(fichiers[i].type)) { etat.message = 'Seules les images sont acceptées.'; continue; }
      try { etat.captures.push(await preparerImage(fichiers[i])); etat.message = ''; } catch (e) { etat.message = e.message; }
    }
    garderTexte(); afficher();
  }
  function garderTexte() { var t = $('asMessage'); if (t) etat.texte = t.value; }

  function etape1() {
    return '<p class="as-question">Que souhaitez-vous nous signaler ?</p><div class="as-choix">' + NATURES.map(function (n) {
      return '<button type="button" class="as-carte" data-as="nature" data-v="' + n[0] + '"><i class="bi ' + n[1] + '"></i><b>' + n[2] + '</b><small>' + n[3] + '</small></button>'; }).join('') + '</div>';
  }
  function etape2() {
    var erreur = etat.nature === 'erreur';
    return '<p class="as-question">' + (erreur ? 'Où l\'erreur se produit-elle ?' : 'Quelle partie de l\'application est concernée ?') + '</p>' +
      '<div class="as-puces">' + MODULES.map(function (m) { return '<button type="button" class="as-puce' + (etat.module === m[0] ? ' actif' : '') + '" data-as="module" data-v="' + m[0] + '" aria-pressed="' + (etat.module === m[0]) + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      (erreur ? '<p class="as-question">Cela vous empêche-t-il de travailler ?</p><div class="as-puces">' + GRAVITES.map(function (g) {
        return '<button type="button" class="as-puce' + (etat.gravite === g[0] ? ' actif' : '') + '" data-as="gravite" data-v="' + g[0] + '" aria-pressed="' + (etat.gravite === g[0]) + '">' + g[1] + '</button>'; }).join('') + '</div>' : '') +
      '<div class="as-pied"><button type="button" class="btn btn-outline-secondary" data-as="retour">Retour</button>' +
      '<button type="button" class="btn btn-primary" data-as="suite"' + (etat.module && (!erreur || etat.gravite) ? '' : ' disabled') + '>Continuer</button></div>';
  }
  function etape3() {
    var aide = { erreur: 'Que faisiez-vous ? Qu\'attendiez-vous ? Qu\'avez-vous obtenu ? Une adresse ou une référence d\'étude aide beaucoup.',
      amelioration: 'Décrivez votre idée et ce qu\'elle vous apporterait.', question: 'Que cherchez-vous à faire ?', compte: 'Décrivez la difficulté. N\'écrivez jamais votre mot de passe.' }[etat.nature];
    return '<div class="as-rappel"><span>' + esc(lib(NATURES, etat.nature)) + '</span><span>' + esc(lib(MODULES, etat.module)) + '</span>' + (etat.gravite ? '<span>' + esc(lib(GRAVITES, etat.gravite)) + '</span>' : '') +
        '<button type="button" class="as-lien" data-as="recommencer">Modifier</button></div>' +
      '<label class="as-question" for="asMessage">Décrivez votre demande</label>' +
      '<textarea id="asMessage" class="form-control" rows="5" maxlength="4000" placeholder="' + esc(aide) + '">' + esc(etat.texte) + '</textarea>' +
      '<p class="as-question">Captures d\'écran <small>(facultatif, ' + CAPTURES_MAX + ' au plus)</small></p>' +
      '<div class="as-captures">' + etat.captures.map(function (c, i) { return '<div class="as-capture"><img src="' + c.apercu + '" alt="Capture ' + (i + 1) + '"><button type="button" data-as="retirer-capture" data-v="' + i + '" aria-label="Retirer la capture ' + (i + 1) + '"><i class="bi bi-x-lg"></i></button></div>'; }).join('') +
        (etat.captures.length < CAPTURES_MAX ? '<button type="button" class="as-ajout" data-as="choisir"><i class="bi bi-image"></i><span>Ajouter une image</span></button>' : '') + '</div>' +
      '<input type="file" id="asFichier" class="d-none" accept="image/png,image/jpeg,image/webp" multiple>' +
      '<p class="as-aide">Sur ordinateur, vous pouvez aussi coller une capture ici (Ctrl + V).</p>' +
      (etat.message ? '<div class="as-erreur" role="alert">' + esc(etat.message) + '</div>' : '') +
      '<div class="as-pied"><button type="button" class="btn btn-outline-secondary" data-as="retour">Retour</button>' +
      '<button type="button" class="btn btn-primary" data-as="envoyer"' + (etat.envoi ? ' disabled' : '') + '><i class="bi bi-send me-1"></i>' + (etat.envoi ? 'Envoi…' : 'Envoyer') + '</button></div>' +
      (etat.contact ? '<div class="as-email">Vous préférez écrire par e-mail ? <b id="asAdresse">' + esc(etat.contact) + '</b> ' +
        '<button type="button" class="as-lien" data-as="copier">Copier l\'adresse</button> · <a class="as-lien" href="mailto:' + esc(etat.contact) + '?subject=' + encodeURIComponent('Assistance — ' + lib(NATURES, etat.nature)) + '">Ouvrir ma messagerie</a></div>' : '');
  }
  function fin() {
    return '<div class="as-fin"><i class="bi bi-check-circle-fill"></i><h6>Demande envoyée</h6><p>Référence <b>' + esc(etat.numero) + '</b>. ' +
      (etat.email === 'envoye' ? 'Elle a été transmise par e-mail à l\'assistance.' : 'Elle est enregistrée et sera lue par l\'assistance.') + '</p>' +
      '<button type="button" class="btn btn-primary" data-bs-dismiss="modal">Fermer</button></div>';
  }
  function afficher() {
    var c = $('asCorps'); if (!c) return;
    var n = etat.numero ? 4 : etat.etape;
    c.innerHTML = (n <= 3 ? '<ol class="as-etapes" aria-label="Étapes">' + ['Nature', 'Précisions', 'Description'].map(function (t, i) { return '<li class="' + (i + 1 === n ? 'actif' : i + 1 < n ? 'fait' : '') + '">' + t + '</li>'; }).join('') + '</ol>' : '') +
      (n === 1 ? etape1() : n === 2 ? etape2() : n === 3 ? etape3() : fin());
  }
  async function clic(e) {
    var b = e.target.closest ? e.target.closest('[data-as]') : null; if (!b) return;
    var a = b.getAttribute('data-as'), v = b.getAttribute('data-v');
    garderTexte();
    if (a === 'nature') { etat.nature = v; etat.etape = 2; if (v !== 'erreur') etat.gravite = ''; return afficher(); }
    if (a === 'module') { etat.module = v; return afficher(); }
    if (a === 'gravite') { etat.gravite = v; return afficher(); }
    if (a === 'suite') { etat.etape = 3; afficher(); var t = $('asMessage'); if (t) t.focus(); return; }
    if (a === 'retour') { etat.etape = Math.max(1, etat.etape - 1); etat.message = ''; return afficher(); }
    if (a === 'recommencer') { etat.etape = 1; return afficher(); }
    if (a === 'choisir') return $('asFichier').click();
    if (a === 'retirer-capture') { etat.captures.splice(+v, 1); return afficher(); }
    if (a === 'copier') { try { await navigator.clipboard.writeText(etat.contact); b.textContent = 'Adresse copiée'; } catch (x) { var r = document.createRange(); r.selectNodeContents($('asAdresse')); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } return; }
    if (a === 'envoyer') {
      if (etat.texte.trim().length < 10 && !etat.captures.length) { etat.message = 'Décrivez votre demande en quelques mots, ou joignez une capture d\'écran.'; return afficher(); }
      etat.envoi = true; etat.message = ''; afficher();
      var r2 = await appel('POST', '/api/assistance', { action: 'signaler', nature: etat.nature, module: etat.module, gravite: etat.gravite, message: etat.texte,
        captures: etat.captures.map(function (c) { return { nom: c.nom, base64: c.base64 }; }),
        contexte: { version: window.APP_VERSION || '', ecran: window.innerWidth + '×' + window.innerHeight, navigateur: navigator.userAgent, page: etat.page } });
      etat.envoi = false;
      if (!r2.ok) { etat.message = r2.data.error || 'Envoi impossible. Réessayez.'; return afficher(); }
      etat.numero = r2.data.numero; etat.email = r2.data.email; afficher();
    }
  }
  async function ouvrir() {
    if (typeof window.bootstrap === 'undefined') return;
    var racine = $('assistanceRoot'); if (!racine) { racine = document.createElement('div'); racine.id = 'assistanceRoot'; document.body.appendChild(racine); }
    // Écran d'où part la demande (pré-sélection de la partie concernée).
    var avis = !!document.querySelector('#avisModal.show'), compte = !!document.querySelector('#compteModal.show'), resultats = $('results-panel') && !$('results-panel').classList.contains('d-none') && $('results-panel').offsetParent;
    etat = { etape: 1, nature: '', module: avis ? 'avis' : compte ? 'compte' : resultats ? 'etude' : 'saisie', gravite: '', texte: '', captures: [], message: '', contact: '', numero: '', email: '', envoi: false,
      page: avis ? 'avis' : compte ? 'compte' : resultats ? 'etude' : 'saisie' };
    racine.innerHTML = '<div class="modal fade" id="assistanceModal" tabindex="-1" aria-labelledby="asTitre"><div class="modal-dialog modal-dialog-scrollable modal-fullscreen-md-down"><div class="modal-content">' +
      '<div class="modal-header as-tete"><h5 class="modal-title" id="asTitre"><i class="bi bi-life-preserver me-1"></i>Assistance</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fermer"></button></div>' +
      '<div class="modal-body as-corps" id="asCorps"></div></div></div></div>';
    var el = $('assistanceModal');
    el.addEventListener('click', clic);
    el.addEventListener('change', function (e) { if (e.target.id === 'asFichier' && e.target.files) ajouterImages([].slice.call(e.target.files)); });
    el.addEventListener('paste', function (e) {
      if (etat.etape !== 3 || etat.numero) return;
      var f = [].filter.call((e.clipboardData && e.clipboardData.items) || [], function (i) { return i.kind === 'file' && /^image\//.test(i.type); }).map(function (i) { return i.getAsFile(); }).filter(Boolean);
      if (f.length) { e.preventDefault(); ajouterImages(f); }
    });
    el.addEventListener('hidden.bs.modal', function () { el.remove(); });
    if (typeof window.fidiStackModal === 'function') window.fidiStackModal(el);
    afficher();
    new window.bootstrap.Modal(el).show();
    var r = await appel('GET', '/api/assistance'); if (r.ok) { etat.contact = r.data.contact || ''; if (etat.etape === 3 && !etat.numero) { garderTexte(); afficher(); } }
  }

  // ── Administrateur : Mon compte → Assistance ─────────────────────────────────────────────────────────────────────────────
  var adm = { liste: null, choisi: null, filtre: 'ouvert', erreur: '' };
  var dateFr = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
  function vueAdmin() {
    var el = $('assistanceAdminRoot'); if (!el) return;
    if (!adm.liste) { el.innerHTML = '<div class="' + (adm.erreur ? 'text-danger' : 'text-muted') + ' small">' + esc(adm.erreur || 'Chargement…') + '</div>'; return; }
    var t = adm.choisi ? adm.liste.filter(function (x) { return x.numero === adm.choisi; })[0] : null;
    if (t) {
      el.innerHTML = '<div class="cpt-carte"><button type="button" class="btn btn-sm btn-outline-secondary mb-2" data-asa="retour"><i class="bi bi-arrow-left me-1"></i>Toutes les demandes</button>' +
        '<h3>' + esc(lib(NATURES, t.nature)) + ' — ' + esc(lib(MODULES, t.module)) + '</h3>' +
        '<p class="as-meta">' + esc(t.numero) + ' · ' + esc(dateFr(t.le)) + ' · ' + esc(t.auteur.nom || t.auteur.email) + ' (' + esc(t.auteur.email) + ')' + (t.gravite ? ' · ' + esc(lib(GRAVITES, t.gravite)) : '') + '</p>' +
        '<div class="as-texte">' + (t.message ? esc(t.message).replace(/\n/g, '<br>') : '<span class="text-muted">Pas de texte : voir les captures.</span>') + '</div>' +
        ((t.captures || []).length ? '<div class="as-captures-admin">' + t.captures.map(function (c, i) { return '<a href="/api/assistance?id=' + encodeURIComponent(t.numero) + '&capture=' + i + '" target="_blank" rel="noopener"><img src="/api/assistance?id=' + encodeURIComponent(t.numero) + '&capture=' + i + '" alt="Capture ' + (i + 1) + '" loading="lazy"></a>'; }).join('') + '</div>' : '') +
        '<p class="as-meta">Version ' + esc(t.contexte.version || '?') + ' · écran ' + esc(t.contexte.ecran || '?') + ' · ' + esc(t.contexte.navigateur || '') + '</p>' +
        '<button type="button" class="btn btn-sm ' + (t.etat === 'traite' ? 'btn-outline-secondary' : 'btn-success') + '" data-asa="etat" data-v="' + (t.etat === 'traite' ? 'ouvert' : 'traite') + '">' + (t.etat === 'traite' ? 'Rouvrir' : '<i class="bi bi-check-lg me-1"></i>Marquer comme traitée') + '</button></div>';
      return;
    }
    var n = function (f) { return adm.liste.filter(function (x) { return f === 'tout' || (x.etat || 'ouvert') === f; }).length; };
    var lignes = adm.liste.filter(function (x) { return adm.filtre === 'tout' || (x.etat || 'ouvert') === adm.filtre; });
    el.innerHTML = '<div class="as-filtres">' + [['ouvert', 'À traiter'], ['traite', 'Traitées'], ['tout', 'Toutes']].map(function (f) {
        return '<button type="button" class="as-puce' + (adm.filtre === f[0] ? ' actif' : '') + '" data-asa="filtre" data-v="' + f[0] + '">' + f[1] + ' <span>' + n(f[0]) + '</span></button>'; }).join('') + '</div>' +
      (lignes.length ? lignes.map(function (x) {
        return '<button type="button" class="as-ligne" data-asa="ouvrir" data-v="' + esc(x.numero) + '"><span class="as-nature as-nature-' + esc(x.nature) + '">' + esc(lib(NATURES, x.nature)) + '</span>' +
          '<span class="as-ligne-corps"><b>' + esc(lib(MODULES, x.module)) + (x.gravite === 'bloquant' ? ' <span class="as-bloquant">bloquant</span>' : '') + '</b><small>' + esc((x.message || 'Capture d\'écran').slice(0, 110)) + '</small></span>' +
          '<span class="as-ligne-meta">' + esc(x.auteur.nom || x.auteur.email) + '<br>' + esc(dateFr(x.le)) + '</span></button>'; }).join('')
        : '<p class="text-muted small mb-0">Aucune demande ' + (adm.filtre === 'ouvert' ? 'à traiter.' : 'dans cette liste.') + '</p>');
  }
  async function monterAdmin() {
    var el = $('assistanceAdminRoot'); if (!el) return;
    if (!el.dataset.asPret) {
      el.dataset.asPret = '1';
      el.addEventListener('click', async function (e) {
        var b = e.target.closest ? e.target.closest('[data-asa]') : null; if (!b) return;
        var a = b.getAttribute('data-asa'), v = b.getAttribute('data-v');
        if (a === 'filtre') { adm.filtre = v; return vueAdmin(); }
        if (a === 'ouvrir') { adm.choisi = v; return vueAdmin(); }
        if (a === 'retour') { adm.choisi = null; return vueAdmin(); }
        if (a === 'etat') { var r = await appel('POST', '/api/assistance', { action: 'etat', id: adm.choisi, etat: v });
          if (r.ok) { adm.liste = adm.liste.map(function (x) { return x.numero === adm.choisi ? r.data.signalement : x; }); adm.choisi = null; } vueAdmin(); }
      });
    }
    adm.liste = null; adm.choisi = null; adm.erreur = ''; vueAdmin();
    var r = await appel('GET', '/api/assistance?liste=1');
    if (r.ok) adm.liste = r.data.signalements || []; else adm.erreur = r.data.error || 'Lecture impossible.';
    vueAdmin();
  }
  window.FidiAssistance = { ouvrir: ouvrir, monterAdmin: monterAdmin };
})();
