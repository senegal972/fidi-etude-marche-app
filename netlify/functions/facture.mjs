// Netlify Function — Création d'une facture FIDI + préparation de la remise.
// POST /api/facture
// Body: { kind:"avis"|"etude"|"prestation", ref, client, email_client, telephone, adresse,
//   « prestation » : facture demandée par une autre application (REA, Fiche découverte, HomeStaging PRO…)
//   via facturation-pont.js ; type_libelle = libellé du type dans Notion, source = application d'origine.
//         commune, montant, libelle?, paiement_requis?, canal?:[], lien_document? }
//   Facture détaillée (écran de facturation v2, facture.js) — champs supplémentaires :
//         facture:{ lignes:[{designation,description,quantite,prixUnitaire}], mode, prixSaisis, remise },
//         echeance_jours, notes, client_adresse, emetteur? (repli si le compte n'a pas de charte)
//   Les totaux sont recalculés ici (_facture_calc.mjs) ; le régime de TVA et l'identité de l'émetteur
//   viennent de la charte du compte (store « fidi-marques »). Le détail est figé dans le store
//   « fidi-factures » (clé = jeton de livraison) et sert au rendu de facture-html.mjs.
//
// Génère un numéro séquentiel, crée la page Notion « Factures », et un jeton de
// remise unique. Le document (et la facture) ne seront délivrés au client via la
// page /l/<jeton> que si le paiement n'est pas requis, ou une fois encaissé.

import { DB, P, hasToken, queryDatabase, createPage, updatePage, randToken } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { reqOrigin } from "./_facture.mjs";
import { getNamedStore } from "./_blobs.mjs";
import { calculerFacture, libelleCourt } from "./_facture_calc.mjs";
import { assainirMarque, MARQUE_STORE } from "./marque.mjs";

export const FACTURES_STORE = "fidi-factures";

const txt = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const plusJours = (iso, j) => new Date(new Date(iso + "T12:00:00Z").getTime() + j * 86400000).toISOString().slice(0, 10);

// Émetteur figé sur la facture. Source : charte du compte (store « fidi-marques »), à défaut la
// charte transmise par le navigateur (b.charte). Si la charte définit des sociétés émettrices,
// celle demandée (b.emetteur_id, sinon la société par défaut) est utilisée, avec son préfixe de
// numérotation. Sinon : mentions uniques de la charte (bloc « facturation ») et suite historique.
async function emetteurDe(event, me, b) {
  let charte = null;
  try {
    const store = await getNamedStore(event, MARQUE_STORE);
    charte = await store.get(String(me.user.id || me.page?.id || ""), { type: "json" });
  } catch (_) { /* stockage indisponible : repli sur la charte transmise */ }
  const m = assainirMarque(charte || b.charte || b.emetteur || {});
  const fa = m.facturation || {}, co = m.coordonnees || {};
  const liste = m.emetteurs || [];
  if (liste.length) {
    const id = String(b.emetteur_id || m.emetteurDefaut || "");
    const e = liste.find((x) => x.id === id) || (!b.emetteur_id ? liste[0] : null);
    if (!e) return { erreur: "Société émettrice introuvable : rechargez la fenêtre de facture." };
    return {
      prefixe: e.prefixe || PREFIXE_HISTORIQUE,
      emetteur: {
        id: e.id, enseigne: e.raisonSociale, logo: e.avecLogo ? (m.logo || "") : "", couleurs: m.couleurs || {},
        coordonnees: { raisonSociale: e.raisonSociale, adresse: e.adresse, telephone: e.telephone, email: e.email,
                       mentions: e.avecLogo ? (co.mentions || "") : "" },
        facturation: { formeJuridique: e.formeJuridique, capital: e.capital, siren: e.siret || e.siren,
                       registre: e.registre, tvaIntra: e.tvaIntra, regimeTva: e.regimeTva, tauxTva: e.tauxTva,
                       conditions: fa.conditions || "" },
        // Virement : figé avec la facture, repris par le document et par la page du client.
        ...(e.iban ? { banque: { iban: e.iban, bic: e.bic || "", titulaire: e.titulaire || e.raisonSociale } } : {}),
      },
    };
  }
  return {
    prefixe: PREFIXE_HISTORIQUE,
    emetteur: { enseigne: m.enseigne || "", logo: m.logo || "", couleurs: m.couleurs || {}, coordonnees: co, facturation: fa },
  };
}

const TARIFS = { avis: 250, etude: 450, prestation: 0 };

