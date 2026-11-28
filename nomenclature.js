// Nomenclature des dossiers : à l'affichage, « FIDI » en tête d'une référence d'étude ou d'avis est remplacé par les initiales de son
// auteur — deux premières lettres du nom, puis deux premières lettres du prénom (Laura Fidi → FILA-EM-…). La référence enregistrée ne
// change pas : elle sert de clé aux crédits déjà consommés, aux factures, au lien étude ↔ avis et aux versions diffusées.
(function (window) {
  "use strict";
  var PARTICULES = { DE: 1, DU: 1, DES: 1, D: 1, LE: 1, LA: 1, LES: 1, VAN: 1, VON: 1 };
  function lettres(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, ""); }

  // « Prénom Nom » (usage des fiches de compte) ; un mot écrit tout en capitales est pris pour le nom (« FIDI Laura »).
  function initiales(nomComplet) {
    var brut = String(nomComplet || "").trim();
    if (!brut || brut.indexOf("@") >= 0) return "";
    var mots = brut.split(/\s+/).map(function (m) { return { brut: m, l: lettres(m) }; }).filter(function (m) { return m.l; });
    if (!mots.length) return "";
    if (mots.length === 1) return mots[0].l.slice(0, 4).toUpperCase();
    var utiles = mots.filter(function (m) { return !PARTICULES[m.l.toUpperCase()]; });
    if (utiles.length < 2) utiles = mots;
    var capitales = utiles.filter(function (m) { return m.l.length > 1 && m.brut === m.brut.toUpperCase(); });
    var nom, prenom;
    if (capitales.length === 1) { nom = capitales[0]; prenom = utiles.filter(function (m) { return m !== nom; })[0]; }
    else { prenom = utiles[0]; nom = utiles[utiles.length - 1]; }
    return (nom.l.slice(0, 2) + prenom.l.slice(0, 2)).toUpperCase();
  }

  // Référence telle qu'on la montre. Auteur inconnu (dossier ancien sans propriétaire) : la référence reste telle quelle.
  function afficher(ref, auteur) {
    var r = String(ref == null ? "" : ref), i = initiales(auteur);
    return i && /^FIDI-(EM|AV)-/.test(r) ? i + r.slice(4) : r;
  }
  function moi() { try { var u = window.Compte && window.Compte.state && window.Compte.state.user; return (u && u.nom) || ""; } catch (e) { return ""; } }
  function mienne(ref) { return afficher(ref, moi()); }

  window.FidiNomenclature = { initiales: initiales, afficher: afficher, moi: moi, mienne: mienne };
})(typeof window === "undefined" ? globalThis : window);
