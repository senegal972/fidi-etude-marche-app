// /api/facture/paiement — paiement enregistré à la main sur une facture (espèces, virement, chèque…).
//
// Le paiement en ligne (PayPal / carte) marque la facture payée tout seul ; ici l'administrateur constate un
// règlement reçu autrement, avec ou sans justificatif, et peut le corriger ou l'annuler.
//
// Auth : session exigée avant tout le reste, rôle Administrateur.
//
// GET  ?ref=N                  → { ref, paiement|null }   détail enregistré (note, justificatif présent ou non)
// GET  ?ref=N&justificatif=1   → le fichier justificatif (image ou PDF)
// POST { action:"enregistrer", ref, date, moyen, montant, reference, note, sans_justificatif, recu_remis,
//        ecart_accepte, justificatif?:{ nom, type, base64 } }
// POST { action:"annuler_paiement", ref, motif }   remet la facture « À payer » (paiements manuels seulement)
//
// Notion porte le statut, la date, le moyen, le montant et la référence ; la note, l'auteur et le justificatif
// vont dans Netlify Blobs (store « fidi-paiements ») : p/<numéro> = fiche, j/<numéro> = fichier.

import { DB, P, hasToken, updatePage, createPage, queryDatabase } from "./_notion.mjs";
import { authResp, currentUser, AUTH_HEADERS } from "./_auth.mjs";
import { factureFromPage } from "./_facture.mjs";
import { getNamedStore } from "./_blobs.mjs";

export const PAIEMENTS_STORE = "fidi-paiements";
export const MOYENS = ["Espèces", "Virement", "Chèque", "Carte", "PayPal", "Autre"];
export const TYPES_JUSTIFICATIF = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const TAILLE_JUSTIFICATIF_MAX = 3_000_000; // octets : le corps d'une fonction est limité à 6 Mo, base64 compris
// Plafond légal d'un paiement en espèces à un professionnel (résident fiscal français) : art. L112-6 et D112-3
// du Code monétaire et financier. Le paiement est enregistré quand même : l'écran avertit, il ne bloque pas.
export const PLAFOND_ESPECES = 1000;

const REF_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const texte = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(v));

// Contrôle d'une demande d'enregistrement : { ok, erreur?, valeur? }. Pur, testé sans réseau.
export function validerPaiement(b, montantFacture, aujourdhui = new Date().toISOString().slice(0, 10)) {
  const moyen = String(b.moyen || "");
  if (!MOYENS.includes(moyen)) return { ok: false, erreur: "Moyen de paiement à choisir." };
  const date = String(b.date || aujourdhui);
  if (!dateOk(date)) return { ok: false, erreur: "Date de paiement invalide." };
  if (date > aujourdhui) return { ok: false, erreur: "La date de paiement ne peut pas être dans le futur." };
  const montant = Math.round(Number(String(b.montant == null || b.montant === "" ? montantFacture : b.montant).replace(",", ".")) * 100) / 100;
  if (!Number.isFinite(montant) || montant <= 0) return { ok: false, erreur: "Montant reçu invalide." };
  const ecart = Math.round((montant - montantFacture) * 100) / 100;
  const note = texte(b.note, 600);
  // Le paiement partiel n'est pas géré : un montant différent du TTC doit être assumé et expliqué.
  if (Math.abs(ecart) > 0.5) {
    if (!b.ecart_accepte) return { ok: false, erreur: `Le montant reçu (${montant.toFixed(2)} €) diffère du montant de la facture (${montantFacture.toFixed(2)} €). Confirmez l'écart pour solder la facture.`, ecart };
    if (note.length < 5) return { ok: false, erreur: "Expliquez l'écart de montant dans la note.", ecart };
  }
  const j = b.justificatif && typeof b.justificatif === "object" ? b.justificatif : null;
  let fichier = null;
  if (j) {
    const type = String(j.type || "");
    if (!TYPES_JUSTIFICATIF.includes(type)) return { ok: false, erreur: "Justificatif : image (JPEG, PNG, WebP) ou PDF seulement." };
    const b64 = String(j.base64 || "").replace(/^data:[^,]*,/, "");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.length < 8) return { ok: false, erreur: "Justificatif illisible." };
    const taille = Math.floor(b64.replace(/\s/g, "").length * 3 / 4);
    if (taille > TAILLE_JUSTIFICATIF_MAX) return { ok: false, erreur: "Justificatif trop lourd (3 Mo au plus)." };
    fichier = { nom: texte(j.nom, 120).replace(/[^\w .()-]/g, "_") || "justificatif", type, base64: b64.replace(/\s/g, ""), taille };
  } else if (!b.sans_justificatif && !b.garder_justificatif) {
    return { ok: false, erreur: "Joignez un justificatif ou indiquez que le paiement est enregistré sans justificatif." };
  }
  return {
    ok: true,
    valeur: { moyen, date, montant, ecart, reference: texte(b.reference, 80), note, sans_justificatif: !fichier && !!b.sans_justificatif,
              recu_remis: !!b.recu_remis, fichier, depasse_plafond_especes: moyen === "Espèces" && montant > PLAFOND_ESPECES },
  };
}

