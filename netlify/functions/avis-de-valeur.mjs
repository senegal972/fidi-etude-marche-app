// Avis de valeur v2 — calcul serveur multi-méthodes en fourchette.
// POST /api/avis-de-valeur  { bien, cadastre, methodesV2, strategie, annonces, terrains, territoire }
//   → { valeur:{ methodes[], synthese }, cout_acquisition, strategie, vigilances, constat_marche }
// Rétro-compatible : un corps minimal (sans les nouveaux champs) ne provoque pas d'erreur.
// Aucune clé requise. Fonctions PURES importées de _avis_calcul.mjs.
import { calculerMethodes, arrondiValeur } from "./_avis_calcul.mjs";
import { territoirePourCode } from "./_territoires.mjs";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (s, b) => ({ statusCode: s, headers: CORS, body: JSON.stringify(b) });
const n = (v) => { if (v == null || v === "") return 0; const x = parseFloat(String(v).replace(",", ".")); return isFinite(x) ? x : 0; };

function quantiles(vals) {
  const s = vals.filter((v) => v > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const q = (p) => { const pos = (s.length - 1) * p, b = Math.floor(pos), r = pos - b; return s[b + 1] !== undefined ? s[b] + r * (s[b + 1] - s[b]) : s[b]; };
  return { p25: Math.round(q(0.25)), med: Math.round(q(0.5)), p75: Math.round(q(0.75)), moy: Math.round(s.reduce((a, v) => a + v, 0) / s.length), min: s[0], max: s[s.length - 1], n: s.length };
}

function coutAcquereur(net, terr, honoPct, charge) {
  net = n(net);
  const hono = net * honoPct / 100;
  const tvaHono = hono * terr.tva_honoraires_pct / 100;
  const honoTTC = hono + tvaHono;
  const acq = charge !== "vendeur";
  const prixFAI = acq ? net + honoTTC : net;
  const base = acq ? net : prixFAI;
  const droits = base * terr.droits_mutation_pct / 100;
  const notaire = base * terr.frais_notaire_pct / 100;
  return { net_vendeur: net, honoraires: hono, tva_honoraires: tvaHono, prix_fai: prixFAI, droits_mutation: droits, notaire, cout_total: prixFAI + droits + notaire };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "POST") return j(405, { error: "POST requis" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return j(400, { error: "JSON invalide" }); }

  const bien = body.bien || {};
  const cad = body.cadastre || {};
  const mv = body.methodesV2 || {};
  const strat = body.strategie || {};
  const annonces = Array.isArray(body.annonces) ? body.annonces : [];
  const terrainsIn = Array.isArray(body.terrains) ? body.terrains : [];

  const terr = territoirePourCode(body.territoire || bien.code_insee, bien.cp);

  // €/m² comparaison : override manuel sinon quantiles des annonces fournies.
  const comp = mv.comparaison || {};
  const annM2 = annonces.map((a) => n(a.prix_m2)).filter((v) => v > 0);
  const qa = quantiles(annM2);
  const comparaison = {
    bas: n(comp.prixM2Bas) || (qa ? qa.p25 : 0),
    central: n(comp.prixM2Central) || (qa ? qa.med : 0),
    haut: n(comp.prixM2Haut) || (qa ? qa.p75 : 0),
  };

  const sc = mv.solConstruction || {};
  const taux = mv.taux || {};
  const tCen = n(taux.central) || terr.taux_capi.central;
  const input = {
    shon: n(cad.shonAutorisee), shob: n(cad.shobAutorisee), surfaceHab: n(bien.surfaceCarrez),
    comparaison,
    chargeFonciere: sc.chargeFonciere || { bas: 0, central: 0, haut: 0 },
    coutShonM2: sc.coutShonM2 != null ? sc.coutShonM2 : terr.cout_construction_m2.shon,
    coutAnnexesM2: sc.coutAnnexesM2 != null ? sc.coutAnnexesM2 : terr.cout_construction_m2.annexes,
    forfait: n(sc.forfait),
    vetustePct: sc.vetustePct != null && sc.vetustePct !== "" ? n(sc.vetustePct) : 20,
    prime: sc.prime && (sc.prime.central !== "" && sc.prime.central != null) ? sc.prime : terr.prime_rarete_pct,
    lots: mv.lots || [],
    charges: mv.charges || {},
    taux: { bas: n(taux.bas) || tCen + 0.5, central: tCen, haut: n(taux.haut) || Math.max(0.5, tCen - 0.5) },
    poids: mv.poids || undefined,
    methodes: mv.methodes || undefined,
  };

  const r = calculerMethodes(input);
  const syn = r.synthese;

  const methodes = [];
  if (r.actives.comparaison) methodes.push({ cle: "comparaison", bas: r.comparaison.bas, central: r.comparaison.central, haut: r.comparaison.haut, poids: r.poids.comparaison });
  if (r.actives.solConstruction) methodes.push({ cle: "sol_construction", bas: r.solConstruction.bas, central: r.solConstruction.central, haut: r.solConstruction.haut, poids: r.poids.solConstruction });
  if (r.actives.capitalisation) methodes.push({ cle: "capitalisation", bas: r.capitalisation.bas, central: r.capitalisation.central, haut: r.capitalisation.haut, poids: r.poids.capitalisation });

  // Stratégie de prix
  const marge = strat.margeNegoPct != null && strat.margeNegoPct !== "" ? n(strat.margeNegoPct) : 8.5;
  const prixPresentation = n(strat.prixPresentationManuel) || arrondiValeur(syn.central * (1 + marge / 100));
  const honoPct = strat.honorairesPct != null && strat.honorairesPct !== "" ? n(strat.honorairesPct) : terr.honoraires_defaut_pct;
  const charge = strat.honorairesCharge || "acquéreur";

  const cout_acquisition = {
    presentation: coutAcquereur(prixPresentation, terr, honoPct, charge),
    objectif: coutAcquereur(syn.central, terr, honoPct, charge),
  };

  // Vigilances (réplique serveur, non exhaustive)
  const vigilances = [];
  const shon = n(cad.shonAutorisee), hab = n(bien.surfaceCarrez);
  if (shon && hab && hab > shon) {
    const ecart = hab - shon;
    vigilances.push({ niveau: "rouge", cle: "conformite_surface", texte: `Surface habitable (${hab} m²) supérieure à la SHON autorisée (${shon} m²) : écart ${ecart} m².` });
  }
  if (cad.voieTraversante) vigilances.push({ niveau: "orange", cle: "voie", texte: "Voie traversante / servitudes à vérifier." });
  if ((mv.lots || []).length) vigilances.push({ niveau: "info", cle: "locatif", texte: "Bien loué / multi-lots : vente soumise aux baux en cours." });
  vigilances.push({ niveau: "info", cle: "fiscalite", texte: `Fiscalité (${terr.libelle}) : ${terr.fiscalite_note}` });

  const constat_marche = {
    prix_m2: qa,
    prix_m2_terrain: quantiles(terrainsIn.map((t) => n(t.prix_m2_terrain)).filter((v) => v > 0)),
    nb_annonces: annonces.length, nb_terrains: terrainsIn.length,
    avertissement: "Prix affichés (annonces), non des prix de vente réalisés (≠ DVF).",
  };

  return j(200, {
    ok: true,
    territoire: { code: terr.code, libelle: terr.libelle, dvf_disponible: terr.dvf_disponible },
    valeur: {
      methodes,
      synthese: { bas: syn.bas, central: syn.central, haut: syn.haut },
      capitalisation_detail: { revenu_brut: r.capitalisation.revenuBrut, revenu_net: r.capitalisation.revenuNet, charges: r.capitalisation.charges },
    },
    cout_acquisition,
    strategie: { marge_nego_pct: marge, prix_presentation: prixPresentation, objectif_signature: syn.central, plancher: syn.bas, honoraires_pct: honoPct, honoraires_charge: charge },
    vigilances,
    constat_marche,
    avertissement: "Aide à la décision — ni notaire ni expert. Hypothèses « à valider ».",
  });
};
