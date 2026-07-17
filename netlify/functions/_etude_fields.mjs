// Éclatement / reconstruction d'une étude de marché vers les champs Notion.
// Principe FIDI : « une information = un champ » — aucun blob JSON.
// Deux fonctions pures + inverses :
//   - etudeToProps(b)    : payload de sauvegarde -> propriétés Notion (page parente)
//   - etudeToAnnees(b)   : payload -> lignes de la base liée « Prix DVF par année »
//   - propsToEtude(p, a) : propriétés Notion + lignes annuelles -> { data, inputs }
//
// Les valeurs strictement dérivées (fourchettes par type, couleur du score,
// libellés/max des axes) ne sont pas stockées : elles sont recalculées ici.

import { P, readNumber, readText, readSelect, readMultiSelect } from "./_notion.mjs";

// Libellés fixes des axes de score (l'app les affiche tels quels).
const AXE_LABELS = {
  activite:     "Activité du marché",
  tendance:     "Tendance des prix",
  attractivite: "Attractivité",
  dpe:          "Parc énergétique",
  risques:      "Risques naturels",
};
const AXE_MAX = 20;

const DPE_CLASSES = ["A", "B", "C", "D", "E", "F", "G"];

function couleurFromTotal(total) {
  if (total == null) return "#6c757d";
  if (total >= 80) return "#198754";
  if (total >= 65) return "#0d6efd";
  if (total >= 50) return "#0dcaf0";
  if (total >= 35) return "#ffc107";
  return "#dc3545";
}

// ─── Éclatement : sous-objet analytique `d` -> champs éclatés (hors identité) ───
// Ne touche PAS aux colonnes d'identité/client/statut : réutilisable en migration
// pour remplir uniquement les nouveaux champs sans écraser l'existant.
export function explodedProps(d) {
  d = d || {};
  const loc  = d.localisation || {};
  const info = d.commune_info || {};
  const sc   = d.score || {};
  const axes = sc.axes || {};
  const est  = d.estimation || {};
  const ests = d.estimations || {};
  const val  = d.valoris || {};
  const dpe  = d.dpe || {};
  const risq = d.risques || {};
  const per  = (Array.isArray(d.dvf_periodes) && d.dvf_periodes[0]) || {};

  const props = {
    // ── Localisation ──
    "Code postal":    P.text(loc.postcode),
    "Département":    P.text(loc.departement),
    "Latitude":      P.number(loc.lat),
    "Longitude":     P.number(loc.lon),
    "Score géocodage":P.number(loc.score_geo),
    "Contexte géo":   P.text(loc.context),

    // ── Commune ──
    "Population":     P.number(info.population),
    "Superficie km2": P.number(info.superficie),
    "Code région":    P.text(info.codeRegion),

    // ── Estimation retenue ──
    "Fourchette basse": P.number(est.valeur_min),
    "Fourchette haute": P.number(est.valeur_max),

    // ── Estimation par type (valoris = prix médian, estimations = valeur vénale) ──
    "Prix m2 maison":       P.number(val.maison && val.maison.prix_median_m2),
    "Valeur maison":        P.number(ests.maison && ests.maison.valeur_med),
    "Ventes maisons":       P.number(per.nb_maison),
    "Prix m2 appartement":  P.number(val.appartement && val.appartement.prix_median_m2),
    "Valeur appartement":   P.number(ests.appartement && ests.appartement.valeur_med),
    "Ventes appartements":  P.number(per.nb_appart),
    "Prix m2 terrain":      P.number(val.terrain && val.terrain.prix_median_m2),
    "Valeur terrain":       P.number(ests.terrain && ests.terrain.valeur_med),
    "Ventes terrains":      P.number(per.nb_terrain),
    "Prix m2 tous":         P.number(val.tous && val.tous.prix_median_m2),
    "Ventes tous":          P.number(val.tous && val.tous.nb),

    // ── Marché DVF (période agrégée) ──
    "Période DVF": P.text(per.periode),

    // ── Score ──
    "Verdict":            P.select(sc.verdict),
    "Note activité":     P.number(axes.activite && axes.activite.note),
    "Note tendance":      P.number(axes.tendance && axes.tendance.note),
    "Note attractivité": P.number(axes.attractivite && axes.attractivite.note),
    "Note DPE":           P.number(axes.dpe && axes.dpe.note),
    "Note risques":       P.number(axes.risques && axes.risques.note),
    "Détail activité":   P.text(axes.activite && axes.activite.detail),
    "Détail tendance":    P.text(axes.tendance && axes.tendance.detail),
    "Détail attractivité":P.text(axes.attractivite && axes.attractivite.detail),
    "Détail DPE":         P.text(axes.dpe && axes.dpe.detail),
    "Détail risques":     P.text(axes.risques && axes.risques.detail),

    // ── DPE (répartition par classe) ──
    // (ajoutées ci-dessous en boucle)

    // ── Risques ──
    "Sismicité zone":     P.text(risq.sismicite && risq.sismicite.zone),
    "Sismicité libellé":  P.text(risq.sismicite && risq.sismicite.libelle),
    "Radon classe":       P.text(risq.radon && risq.radon.classe),
    "Risques recensés":   P.multi_select(risq.synthese || []),
    "Nb ICPE":            P.number(risq.icpe && risq.icpe.count),

    // ── Méta ──
    "Généré le":          P.text(d.generated_at),
  };

  for (const c of DPE_CLASSES) props[`DPE ${c}`] = P.number(dpe[c]);

  return props;
}

