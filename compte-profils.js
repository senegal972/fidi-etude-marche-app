// Mon compte → « Profils & modules » (administrateur) : profils types d'utilisateurs et modules de l'analyse ouverts à chacun.
// Données : /api/templates (modules groupés, profils système et personnalisés). L'attribution d'un profil à un compte se fait
// dans la fiche du compte (champ « Profil type »). Styles : compte.css (.pf-*).
(function () {
  'use strict';
  var etat = { modules: [], profils: [], modifiable: false, courant: null, message: '', erreur: false, comptes: null };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var racine = function () { return document.getElementById('profilsRoot'); };
  var slugDe = function (nom) { return String(nom || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); };

  async function charger() {
    try {
      var r = await fetch('/api/templates', { credentials: 'same-origin' }); var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Lecture impossible.');
      etat.modules = d.modules || []; etat.profils = d.templates || []; etat.modifiable = !!d.custom_store;
    } catch (e) { etat.message = e.message || 'Lecture impossible.'; etat.erreur = true; }
    // Nombre de comptes par profil (liste des comptes déjà réservée à l'administrateur).
    try {
      var r2 = await fetch('/api/admin/users', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) });
      var d2 = await r2.json(); etat.comptes = {};
      (d2.users || []).forEach(function (u) { var k = u.template || ''; etat.comptes[k] = (etat.comptes[k] || 0) + 1; });
    } catch (e) { etat.comptes = null; }
  }
  function nbActifs(p) { return etat.modules.filter(function (m) { return !p.flags || p.flags[m.key] !== false; }).length; }
  function groupes() { var g = [], vus = {}; etat.modules.forEach(function (m) { var n = m.groupe || 'Modules'; if (!vus[n]) { vus[n] = { nom: n, modules: [] }; g.push(vus[n]); } vus[n].modules.push(m); }); return g; }

  function liste() {
    var cartes = etat.profils.map(function (p) {
      var n = etat.comptes ? (etat.comptes[p.slug] || 0) + (p.slug === 'complet' ? (etat.comptes[''] || 0) : 0) : null;
      return '<button type="button" class="pf-carte" data-pf="ouvrir" data-slug="' + esc(p.slug) + '"><span class="pf-carte-nom">' + esc(p.name) + (p.is_system ? ' <span class="badge bg-secondary">modèle</span>' : '') + '</span>' +
        '<span class="pf-carte-info">' + nbActifs(p) + ' modules sur ' + etat.modules.length + (n == null ? '' : ' · ' + n + ' compte' + (n > 1 ? 's' : '')) + '</span><i class="bi bi-chevron-right"></i></button>';
    }).join('');
    return (etat.message ? '<div class="alert ' + (etat.erreur ? 'alert-danger' : 'alert-success') + ' py-2 small" role="status">' + esc(etat.message) + '</div>' : '') +
      '<div class="cpt-carte"><h3>Profils d\'utilisateurs</h3>' +
      '<p class="pf-aide">Les profils marqués « modèle » ne se modifient pas : ouvrez-en un et dupliquez-le pour créer le vôtre. Un compte sans profil, comme un administrateur, voit tous les modules.</p>' +
      '<div class="pf-liste">' + cartes + '</div>' +
      (etat.modifiable ? '<button type="button" class="btn btn-sm btn-primary mt-2" data-pf="nouveau"><i class="bi bi-plus-lg me-1"></i>Nouveau profil</button>'
        : '<div class="alert alert-warning py-2 small mt-2 mb-0">L\'enregistrement de profils personnalisés n\'est pas réglé sur ce site.</div>') + '</div>';
  }
  function editeur(p) {
    var lecture = !!p.is_system || !etat.modifiable;
    var blocs = groupes().map(function (g) {
      return '<fieldset class="pf-groupe"><legend>' + esc(g.nom) + (lecture ? '' : ' <button type="button" class="cpt-lien-texte" data-pf="groupe" data-groupe="' + esc(g.nom) + '">tout cocher / décocher</button>') + '</legend>' +
        g.modules.map(function (m) { var on = !p.flags || p.flags[m.key] !== false;
          return '<label class="pf-module"><input class="form-check-input" type="checkbox" data-mod="' + esc(m.key) + '" data-groupe="' + esc(g.nom) + '"' + (on ? ' checked' : '') + (lecture ? ' disabled' : '') + '><span>' + esc(m.label) + '</span></label>'; }).join('') + '</fieldset>';
    }).join('');
    return '<div class="cpt-carte"><div class="d-flex align-items-center gap-2 mb-2"><button type="button" class="btn btn-sm btn-outline-secondary" data-pf="retour"><i class="bi bi-arrow-left me-1"></i>Profils</button>' +
      '<h3 class="mb-0">' + (p.__nouveau ? 'Nouveau profil' : esc(p.name)) + '</h3></div>' +
      (p.is_system ? '<div class="alert alert-secondary py-2 small">Profil modèle, en lecture seule. « Dupliquer » en crée une copie modifiable.</div>' : '') +
      (etat.message ? '<div class="alert ' + (etat.erreur ? 'alert-danger' : 'alert-success') + ' py-2 small" role="status">' + esc(etat.message) + '</div>' : '') +
      '<label class="form-label small mb-0" for="pfNom">Nom du profil</label><input id="pfNom" class="form-control form-control-sm mb-3" maxlength="100" value="' + esc(p.name || '') + '"' + (lecture ? ' disabled' : '') + ' placeholder="Ex. Agent immobilier, Banque, Notaire, Promoteur…">' +
      '<div class="pf-groupes">' + blocs + '</div>' +
      '<div class="pf-pied">' +
        (lecture ? '' : '<button type="button" class="btn btn-sm btn-primary" data-pf="enregistrer"><i class="bi bi-check-lg me-1"></i>Enregistrer</button>') +
        (etat.modifiable && !p.__nouveau ? '<button type="button" class="btn btn-sm btn-outline-primary" data-pf="dupliquer"><i class="bi bi-copy me-1"></i>Dupliquer</button>' : '') +
        (!lecture && p.id ? '<button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-pf="supprimer"><i class="bi bi-trash me-1"></i>Supprimer</button>' : '') +
      '</div></div>';
  }
  function afficher() { var el = racine(); if (!el) return; el.innerHTML = etat.courant ? editeur(etat.courant) : liste(); }
  function lireCases() { var f = {}; [].forEach.call(racine().querySelectorAll('[data-mod]'), function (c) { f[c.getAttribute('data-mod')] = c.checked; }); return f; }
  async function poster(corps) {
    try { var r = await fetch('/api/templates', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
      var d = await r.json().catch(function () { return {}; }); return { ok: r.ok, data: d }; }
    catch (e) { return { ok: false, data: { error: 'Connexion impossible. Réessayez.' } }; }
  }
  async function clic(e) {
    var b = e.target.closest('[data-pf]'); if (!b) return;
    var a = b.getAttribute('data-pf'), p = etat.courant;
    if (a === 'ouvrir') { var t = etat.profils.filter(function (x) { return x.slug === b.getAttribute('data-slug'); })[0]; if (t) { etat.courant = JSON.parse(JSON.stringify(t)); etat.message = ''; afficher(); } return; }
    if (a === 'nouveau') { etat.courant = { __nouveau: true, name: '', slug: '', flags: {}, is_system: false }; etat.message = ''; return afficher(); }
    if (a === 'retour') { etat.courant = null; etat.message = ''; return afficher(); }
    if (a === 'dupliquer') { etat.courant = { __nouveau: true, name: (p.name || '') + ' (copie)', slug: '', flags: p.is_system ? Object.assign({}, p.flags) : lireCases(), is_system: false }; etat.message = ''; return afficher(); }
    if (a === 'groupe') { var cases = [].filter.call(racine().querySelectorAll('[data-mod]'), function (c) { return c.getAttribute('data-groupe') === b.getAttribute('data-groupe'); });
      var tous = cases.every(function (c) { return c.checked; }); cases.forEach(function (c) { c.checked = !tous; }); return; }
    if (a === 'enregistrer') {
      var nom = (document.getElementById('pfNom').value || '').trim(), flags = lireCases();
      if (nom.length < 2) { etat.message = 'Donnez un nom au profil.'; etat.erreur = true; p.flags = flags; return afficher(); }
      var slug = p.slug || slugDe(nom);
      if (p.__nouveau && etat.profils.some(function (x) { return x.slug === slug; })) slug = (slug.slice(0, 34) + '-' + Date.now().toString(36).slice(-4));
      var r = await poster({ action: 'save', id: p.id, name: nom, slug: slug, flags: flags });
      if (!r.ok) { etat.message = r.data.error || 'Enregistrement impossible.'; etat.erreur = true; p.name = nom; p.flags = flags; return afficher(); }
      window._templates = null; etat.courant = null; await charger(); etat.message = 'Profil « ' + nom + ' » enregistré. Il s\'applique à la prochaine connexion des comptes qui le portent.'; etat.erreur = false; return afficher();
    }
    if (a === 'supprimer') {
      if (!window.confirm('Supprimer le profil « ' + p.name + ' » ? Les comptes qui le portent verront de nouveau tous les modules.')) return;
      var r2 = await poster({ action: 'delete', id: p.id });
      if (!r2.ok) { etat.message = r2.data.error || 'Suppression impossible.'; etat.erreur = true; return afficher(); }
      window._templates = null; etat.courant = null; await charger(); etat.message = 'Profil supprimé.'; etat.erreur = false; return afficher();
    }
  }
  async function monter() {
    var el = racine(); if (!el) return;
    if (!el.dataset.pfPret) { el.dataset.pfPret = '1'; el.addEventListener('click', clic); }
    etat.courant = null; etat.message = ''; etat.erreur = false;
    el.innerHTML = '<div class="text-muted small">Chargement…</div>';
    await charger(); afficher();
  }
  window.FidiProfils = { monter: monter };
})();
