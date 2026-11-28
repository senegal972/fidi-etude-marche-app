// Netlify Function — Sauvegarde Notion (upsert avis ou étude par Référence)
// POST /api/notion-save  body: { kind: "avis"|"etude", ref, ...champs, data:{...} }
//
// Études : « une information = un champ ». Chaque donnée est écrite dans sa propre
// colonne (voir _etude_fields.mjs) ; la série annuelle DVF va dans la base liée
// « Prix DVF par année ». Aucun blob JSON n'est écrit pour les études.

import {
  DB, P, bigText, packBig, tropLourd, jsonResp, hasToken,
  createPage, updatePage, findByRef, queryDatabase, archivePage, ensureProperty,
} from "./_notion.mjs";
import { etudeToProps, etudeToAnnees } from "./_etude_fields.mjs";

// La copie Notion d'un avis est un index de secours. Si elle ne tient pas dans la propriété
// (photos), on l'écrit sans les images plutôt que de la perdre ; l'avis complet, photos
// comprises, est enregistré par /api/avis-store.
export function packAvis(data) {
  const plein = packBig(data);
  if (!tropLourd(plein)) return plein;
  const photos = data?.bien?.photos;
  if (!Array.isArray(photos) || !photos.length) return plein;
  return packBig({ ...data, bien: { ...data.bien, photos: [] }, __photos_retirees: photos.length });
}

function buildAvisProps(b) {
  return {
    "Référence":        P.title(b.ref),
    "Date":             P.date(b.date || new Date().toISOString().slice(0, 10)),
    "Adresse":          P.text(b.adresse),
    "Commune":          P.text(b.commune),
    "Type de bien":     P.select(b.type_bien),
    "Surface m2":       P.number(b.surface),
    "Valeur retenue":   P.number(b.valeur),
    "Fourchette basse": P.number(b.valeur_min),
    "Fourchette haute": P.number(b.valeur_max),
    "Client":           P.text(b.client),
    "Email client":     P.email(b.email_client),
    "Statut":           P.status(b.statut || "En cours"),
    "Honoraires":       P.number(b.honoraires),
    "Statut facture":   P.select(b.statut_facture || "Non facturé"),
    "Lien partage":     P.url(b.lien_partage),
    "Donnees JSON":     packAvis(b.data),
  };
}

// Remplace les lignes annuelles liées d'une étude : archive les anciennes, crée les neuves.
async function syncEtudeAnnees(parentId, b, isUpdate) {
  if (isUpdate) {
    try {
      const existing = await queryDatabase(DB.etudeAnnees, {
        filter: { property: "Étude", relation: { contains: parentId } },
        page_size: 100,
      });
      await Promise.all((existing.results || []).map((r) => archivePage(r.id)));
    } catch (_) { /* best-effort : on n'échoue pas la sauvegarde pour ça */ }
  }
  const rows = etudeToAnnees(b);
  await Promise.all(rows.map((props) =>
    createPage(DB.etudeAnnees, { ...props, "Étude": P.relation([parentId]) })
  ));
}

import { sessionRequise } from "./_auth.mjs";
import { lecteurDe, pageParRef, proprietaireDePage, peutModifier, colonneProprietaire, PROP_PROPRIETAIRE } from "./_documents.mjs";
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  // Session vérifiée avant tout le reste : ces dossiers contiennent des noms de clients.
  const s = await sessionRequise(event); if (s.refus) return s.refus;
  const lecteur = lecteurDe(s.found);

  if (!hasToken()) {
    return jsonResp(503, {
      error: "Notion non configuré. Définir NOTION_TOKEN dans les variables Netlify.",
      configured: false,
    });
  }

  let b;
  try { b = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const kind = (b.kind || "").toLowerCase();
  const ref  = (b.ref || "").trim();
  if (!ref) return jsonResp(400, { error: "ref (référence) requise" });
  if (kind !== "avis" && kind !== "etude") {
    return jsonResp(400, { error: "kind doit valoir 'avis' ou 'etude'" });
  }

  const databaseId = kind === "avis" ? DB.avis : DB.etude;
  const props = kind === "avis" ? buildAvisProps(b) : etudeToProps(b);
  // Parcelles terrain multiples : persistées pour la réouverture (carte + total). On
  // s'assure d'abord que la colonne existe ; si elle ne peut pas être créée (droits),
  // on n'ajoute pas la propriété (la sauvegarde ne doit jamais échouer pour ça).
  if (kind === "etude") {
    try {
      const ok = await ensureProperty(DB.etude, "Parcelles terrain", { rich_text: {} });
      if (ok) props["Parcelles terrain"] = P.text(JSON.stringify(Array.isArray(b.terrain_parcelles) ? b.terrain_parcelles : []));
    } catch (_) { /* best-effort */ }
  }

  try {
    // Sauvegarde automatique d'une étude : la référence ne contient ni adresse ni parcelle
    // (jour + destinataire + commune). Deux études du même jour dans la même commune la
    // partagent : une sauvegarde automatique ne remplace jamais l'étude d'une autre adresse.
    // Confidentialité : le dossier porte son propriétaire. Un dossier existant ne se modifie que par son propriétaire ou par
    // l'administrateur ; un dossier sans propriétaire (antérieur) n'est repris que par l'administrateur, qui en devient propriétaire.
    const p0 = await pageParRef(databaseId, ref);
    const proprietaire = p0 ? proprietaireDePage(p0) : "";
    if (p0 && !peutModifier(lecteur, proprietaire)) {
      return jsonResp(403, { ok: false, autre_compte: true, error: "Cette référence est déjà celle d'un dossier d'un autre compte : il ne peut pas être modifié d'ici. Changez le destinataire ou la date, ou adressez-vous à l'administrateur." });
    }
    if (await colonneProprietaire(databaseId)) props[PROP_PROPRIETAIRE] = P.text(proprietaire || lecteur.email);
    else return jsonResp(503, { ok: false, error: "Le dossier ne peut pas être rattaché à votre compte pour l'instant (colonne « Propriétaire » indisponible). Réessayez." });

    let existingId;
    if (kind === "etude" && b.auto) {
      existingId = p0?.id || null;
      const autre = p0 ? (p0.properties?.["Adresse"]?.rich_text || []).map((t) => t.plain_text).join("").trim() : "";
      const ici = String(b.adresse || "").trim();
      if (autre && ici && autre.toLowerCase() !== ici.toLowerCase()) {
        return jsonResp(409, { ok: false, conflit: true, adresse_existante: autre, error: "Une autre étude porte déjà cette référence." });
      }
    } else {
      existingId = p0 ? p0.id : null;
    }
    let page;
    if (existingId) {
      page = await updatePage(existingId, props);
    } else {
      page = await createPage(databaseId, props);
    }

    if (kind === "etude") {
      await syncEtudeAnnees(page.id, b, !!existingId);
    }

    return jsonResp(200, {
      ok: true,
      kind,
      ref,
      action: existingId ? "updated" : "created",
      page_id: page.id,
      page_url: page.url,
    });
  } catch (e) {
    return jsonResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
