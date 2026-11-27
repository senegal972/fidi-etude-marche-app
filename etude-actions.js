// Bandeau de l'étude après analyse : « Pour qui est cette étude ? » (client ou essai, contact compact) et tableau des actions.
// Le nom reste dans #inputDestinataire (lu par la référence, le rapport, l'avis, la sauvegarde). L'e-mail et le téléphone servent à
// pré-remplir la facture et l'avis ; « Mémoriser » range le contact dans la liste commune « fidi:clients » (étude, avis, facture).
// Rien n'est envoyé au serveur depuis ce module.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CLE = 'fidi:clients';
  function clients() { try { var a = JSON.parse(localStorage.getItem(CLE) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function tous() { return typeof window.etudeAllClients === 'function' ? window.etudeAllClients() : clients(); }
  var norme = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  function nature() { var t = $('etudeNatureTest'); return t && t.checked ? 'test' : 'client'; }
  function dire(texte, erreur) { var e = $('eaEtat'); if (!e) return; e.textContent = texte || ''; e.style.color = erreur ? '#a12020' : ''; }

  // Contact courant, lu par la facture (facture.js) : { nature, nom, email, telephone }.
  window.fidiEtudeContact = function () {
    return { nature: nature(), nom: nature() === 'test' ? '' : (($('inputDestinataire') || {}).value || '').trim(),
      email: (($('etudeContactEmail') || {}).value || '').trim(), telephone: (($('etudeContactTel') || {}).value || '').trim() };
  };

  function appliquerNature() {
    var test = nature() === 'test', champs = $('eaChamps'), note = $('eaNoteTest'), dest = $('inputDestinataire');
    if (champs) champs.classList.toggle('d-none', test);
    if (note) note.classList.toggle('d-none', !test);
    if (dest) {
      if (test) { if (dest.value) dest.dataset.eaAvant = dest.value; dest.value = ''; }
      else if (!dest.value && dest.dataset.eaAvant) { dest.value = dest.dataset.eaAvant; }
      dest.dispatchEvent(new Event('input', { bubbles: true }));
    }
    dire('');
  }
  // Un nom déjà mémorisé ramène son e-mail et son téléphone (sans écraser une saisie).
  function completer() {
    var dest = $('inputDestinataire'); if (!dest) return;
    var n = norme(dest.value); if (!n) return;
    var c = tous().filter(function (x) { return norme(x.nom) === n || norme(x.label) === n; })[0];
    if (!c) return;
    var em = $('etudeContactEmail'), tel = $('etudeContactTel');
    if (em && !em.value && c.email) em.value = c.email;
    if (tel && !tel.value && c.telephone) tel.value = c.telephone;
  }
  function memoriser() {
    var c = window.fidiEtudeContact();
    if (!c.nom) { dire('Indiquez d\'abord le nom du contact.', true); var d = $('inputDestinataire'); if (d) d.focus(); return; }
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) { dire('Adresse e-mail invalide.', true); return; }
    var liste = clients(), n = norme(c.nom);
    var i = -1; liste.forEach(function (x, k) { if (norme(x.nom) === n || norme(x.label) === n) i = k; });
    if (i >= 0) { if (c.email) liste[i].email = c.email; if (c.telephone) liste[i].telephone = c.telephone; }
    else liste.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: c.nom.slice(0, 80), nom: c.nom, email: c.email, telephone: c.telephone, source: 'local' });
    try { localStorage.setItem(CLE, JSON.stringify(liste)); } catch (e) { dire('Ce navigateur refuse d\'enregistrer le contact.', true); return; }
    if (typeof window.etudeRefreshDatalist === 'function') window.etudeRefreshDatalist();
    dire(i >= 0 ? 'Contact mis à jour.' : 'Contact mémorisé : il vous sera proposé dans vos prochaines études, avis et factures.');
  }
  function demarrer() {
    if (!$('etudeActions')) return;
    ['etudeNatureClient', 'etudeNatureTest'].forEach(function (id) { var r = $(id); if (r) r.addEventListener('change', appliquerNature); });
    var dest = $('inputDestinataire');
    if (dest) { dest.addEventListener('change', completer); dest.addEventListener('blur', completer); dest.addEventListener('input', function () { dire(''); }); }
    var m = $('etudeContactMemo'); if (m) m.addEventListener('click', memoriser);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
