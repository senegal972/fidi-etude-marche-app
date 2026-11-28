// Avis de valeur — enregistrement en ligne et fenêtre « Mes avis & versions ».
//
// Les avis sont rattachés au compte (/api/avis-store) : on les retrouve depuis n'importe quel
// poste, photos comprises. Chaque PDF, impression, partage ou facture fige une version
// « diffusée », jamais remplacée : c'est la trace de ce qui a été remis à un tiers.
//
// Ce module ne connaît de l'avis que l'API publique d'avis-valeur.js (window.AvisValeur).
(function () {
  'use strict';

  var API = '/api/avis-store';
  var MOTIFS = {
    manuel: { nom: 'Enregistrée', icone: 'bi-save' },
    auto: { nom: 'Automatique', icone: 'bi-arrow-repeat' },
    import: { nom: 'Importée', icone: 'bi-upload' },
    pdf: { nom: 'PDF généré', icone: 'bi-file-earmark-pdf-fill' },
    impression: { nom: 'Imprimée', icone: 'bi-printer-fill' },
    partage: { nom: 'Partagée', icone: 'bi-share-fill' },
    facture: { nom: 'Facturée', icone: 'bi-receipt' },
    word: { nom: 'Export Word', icone: 'bi-file-earmark-word-fill' }
  };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var euros = function (n) { return Math.round(n).toLocaleString('fr-FR') + ' €'; };
  var fourchette = function (r) {
    if (!r || !r.valeur_min || !r.valeur_max) return '';
    return r.valeur_min === r.valeur_max ? euros(r.valeur_min) : euros(r.valeur_min) + ' – ' + euros(r.valeur_max);
  };
  var dateHeure = function (v) {
    // Une date sans heure (« 2026-09-02 ») est affichée telle quelle, sans décalage de fuseau.
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return new Date(v + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    var d = v ? new Date(v) : null;
    if (!d || isNaN(d)) return '';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  // ── Appels serveur : { ok, code, ...réponse } ; jamais d'exception ──────────
  function appel(methode, params, corps) {
    var url = API;
    if (params) {
      url += '?' + Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; })
        .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    }
    var options = { method: methode, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (corps) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(corps); }
    return fetch(url, options).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        j = j || {}; j.ok = r.ok; j.code = r.status; return j;
      });
    }).catch(function () { return { ok: false, code: 0, error: 'Réseau indisponible' }; });
  }
  function messageErreur(r) {
    if (r.code === 401) return 'Connectez-vous pour enregistrer vos avis en ligne.';
    if (r.code === 0) return 'Pas de connexion : l\'avis reste enregistré sur ce poste.';
    return r.error || 'Enregistrement en ligne impossible.';
  }

  // Empreinte identique à celle du serveur (SHA-1 du JSON) : dit si deux copies sont les mêmes.
  function empreinte(data) {
    try {
      var octets = new TextEncoder().encode(JSON.stringify(data));
      return crypto.subtle.digest('SHA-1', octets).then(function (h) {
        return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }).catch(function () { return ''; });
    } catch (e) { return Promise.resolve(''); }
  }

  // ── État de synchronisation par avis, sur ce poste ───────────────────────────
  var CLE_SYNC = 'fidi:avis:sync:';
  function lireSync(ref) { try { return JSON.parse(localStorage.getItem(CLE_SYNC + ref) || '{}') || {}; } catch (e) { return {}; } }
  function ecrireSync(ref, patch) {
    try { localStorage.setItem(CLE_SYNC + ref, JSON.stringify(Object.assign(lireSync(ref), patch))); } catch (e) {}
  }

  function enregistrer(ref, data, resume, version) {
    ecrireSync(ref, { attente: true });
    return appel('POST', null, { action: 'enregistrer', ref: ref, data: data, resume: resume, version: version || undefined })
      .then(function (r) {
        if (r.ok) ecrireSync(ref, { attente: false, enLigne: r.maj });
        return r;
      });
  }

  // ── Fenêtre « Mes avis & versions » ─────────────────────────────────────────
  var etat = { docs: [], choisi: null, versions: [], apercu: null, filtre: '', admin: false };

  // Référence affichée : initiales de l'auteur à la place de « FIDI » (nomenclature.js).
  function nomRef(d) { var N = window.FidiNomenclature; return N ? N.afficher(d.ref, d.aMoi ? N.moi() : d.nomAuteur) : d.ref; }

  function avisLocaux() {
    try { return (window.AvisValeur.listAvis() || []).filter(function (m) { return m && m.ref; }); } catch (e) { return []; }
  }

  function gabarit() {
    return '<div class="modal fade" id="avisDossiersModal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header avd-entete"><h5 class="modal-title"><i class="bi bi-folder2-open me-2"></i>Mes avis &amp; versions</h5>' +
      '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fermer"></button></div>' +
      '<div class="modal-body avd-corps">' +
        '<div class="avd-col avd-liste">' +
          '<input type="search" class="form-control form-control-sm mb-2" id="avdFiltre" placeholder="Rechercher un client, une commune, une référence…" autocomplete="off">' +
          '<div id="avdSauvEtat" class="avd-sauv-etat" role="status"></div><div id="avdMessage"></div><div id="avdDocs" class="avd-defile"><div class="avd-vide"><span class="spinner-border spinner-border-sm me-2"></span>Chargement…</div></div>' +
        '</div>' +
        '<div class="avd-col avd-versions"><div id="avdVersions" class="avd-defile"><div class="avd-vide">Choisissez un avis dans la liste.</div></div></div>' +
        '<div class="avd-col avd-apercu"><div id="avdApercuBarre" class="avd-barre"></div><div id="avdApercu" class="avd-defile avd-feuille"><div class="avd-vide">L\'aperçu du document s\'affiche ici.</div></div></div>' +
      '</div>' +
      '<div class="modal-footer avd-pied"><span class="small text-muted me-auto avd-pied-note"><i class="bi bi-shield-check me-1"></i>Une version diffusée (PDF, impression, partage, facture) est conservée telle quelle et ne peut pas être supprimée.</span>' +
      '<button type="button" class="btn btn-sm btn-outline-primary" data-avd-action="sauvegarder" title="Télécharger sur ce poste un fichier contenant tous vos avis en ligne et leurs versions diffusées"><i class="bi bi-download me-1"></i>Tout sauvegarder</button>' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-avd-action="restaurer" title="Remettre en ligne les avis d\'un fichier de sauvegarde. Un avis déjà en ligne n\'est jamais remplacé."><i class="bi bi-upload me-1"></i>Restaurer</button>' +
      '<input type="file" id="avdFichier" accept="application/json,.json" class="d-none">' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Fermer</button></div>' +
      '</div></div></div>';
  }

  // filtre (facultatif) : texte posé d'office dans la recherche (ex. la référence choisie dans « Mes documents »).
  function ouvrir(filtre) {
    if (typeof bootstrap === 'undefined' || !window.AvisValeur) { alert('Interface non chargée. Rechargez la page.'); return; }
    var racine = document.getElementById('avisDossiersRoot');
    if (!racine) { racine = document.createElement('div'); racine.id = 'avisDossiersRoot'; document.body.appendChild(racine); }
    racine.innerHTML = gabarit();
    var el = document.getElementById('avisDossiersModal');
    el.addEventListener('hidden.bs.modal', function () { el.remove(); });
    el.addEventListener('click', surClic);
    el.querySelector('#avdFichier').addEventListener('change', function () { restaurer(this.files && this.files[0]); });
    el.querySelector('#avdFiltre').addEventListener('input', function () { etat.filtre = this.value; afficherDocs(); });
    if (typeof window.fidiStackModal === 'function') window.fidiStackModal(el);
    new bootstrap.Modal(el).show();
    etat = { docs: [], choisi: null, versions: [], apercu: null, filtre: typeof filtre === 'string' ? filtre : '', admin: false };
    if (etat.filtre) el.querySelector('#avdFiltre').value = etat.filtre;
    charger();
  }

  // Réunit les avis en ligne, ceux de ce poste et les anciens dossiers Notion, par référence.
  function charger() {
    var locaux = avisLocaux();
    var anciens = fetch('/api/notion-list?kind=avis&limit=100', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { return (j && j.items) || []; }).catch(function () { return []; });
    return Promise.all([appel('GET', { liste: 1 }), anciens]).then(function (res) {
      var enLigne = res[0], notion = res[1];
      var parCle = {}, docs = [];
      var cle = function (ref, proprio) { return (proprio || '') + '|' + ref; };
      etat.admin = !!enLigne.admin;
      (enLigne.documents || []).forEach(function (d) {
        var o = { ref: d.ref, proprio: d.a_moi ? '' : d.proprio, aMoi: !!d.a_moi, enLigne: true, local: false, ancien: false,
          client: d.client, commune: d.commune, type: d.type, date: d.date, maj: d.maj, auteur: d.auteur, nomAuteur: d.proprietaire_nom || '', emailAuteur: d.proprietaire || '',
          valeur_min: d.valeur_min, valeur_max: d.valeur_max, diffusions: d.diffusions || 0 };
        parCle[cle(o.ref, o.proprio)] = o; docs.push(o);
      });
      locaux.forEach(function (m) {
        var o = parCle[cle(m.ref, '')];
        if (o) { o.local = true; return; }
        o = { ref: m.ref, proprio: '', aMoi: true, enLigne: false, local: true, ancien: false, client: m.client, commune: m.commune,
          type: m.type, date: m.date, maj: m.date, valeurTexte: m.valeur, diffusions: 0 };
        parCle[cle(o.ref, '')] = o; docs.push(o);
      });
      notion.forEach(function (n) {
        if (!n || !n.ref || parCle[cle(n.ref, '')]) return;
        if (docs.some(function (d) { return d.ref === n.ref; })) return; // déjà en ligne chez son auteur
        // Le serveur ne renvoie que les dossiers visibles ; a_moi dit si celui-ci est le mien (sinon : partagé, en lecture).
        docs.push({ ref: n.ref, proprio: '', aMoi: n.a_moi !== false, auteur: n.proprietaire_nom || '', nomAuteur: n.proprietaire_nom || '', emailAuteur: n.proprietaire || '', enLigne: false, local: false, ancien: true, client: n.client, commune: n.commune,
          type: n.type_bien, date: n.date, maj: n.date, valeur_min: n.valeur, valeur_max: n.valeur, diffusions: 0, verrou: !!n.verrou });
      });
      docs.sort(function (a, b) { return String(b.maj || '').localeCompare(String(a.maj || '')); });
      etat.docs = docs;
      var msg = document.getElementById('avdMessage');
      if (msg) {
        msg.innerHTML = enLigne.ok ? '' :
          '<div class="alert alert-warning small py-2 mb-2">' + esc(messageErreur(enLigne)) + ' Seuls les avis de ce poste sont affichés.</div>';
      }
      afficherDocs();
      if (enLigne.ok) mettreEnLigneLocaux();
    });
  }

  // Les avis restés sur ce seul poste sont envoyés en ligne, sans jamais écraser un avis en ligne.
  function mettreEnLigneLocaux() {
    var aEnvoyer = etat.docs.filter(function (d) { return d.local && !d.enLigne && d.aMoi; });
    if (!aEnvoyer.length) return;
    var msg = document.getElementById('avdMessage');
    var suite = Promise.resolve(), faits = 0, echecs = 0;
    aEnvoyer.forEach(function (d) {
      suite = suite.then(function () {
        var data = window.AvisValeur.lireLocal(d.ref);
        if (!data) return null;
        return enregistrer(d.ref, data, window.AvisValeur.resume(data), { motif: 'import', libelle: 'Mis en ligne depuis ce poste' }).then(function (r) {
          if (r.ok) { faits++; d.enLigne = true; d.maj = r.maj; } else echecs++;
        });
      });
    });
    suite.then(function () {
      if (msg && (faits || echecs)) {
        msg.innerHTML = '<div class="alert ' + (echecs ? 'alert-warning' : 'alert-success') + ' small py-2 mb-2">' +
          (faits ? faits + ' avis de ce poste ' + (faits > 1 ? 'ont été mis' : 'a été mis') + ' en ligne. ' : '') +
          (echecs ? echecs + ' n\'' + (echecs > 1 ? 'ont' : 'a') + ' pas pu l\'être (trop volumineux ou réseau).' : '') + '</div>';
      }
      afficherDocs();
    });
  }

  function badges(d) {
    var b = '';
    if (d.enLigne) b += '<span class="avd-badge avd-ok" title="Enregistré en ligne : accessible de tout poste"><i class="bi bi-cloud-check-fill"></i> En ligne</span>';
    else if (d.ancien) b += '<span class="avd-badge avd-gris" title="Ancien enregistrement Notion"><i class="bi bi-archive"></i> Ancien cloud</span>';
    else b += '<span class="avd-badge avd-alerte" title="Présent sur ce poste seulement"><i class="bi bi-pc-display"></i> Ce poste seulement</span>';
    if (d.diffusions) b += '<span class="avd-badge avd-or" title="Versions diffusées"><i class="bi bi-send-check-fill"></i> ' + d.diffusions + ' diffusée' + (d.diffusions > 1 ? 's' : '') + '</span>';
    if (!d.aMoi) b += '<span class="avd-badge avd-gris"><i class="bi bi-person"></i> ' + esc(d.auteur || 'autre compte') + '</span>';
    return b;
  }

  function afficherDocs() {
    var zone = document.getElementById('avdDocs'); if (!zone) return;
    var f = etat.filtre.trim().toLowerCase();
    var docs = etat.docs.filter(function (d) {
      return !f || [d.ref, nomRef(d), d.client, d.commune, d.type, d.auteur].join(' ').toLowerCase().indexOf(f) >= 0;
    });
    if (!docs.length) {
      zone.innerHTML = '<div class="avd-vide">' + (etat.docs.length ? 'Aucun avis ne correspond à la recherche.' : 'Aucun avis enregistré pour le moment.') + '</div>';
      return;
    }
    zone.innerHTML = docs.map(function (d) {
      var i = etat.docs.indexOf(d);
      var nom = d.client || [d.type, d.commune].filter(Boolean).join(' · ') || 'Sans destinataire';
      var actif = etat.choisi === d ? ' avd-actif' : '';
      return '<button type="button" class="avd-doc' + actif + '" data-avd-doc="' + i + '">' +
        '<span class="avd-nom">' + esc(nom) + '</span>' +
        '<span class="avd-sous">' + esc([d.client ? d.type : '', d.client ? d.commune : '', nomRef(d)].filter(Boolean).join(' · ')) + '</span>' +
        '<span class="avd-valeur">' + esc(fourchette(d) || d.valeurTexte || '—') + '</span>' +
        '<span class="avd-ligne">' + badges(d) + '<span class="avd-date">' + esc(dateHeure(d.maj) || d.date || '') + '</span></span>' +
        '</button>';
    }).join('');
  }

  function choisir(d) {
    etat.choisi = d; etat.versions = []; etat.apercu = null;
    afficherDocs();
    var zone = document.getElementById('avdVersions');
    zone.innerHTML = '<div class="avd-vide"><span class="spinner-border spinner-border-sm me-2"></span>Chargement des versions…</div>';
    var p = d.enLigne ? appel('GET', { ref: d.ref, versions: 1, proprio: d.proprio }) : Promise.resolve({ ok: true, versions: [] });
    p.then(function (r) {
      if (etat.choisi !== d) return;
      etat.versions = (r && r.versions) || [];
      afficherVersions(r && !r.ok ? messageErreur(r) : '');
      apercu('courant');
    });
  }

  function afficherVersions(erreur) {
    var d = etat.choisi, zone = document.getElementById('avdVersions'); if (!zone || !d) return;
    var nom = d.client || [d.type, d.commune].filter(Boolean).join(' · ') || nomRef(d);
    var supprimable = d.aMoi && !d.diffusions && !d.verrou;
    var html = '<button type="button" class="btn btn-sm btn-link avd-retour" data-avd-action="retour-liste"><i class="bi bi-arrow-up me-1"></i>Tous les avis</button>' +
      '<div class="avd-titre">' + esc(nom) + '<small>' + esc(nomRef(d)) + '</small></div>' +
      '<div class="d-flex gap-1 flex-wrap mb-2">' +
        '<button type="button" class="btn btn-sm btn-primary" data-avd-action="ouvrir"><i class="bi bi-pencil-square me-1"></i>Ouvrir l\'avis</button>' +
        (supprimable ? '<button type="button" class="btn btn-sm btn-outline-danger" data-avd-action="supprimer" title="Supprimer cet avis"><i class="bi bi-trash"></i></button>' :
          '<button type="button" class="btn btn-sm btn-outline-secondary" disabled title="' + (d.aMoi ? 'Avis diffusé ou facturé : suppression interdite' : 'Avis d\'un autre compte') + '"><i class="bi bi-lock-fill"></i></button>') +
      '</div>';
    if (erreur) html += '<div class="alert alert-warning small py-2">' + esc(erreur) + '</div>';
    html += '<button type="button" class="avd-version' + (etat.apercu === 'courant' ? ' avd-actif' : '') + '" data-avd-version="courant">' +
      '<span class="avd-nom"><i class="bi bi-pencil me-1"></i>Version de travail</span>' +
      '<span class="avd-sous">' + esc(d.enLigne ? 'Dernier enregistrement : ' + (dateHeure(d.maj) || '—') : (d.ancien ? 'Ancien enregistrement Notion' : 'Enregistrée sur ce poste')) + '</span></button>';

    var diffusees = etat.versions.filter(function (v) { return v.diffusee; });
    var autres = etat.versions.filter(function (v) { return !v.diffusee; });
    var ligne = function (v) {
      var m = MOTIFS[v.motif] || MOTIFS.manuel;
      return '<button type="button" class="avd-version' + (v.diffusee ? ' avd-diffusee' : '') + (etat.apercu === v.id ? ' avd-actif' : '') + '" data-avd-version="' + esc(v.id) + '">' +
        '<span class="avd-nom"><i class="bi ' + m.icone + ' me-1"></i>' + esc(m.nom) + ' le ' + esc(dateHeure(v.ts)) + '</span>' +
        '<span class="avd-sous">' + esc([v.client, fourchette(v), v.libelle].filter(Boolean).join(' · ')) + '</span></button>';
    };
    html += '<div class="avd-section"><i class="bi bi-send-check-fill me-1"></i>Versions diffusées (' + diffusees.length + ')</div>';
    html += diffusees.length ? diffusees.map(ligne).join('') :
      '<div class="avd-note">Aucune pour le moment. Une version est figée à chaque PDF, impression, partage ou facture.</div>';
    html += '<div class="avd-section"><i class="bi bi-clock-history me-1"></i>Versions enregistrées (' + autres.length + ')</div>';
    html += autres.length ? autres.map(ligne).join('') :
      '<div class="avd-note">Créées par le bouton « Enregistrer ». Les 30 plus récentes sont gardées.</div>';
    zone.innerHTML = html;
  }

  // Charge les données d'une version (ou de la version de travail) et affiche le document.
  function apercu(id) {
    var d = etat.choisi; if (!d) return;
    etat.apercu = id;
    afficherVersions();
    var zone = document.getElementById('avdApercu'), barre = document.getElementById('avdApercuBarre');
    zone.innerHTML = '<div class="avd-vide"><span class="spinner-border spinner-border-sm me-2"></span>Préparation de l\'aperçu…</div>';
    barre.innerHTML = '';
    donnees(d, id).then(function (data) {
      if (etat.choisi !== d || etat.apercu !== id) return;
      if (!data) { zone.innerHTML = '<div class="avd-vide">Contenu introuvable. ' + (d.ancien ? 'Cet ancien enregistrement Notion est vide ou illisible.' : '') + '</div>'; return; }
      etat.donneesApercu = data;
      var v = id === 'courant' ? null : etat.versions.filter(function (x) { return x.id === id; })[0];
      barre.innerHTML = '<span class="avd-barre-titre">' + (v ? esc((MOTIFS[v.motif] || MOTIFS.manuel).nom + ' le ' + dateHeure(v.ts)) : 'Version de travail') + '</span>' +
        '<button type="button" class="btn btn-sm btn-outline-primary" data-avd-action="imprimer" title="Imprimer ou enregistrer en PDF ce document, tel quel"><i class="bi bi-printer me-1"></i>Imprimer / PDF</button>' +
        (v ? '<button type="button" class="btn btn-sm btn-outline-success" data-avd-action="reprendre" title="Rouvrir cette version dans l\'éditeur. La version de travail actuelle est d\'abord enregistrée."><i class="bi bi-arrow-counterclockwise me-1"></i>Reprendre cette version</button>' : '') +
        (v && !v.diffusee && d.aMoi ? '<button type="button" class="btn btn-sm btn-outline-danger" data-avd-action="supprimer-version" title="Supprimer cette version"><i class="bi bi-trash"></i></button>' : '');
      try { zone.innerHTML = '<div class="avd-page"><div class="avis-doc">' + window.AvisValeur.documentHTML(data) + '</div></div>'; }
      catch (e) { zone.innerHTML = '<div class="avd-vide">Aperçu impossible pour cette version (données anciennes).</div>'; }
    });
  }

  function donnees(d, id) {
    if (id !== 'courant') {
      return appel('GET', { ref: d.ref, version: id, proprio: d.proprio }).then(function (r) { return r.ok ? r.data : null; });
    }
    // Version de travail : la copie de ce poste si elle existe (la plus fraîche ici), sinon en ligne.
    var local = d.aMoi && d.local ? window.AvisValeur.lireLocal(d.ref) : null;
    if (local) return Promise.resolve(local);
    if (d.enLigne) return appel('GET', { ref: d.ref, proprio: d.proprio }).then(function (r) { return r.ok ? r.data : null; });
    return fetch('/api/notion-get?kind=avis&ref=' + encodeURIComponent(d.ref), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { return (j && j.data) || null; }).catch(function () { return null; });
  }

  // Écran étroit : les trois volets sont empilés. Un choix amène au volet suivant.
  // ── Sauvegarde complète sur ce poste ────────────────────────────────────────
  // Un fichier .json : chaque avis en ligne du compte (contenu complet, photos comprises) et ses versions diffusées.
  // Les avis sont lus un par un et assemblés dans le navigateur : rien ne transite par un serveur tiers.
  var FORMAT_SAUV = 'fidi-avis-sauvegarde';
  function etatSauv(txt) { var e = document.getElementById('avdSauvEtat'); if (e) e.textContent = txt || ''; }
  function construireSauvegarde(docs, progres) {
    var avis = [], echecs = [], i = 0;
    function suivant() {
      if (i >= docs.length) return Promise.resolve();
      var d = docs[i++];
      if (progres) progres(i, docs.length);
      return appel('GET', { ref: d.ref, proprio: d.proprio }).then(function (r) {
        if (!r.ok || !r.data) { echecs.push(d.ref); return; }
        var fiche = { ref: d.ref, proprio: d.proprio || '', resume: r.resume || d.resume || {}, maj: r.maj || d.maj || null, data: r.data, versions: [] };
        avis.push(fiche);
        return appel('GET', { ref: d.ref, versions: 1, proprio: d.proprio }).then(function (rv) {
          var diff = ((rv.ok && rv.versions) || []).filter(function (v) { return v.diffusee; });
          var k = 0;
          function versionSuivante() {
            if (k >= diff.length) return;
            var v = diff[k++];
            return appel('GET', { ref: d.ref, version: v.id, proprio: d.proprio }).then(function (x) {
              if (x.ok && x.data) fiche.versions.push({ id: v.id, ts: v.ts, motif: v.motif, libelle: v.libelle || '', data: x.data });
              else echecs.push(d.ref + ' (version ' + v.id + ')');
              return versionSuivante();
            });
          }
          return versionSuivante();
        });
      }).then(suivant);
    }
    return suivant().then(function () {
      return { fichier: { format: FORMAT_SAUV, version: 1, date: new Date().toISOString(), avis: avis }, echecs: echecs };
    });
  }
  function sauvegarderTout(bouton) {
    var docs = etat.docs.filter(function (d) { return d.enLigne; });
    if (!docs.length) { etatSauv('Aucun avis en ligne à sauvegarder.'); return; }
    bouton.disabled = true;
    construireSauvegarde(docs, function (n, total) { etatSauv('Sauvegarde : avis ' + n + ' / ' + total + '…'); }).then(function (res) {
      bouton.disabled = false;
      if (!res.fichier.avis.length) { etatSauv('Sauvegarde impossible : aucun avis n\'a pu être lu.'); return; }
      var blob = new Blob([JSON.stringify(res.fichier)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sauvegarde-avis-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
      try { localStorage.setItem('fidi:avis:sauvegarde', new Date().toISOString()); } catch (e) {}
      var nv = res.fichier.avis.reduce(function (t, x) { return t + x.versions.length; }, 0);
      etatSauv(res.fichier.avis.length + ' avis et ' + nv + ' version(s) diffusée(s) sauvegardés' +
        (res.echecs.length ? ' — ' + res.echecs.length + ' élément(s) non lus : ' + res.echecs.slice(0, 3).join(', ') : '') + '. Rangez ce fichier en lieu sûr.');
    });
  }
  // Restauration : remet en ligne le contenu courant des avis ABSENTS du compte. Un avis déjà en ligne n'est jamais remplacé.
  // Les versions diffusées restent dans le fichier (le serveur date lui-même les versions : elles ne se recréent pas à l'identique).
  function lireSauvegarde(texte) {
    var j; try { j = JSON.parse(texte); } catch (e) { return null; }
    if (!j || j.format !== FORMAT_SAUV || !Array.isArray(j.avis)) return null;
    return j.avis.filter(function (a) { return a && typeof a.ref === 'string' && a.data && typeof a.data === 'object'; });
  }
  function restaurer(fichier) {
    if (!fichier) return;
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var liste = lireSauvegarde(String(lecteur.result || ''));
      if (!liste) { etatSauv('Ce fichier n\'est pas une sauvegarde d\'avis.'); return; }
      var remis = 0, presents = 0, echecs = 0, i = 0;
      function suivant() {
        if (i >= liste.length) return Promise.resolve();
        var a = liste[i++];
        etatSauv('Restauration : avis ' + i + ' / ' + liste.length + '…');
        return appel('GET', { ref: a.ref, resume: 1 }).then(function (r) {
          if (r.ok) { presents++; return; }
          if (r.code !== 404) { echecs++; return; }
          return enregistrer(a.ref, a.data, a.resume || {}, { motif: 'import', libelle: 'Restauré depuis une sauvegarde' }).then(function (x) { if (x.ok) remis++; else echecs++; });
        }).then(suivant);
      }
      suivant().then(function () {
        etatSauv(remis + ' avis remis en ligne, ' + presents + ' déjà présent(s) et laissé(s) tels quels' + (echecs ? ', ' + echecs + ' en échec' : '') + '.');
        if (remis) charger();
      });
    };
    lecteur.readAsText(fichier);
  }

  function allerVers(volet) {
    try {
      if (!window.matchMedia('(max-width: 1100px)').matches) return;
      var c = document.querySelector('#avisDossiersModal ' + volet);
      if (c) setTimeout(function () { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    } catch (e) {}
  }

  function fermer() {
    var el = document.getElementById('avisDossiersModal');
    var m = el && bootstrap.Modal.getInstance(el);
    if (m) m.hide();
  }

  function surClic(e) {
    var t = e.target.closest('[data-avd-doc],[data-avd-version],[data-avd-action]');
    if (!t) return;
    if (t.dataset.avdDoc != null) { choisir(etat.docs[+t.dataset.avdDoc]); allerVers('.avd-versions'); return; }
    if (t.dataset.avdVersion) { apercu(t.dataset.avdVersion); allerVers('.avd-apercu'); return; }
    if (t.dataset.avdAction === 'retour-liste') { allerVers('.avd-liste'); return; }
    if (t.dataset.avdAction === 'sauvegarder') { sauvegarderTout(t); return; }
    if (t.dataset.avdAction === 'restaurer') { var f = document.getElementById('avdFichier'); if (f) { f.value = ''; f.click(); } return; }
    var d = etat.choisi, a = t.dataset.avdAction; if (!d) return;

    if (a === 'ouvrir') {
      donnees(d, 'courant').then(function (data) {
        if (!data) { alert('Contenu introuvable pour cet avis.'); return; }
        fermer();
        if (!d.aMoi && d.nomAuteur) { data.metadata = data.metadata || {}; data.metadata.auteur = d.nomAuteur; }
        // Avis d'un autre compte : le document garde l'identité (société, logo, couleurs) de son auteur.
        var avant = !d.aMoi && d.emailAuteur && window.Marque && Marque.chargerAuteur ? Marque.chargerAuteur('avis:' + d.ref, d.emailAuteur, d.nomAuteur) : Promise.resolve();
        avant.then(function () { setTimeout(function () { window.AvisValeur.charger(data, { message: 'Avis ouvert : ' + nomRef(d) }); }, 250); });
      });
    } else if (a === 'reprendre') {
      if (!etat.donneesApercu) return;
      if (!confirm('Reprendre cette version dans l\'éditeur ?\n\nLa version de travail actuelle est d\'abord enregistrée dans les versions : rien n\'est perdu.')) return;
      var reprise = etat.donneesApercu;
      donnees(d, 'courant').then(function (courant) {
        var avant = courant && d.aMoi
          ? enregistrer(d.ref, courant, window.AvisValeur.resume(courant), { motif: 'manuel', libelle: 'Avant reprise d\'une version' })
          : Promise.resolve({ ok: true });
        return avant;
      }).then(function () {
        fermer();
        setTimeout(function () { window.AvisValeur.charger(reprise, { message: 'Version reprise : enregistrez pour la conserver', modifie: true }); }, 250);
      });
    } else if (a === 'imprimer') {
      if (etat.donneesApercu) { fermer(); setTimeout(function () { window.AvisValeur.imprimerDonnees(etat.donneesApercu); }, 300); }
    } else if (a === 'supprimer-version') {
      if (!confirm('Supprimer cette version enregistrée ?')) return;
      appel('POST', null, { action: 'supprimer_version', ref: d.ref, id: etat.apercu, proprio: d.proprio }).then(function (r) {
        if (!r.ok) { alert(r.error || 'Suppression impossible.'); return; }
        choisir(d);
      });
    } else if (a === 'supprimer') {
      if (!confirm('Supprimer l\'avis « ' + d.ref + ' » et ses versions enregistrées ?\n\nCette suppression est définitive.')) return;
      var enLigne = d.enLigne ? appel('POST', null, { action: 'supprimer', ref: d.ref, proprio: d.proprio }) : Promise.resolve({ ok: true });
      enLigne.then(function (r) {
        if (!r.ok) { alert(r.error || 'Suppression impossible.'); return; }
        var suite = d.ancien
          ? fetch('/api/notion-delete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'avis', ref: d.ref }) })
            .then(function (x) { return x.ok ? { ok: true } : x.json().catch(function () { return {}; }); }).catch(function () { return { error: 'Réseau indisponible' }; })
          : Promise.resolve({ ok: true });
        return suite.then(function (s) {
          if (!s.ok) { alert(s.error || 'Suppression impossible.'); return; }
          try { window.AvisValeur.supprimerLocal(d.ref); } catch (e) {}
          etat.docs.splice(etat.docs.indexOf(d), 1); etat.choisi = null;
          afficherDocs();
          document.getElementById('avdVersions').innerHTML = '<div class="avd-vide">Avis supprimé.</div>';
          document.getElementById('avdApercu').innerHTML = ''; document.getElementById('avdApercuBarre').innerHTML = '';
        });
      });
    }
  }

  window.AvisDossiers = {
    ouvrir: ouvrir, enregistrer: enregistrer, empreinte: empreinte, lireSync: lireSync, ecrireSync: ecrireSync, messageErreur: messageErreur,
    lire: function (ref) { return appel('GET', { ref: ref }); },
    resume: function (ref) { return appel('GET', { ref: ref, resume: 1 }); },
    MOTIFS: MOTIFS,
    construireSauvegarde: construireSauvegarde, lireSauvegarde: lireSauvegarde
  };
})();
