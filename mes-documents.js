// « Mes documents » : études et avis de valeur classés par propriétaire — les miens, ceux de mon groupe, tous les comptes
// (administrateur) — avec le réglage « qui voit mes documents ». Le serveur ne renvoie que ce que le compte a le droit de voir
// (_documents.mjs) : cet écran présente, il ne filtre pas la confidentialité. Styles : mes-documents.css.
(function () {
  'use strict';
  var etat = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { return n == null || n === '' || !isFinite(Number(n)) ? '' : Math.round(Number(n)).toLocaleString('fr-FR') + ' €'; };
  var dateFr = function (d) { var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  var LIB = { prive: 'par moi seul', groupe: 'par tous les membres de mon groupe', choisi: 'par les personnes que j\'ai choisies' };

  async function lire(url) {
    try { var r = await fetch(url, { credentials: 'same-origin' }); var d = await r.json().catch(function () { return {}; }); return { ok: r.ok, data: d }; }
    catch (e) { return { ok: false, data: { error: 'Connexion impossible.' } }; }
  }
  async function poster(url, corps) {
    try { var r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
      var d = await r.json().catch(function () { return {}; }); return { ok: r.ok, data: d }; }
    catch (e) { return { ok: false, data: { error: 'Connexion impossible.' } }; }
  }

  // Réunit études (Notion), avis en ligne et anciens avis (Notion) en une seule liste, chacun avec son propriétaire.
  async function charger() {
    var res = await Promise.all([lire('/api/documents'), lire('/api/notion-list?kind=etude&limit=100'), lire('/api/avis-store?liste=1'), lire('/api/notion-list?kind=avis&limit=100')]);
    var conf = res[0], etudes = res[1], avis = res[2], anciens = res[3];
    etat.moi = (conf.ok && conf.data.moi) || { email: '', groupe: '', partage: 'prive', avec: [], admin: false };
    etat.membres = (conf.ok && conf.data.membres) || [];
    etat.erreurs = [];
    if (!conf.ok) etat.erreurs.push('Le réglage de confidentialité n\'a pas pu être lu.');
    if (!etudes.ok) etat.erreurs.push('Les études n\'ont pas pu être lues.');
    if (!avis.ok && !anciens.ok) etat.erreurs.push('Les avis de valeur n\'ont pas pu être lus.');
    var docs = [], vus = {};
    ((etudes.data && etudes.data.items) || []).forEach(function (m) {
      docs.push({ type: 'etude', ref: m.ref, adresse: m.adresse, commune: m.commune, client: m.client, date: m.date, valeur: m.estimation,
        proprietaire: m.proprietaire || '', nom: m.proprietaire_nom || '', groupe: m.groupe || '', aMoi: !!m.a_moi, modifiable: !!m.modifiable, verrou: !!m.verrou, raison: m.verrou_raison || '' });
    });
    ((avis.data && avis.data.documents) || []).forEach(function (d) {
      vus[d.ref] = 1;
      docs.push({ type: 'avis', ref: d.ref, adresse: d.adresse, commune: d.commune, client: d.client, date: d.date || String(d.maj || '').slice(0, 10), valeur: d.valeur_max || d.valeur_min,
        proprietaire: d.proprietaire || (d.a_moi ? etat.moi.email : ''), nom: d.proprietaire_nom || d.auteur || '', groupe: d.groupe || '', aMoi: !!d.a_moi, modifiable: !!d.a_moi });
    });
    ((anciens.data && anciens.data.items) || []).forEach(function (m) {
      if (vus[m.ref]) return;
      docs.push({ type: 'avis', ref: m.ref, adresse: m.adresse, commune: m.commune, client: m.client, date: m.date, valeur: m.valeur,
        proprietaire: m.proprietaire || '', nom: m.proprietaire_nom || '', groupe: m.groupe || '', aMoi: !!m.a_moi, modifiable: !!m.modifiable, ancien: true });
    });
    docs.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    etat.docs = docs;
    etat.comptes = null;
  }

  function filtres(d) {
    if (etat.type !== 'tous' && d.type !== etat.type) return false;
    var f = etat.recherche.trim().toLowerCase();
    return !f || [d.ref, nomRef(d), d.adresse, d.commune, d.client, d.nom, d.groupe].join(' ').toLowerCase().indexOf(f) >= 0;
  }
  var dePortee = { moi: function (d) { return d.aMoi; }, groupe: function (d) { return !d.aMoi && !!d.proprietaire && !!etat.moi.groupe && d.groupe && d.groupe.trim().toLowerCase() === etat.moi.groupe.trim().toLowerCase(); }, tous: function () { return true; } };

  // Référence affichée : initiales de l'auteur à la place de « FIDI » (nomenclature.js).
  function nomRef(d) { var N = window.FidiNomenclature; return N ? N.afficher(d.ref, d.nom || (d.aMoi ? N.moi() : '')) : d.ref; }

  function ligne(d) {
    var sous = [d.adresse, d.commune].filter(Boolean).join(' · ');
    return '<div class="md-doc" data-ref="' + esc(d.ref) + '" data-type="' + d.type + '">' +
      '<span class="md-type md-type-' + d.type + '" title="' + (d.type === 'etude' ? 'Étude de marché' : 'Avis de valeur') + '"><i class="bi ' + (d.type === 'etude' ? 'bi-bar-chart-line' : 'bi-file-earmark-text') + '"></i></span>' +
      '<div class="md-doc-corps"><div class="md-doc-ref">' + esc(nomRef(d)) + (d.client ? ' <span class="md-client"><i class="bi bi-person"></i> ' + esc(d.client) + '</span>' : '') +
        (d.verrou ? ' <span class="md-verrou" title="Dossier ' + esc(d.raison || 'envoyé') + ' : suppression interdite"><i class="bi bi-lock-fill"></i></span>' : '') + '</div>' +
        '<div class="md-doc-sous">' + esc([dateFr(d.date), sous, eur(d.valeur)].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div class="md-doc-actions">' +
        (etat.moi.admin && !d.proprietaire && d.type === 'etude' || etat.moi.admin && !d.proprietaire && d.ancien ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-md="attribuer" title="Donner ce dossier à un compte"><i class="bi bi-person-plus"></i><span class="md-lbl"> Attribuer</span></button>' : '') +
        (d.type === 'etude' && d.modifiable && !d.verrou ? '<button type="button" class="btn btn-sm btn-outline-danger" data-md="supprimer" title="Supprimer cette étude" aria-label="Supprimer"><i class="bi bi-trash"></i></button>' : '') +
        '<button type="button" class="btn btn-sm btn-primary" data-md="ouvrir">' + (d.aMoi || etat.moi.admin ? 'Ouvrir' : 'Consulter') + '</button></div></div>';
  }
  function parPersonne(docs) {
    var ordre = [], par = {};
    docs.forEach(function (d) { var k = d.proprietaire || ''; if (!par[k]) { par[k] = { email: k, nom: d.nom || k, groupe: d.groupe || '', docs: [] }; ordre.push(par[k]); } par[k].docs.push(d); });
    return ordre.sort(function (a, b) { return (a.email ? 0 : 1) - (b.email ? 0 : 1) || a.nom.localeCompare(b.nom); });
  }
  function blocPersonne(p) {
    return '<section class="md-personne"><h6>' + (p.email ? '<i class="bi bi-person-circle me-1"></i>' + esc(p.nom) + (p.nom !== p.email ? ' <small>' + esc(p.email) + '</small>' : '')
      : '<i class="bi bi-archive me-1"></i>Sans propriétaire <small>dossiers enregistrés avant la séparation par compte — visibles de l\'administrateur seul</small>') +
      ' <span class="md-compte">' + p.docs.length + '</span></h6>' + p.docs.map(ligne).join('') + '</section>';
  }
  function corpsListe() {
    var docs = etat.docs.filter(dePortee[etat.portee]).filter(filtres);
    if (!docs.length) {
      var vide = { moi: 'Aucun document à votre nom' + (etat.recherche || etat.type !== 'tous' ? ' pour ce filtre.' : '. Une étude sauvegardée ou un avis enregistré apparaîtra ici.'),
        groupe: !etat.moi.groupe ? 'Votre compte n\'appartient à aucun groupe : aucun document ne peut vous être partagé. L\'administrateur attribue le groupe.' : 'Aucun membre de votre groupe ne partage de document avec vous pour l\'instant.',
        tous: 'Aucun document.' }[etat.portee];
      return '<p class="md-vide">' + esc(vide) + '</p>';
    }
    if (etat.portee === 'moi') return docs.map(ligne).join('');
    if (etat.portee === 'groupe') return parPersonne(docs).map(blocPersonne).join('');
    // Administrateur : par groupe, puis par personne.
    var groupes = [], par = {};
    docs.forEach(function (d) { var g = d.proprietaire ? (d.groupe || 'Sans groupe') : '￿Sans propriétaire'; if (!par[g]) { par[g] = []; groupes.push(g); } par[g].push(d); });
    groupes.sort(function (a, b) { return a.localeCompare(b); });
    return groupes.map(function (g) {
      return (g.charAt(0) === '￿' ? '' : '<div class="md-groupe"><i class="bi bi-people-fill me-1"></i>' + esc(g) + '</div>') + parPersonne(par[g]).map(blocPersonne).join('');
    }).join('');
  }
  function bandeauConfidentialite() {
    var m = etat.moi, n = (m.avec || []).length;
    var texte = m.partage === 'choisi' ? 'par ' + n + ' personne' + (n > 1 ? 's' : '') + ' de mon groupe' : LIB[m.partage] || LIB.prive;
    if (etat.reglage) {
      var sansGroupe = !m.groupe;
      return '<div class="md-conf md-conf-ouvert"><div class="md-conf-titre"><i class="bi bi-shield-lock me-1"></i>Qui peut voir mes documents ?</div>' +
        (sansGroupe ? '<p class="md-aide">Votre compte n\'appartient à aucun groupe : vos documents ne sont visibles que de vous (et de l\'administrateur). L\'administrateur attribue le groupe.</p>' : '') +
        ['prive', 'groupe', 'choisi'].map(function (k) {
          var lib = { prive: 'Moi seul', groupe: 'Tous les membres de mon groupe' + (m.groupe ? ' « ' + esc(m.groupe) + ' »' : ''), choisi: 'Seulement les personnes que je choisis dans mon groupe' }[k];
          return '<label class="md-radio"><input class="form-check-input" type="radio" name="mdPartage" value="' + k + '"' + (m.partage === k ? ' checked' : '') + (sansGroupe && k !== 'prive' ? ' disabled' : '') + '><span>' + lib + '</span></label>';
        }).join('') +
        '<div class="md-membres' + (m.partage === 'choisi' ? '' : ' d-none') + '" id="mdMembres">' + (etat.membres.length ? etat.membres.map(function (c) {
          return '<label class="md-radio"><input class="form-check-input" type="checkbox" value="' + esc(c.email) + '"' + ((m.avec || []).indexOf(c.email) >= 0 ? ' checked' : '') + '><span>' + esc(c.nom) + (c.nom !== c.email ? ' <small>' + esc(c.email) + '</small>' : '') + '</span></label>';
        }).join('') : '<p class="md-aide">Aucun autre membre dans votre groupe pour l\'instant.</p>') + '</div>' +
        '<p class="md-aide">Un partage donne la lecture seule : personne d\'autre que vous ne modifie ni ne supprime vos documents. Les comptes d\'un autre groupe ne les voient jamais. ' +
          (m.ecosysteme === 'public' ? 'L\'administrateur de la plateforme n\'a pas accès à vos documents, à vos clients ni à vos factures : il ne gère que votre compte (mot de passe, crédits).' : 'L\'administrateur voit vos documents.') + '</p>' +
        '<div class="md-conf-pied"><button type="button" class="btn btn-sm btn-primary" data-md="enregistrer-partage"><i class="bi bi-check-lg me-1"></i>Enregistrer</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-md="fermer-partage">Annuler</button><span class="md-message" id="mdMessage" role="status"></span></div></div>';
    }
    return '<div class="md-conf"><span><i class="bi bi-shield-lock me-1"></i>Mes documents sont visibles <b>' + esc(texte) + '</b>' + (m.groupe ? ' <small>· groupe « ' + esc(m.groupe) + ' »</small>' : ' <small>· aucun groupe</small>') +
      ' <small>· ' + (m.ecosysteme === 'public' ? 'l\'administrateur de la plateforme n\'y a pas accès' : 'l\'administrateur les voit') + '</small></span>' +
      '<button type="button" class="btn btn-sm btn-outline-primary" data-md="ouvrir-partage">Modifier</button></div>';
  }
  function afficher() {
    var c = $('mdCorps'); if (!c) return;
    if (!etat.docs) { c.innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Chargement…</div>'; return; }
    var nb = function (p) { return etat.docs.filter(dePortee[p]).length; };
    var onglet = function (k, lib, icone) { return '<button type="button" class="md-onglet' + (etat.portee === k ? ' actif' : '') + '" data-md="portee" data-portee="' + k + '" aria-pressed="' + (etat.portee === k) + '"><i class="bi ' + icone + '"></i> ' + lib + ' <span class="md-compte">' + nb(k) + '</span></button>'; };
    var puce = function (k, lib) { return '<button type="button" class="md-puce' + (etat.type === k ? ' actif' : '') + '" data-md="type" data-type-doc="' + k + '" aria-pressed="' + (etat.type === k) + '">' + lib + '</button>'; };
    c.innerHTML = bandeauConfidentialite() +
      (etat.erreurs.length ? '<div class="alert alert-warning py-2 small">' + esc(etat.erreurs.join(' ')) + '</div>' : '') +
      '<div class="md-onglets" role="group" aria-label="Documents à afficher">' + onglet('moi', 'Les miens', 'bi-person') + onglet('groupe', 'Mon groupe', 'bi-people') + (etat.moi.admin ? onglet('tous', 'Tous les comptes', 'bi-building') : '') + '</div>' +
      '<div class="md-filtres">' + puce('tous', 'Tout') + puce('etude', 'Études de marché') + puce('avis', 'Avis de valeur') +
        '<input type="search" class="form-control form-control-sm" id="mdRecherche" placeholder="Rechercher une adresse, un client, une référence…" autocomplete="off" value="' + esc(etat.recherche) + '"></div>' +
      '<div class="md-liste" id="mdListe">' + corpsListe() + '</div>';
  }
  function fermer() { var el = $('mesDocumentsModal'), M = el && window.bootstrap && window.bootstrap.Modal.getInstance(el); if (M) M.hide(); }

  async function clic(e) {
    var b = e.target.closest ? e.target.closest('[data-md]') : null; if (!b) return;
    var a = b.getAttribute('data-md');
    if (a === 'portee') { etat.portee = b.getAttribute('data-portee'); return afficher(); }
    if (a === 'type') { etat.type = b.getAttribute('data-type-doc'); return afficher(); }
    if (a === 'ouvrir-partage') { etat.reglage = true; return afficher(); }
    if (a === 'fermer-partage') { etat.reglage = false; return afficher(); }
    if (a === 'enregistrer-partage') {
      var mode = (document.querySelector('input[name="mdPartage"]:checked') || {}).value || 'prive';
      var avec = [].map.call(document.querySelectorAll('#mdMembres input:checked'), function (x) { return x.value; });
      var msg = $('mdMessage'); if (msg) { msg.textContent = 'Enregistrement…'; msg.className = 'md-message'; }
      var r = await poster('/api/documents', { action: 'partage', mode: mode, avec: avec });
      if (!r.ok) { if (msg) { msg.textContent = r.data.error || 'Enregistrement impossible.'; msg.className = 'md-message md-erreur'; } return; }
      etat.moi = r.data.moi; etat.membres = r.data.membres || etat.membres; etat.reglage = false; return afficher();
    }
    var ligneEl = b.closest('.md-doc'); if (!ligneEl) return;
    var ref = ligneEl.getAttribute('data-ref'), type = ligneEl.getAttribute('data-type');
    var doc = etat.docs.filter(function (d) { return d.ref === ref && d.type === type; })[0]; if (!doc) return;
    if (a === 'ouvrir') {
      fermer();
      if (type === 'etude') { if (typeof window.reopenEtude === 'function') window.reopenEtude(ref); return; }
      if (window.AvisDossiers) window.AvisDossiers.ouvrir(ref); else if (window.AvisValeur && window.AvisValeur.cloud) window.AvisValeur.cloud();
      return;
    }
    if (a === 'supprimer') {
      if (!window.confirm('Supprimer l\'étude « ' + ref + ' » ?\n\nElle part à la corbeille (récupérable 30 jours par l\'administrateur).')) return;
      b.disabled = true;
      var rs = await poster('/api/notion-delete', { kind: 'etude', ref: ref });
      if (rs.ok && rs.data.ok) { etat.docs = etat.docs.filter(function (d) { return d !== doc; }); return afficher(); }
      b.disabled = false; window.alert(rs.data.error || 'Suppression impossible.'); return;
    }
    if (a === 'attribuer') {
      if (!etat.comptes) { var rc = await poster('/api/admin/users', { action: 'list' }); etat.comptes = (rc.ok && rc.data.users) || []; }
      var actions = ligneEl.querySelector('.md-doc-actions');
      actions.innerHTML = '<select class="form-select form-select-sm md-attrib" aria-label="Compte à qui attribuer ce dossier"><option value="">Attribuer à…</option>' +
        etat.comptes.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.nom || u.email) + (u.reseau ? ' — ' + esc(u.reseau) : '') + '</option>'; }).join('') + '</select>';
      actions.querySelector('select').addEventListener('change', async function () {
        if (!this.value) return;
        var ra = await poster('/api/documents', { action: 'attribuer', kind: type, ref: ref, email: this.value });
        if (!ra.ok) { window.alert(ra.data.error || 'Attribution impossible.'); return; }
        await charger(); afficher();
      });
    }
  }
  async function ouvrir() {
    if (typeof window.bootstrap === 'undefined') { window.alert('Interface non chargée. Rechargez la page.'); return; }
    var racine = $('mesDocumentsRoot'); if (!racine) { racine = document.createElement('div'); racine.id = 'mesDocumentsRoot'; document.body.appendChild(racine); }
    racine.innerHTML = '<div class="modal fade" id="mesDocumentsModal" tabindex="-1" aria-labelledby="mdTitre"><div class="modal-dialog modal-lg modal-dialog-scrollable modal-fullscreen-md-down"><div class="modal-content">' +
      '<div class="modal-header md-tete"><h5 class="modal-title" id="mdTitre"><i class="bi bi-folder2-open me-1"></i>Mes documents</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fermer"></button></div>' +
      '<div class="modal-body md-corps" id="mdCorps"></div></div></div></div>';
    var el = $('mesDocumentsModal');
    etat = { docs: null, moi: { partage: 'prive', avec: [], groupe: '', admin: false }, membres: [], portee: 'moi', type: 'tous', recherche: '', reglage: false, erreurs: [] };
    el.addEventListener('click', clic);
    el.addEventListener('input', function (e) { if (e.target.id === 'mdRecherche') { etat.recherche = e.target.value; var l = $('mdListe'); if (l) l.innerHTML = corpsListe(); } });
    el.addEventListener('change', function (e) { if (e.target.name === 'mdPartage') { var m = $('mdMembres'); if (m) m.classList.toggle('d-none', e.target.value !== 'choisi'); } });
    el.addEventListener('hidden.bs.modal', function () { el.remove(); });
    if (typeof window.fidiStackModal === 'function') window.fidiStackModal(el);
    afficher();
    new window.bootstrap.Modal(el).show();
    await charger(); afficher();
  }
  window.FidiDocuments = { ouvrir: ouvrir };
})();
