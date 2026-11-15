// POST /api/facture-auto — facture émise automatiquement par une autre application, de serveur à serveur
// (ex. REA : une facture acquittée à chaque achat de crédits confirmé par PayPal).
//
// Sécurité : en-tête « X-Fidi-Cle » égal à la variable d'environnement FIDI_FACTURATION_CLE (même valeur
// dans l'application appelante). Sans cette variable, la fonction est désactivée (503).
// La facture est émise par la société par défaut (ou emetteur_id) du compte FIDI désigné par
// FIDI_FACTURATION_COMPTE (adresse e-mail d'un compte actif) : même numérotation, même charte et même
// historique que les factures faites à la main dans l'Étude de marché.
//
// Corps : { ref (unique, ex. identifiant PayPal), source, type_libelle?, emetteur_id?,
//           client:{ nom, email, adresse?, telephone? },
//           lignes:[{ designation, description?, quantite, prixUnitaire }], prixSaisis?:"TTC"|"HT",
//           paye?:true, moyen?:"PayPal"|"Carte"|…, transaction? }
// Réponse : 200 { ok, ref, token, montant, delivery_url, facture_url, deja? }
// Idempotent : un second appel avec la même « ref » renvoie la facture déjà émise.

import { timingSafeEqual } from "node:crypto";
import { authResp, signJWT } from "./_auth.mjs";
import { handler as creerFacture } from "./facture.mjs";
import { findFactureByToken, factureHtmlUrl, factureFromPage, reqOrigin } from "./_facture.mjs";
import { queryDatabase, updatePage, DB, P } from "./_notion.mjs";

function cleValide(recue) {
  const attendue = process.env.FIDI_FACTURATION_CLE || "";
  if (!attendue || attendue.length < 24) return false;
  const a = Buffer.from(String(recue || "")), b = Buffer.from(attendue);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function factureParRef(ref) {
  const data = await queryDatabase(DB.facture, {
    filter: { property: "Référence dossier", rich_text: { equals: ref } },
    page_size: 5,
  });
  const pages = (data.results || []).map(factureFromPage).filter((f) => f.statut !== "Annulée");
  return pages[0] || null;
}

const reponseFacture = (f, origin, deja) => authResp(200, {
  ok: true, deja: !!deja, ref: f.numero, token: f.jeton, montant: f.montant,
  delivery_url: f.jeton ? `${origin}/l/${f.jeton}` : "", facture_url: factureHtmlUrl(f, origin),
});

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "Méthode non autorisée" });
  if (!process.env.FIDI_FACTURATION_CLE || !process.env.FIDI_FACTURATION_COMPTE) {
    return authResp(503, { error: "Facturation automatique non configurée (FIDI_FACTURATION_CLE, FIDI_FACTURATION_COMPTE)." });
  }
  const h = event.headers || {};
  if (!cleValide(h["x-fidi-cle"] || h["X-Fidi-Cle"])) return authResp(401, { error: "Clé de facturation invalide" });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch (_) { return authResp(400, { error: "JSON invalide" }); }
  const ref = String(b.ref || "").trim().slice(0, 120);
  if (!ref) return authResp(400, { error: "« ref » obligatoire (identifiant unique de l'opération)" });
  const client = b.client || {};
  if (!String(client.nom || "").trim()) return authResp(400, { error: "« client.nom » obligatoire" });
  if (!Array.isArray(b.lignes) || !b.lignes.length) return authResp(400, { error: "« lignes » obligatoire" });
  const origin = reqOrigin(event);

  // Idempotence : la même opération ne donne jamais deux factures.
  try {
    const existante = await factureParRef(ref);
    if (existante) return reponseFacture(existante, origin, true);
  } catch (_) { /* recherche impossible : la création ci-dessous applique de toute façon l'anti-doublon */ }

  // Création par le même chemin que l'écran de facturation, au nom du compte désigné.
  const corps = {
    kind: "prestation", ref, source: String(b.source || "").slice(0, 60), type_libelle: b.type_libelle || b.source || "Prestation",
    client: client.nom, email_client: client.email || "", telephone: client.telephone || "",
    adresse: client.adresse || "", client_adresse: client.adresse || "", emetteur_id: b.emetteur_id || "",
    paiement_requis: false, canal: ["Lien"], echeance_jours: 0,
    facture: { lignes: b.lignes, mode: "quantite", prixSaisis: b.prixSaisis === "HT" ? "HT" : "TTC" },
  };
  const r = await creerFacture({
    ...event,
    headers: { ...h, cookie: "fidi_session=" + signJWT({ email: process.env.FIDI_FACTURATION_COMPTE }) },
    body: JSON.stringify(corps),
  });
  let j = {};
  try { j = JSON.parse(r.body || "{}"); } catch (_) { j = {}; }
  if (r.statusCode === 409 && j.ref) {
    try { const ex = await factureParRef(ref); if (ex) return reponseFacture(ex, origin, true); } catch (_) {}
  }
  if (r.statusCode !== 200 || !j.ok) return authResp(r.statusCode === 401 ? 503 : r.statusCode, { error: j.error || "Création impossible" });

  // Opération déjà encaissée : la facture est acquittée.
  if (b.paye !== false && j.token) {
    try {
      const f = await findFactureByToken(j.token);
      if (f) {
        await updatePage(f.id, {
          "Statut": P.select("Payée"),
          "Date paiement": P.date(new Date().toISOString().slice(0, 10)),
          "Moyen paiement": P.select(String(b.moyen || "PayPal").slice(0, 40)),
          "Montant payé": P.number(j.montant),
          "ID transaction": P.text(String(b.transaction || ref).slice(0, 120)),
        });
      }
    } catch (e) { console.error("[facture-auto] statut payé non enregistré :", e.message); }
  }
  return authResp(200, {
    ok: true, ref: j.ref, token: j.token, montant: j.montant, delivery_url: j.delivery_url || (j.token ? `${origin}/l/${j.token}` : ""),
    facture_url: j.token ? factureHtmlUrl({ numero: j.ref, jeton: j.token, montant: j.montant, paye: b.paye !== false }, origin) : "",
  });
};