async function trouver(ref) {
  const q = await queryDatabase(DB.facture, { filter: { property: "Numéro", title: { equals: ref } }, page_size: 1 });
  return (q.results || [])[0] || null;
}
const lireJSON = async (store, cle) => { try { return await store.get(cle, { type: "json" }); } catch { return null; } };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!hasToken() || !process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  let store = null;
  const ouvrir = async () => (store = store || await getNamedStore(event, PAIEMENTS_STORE));

  try {
    if (event.httpMethod === "GET") {
      const q = event.queryStringParameters || {};
      const ref = String(q.ref || "");
      if (!REF_VALIDE.test(ref)) return authResp(400, { error: "Référence invalide" });
      await ouvrir();
      if (q.justificatif) {
        const f = await lireJSON(store, "j/" + ref);
        if (!f || !TYPES_JUSTIFICATIF.includes(f.type)) return authResp(404, { error: "Aucun justificatif pour cette facture." });
        return {
          statusCode: 200, isBase64Encoded: true, body: f.base64,
          headers: { ...AUTH_HEADERS, "Content-Type": f.type, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
                     "Content-Disposition": `inline; filename="${String(f.nom || "justificatif").replace(/[^\w .()-]/g, "_")}"` },
        };
      }
      return authResp(200, { ref, paiement: await lireJSON(store, "p/" + ref) });
    }
    if (event.httpMethod !== "POST") return authResp(405, { error: "GET ou POST requis" });

    let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
    const ref = String(b.ref || "");
    if (!REF_VALIDE.test(ref)) return authResp(400, { error: "Référence invalide" });
    const page = await trouver(ref);
    if (!page) return authResp(404, { error: "Facture introuvable." });
    const f = factureFromPage(page);
    const moyenActuel = page.properties?.["Moyen paiement"]?.select?.name || "";
    const transaction = (page.properties?.["ID transaction"]?.rich_text || []).map((t) => t.plain_text || "").join("");
    const manuel = /^MANUEL/.test(transaction);
    const auteur = { email: me.user.email, nom: me.user.nom || "" };
    const maintenant = new Date().toISOString();

    if (b.action === "annuler_paiement") {
      if (!f.paye) return authResp(409, { error: "Cette facture n'est pas marquée payée." });
      if (!manuel) return authResp(409, { error: "Ce paiement a été encaissé en ligne (" + (moyenActuel || "PayPal") + ") : il se rembourse depuis PayPal, il ne s'annule pas ici.", en_ligne: true });
      await updatePage(f.id, { "Statut": P.select("À payer"), "Date paiement": { date: null }, "Montant payé": P.number(0),
                               "ID transaction": P.text("PAIEMENT ANNULE — " + texte(b.motif, 200)) });
      try {
        await ouvrir();
        const fiche = (await lireJSON(store, "p/" + ref)) || {};
        await store.setJSON("p/" + ref, { ...fiche, annule: { le: maintenant, par: auteur, motif: texte(b.motif, 200) } });
      } catch (e) { console.error("[facture-paiement] fiche non mise à jour :", e.message); }
      return authResp(200, { ok: true, ref, statut: "À payer" });
    }

    if (b.action !== "enregistrer") return authResp(400, { error: "Action inconnue" });
    if (f.statut === "Annulée") return authResp(409, { error: "Facture annulée : aucun paiement ne peut y être enregistré." });
    if (f.statut === "Brouillon") return authResp(409, { error: "Facture en brouillon : émettez-la avant d'enregistrer un paiement." });
    if (f.paye && !manuel) return authResp(409, { error: "Cette facture a été réglée en ligne : son paiement ne se modifie pas ici.", en_ligne: true });
    if (!(f.montant > 0)) return authResp(400, { error: "Montant de facture invalide." });

    const v = validerPaiement(b, f.montant);
    if (!v.ok) return authResp(400, { error: v.erreur, ecart: v.ecart });
    const p = v.valeur;

    // Le justificatif et la fiche sont écrits AVANT de marquer la facture payée : un stockage en panne ne laisse
    // pas une facture soldée sans trace de qui l'a soldée.
    await ouvrir();
    const ancienne = (await lireJSON(store, "p/" + ref)) || {};
    let justificatif = b.garder_justificatif && !p.fichier ? (ancienne.justificatif || null) : null;
    if (p.fichier) {
      await store.setJSON("j/" + ref, { nom: p.fichier.nom, type: p.fichier.type, base64: p.fichier.base64 });
      justificatif = { nom: p.fichier.nom, type: p.fichier.type, taille: p.fichier.taille };
    } else if (!justificatif) {
      try { await store.delete("j/" + ref); } catch { /* aucun fichier à retirer */ }
    }
    const fiche = {
      ref, moyen: p.moyen, date: p.date, montant: p.montant, ecart: p.ecart, reference: p.reference, note: p.note,
      sans_justificatif: !justificatif, recu_remis: p.recu_remis, justificatif,
      enregistre: ancienne.enregistre || { le: maintenant, par: auteur },
      ...(ancienne.enregistre ? { modifie: { le: maintenant, par: auteur } } : {}),
    };
    await store.setJSON("p/" + ref, fiche);

    await updatePage(f.id, {
      "Statut":         P.select("Payée"),
      "Date paiement":  P.date(p.date),
      "Moyen paiement": P.select(p.moyen),
      "Montant payé":   P.number(p.montant),
      "ID transaction": P.text("MANUEL" + (p.reference ? " — " + p.reference : "")),
    });

    // Journal Paiements (au mieux) — seulement au premier enregistrement.
    if (!ancienne.enregistre) {
      try {
        await createPage(DB.paiements, {
          "Référence":         P.title("MANUEL-" + ref),
          "Email utilisateur": P.text(f.email),
          "Offre":             P.text("Facture " + ref),
          "Montant €":         P.number(p.montant),
          "Moyen":             P.select(p.moyen),
          "Statut":            P.select("Payé"),
          "Date":              P.date(p.date),
        });
      } catch { /* le journal n'empêche pas l'enregistrement */ }
    }

    return authResp(200, { ok: true, ref, statut: "Payée", paiement: fiche, depasse_plafond_especes: p.depasse_plafond_especes });
  } catch (e) {
    console.error("[facture-paiement]", e.message);
    return authResp(e.status || 500, { error: e.message || "Erreur" });
  }
};
