// Netlify Function — Création d'une facture FIDI + préparation de la remise.
// POST /api/facture
// Body: { kind:"avis"|"etude", ref, client, email_client, telephone, adresse,
//         commune, montant, libelle?, paiement_requis?, canal?:[], lien_document? }
//
// Génère un numéro séquentiel, crée la page Notion « Factures », et un jeton de
// remise unique. Le document (et la facture) ne seront délivrés au client via la
// page /l/<jeton> que si le paiement n'est pas requis, ou une fois encaissé.

import { DB, P, hasToken, queryDatabase, createPage, randToken } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { reqOrigin } from "./_facture.mjs";

const TARIFS = { avis: 250, etude: 450 };

async function nextFactureRef(year) {
  try {
    const data = await queryDatabase(DB.facture, {
      sorts: [{ property: "Numéro", direction: "descending" }],
      page_size: 1,
    });
    if (!data.results?.length) return `FIDI-FAC-${year}-001`;
    const last = data.results[0].properties?.["Numéro"]?.title?.[0]?.plain_text || "";
    const m = last.match(/FIDI-FAC-\d{4}-(\d+)$/);
    const n = m ? parseInt(m[1], 10) + 1 : 1;
    return `FIDI-FAC-${year}-${String(n).padStart(3, "0")}`;
  } catch {
    return `FIDI-FAC-${year}-${String(Date.now()).slice(-3)}`;
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
  if (!["avis", "etude"].includes(kind)) return authResp(400, { error: "kind doit être avis ou etude" });

  const today   = new Date().toISOString().slice(0, 10);
  const year    = today.slice(0, 4);
  const montant = Number(b.montant) > 0 ? Number(b.montant) : TARIFS[kind];
  const ref     = String(b.ref || "").trim();
  const client  = String(b.client || "").trim();
  const email   = String(b.email_client || "").trim();
  const tel      = String(b.telephone || "").trim();
  const adresse = String(b.adresse || b.commune || "").trim();
  const paiementRequis = !!b.paiement_requis;
  const lienDoc = String(b.lien_document || "").trim();
  const canaux  = Array.isArray(b.canal) ? b.canal.filter((c) => ["Lien", "Email", "WhatsApp"].includes(c)) : [];
  const type    = kind === "avis" ? "Avis de valeur" : "Étude de marché";
  const libelle = String(b.libelle || "").trim() || (kind === "avis"
    ? `Avis de valeur immobilier — ${adresse || ref}`
    : `Étude de marché immobilier — ${adresse || ref}`);

  const origin  = reqOrigin(event);

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
        const exTok = ex.properties?.["Jeton livraison"]?.rich_text?.[0]?.plain_text || "";
        return authResp(200, {
          ok: true, existing: true, ref: exRef, token: exTok, kind, montant, date: today,
          libelle, client, email, adresse,
          delivery_url: exTok ? `${origin}/l/${exTok}` : "",
        });
      }
    }

    const factRef = await nextFactureRef(year);
    const token   = randToken();

    await createPage(DB.facture, {
      "Numéro":            P.title(factRef),
      "Date":              P.date(today),
      "Client":            P.text(client),
      "Email client":      P.email(email),
      "Téléphone client":  { phone_number: tel || null },
      "Type":              P.select(type),
      "Libellé":           P.text(libelle),
      "Adresse bien":      P.text(adresse),
      "Montant HT":        P.number(montant),
      "TVA":               P.number(0),
      "Montant TTC":       P.number(montant),
      "Référence dossier": P.text(ref),
      "Statut":            P.select("À payer"),
      "Paiement requis":   P.checkbox(paiementRequis),
      "Jeton livraison":   P.text(token),
      "Lien document":     P.url(lienDoc || null),
      "Canal envoi":       P.multi_select(canaux),
    });

    return authResp(200, {
      ok: true, ref: factRef, token, kind, montant, date: today,
      libelle, client, email, adresse, paiement_requis: paiementRequis,
      delivery_url: `${origin}/l/${token}`,
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
