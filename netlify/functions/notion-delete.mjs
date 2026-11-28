// Netlify Function — Supprime (met en corbeille Notion) un dossier par référence.
// POST /api/notion-delete  { kind: "etude"|"avis", ref: "XXXX" }
//
// Notion ne supprime pas définitivement : la page est mise en corbeille (in_trash).
// Elle disparaît des listes (notion-list filtre les pages archivées côté API).

import { DB, jsonResp, hasToken, findByRef, archivePage } from "./_notion.mjs";
import { factureLockForRef } from "./_facture.mjs";

import { sessionRequise } from "./_auth.mjs";
import { lecteurDe, pageParRef, proprietaireDePage, peutModifier } from "./_documents.mjs";
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  // Session vérifiée avant tout le reste : ces dossiers contiennent des noms de clients.
  const s = await sessionRequise(event); if (s.refus) return s.refus;
  const lecteur = lecteurDe(s.found);

  if (!hasToken()) {
    return jsonResp(503, { error: "Notion non configuré (NOTION_TOKEN absent).", configured: false });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "corps JSON invalide" }); }
  const kind = (body.kind || "etude").toLowerCase();
  const ref = (body.ref || "").trim();
  if (!ref) return jsonResp(400, { error: "ref requise" });

  const databaseId = kind === "etude" ? DB.etude : DB.avis;
  try {
    // Confidentialité : seuls le propriétaire du dossier et l'administrateur le suppriment (un partage ne donne que la lecture).
    const dossier = await pageParRef(databaseId, ref);
    if (!dossier || !peutModifier(lecteur, proprietaireDePage(dossier))) return jsonResp(404, { error: `Dossier introuvable : ${ref}` });
    // Verrou : interdit de supprimer un dossier déjà envoyé ou payé (vérif serveur,
    // même si le client a tenté de contourner le bouton grisé).
    const lock = await factureLockForRef(ref);
    if (lock.locked) {
      return jsonResp(409, {
        error: lock.raison === "payé"
          ? `Suppression interdite : le dossier « ${ref} » a été payé.`
          : lock.raison === "vérification facture impossible"
            ? `Suppression impossible : vérification de la facturation indisponible, réessayez.`
            : `Suppression interdite : le dossier « ${ref} » a déjà été envoyé / facturé.`,
        locked: true, raison: lock.raison || "envoyé",
      });
    }
    await archivePage(dossier.id);
    return jsonResp(200, { ok: true, kind, ref, archived: true });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
