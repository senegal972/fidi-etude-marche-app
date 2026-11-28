// Présentation des formules : deux grilles (études de marché, avis de valeur), la formule globale en option,
// une aide « Lequel choisir ? » et un calcul de marge. Les prix sont ceux de la grille du compte (/api/offres) ;
// la grille de référence ci-dessous ne sert que si le serveur ne répond pas. Rien ne s'achète ici : « Choisir »
// renvoie à Mon compte → Offres.
(function (window, document) {
  "use strict";

  var CLES = { etudes: "Études de marché", avis: "Avis de valeur", global: "Cumulatif" };

  // Grille de référence (tarif public, 45 € le crédit, dégressif). Repli seulement.
  var PALIERS_REF = [["Starter", 2, 0], ["Essentiel", 5, 12], ["Pro", 10, 20], ["Business", 20, 27], ["Premium", 50, 33], ["Enterprise", 100, 42]];
  function reference() {
    var o = [];
    Object.keys(CLES).forEach(function (cle) {
      var liste = cle === "global" ? PALIERS_REF.concat([["Platinum", 200, 49]]) : PALIERS_REF;
      liste.forEach(function (p, i) {
        var pc = Math.round(45 * (1 - p[2] / 100) * 100) / 100;
        o.push({ module: CLES[cle], palier: p[0], credits: p[1], prix: Math.round(p[1] * pc), prix_credit: pc, economie: p[2],
          recommande: cle === "global" ? p[0] === "Pro" : p[0] === "Essentiel", active: true, ordre: i });
      });
    });
    return o;
  }

  var MODULES = {
    etudes: { icone: "bi-bar-chart-line", titre: "Étude de marché", accroche: "Comprendre un secteur avant d'en parler.",
      texte: "À partir d'une adresse ou d'une parcelle : ventes réelles autour du bien, prix au m², zonage du PLU, risques, potentiel constructible, contexte du quartier.",
      points: ["Préparer un rendez-vous vendeur ou une prospection", "Justifier un prix avec des ventes réelles", "Rapport A4 à vos couleurs, prêt à remettre"] },
    avis: { icone: "bi-file-earmark-text", titre: "Avis de valeur", accroche: "Le document que vous remettez à votre client.",
      texte: "Une valeur en fourchette, argumentée par plusieurs méthodes (comparaison, revenu, sol et construction), avec la stratégie de mise en vente et les points de vigilance.",
      points: ["Un document signé de votre société, facturable", "Reprend l'étude du bien : rien à ressaisir", "Export PDF et Word, envoi au client avec la facture"] },
    global: { icone: "bi-stars", titre: "Formule globale", accroche: "Un seul solde, pour les études comme pour les avis.",
      texte: "Chaque crédit sert indifféremment à une étude de marché ou à un avis de valeur. Vous n'avez pas à prévoir la répartition à l'avance.",
      points: ["La plus souple : vous décidez dossier par dossier", "Convient à l'enchaînement étude puis avis", "Donne accès aux plus grands paliers"] }
  };

  // Avantages et limites, pour l'aide au choix. Formulations d'usage : aucune promesse de résultat.
  var COMPARATIF = {
    etudes: { pour: "Vous prospectez, vous préparez des rendez-vous, vous étudiez un secteur ou un terrain.",
      plus: ["Rapide : une adresse suffit", "Très utile avant même d'avoir un mandat"],
      moins: ["Ne fixe pas une valeur argumentée pour un client", "Le client attend souvent ensuite un avis de valeur"] },
    avis: { pour: "Vous remettez régulièrement une valeur écrite à un vendeur, un héritier, un investisseur.",
      plus: ["Un livrable complet, que vous pouvez facturer", "Plusieurs méthodes, une fourchette, une stratégie"],
      moins: ["Demande plus de saisie qu'une étude", "Plus solide quand il s'appuie sur une étude du bien"] },
    global: { pour: "Vous faites les deux, ou vous ne savez pas encore dans quelle proportion.",
      plus: ["Un seul solde à suivre", "Aucune répartition à prévoir"],
      moins: ["Les plus grands paliers demandent un volume d'activité régulier"] }
  };

  function nombre(v) { var n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : 0; }

  // ─── Calculs purs (testés) ────────────────────────────────────────────────────────────────────────────────────
  // offres : liste de /api/offres ; grille : nom de la grille à retenir (administrateur : il les reçoit toutes).
  function modele(offres, grille) {
    var src = (offres || []).filter(function (o) { return o && o.active !== false && nombre(o.credits) > 0 && nombre(o.prix) > 0; });
    if (grille && src.some(function (o) { return o.grille; })) src = src.filter(function (o) { return (o.grille || "Standard") === grille; });
    var m = { etudes: [], avis: [], global: [], reference: false };
    Object.keys(CLES).forEach(function (cle) {
      var liste = src.filter(function (o) { return o.module === CLES[cle]; }).map(function (o) {
        var credits = nombre(o.credits), prix = nombre(o.prix);
        return { id: o.id || "", palier: String(o.palier || o.nom || credits + " crédits"), credits: credits, prix: prix,
          prixCredit: Math.round(prix / credits * 100) / 100, economie: 0, conseille: !!o.recommande, ordre: nombre(o.ordre) };
      }).sort(function (a, b) { return a.credits - b.credits || a.ordre - b.ordre; });
      // Économie recalculée sur le crédit le plus cher de la grille : elle correspond toujours aux prix affichés.
      var base = liste.reduce(function (x, p) { return Math.max(x, p.prixCredit); }, 0);
      liste.forEach(function (p) { p.economie = base > 0 ? Math.round((1 - p.prixCredit / base) * 100) : 0; });
      m[cle] = liste;
    });
    return m;
  }
  function modeleOuReference(offres, grille) {
    var m = modele(offres, grille);
    if (!m.etudes.length && !m.avis.length && !m.global.length) { m = modele(reference()); m.reference = true; }
    return m;
  }

  // Quelle formule et quel pack ? documents : 'etudes' | 'avis' | 'deux' ; volume : documents par mois.
  // Les crédits valent 12 mois : on ne conseille pas un pack plus grand que le besoin d'une année.
  function conseiller(m, rep) {
    var docs = rep && rep.documents, volume = Math.max(0, nombre(rep && rep.volume));
    var formule = docs === "etudes" || docs === "avis" ? docs : "global";
    if (!m[formule] || !m[formule].length) formule = ["global", "etudes", "avis"].filter(function (c) { return m[c] && m[c].length; })[0];
    if (!formule) return null;
    var packs = m[formule], annuel = Math.round(volume * 12), pack = packs[0];
    packs.forEach(function (p) { if (p.credits <= annuel) pack = p; });
    var mois = volume > 0 ? Math.round(pack.credits / volume * 10) / 10 : null;
    // La formule globale revient-elle au même prix pour ce nombre de crédits ? (dit seulement si c'est vrai)
    var jumeau = formule !== "global" ? (m.global || []).filter(function (p) { return p.credits === pack.credits; })[0] : null;
    return { formule: formule, pack: pack, annuel: annuel, mois: mois, petitVolume: annuel < packs[0].credits,
      globalMemePrix: !!(jumeau && jumeau.prix <= pack.prix) };
  }

  // Ce qu'il reste d'un document revendu, une fois le crédit payé. Prix de vente saisi par l'utilisateur.
  function marge(prixVente, prixCredit) {
    var v = nombre(prixVente), c = nombre(prixCredit);
    if (v <= 0 || c <= 0) return null;
    return { reste: Math.round((v - c) * 100) / 100, part: Math.round((v - c) / v * 100), rembourse: Math.ceil(c / v * 100) / 100 };
  }

  function euros(n, decimales) {
    var s = nombre(n).toFixed(decimales ? 2 : 0).replace(".", ",");
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €";
  }

  var api = { modele: modele, modeleOuReference: modeleOuReference, conseiller: conseiller, marge: marge, euros: euros, reference: reference,
    MODULES: MODULES, COMPARATIF: COMPARATIF, CLES: CLES };
  window.FidiPresentation = api;
  if (!document) return;

  // ─── Écran ────────────────────────────────────────────────────────────────────────────────────────────────────
  var etat = { m: null, onglet: "etudes", global: false, guide: false, rep: { documents: "deux", volume: 4 }, vente: "", pack: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function formule() { return etat.global ? "global" : etat.onglet; }
  function packs() { return (etat.m && etat.m[formule()]) || []; }
  function fabricant() { return (window.Marque && Marque.signatureLogiciel && Marque.signatureLogiciel()) || "Étude de marché & Avis de valeur"; }

  function carte(p) {
    return '<article class="pres-pack' + (p.conseille ? " pres-pack-reco" : "") + '">' +
      (p.conseille ? '<span class="pres-ruban">Le plus choisi</span>' : "") +
      '<h4 class="pres-pack-nom">' + esc(p.palier) + "</h4>" +
      '<p class="pres-pack-cr">' + p.credits + " crédits</p>" +
      '<p class="pres-pack-prix">' + euros(p.prix) + ' <small>TTC</small></p>' +
      '<p class="pres-pack-det">' + euros(p.prixCredit, true) + " le crédit" + (p.economie > 0 ? ' <span class="pres-eco">−' + p.economie + " %</span>" : "") + "</p>" +
      '<button type="button" class="btn pres-btn' + (p.conseille ? " pres-btn-plein" : "") + '" data-pres="choisir">Choisir</button></article>';
  }

  function blocModule() {
    var d = MODULES[formule()];
    return '<section class="pres-module"><div class="pres-module-ic"><i class="bi ' + d.icone + '"></i></div><div>' +
      '<h3>' + esc(d.titre) + ' <span>' + esc(d.accroche) + "</span></h3><p>" + esc(d.texte) + "</p>" +
      '<ul>' + d.points.map(function (x) { return '<li><i class="bi bi-check2"></i>' + esc(x) + "</li>"; }).join("") + "</ul></div></section>";
  }

  function blocMarge() {
    var liste = packs(); if (!liste.length) return "";
    var p = liste.filter(function (x) { return x.palier === etat.pack; })[0] || liste.filter(function (x) { return x.conseille; })[0] || liste[0];
    var r = marge(etat.vente, p.prixCredit), txt;
    if (r && r.reste > 0) txt = "Il vous reste <b>" + euros(r.reste, true) + "</b> par document, soit " + r.part + " % de votre prix de vente.";
    else if (r) txt = "À ce prix de vente, le crédit n'est pas couvert.";
    else txt = "Indiquez le prix auquel vous vendez un document : le calcul se fait avec vos chiffres.";
    return '<section class="pres-marge"><h3><i class="bi bi-calculator me-1"></i>Ce qu\'il vous reste par document</h3><div class="pres-marge-l">' +
      '<label>Je vends un document<span class="pres-champ"><input type="number" inputmode="decimal" min="0" step="10" id="presVente" value="' + esc(etat.vente) + '" placeholder="ex. 300"><em>€</em></span></label>' +
      '<label>Avec le pack<select id="presPack">' + liste.map(function (x) { return '<option' + (x.palier === p.palier ? " selected" : "") + ' value="' + esc(x.palier) + '">' + esc(x.palier) + " — " + euros(x.prixCredit, true) + " le crédit</option>"; }).join("") + "</select></label>" +
      '</div><p class="pres-marge-res" id="presMargeRes">' + txt + "</p></section>";
  }

  function colonne(cle) {
    var c = COMPARATIF[cle], d = MODULES[cle];
    return '<div class="pres-col"><h4><i class="bi ' + d.icone + ' me-1"></i>' + esc(d.titre) + '</h4><p class="pres-col-pour">' + esc(c.pour) + "</p>" +
      '<ul class="pres-plus">' + c.plus.map(function (x) { return '<li><i class="bi bi-plus-circle"></i>' + esc(x) + "</li>"; }).join("") + "</ul>" +
      '<ul class="pres-moins">' + c.moins.map(function (x) { return '<li><i class="bi bi-dash-circle"></i>' + esc(x) + "</li>"; }).join("") + "</ul></div>";
  }

  function texteConseil() {
    var r = conseiller(etat.m, etat.rep); if (!r) return "";
    var d = MODULES[r.formule], t = "<b>" + esc(d.titre) + " — pack " + esc(r.pack.palier) + "</b> (" + r.pack.credits + " crédits, " + euros(r.pack.prix) + " TTC). ";
    if (r.petitVolume) t += "Votre volume est faible : le plus petit pack suffit, et vous avez douze mois pour l'utiliser.";
    else t += "Environ " + r.annuel + " documents par an : ce pack couvre à peu près " + String(r.mois).replace(".", ",") + " mois, sans crédit perdu au bout de douze mois.";
    if (r.globalMemePrix) t += " La formule globale est au même prix pour ce nombre de crédits : elle vous laisse en plus le choix du document.";
    return t;
  }

  function blocGuide() {
    var q = etat.rep, choix = [["etudes", "Des études"], ["avis", "Des avis"], ["deux", "Les deux"]];
    return '<div class="pres-guide" role="dialog" aria-modal="true" aria-labelledby="presGuideTitre"><div class="pres-guide-boite">' +
      '<header><h3 id="presGuideTitre"><i class="bi bi-signpost-split me-1"></i>Lequel choisir ?</h3>' +
      '<button type="button" class="btn-close" data-pres="guide-fermer" aria-label="Fermer"></button></header>' +
      '<div class="pres-cols">' + colonne("etudes") + colonne("avis") + colonne("global") + "</div>" +
      '<section class="pres-quiz"><h4>Ce qui vous convient</h4>' +
      '<div class="pres-q"><span>Je produis surtout</span><div class="pres-seg" role="group">' + choix.map(function (c) {
        return '<button type="button" data-pres="docs" data-v="' + c[0] + '" aria-pressed="' + (q.documents === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="pres-q"><label for="presVolume">Documents par mois, environ</label><input type="number" inputmode="numeric" min="0" max="500" id="presVolume" value="' + esc(q.volume) + '"></div>' +
      '<p class="pres-conseil" id="presConseil">' + texteConseil() + "</p>" +
      '<div class="pres-guide-pied"><button type="button" class="btn pres-btn pres-btn-plein" data-pres="guide-appliquer">Afficher cette formule</button>' +
      '<button type="button" class="btn pres-btn" data-pres="guide-fermer">Fermer</button></div></section></div></div>';
  }

  function corps() {
    var liste = packs();
    return '<section class="pres-hero"><p class="pres-sur">' + esc(fabricant()) + "</p>" +
      "<h2>Vos études et vos avis de valeur, en quelques minutes</h2>" +
      "<p>Des documents professionnels, appuyés sur les ventes réelles et les données publiques, à remettre à vos clients sous votre nom.</p>" +
      '<ul class="pres-puces"><li><i class="bi bi-ticket-perforated"></i>1 crédit = 1 document</li><li><i class="bi bi-calendar-check"></i>Crédits valables 12 mois</li><li><i class="bi bi-unlock"></i>Sans abonnement ni engagement</li></ul></section>' +
      '<div class="pres-choix"><div class="pres-seg" role="group" aria-label="Type de document">' +
        '<button type="button" data-pres="onglet" data-v="etudes" aria-pressed="' + (!etat.global && etat.onglet === "etudes") + '"><i class="bi bi-bar-chart-line"></i>Études de marché</button>' +
        '<button type="button" data-pres="onglet" data-v="avis" aria-pressed="' + (!etat.global && etat.onglet === "avis") + '"><i class="bi bi-file-earmark-text"></i>Avis de valeur</button></div>' +
        (etat.m.global.length ? '<label class="pres-global"><input type="checkbox" id="presGlobal"' + (etat.global ? " checked" : "") + '><span class="pres-inter"></span><span>Formule globale <small>les deux, un seul solde</small></span></label>' : "") +
        '<button type="button" class="btn pres-btn pres-aide" data-pres="guide"><i class="bi bi-signpost-split me-1"></i>Lequel choisir ?</button></div>' +
      blocModule() +
      (liste.length ? '<div class="pres-packs">' + liste.map(carte).join("") + "</div>" : '<p class="pres-vide">Aucune offre n\'est proposée pour cette formule sur votre grille.</p>') +
      '<p class="pres-regle">Prix toutes taxes comprises. Paiement en ligne sécurisé ; une facture est émise à chaque achat.' +
        (etat.m.reference ? " Tarif de référence : la grille de votre compte n'a pas pu être lue." : "") + "</p>" +
      blocMarge() + (etat.guide ? blocGuide() : "");
  }

  function dessiner() {
    var z = document.getElementById("presCorps"); if (!z) return;
    var haut = z.scrollTop; z.innerHTML = corps(); z.scrollTop = haut;
    if (etat.guide) { var b = z.querySelector(".pres-guide .btn-close"); if (b) b.focus(); }
  }

  function vue() {
    return '<div class="modal fade pres-modal" id="presModal" tabindex="-1" aria-labelledby="presTitre"><div class="modal-dialog modal-xl modal-fullscreen-lg-down modal-dialog-scrollable">' +
      '<div class="modal-content"><div class="modal-header pres-tete"><h5 class="modal-title" id="presTitre"><i class="bi bi-easel me-2"></i>Présentation &amp; tarifs</h5>' +
      '<div class="pres-tete-act"><button type="button" class="btn pres-btn" data-pres="partager" title="Envoyer le lien de cette présentation"><i class="bi bi-share"></i><span class="nav-lbl ms-1">Partager</span></button>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button></div></div>' +
      '<div class="modal-body pres-corps" id="presCorps"><p class="pres-vide">Chargement des tarifs…</p></div></div></div></div>';
  }

  function versOffres() {
    var el = document.getElementById("presModal"), m = el && window.bootstrap && bootstrap.Modal.getInstance(el);
    if (m) m.hide();
    setTimeout(function () { if (window.Compte) { Compte.open(); Compte.rubrique("tabOffres"); } }, 300);
  }

  function clic(e) {
    var b = e.target.closest("[data-pres]"); if (!b) return;
    var a = b.getAttribute("data-pres"), v = b.getAttribute("data-v");
    if (a === "onglet") { etat.onglet = v; etat.global = false; etat.pack = null; dessiner(); }
    else if (a === "guide") { etat.guide = true; dessiner(); }
    else if (a === "guide-fermer") { etat.guide = false; dessiner(); }
    else if (a === "docs") { etat.rep.documents = v; dessiner(); }
    else if (a === "guide-appliquer") {
      var r = conseiller(etat.m, etat.rep);
      if (r) { etat.global = r.formule === "global"; if (!etat.global) etat.onglet = r.formule; etat.pack = r.pack.palier; }
      etat.guide = false; dessiner();
    }
    else if (a === "choisir") versOffres();
    else if (a === "partager") partager();
  }
  function saisie(e) {
    var t = e.target;
    if (t.id === "presGlobal") { etat.global = t.checked; etat.pack = null; dessiner(); }
    else if (t.id === "presPack") { etat.pack = t.value; dessiner(); }
    else if (t.id === "presVolume") { etat.rep.volume = t.value; var c = document.getElementById("presConseil"); if (c) c.innerHTML = texteConseil(); }
    else if (t.id === "presVente") {
      etat.vente = t.value;
      var liste = packs(), p = liste.filter(function (x) { return x.palier === (document.getElementById("presPack") || {}).value; })[0];
      var r = p && marge(etat.vente, p.prixCredit), z = document.getElementById("presMargeRes");
      if (z) z.innerHTML = r && r.reste > 0 ? "Il vous reste <b>" + euros(r.reste, true) + "</b> par document, soit " + r.part + " % de votre prix de vente."
        : r ? "À ce prix de vente, le crédit n'est pas couvert." : "Indiquez le prix auquel vous vendez un document : le calcul se fait avec vos chiffres.";
    }
  }

  function charger() {
    return fetch("/api/offres", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) { return modeleOuReference(d && d.offres, d && (d.grille || (d.grilles || [])[0])); });
  }

  function open() {
    if (!(window.Compte && Compte.state && Compte.state.authenticated)) { memoriser(); return; }
    if (!window.bootstrap) return;
    var racine = document.getElementById("presModalRoot"); if (!racine) return;
    if (document.getElementById("presModal")) return;
    racine.innerHTML = vue();
    var el = document.getElementById("presModal");
    el.addEventListener("click", clic); el.addEventListener("input", saisie); el.addEventListener("change", saisie);
    el.addEventListener("keydown", function (e) { if (e.key === "Escape" && etat.guide) { e.stopPropagation(); e.preventDefault(); etat.guide = false; dessiner(); } }, true);
    el.addEventListener("hidden.bs.modal", function () { racine.innerHTML = ""; });
    etat.guide = false; etat.pack = null;
    new bootstrap.Modal(el).show();
    charger().then(function (m) { etat.m = m; if (!m[etat.onglet].length && m.global.length) etat.global = true; dessiner(); });
  }

  // Lien partagé (#presentation) : la présentation s'ouvre une fois la personne connectée.
  var enAttente = false;
  function memoriser() { enAttente = true; }
  function lienPartage() { if (/^#presentation\b/.test(location.hash)) { enAttente = true; try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} } }
  function reprise() { if (enAttente && window.Compte && Compte.state && Compte.state.authenticated) { enAttente = false; open(); } }

  function partager() {
    var url = location.origin + "/#presentation";
    var texte = "Découvrez « Étude de marché & Avis de valeur », le logiciel d'Optimmo Dom pour vos études de marché et vos avis de valeur immobiliers.";
    if (navigator.share) { navigator.share({ title: "Étude de marché & Avis de valeur", text: texte, url: url }).catch(function () {}); return; }
    var fait = function (ok) { var b = document.querySelector('#presModal [data-pres="partager"] .nav-lbl'); if (b) { b.textContent = ok ? "Lien copié" : url; setTimeout(function () { b.textContent = "Partager"; }, ok ? 2500 : 9000); } };
    if (navigator.clipboard) navigator.clipboard.writeText(texte + "\n" + url).then(function () { fait(true); }, function () { fait(false); }); else fait(false);
  }

  window.Presentation = { open: open, share: partager };
  lienPartage();
  document.addEventListener("fidi:compte", reprise);
  window.addEventListener("hashchange", function () { lienPartage(); reprise(); });
})(window, typeof document === "undefined" ? undefined : document);