// Numéro suivant dans la suite chronologique d'une société émettrice : <PRÉFIXE>-<AAAA>-<NNN>.
// Chaque société a son préfixe (obligation légale d'une numérotation continue par émetteur) ;
// « FIDI-FAC » est la suite historique, utilisée quand aucune société n'est définie.
export const PREFIXE_HISTORIQUE = "FIDI-FAC";
const echapperRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function nextFactureRef(year, prefixe = PREFIXE_HISTORIQUE) {
  const debut = `${prefixe}-${year}-`;
  try {
    const data = await queryDatabase(DB.facture, {
      filter: { property: "Numéro", title: { starts_with: debut } },
      sorts: [{ property: "Numéro", direction: "descending" }],
      page_size: 1,
    });
    if (!data.results?.length) return `${debut}001`;
    const last = data.results[0].properties?.["Numéro"]?.title?.[0]?.plain_text || "";
    const m = last.match(new RegExp("^" + echapperRegex(debut) + "(\\d+)$"));
    const n = m ? parseInt(m[1], 10) + 1 : 1;
    return `${debut}${String(n).padStart(3, "0")}`;
  } catch {
    return `${debut}${String(Date.now()).slice(-3)}`;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET || !hasToken()) return authResp(503, { error: "Service non configuré." });

  // La facturation est réservée au personnel FIDI connecté.
  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });

  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }

  const kind = (b.kind || "").toLowerCase();
  if (!["avis", "etude", "prestation"].includes(kind)) return authResp(400, { error: "kind doit être avis, etude ou prestation" });
  if (kind === "prestation" && !(b.facture && typeof b.facture === "object")) {
    return authResp(400, { error: "Une prestation se facture avec le détail des articles (champ « facture »)." });
  }

  const today   = new Date().toISOString().slice(0, 10);
  const year    = today.slice(0, 4);
  const montant = Number(b.montant) > 0 ? Number(b.montant) : TARIFS[kind];
  const ref     = String(b.ref || "").trim();
  const client  = String(b.client || "").trim();
  if (b.facture && typeof b.facture === "object" && !client) return authResp(400, { error: "Le nom du client est obligatoire sur une facture." });
  const email   = String(b.email_client || "").trim();
  const tel      = String(b.telephone || "").trim();
  const adresse = String(b.adresse || b.commune || "").trim();
  const paiementRequis = !!b.paiement_requis;
  const lienDoc = String(b.lien_document || "").trim();
  const canaux  = Array.isArray(b.canal) ? b.canal.filter((c) => ["Lien", "Email", "WhatsApp"].includes(c)) : [];
  const type    = kind === "avis" ? "Avis de valeur" : kind === "etude" ? "Étude de marché"
                : (String(b.type_libelle || "").replace(/[\u0000-\u001f,]/g, " ").trim().slice(0, 60) || "Prestation");
  const libelle = String(b.libelle || "").trim() || (kind === "avis"
    ? `Avis de valeur immobilier — ${adresse || ref}`
    : kind === "etude" ? `Étude de marché immobilier — ${adresse || ref}`
    : `${type}${adresse ? " — " + adresse : ""}`);

  const origin  = reqOrigin(event);

  // ─── Facture détaillée (lignes, remise, TVA, échéance) ─────────────────────
  let detail = null, montantHT = montant, montantTVA = 0, montantTTC = montant, libelleFinal = libelle;
  let prefixe = PREFIXE_HISTORIQUE;
  if (b.facture && typeof b.facture === "object") {
    const choix = await emetteurDe(event, me, b);
    if (choix.erreur) return authResp(400, { error: choix.erreur });
    const emetteur = choix.emetteur;
    prefixe = choix.prefixe;
    const fa = emetteur.facturation;
    if (!fa.regimeTva) {
      return authResp(400, { error: "Choisissez le régime de TVA de la société émettrice avant de facturer.", need_regime: true });
    }
    const facture = { lignes: b.facture.lignes, mode: b.facture.mode, prixSaisis: b.facture.prixSaisis,
                      remise: b.facture.remise, tva: { regime: fa.regimeTva, taux: fa.tauxTva } };
    const calc = calculerFacture(facture);
    if (!(calc.totaux.ttc > 0)) return authResp(400, { error: "Ajoutez au moins un article avec un montant." });
    const jours = Math.max(0, Math.min(90, parseInt(b.echeance_jours, 10) || 0));
    montantHT = calc.totaux.ht; montantTVA = calc.totaux.tva; montantTTC = calc.totaux.ttc;
    libelleFinal = libelleCourt(calc, libelle);
    detail = {
      v: 1, date: today, echeance: plusJours(today, jours),
      client: { nom: client, email, telephone: tel, adresse: txt(b.client_adresse, 200) },
      bien: adresse, refDossier: ref, notes: txt(b.notes, 1000), source: txt(b.source, 60),
      facture: { lignes: calc.lignes.map(({ designation, description, quantite, prixUnitaire }) => ({ designation, description, quantite, prixUnitaire })),
                 mode: calc.mode, prixSaisis: calc.prixSaisis, remise: calc.remise, tva: calc.tva },
      totaux: calc.totaux, emetteur,
    };
  }
  // Enregistré AVANT la page Notion : une facture détaillée n'existe jamais sans son détail.
  async function figerDetail(numero, jeton, date) {
    if (!detail) return;
    const store = await getNamedStore(event, FACTURES_STORE);
    await store.setJSON(jeton, { ...detail, numero, date: date || detail.date });
  }

  try {
    // Anti-doublon : même prestation → on renvoie la facture existante + son jeton.
    if (ref) {
      const dup = await queryDatabase(DB.facture, {
        filter: { property: "Référence dossier", rich_text: { equals: ref } },
        page_size: 1,
      });
      if (dup.results?.length) {
        const ex = dup.results[0];
        const exRef = ex.properties?.["Numéro"]?.title?.[0]?.plain_text || "";
        const exStatut = ex.properties?.["Statut"]?.select?.name || "";
        let exTok = ex.properties?.["Jeton livraison"]?.rich_text?.[0]?.plain_text || "";
        const exMontant = ex.properties?.["Montant TTC"]?.number || 0;

        // ─── IMMUABILITÉ ───────────────────────────────────────────────────
        // Facture "Payée" ou "Annulée" : interdit de la modifier. On refuse
        // avec un code clair, l'appelant décidera (créer un avenant ou
        // simplement afficher l'existante).
        if (exStatut === "Payée" || exStatut === "Annulée") {
          return authResp(409, {
            error: "Facture N° " + exRef + " au statut « " + exStatut + " » — modification interdite.",
            locked: true,
            statut: exStatut,
            ref: exRef,
            token: exTok || "",
            montant: exMontant,
            delivery_url: exTok ? `${origin}/l/${exTok}` : "",
            hint: "Créez une nouvelle facture (avenant) ou annulez celle-ci si nécessaire.",
          });
        }

        // Le numéro appartient à la suite d'une société : une ré-édition au nom d'une AUTRE société
        // ne peut pas le reprendre (numérotation continue par émetteur).
        if (detail && !exRef.startsWith(prefixe + "-")) {
          return authResp(409, {
            error: "Cette prestation a déjà la facture N° " + exRef + " émise par une autre société. "
              + "Annulez-la (onglet Facturation) avant d'en établir une au nom de la société choisie.",
            autre_emetteur: true, ref: exRef, statut: exStatut,
          });
        }

        // Ré-édition (statut À payer / Brouillon) : on ECRASE aussi montant +
        // libellé + type + client + adresse avec les valeurs de la requête
        // actuelle (sinon un ancien montant erroné reste dans Notion).
        const upd = {
          "Paiement requis": P.checkbox(paiementRequis),
          "Canal envoi":     P.multi_select(canaux),
          "Libellé":         P.text(libelleFinal),
          "Montant HT":      P.number(montantHT),
          "TVA":             P.number(montantTVA),
          "Montant TTC":     P.number(montantTTC),
          "Type":            P.select(type),
          "Client":          P.text(client),
          "Email client":    P.email(email),
          "Adresse bien":    P.text(adresse),
          "Téléphone client": { phone_number: tel || null },
        };
        if (lienDoc) upd["Lien document"] = P.url(lienDoc);
        if (!exTok) { exTok = randToken(); upd["Jeton livraison"] = P.text(exTok); }
        if (detail) {
          try { await figerDetail(exRef, exTok, ex.properties?.["Date"]?.date?.start || today); }
          catch (e) { return authResp(503, { error: "Enregistrement du détail de la facture impossible, réessayez.", blobs_error: true }); }
        }
        try { await updatePage(ex.id, upd); } catch (_) { /* non bloquant */ }
        return authResp(200, {
          ok: true, existing: true, updated: true, ref: exRef, token: exTok, kind, montant: montantTTC, date: today,
          libelle: libelleFinal, client, email, adresse, paiement_requis: paiementRequis,
          delivery_url: exTok ? `${origin}/l/${exTok}` : "",
        });
      }
    }

    const factRef = await nextFactureRef(year, prefixe);
    const token   = randToken();
    if (detail) {
      try { await figerDetail(factRef, token, today); }
      catch (e) { return authResp(503, { error: "Enregistrement du détail de la facture impossible, réessayez.", blobs_error: true }); }
    }

    await createPage(DB.facture, {
      "Numéro":            P.title(factRef),
      "Date":              P.date(today),
      "Client":            P.text(client),
      "Email client":      P.email(email),
      "Téléphone client":  { phone_number: tel || null },
      "Type":              P.select(type),
      "Libellé":           P.text(libelleFinal),
      "Adresse bien":      P.text(adresse),
      "Montant HT":        P.number(montantHT),
      "TVA":               P.number(montantTVA),
      "Montant TTC":       P.number(montantTTC),
      "Référence dossier": P.text(ref),
      "Statut":            P.select("À payer"),
      "Paiement requis":   P.checkbox(paiementRequis),
      "Jeton livraison":   P.text(token),
      "Lien document":     P.url(lienDoc || null),
      "Canal envoi":       P.multi_select(canaux),
    });

    return authResp(200, {
      ok: true, ref: factRef, token, kind, montant: montantTTC, date: today,
      libelle: libelleFinal, client, email, adresse, paiement_requis: paiementRequis,
      delivery_url: `${origin}/l/${token}`,
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