// ─── Éclatement : payload de sauvegarde -> propriétés Notion (page parente) ─────
// = colonnes d'identité/client (depuis `b`) + champs éclatés (depuis `b.data.data`).
export function etudeToProps(b) {
  const wrap = b.data || {};
  const d = wrap.data || {};

  const props = {
    // ── Identification / client (envoyés en tête du payload) ──
    "Référence":      P.title(b.ref),
    "Date":           P.date(b.date || new Date().toISOString().slice(0, 10)),
    "Adresse":        P.text(b.adresse),
    "Commune":        P.text(b.commune),
    "Code INSEE":     P.text(b.code_insee),
    "Périmètre":      P.text(b.perimetre),
    "Type de bien":   P.select(b.type_bien),
    "Surface m2":     P.number(b.surface),
    "Score potentiel":P.number(b.score),
    "Prix m2 median": P.number(b.prix_m2),
    "Nb transactions":P.number(b.nb_transactions),
    "Estimation":     P.number(b.estimation),
    "Client":         P.text(b.client),
    "Email client":   P.email(b.email_client),
    "Statut":         P.status(b.statut || "Terminé"),
    "Statut facture": P.select(b.statut_facture || "Non facturé"),
    "Lien partage":   P.url(b.lien_partage),
    ...explodedProps(d),
  };

  // Honoraires : uniquement si fourni (ne pas écraser une saisie manuelle par null)
  if (b.honoraires != null && b.honoraires !== "") props["Honoraires"] = P.number(b.honoraires);

  return props;
}

// ─── Éclatement : étude -> lignes de la base « Prix DVF par année » ────────────
// Renvoie un tableau de propriétés Notion (hors relation, ajoutée à l'écriture).
export function etudeToAnnees(b) {
  const d = (b.data && b.data.data) || {};
  const annees = Array.isArray(d.dvf_annees) ? d.dvf_annees : [];
  const ref = b.ref || "";
  return annees
    .filter((a) => a && a.annee != null)
    .map((a) => ({
      "Clé":                 P.title(`${ref} ${a.annee}`),
      "Année":               P.number(a.annee),
      "Ventes maisons":      P.number(a.nb_maison),
      "Ventes appartements": P.number(a.nb_appart),
      "Ventes local":        P.number(a.nb_local),
      "Ventes terrains":     P.number(a.nb_terrain),
      "Ventes total":        P.number(a.nb_total),
      "Prix m2 maison":      P.number(a.prix_m2_maison),
      "Prix m2 appartement": P.number(a.prix_m2_appart),
      "Prix m2 local":       P.number(a.prix_m2_local),
      "Prix m2 terrain":     P.number(a.prix_m2_terrain),
    }));
}

