/* Mon compte → Mes sociétés : les sociétés (ou statuts) au nom desquels le compte facture.
   Liste des sociétés avec leur situation (par défaut, mentions à compléter, virement réglé ou non) ; l'ajout et la
   modification réutilisent le module des sociétés émettrices (emetteurs.js), le même que dans « Nouvelle facture ».
   Enregistrement dans la charte du compte (Marque.maj → /api/marque). Expose window.FidiSocietes.monter(). */
(function () {
  'use strict';
  var widget = null;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function racine() { return document.getElementById('societesRoot'); }
  function ibanMasque(v) { var s = String(v || '').replace(/\s/g, ''); return s ? s.slice(0, 4) + ' •••• ' + s.slice(-4) : ''; }

  function liste() {
    var E = window.FidiEmetteurs; if (!E) return '';
    var l = E.liste(), def = E.defaut();
    if (!l.length) return '<div class="soc-vide"><i class="bi bi-building-add"></i><p>Aucune société pour le moment. Ajoutez celle au nom de laquelle vous facturez : entreprise individuelle (BNC, micro-entreprise) ou société.</p></div>';
    return '<div class="soc-liste">' + l.map(function (e) {
      var manque = E.manquantes(e);
      var regime = e.regimeTva === 'assujetti' ? 'TVA ' + String(e.tauxTva).replace('.', ',') + ' %' : e.regimeTva === 'franchise' ? 'Franchise en base de TVA' : 'Régime de TVA à préciser';
      return '<button type="button" class="soc-carte' + (def && def.id === e.id ? ' soc-defaut' : '') + '" data-soc="' + esc(e.id) + '">' +
        '<span class="soc-nom">' + esc(e.raisonSociale || '(sans nom)') + (def && def.id === e.id ? ' <span class="soc-badge">par défaut</span>' : '') + '</span>' +
        '<span class="soc-ligne">' + [e.formeJuridique, (e.siren || e.siret) && 'SIREN ' + (e.siren || e.siret), regime].filter(Boolean).map(esc).join(' · ') + '</span>' +
        '<span class="soc-ligne">Factures numérotées ' + esc(e.prefixe || '—') + '-AAAA-NNN</span>' +
        '<span class="soc-etats">' +
          (e.iban ? '<span class="soc-etat soc-ok"><i class="bi bi-bank"></i> Virement : ' + esc(ibanMasque(e.iban)) + '</span>'
                  : '<span class="soc-etat soc-ko"><i class="bi bi-bank"></i> Pas de RIB : virement non proposé</span>') +
          (manque.length ? '<span class="soc-etat soc-ko"><i class="bi bi-exclamation-triangle"></i> À compléter : ' + esc(manque.join(', ')) + '</span>' : '') +
        '</span><span class="soc-modifier"><i class="bi bi-pencil"></i> Modifier</span></button>';
    }).join('') + '</div>';
  }

  function dessinerListe() { var z = document.getElementById('societesListe'); if (z) z.innerHTML = liste(); }

  function monter() {
    var r = racine(); if (!r) return;
    if (!window.FidiEmetteurs) { r.innerHTML = '<p class="text-muted">Module des sociétés indisponible. Rechargez la page.</p>'; return; }
    // Le module utilise des identifiants fixes : un seul exemplaire à la fois dans la page.
    var autre = document.getElementById('fxEmetteurs'); if (autre) autre.innerHTML = '';
    r.innerHTML = '<div id="societesListe"></div>' +
      '<div class="cpt-carte soc-editeur"><h3>Ajouter ou modifier une société</h3>' +
      '<p class="soc-aide">Recherchez par SIRET, SIREN, nom ou dirigeant : les mentions légales sont pré-remplies. Indiquez ensuite le régime de TVA, le préfixe des numéros de facture et, pour proposer le virement, l\'IBAN et le BIC du compte de cette société.</p>' +
      '<div id="societesWidget" class="fx-emetteur"></div></div>';
    widget = window.FidiEmetteurs.monter(document.getElementById('societesWidget'), { onChange: dessinerListe });
    dessinerListe();
  }

  document.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('#societesRoot [data-soc]') : null; if (!c) return;
    var sel = document.getElementById('emSelect');
    if (sel) { sel.value = c.getAttribute('data-soc'); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    if (widget && widget.modifier) widget.modifier();
    var ed = document.querySelector('#societesRoot .soc-editeur'); if (ed) ed.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  // Charte rechargée (connexion, enregistrement depuis un autre écran) : la liste suit.
  document.addEventListener('marque:change', dessinerListe);

  window.FidiSocietes = { monter: monter };
})();
