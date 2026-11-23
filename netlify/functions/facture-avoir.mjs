// POST /api/facture/avoir { ref, motif, remboursement? } — avoir annulant une facture PAYÉE. Administrateur.
//
// Une facture réglée ne se supprime pas et ne s'« annule » pas : on émet un avoir, document numéroté qui l'annule.
//   • L'avoir a sa propre suite : <préfixe de la facture>-AV-<AAAA>-<NNN>.
//   • Son détail (copie des lignes de la facture, émetteur et client figés) est écrit dans Blobs « fidi-factures » AVANT la page Notion.
//   • Notion : une ligne Type « Avoir », Statut « Avoir », montants négatifs, « Référence dossier » = numéro de la facture annulée.
//   • La facture d'origine passe « Annulée », avec la mention de l'avoir : elle sort des encaissements, la prestation redevient facturable.
// Aucun appel à PayPal : le remboursement du client se fait à la main (virement, espèces, ou depuis le compte PayPal) et se note ici.
// Idempotent : un second appel pour la même facture renvoie l'avoir déjà émis.
import { DB, P, hasToken, queryDatabase, createPage, updatePage, randToken } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { factureFromPage, reqOrigin } from "./_facture.mjs";
import { getNamedStore } from "./_blobs.mjs";
import { FACTURES_STORE, nextFactureRef } from "./facture.mjs";

const REMBOURSEMENTS = ["Virement", "Espèces", "Chèque", "PayPal", "Carte bancaire", "Non remboursé à ce jour"];
const texte = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const lire = (p, k) => ((p[k] && (p[k].rich_text || p[k].title)) || []).map((t) => t.plain_text || "").join("");

// Préfixe de la suite d'avoirs, tiré du numéro de la facture (« FF-FAC-2026-002 » → « FF-FAC-AV »).
export function prefixeAvoir(numero) {
  const m = String(numero || "").match(/^(.+)-\d{4}-\d+$/);
  return (m ? m[1] : "FIDI-FAC") + "-AV";
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!hasToken() || !process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
  const ref = texte(b.ref, 80), motif = texte(b.motif, 300);
  const remboursement = REMBOURSEMENTS.includes(b.remboursement) ? b.remboursement : "Non remboursé à ce jour";
  if (!ref) return authResp(400, { error: "Numéro de facture requis." });
  if (motif.length < 3) return authResp(400, { error: "Indiquez le motif de l'avoir.", champ: "motif" });

  try {
    const q = await queryDatabase(DB.facture, { filter: { property: "Numéro", title: { equals: ref } }, page_size: 1 });
    if (!q.results?.length) return authResp(404, { error: "Facture introuvable." });
    const page = q.results[0], props = page.properties || {}, f = factureFromPage(page);
    const origin = reqOrigin(event);
    const lienAvoir = (numero, jeton) => `${origin}/api/facture-html?ref=${encodeURIComponent(numero)}&t=${encodeURIComponent(jeton)}`;

    // Avoir déjà émis pour cette facture ?
    const deja = await queryDatabase(DB.facture, { filter: { and: [
      { property: "Type", select: { equals: "Avoir" } }, { property: "Référence dossier", rich_text: { equals: ref } } ] }, page_size: 1 });
    if (deja.results?.length) {
      const a = deja.results[0].properties || {};
      const numero = lire(a, "Numéro"), jeton = lire(a, "Jeton livraison");
      return authResp(200, { ok: true, deja_emis: true, avoir: numero, avoir_url: lienAvoir(numero, jeton), facture: ref });
    }
    if (f.type === "Avoir") return authResp(409, { error: "Ce document est déjà un avoir." });
    if (f.statut !== "Payée") return authResp(409, { error: "Seule une facture payée s'annule par un avoir. Une facture non réglée s'annule directement.", statut: f.statut });

    const today = new Date().toISOString().slice(0, 10);
    const numero = await nextFactureRef(new Date().getFullYear(), prefixeAvoir(ref));
    const jeton = randToken();

    // Détail figé de l'avoir : celui de la facture, sinon une ligne reconstituée depuis Notion (factures anciennes).
    const store = await getNamedStore(event, FACTURES_STORE);
    let detail = null;
    try { if (f.jeton) detail = await store.get(f.jeton, { type: "json" }); } catch { /* reconstitué ci-dessous */ }
    if (!detail) {
      const ttc = Number(f.montant) || 0;
      detail = { v: 1, emetteur: {}, client: { nom: f.client, email: f.email, telephone: f.telephone }, bien: f.adresse, refDossier: f.refDossier,
        facture: { lignes: [{ designation: f.libelle || f.type || "Prestation", description: "", quantite: 1, prixUnitaire: ttc }],
                   mode: "montant", prixSaisis: "TTC", remise: null, tva: { regime: "franchise", taux: 0 } },
        totaux: { brut: ttc, remise: 0, ht: ttc, tva: 0, ttc, htAvantRemise: ttc, remiseHT: 0 } };
    }
    const avoir = { ...detail, numero, date: today, echeance: today, notes: "", acquittee: false,
      avoir: { de: ref, dateFacture: f.date || "", motif, remboursement, emisPar: me.user.email, emisLe: new Date().toISOString() } };
    try { await store.setJSON(jeton, avoir); }
    catch (e) { console.error("[avoir] détail non enregistré :", e.message); return authResp(503, { error: "Enregistrement de l'avoir impossible, réessayez.", blobs_error: true }); }

    const nb = (k) => (props[k] && typeof props[k].number === "number" ? props[k].number : null);
    const ttc = Number(f.montant) || 0, ht = nb("Montant HT"), tva = nb("TVA");
    await createPage(DB.facture, {
      "Numéro":            P.title(numero),
      "Date":              P.date(today),
      "Client":            P.text(f.client),
      "Email client":      P.email(f.email || null),
      "Téléphone client":  { phone_number: f.telephone || null },
      "Type":              P.select("Avoir"),
      "Libellé":           P.text(("Avoir sur " + ref + " — " + motif).slice(0, 200)),
      "Adresse bien":      P.text(f.adresse),
      "Montant HT":        P.number(-(ht == null ? ttc : ht)),
      "TVA":               P.number(-(tva || 0)),
      "Montant TTC":       P.number(-ttc),
      "Référence dossier": P.text(ref),
      "Statut":            P.select("Avoir"),
      "Paiement requis":   P.checkbox(false),
      "Jeton livraison":   P.text(jeton),
      "Lien document":     P.url(null),
    });
    // La facture d'origine sort des encaissements ; la date et le moyen du paiement d'origine restent lisibles.
    await updatePage(page.id, { "Statut": P.select("Annulée"), "ID transaction": P.text(("AVOIR " + numero + " — " + motif).slice(0, 400)) });

    return authResp(200, { ok: true, avoir: numero, avoir_url: lienAvoir(numero, jeton), facture: ref, montant: -ttc, remboursement });
  } catch (e) {
    console.error("[avoir]", e.message);
    return authResp(e.status || 500, { error: e.message || "Erreur" });
  }
};