// ─── Reconstruction : propriétés Notion (+ lignes annuelles) -> { data, inputs }
// `p` = page.properties de la page parente ; `anneeRows` = tableau de props annuelles.
export function propsToEtude(p, anneeRows) {
  const num = (n) => readNumber(p[n]);
  const txt = (n) => readText(p[n]) || "";
  const sel = (n) => readSelect(p[n]);

  const typeBien = (sel("Type de bien") || "").toLowerCase();
  const surface  = num("Surface m2");

  const localisation = {
    label:      txt("Adresse"),
    city:       txt("Commune"),
    postcode:   txt("Code postal"),
    citycode:   txt("Code INSEE"),
    departement:txt("Département"),
    lat:        num("Latitude"),
    lon:        num("Longitude"),
    score_geo:  num("Score géocodage"),
    context:    txt("Contexte géo"),
  };

  const cp = txt("Code postal");
  const commune_info = {
    nom:             txt("Commune"),
    population:      num("Population"),
    superficie:     num("Superficie km2"),
    codeRegion:     txt("Code région"),
    codeDepartement:txt("Département"),
    codesPostaux:   cp ? [cp] : [],
  };

  // Période agrégée
  const periode = {
    periode:        txt("Période DVF"),
    nb_maison:      num("Ventes maisons"),
    nb_appart:      num("Ventes appartements"),
    nb_terrain:     num("Ventes terrains"),
    nb_total:       num("Nb transactions"),
    prix_m2_maison: num("Prix m2 maison"),
    prix_m2_appart: num("Prix m2 appartement"),
    prix_m2_terrain:num("Prix m2 terrain"),
    prix_m2_local:  null,
  };
  const hasPeriode = periode.periode || periode.nb_total != null;

  // Valoris (médianes par type)
  const valoris = {};
  const addVal = (key, prixName, nbName) => {
    const pm = num(prixName);
    if (pm != null) valoris[key] = { prix_median_m2: pm, nb: num(nbName), source: "DVF local" };
  };
  addVal("maison", "Prix m2 maison", "Ventes maisons");
  addVal("appartement", "Prix m2 appartement", "Ventes appartements");
  addVal("terrain", "Prix m2 terrain", "Ventes terrains");
  addVal("tous", "Prix m2 tous", "Ventes tous");

  // DPE
  const dpe = {};
  for (const c of DPE_CLASSES) { const v = num(`DPE ${c}`); if (v != null) dpe[c] = v; }

  // Risques
  const risques = {};
  const sZone = txt("Sismicité zone"), sLib = txt("Sismicité libellé");
  if (sZone || sLib) risques.sismicite = { zone: sZone, libelle: sLib };
  const radon = txt("Radon classe");
  if (radon) risques.radon = { classe: radon };
  const syn = readMultiSelect(p["Risques recensés"]);
  if (syn && syn.length) risques.synthese = syn;
  const icpe = num("Nb ICPE");
  if (icpe != null) risques.icpe = { count: icpe };

  // Score
  const total = num("Score potentiel");
  const axes = {};
  const addAxe = (key, noteName, detName) => {
    const note = num(noteName);
    if (note != null) axes[key] = { note, max: AXE_MAX, label: AXE_LABELS[key], detail: txt(detName) };
  };
  addAxe("activite", "Note activité", "Détail activité");
  addAxe("tendance", "Note tendance", "Détail tendance");
  addAxe("attractivite", "Note attractivité", "Détail attractivité");
  addAxe("dpe", "Note DPE", "Détail DPE");
  addAxe("risques", "Note risques", "Détail risques");
  const score = { total, verdict: sel("Verdict"), couleur: couleurFromTotal(total), axes };

  // Estimation retenue
  const valeurMed = num("Estimation");
  let estimation;
  if (valeurMed != null) {
    estimation = {
      prix_m2:    num("Prix m2 median"),
      surface,
      valeur_med: valeurMed,
      valeur_min: num("Fourchette basse"),
      valeur_max: num("Fourchette haute"),
    };
  }

  // Estimations par type (fourchettes recalculées)
  const estimations = {};
  const addEst = (key, prixName, valName, nbName) => {
    const pm = num(prixName), vm = num(valName);
    if (pm == null && vm == null) return;
    const isSel = typeBien.includes(key) && surface > 0;
    estimations[key] = {
      prix_m2:    pm,
      surface:    (vm != null && pm) ? Math.round(vm / pm) : null,
      valeur_med: vm,
      valeur_min: vm != null ? Math.round((vm * 0.85) / 1000) * 1000 : null,
      valeur_max: vm != null ? Math.round((vm * 1.20) / 1000) * 1000 : null,
      nb:         num(nbName),
      standard:   !isSel,
    };
  };
  addEst("maison", "Prix m2 maison", "Valeur maison", "Ventes maisons");
  addEst("appartement", "Prix m2 appartement", "Valeur appartement", "Ventes appartements");
  addEst("terrain", "Prix m2 terrain", "Valeur terrain", "Ventes terrains");

  // Série annuelle (base liée)
  const dvf_annees = (anneeRows || [])
    .map((r) => ({
      annee:          readNumber(r["Année"]),
      nb_maison:      readNumber(r["Ventes maisons"]),
      nb_appart:      readNumber(r["Ventes appartements"]),
      nb_local:       readNumber(r["Ventes local"]),
      nb_terrain:     readNumber(r["Ventes terrains"]),
      nb_total:       readNumber(r["Ventes total"]),
      prix_m2_maison: readNumber(r["Prix m2 maison"]),
      prix_m2_appart: readNumber(r["Prix m2 appartement"]),
      prix_m2_local:  readNumber(r["Prix m2 local"]),
      prix_m2_terrain:readNumber(r["Prix m2 terrain"]),
    }))
    .filter((a) => a.annee != null)
    .sort((a, b2) => a.annee - b2.annee);

  const data = {
    localisation,
    commune_info,
    dvf_annees,
    dvf_periodes: hasPeriode ? [periode] : [],
    valoris,
    dpe,
    risques,
    score,
    estimation,
    estimations,
    type_bien: typeBien,
    surface,
    generated_at: txt("Généré le"),
  };

  const inputs = {
    adresse:     txt("Adresse"),
    typeBien,
    surface,
    perimetre:   txt("Périmètre"),
    destinataire:txt("Client"),
  };

  return { data, inputs };
}
