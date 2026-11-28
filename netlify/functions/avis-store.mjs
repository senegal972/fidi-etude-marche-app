// /api/avis-store — stockage des avis de valeur et de leurs versions, accessible de tout poste.
//
// Pourquoi : la copie Notion d'un avis tient dans une propriété limitée à ~200 000 caractères.
// Un avis avec photos la dépasse ; il y était tronqué et devenait illisible, sans erreur.
// Ici l'avis complet est un blob (Netlify Blobs, store « fidi-avis »), sans cette limite.
//
// Auth : session exigée avant tout le reste (cookie fidi_session ou Bearer, voir _auth.mjs).
// Chaque compte ne voit que ses avis ; un administrateur voit ceux de tous (paramètre proprio).
//
// Clés (aucune lecture-modification-écriture : tout se déduit d'un list par préfixe) :
//   d/<compte>/<ref>               avis courant            métadonnées = résumé
//   v/<compte>/<ref>/<ts>-<motif>  version figée           métadonnées = résumé + libellé
//
// GET  ?liste=1                      → { documents:[résumé…] }
// GET  ?ref=R                        → { ref, data, resume, maj }
// GET  ?ref=R&resume=1               → { ref, resume, maj, empreinte } sans le contenu
// GET  ?ref=R&versions=1             → { versions:[{ id, ts, motif, diffusee, … }] }
// GET  ?ref=R&version=ID             → { ref, id, data, resume }
// POST { action:"enregistrer", ref, data, resume, version?:{ motif, libelle } }
// POST { action:"supprimer", ref }             409 si une version diffusée existe
// POST { action:"supprimer_version", ref, id } 409 pour une version diffusée
//
// Une version « diffusée » (PDF, impression, partage, facture, Word) n'est jamais supprimée ni
// remplacée : c'est la trace de ce qui a été remis à un tiers.

import crypto from "node:crypto";
import { authResp, currentUser } from "./_auth.mjs";
import { getNamedStore } from "./_blobs.mjs";
import { lecteurDe, chargerComptes, comptesVisibles, peutVoir } from "./_documents.mjs";

export const AVIS_STORE = "fidi-avis";
export const TAILLE_MAX = 5_500_000;      // octets : la fonction refuse au-delà de 6 Mo
export const VERSIONS_MANUELLES_MAX = 30; // les versions diffusées ne sont pas comptées

export const MOTIFS_DIFFUSION = ["pdf", "impression", "partage", "facture", "word"];
const MOTIFS = ["manuel", "auto", "import", ...MOTIFS_DIFFUSION];

const REF_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ID_VALIDE = /^\d{13}-[a-z]{2,12}$/;
const COMPTE_VALIDE = /^[A-Za-z0-9-]{1,64}$/;

const texte = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const nombre = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);

// Résumé affiché dans les listes : seuls ces champs sont conservés en métadonnées.
export function assainirResume(src) {
  const s = src && typeof src === "object" ? src : {};
  return {
    client: texte(s.client, 80), commune: texte(s.commune, 60), type: texte(s.type, 40),
    adresse: texte(s.adresse, 120), date: texte(s.date, 10), nature: texte(s.nature, 12),
    valeur_min: nombre(s.valeur_min), valeur_max: nombre(s.valeur_max),
  };
}

const cleDoc = (compte, ref) => `d/${compte}/${ref}`;
const prefixeVersions = (compte, ref) => `v/${compte}/${ref}/`;
const estDiffusee = (motif) => MOTIFS_DIFFUSION.includes(motif);

function lireIdVersion(cle) {
  const id = cle.slice(cle.lastIndexOf("/") + 1);
  if (!ID_VALIDE.test(id)) return null;
  const motif = id.slice(14);
  return { id, ts: Number(id.slice(0, 13)), motif, diffusee: estDiffusee(motif) };
}

async function listerVersions(store, compte, ref) {
  const { blobs } = await store.list({ prefix: prefixeVersions(compte, ref) });
  return blobs.map((b) => ({ cle: b.key, ...lireIdVersion(b.key) })).filter((v) => v.id).sort((a, b) => b.ts - a.ts);
}

async function meta(store, cle) {
  try { return (await store.getMetadata(cle))?.metadata || {}; } catch { return {}; }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return authResp(405, { error: "Méthode non autorisée" });

  let found;
  try { found = await currentUser(event); }
  catch { return authResp(503, { error: "Comptes indisponibles" }); }
  if (!found) return authResp(401, { error: "Connexion requise.", need_auth: true });
  const moi = String(found.user.id || found.page?.id || "");
  if (!COMPTE_VALIDE.test(moi)) return authResp(401, { error: "Compte introuvable" });
  const admin = found.user.role === "Administrateur";

  const q = event.queryStringParameters || {};
  let corps = {};
  if (event.httpMethod === "POST") {
    if ((event.body || "").length > TAILLE_MAX) {
      return authResp(413, { error: "Avis trop volumineux pour être enregistré en ligne. Retirez ou réduisez les photos." });
    }
    try { corps = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
  }

  // Un administrateur peut viser le compte d'un autre. Un compte ordinaire peut LIRE (jamais écrire) les avis d'un membre de son
  // groupe qui les lui ouvre (_documents.mjs) ; tout autre compte visé est ignoré : il retombe sur ses propres avis.
  const vise = String((event.httpMethod === "GET" ? q.proprio : corps.proprio) || "");
  const lecteur = lecteurDe(found);
  let comptes = null;
  const lesComptes = async () => { if (!comptes) { try { comptes = await chargerComptes(); } catch { comptes = []; } } return comptes; };
  let compte = moi;
  if (COMPTE_VALIDE.test(vise) && vise !== moi) {
    // Compte visé inconnu, ou client de l'écosystème public : refus, y compris pour l'administrateur.
    const cible = (await lesComptes()).find((c) => c.id === vise) || null;
    if (cible && peutVoir(lecteur, cible) && (admin || event.httpMethod === "GET")) compte = vise;
    else if (admin || event.httpMethod === "GET") return authResp(404, { error: "Avis introuvable" });
  }

  let store;
  try { store = await getNamedStore(event, AVIS_STORE); }
  catch { return authResp(503, { error: "Stockage indisponible", blobs_error: true }); }

  try {
    if (event.httpMethod === "GET") {
      if (q.liste) {
        // Mes avis, plus ceux des membres de mon groupe qui me les ouvrent ; l'administrateur voit ceux de tous.
        const tous = await lesComptes();
        const parId = Object.fromEntries(tous.map((c) => [c.id, c]));
        let blobs = [];
        if (admin) {
          // Tous les avis, sauf ceux des comptes de l'écosystème public (et, par prudence, ceux d'un compte que la liste ne connaît pas).
          ({ blobs } = await store.list({ prefix: "d/" }));
          blobs = blobs.filter((b) => { const id = b.key.split("/")[1]; return id === moi || (parId[id] && peutVoir(lecteur, parId[id])); });
        }
        else {
          const ids = Array.from(new Set([moi, ...comptesVisibles(lecteur, tous).map((c) => c.id)])).filter((id) => COMPTE_VALIDE.test(id)).slice(0, 60);
          for (const id of ids) blobs.push(...(await store.list({ prefix: `d/${id}/` })).blobs);
        }
        const documents = await Promise.all(blobs.map(async (b) => {
          const [, proprio, ...reste] = b.key.split("/");
          const m = await meta(store, b.key), cp = parId[proprio] || null;
          return { ref: reste.join("/"), proprio, a_moi: proprio === moi, ...assainirResume(m), maj: m.maj || null, auteur: m.auteur || (cp ? cp.nom : ""), diffusions: m.diffusions || 0,
            proprietaire: cp ? cp.email : "", proprietaire_nom: cp ? (cp.nom || cp.email) : "", groupe: cp ? cp.groupe : "" };
        }));
        documents.sort((a, b) => String(b.maj || "").localeCompare(String(a.maj || "")));
        return authResp(200, { documents, admin });
      }

      const ref = String(q.ref || "");
      if (!REF_VALIDE.test(ref)) return authResp(400, { error: "Référence invalide" });

      if (q.versions) {
        const versions = await Promise.all((await listerVersions(store, compte, ref)).map(async (v) => {
          const m = await meta(store, v.cle);
          return { id: v.id, ts: v.ts, motif: v.motif, diffusee: v.diffusee, libelle: m.libelle || "", auteur: m.auteur || "", ...assainirResume(m) };
        }));
        return authResp(200, { ref, versions });
      }

      if (q.version) {
        if (!ID_VALIDE.test(q.version)) return authResp(400, { error: "Version invalide" });
        const cle = prefixeVersions(compte, ref) + q.version;
        const data = await store.get(cle, { type: "json" });
        if (!data) return authResp(404, { error: "Version introuvable" });
        return authResp(200, { ref, id: q.version, data, resume: assainirResume(await meta(store, cle)) });
      }

      // Résumé seul : sert à savoir si la copie en ligne est plus récente, sans la télécharger.
      if (q.resume) {
        const brut = await store.getMetadata(cleDoc(compte, ref));
        if (!brut) return authResp(404, { error: "Avis introuvable" });
        const m = brut.metadata || {};
        return authResp(200, { ref, resume: assainirResume(m), maj: m.maj || null, empreinte: m.empreinte || "", diffusions: m.diffusions || 0 });
      }

      const data = await store.get(cleDoc(compte, ref), { type: "json" });
      if (!data) return authResp(404, { error: "Avis introuvable" });
      const m = await meta(store, cleDoc(compte, ref));
      return authResp(200, { ref, data, resume: assainirResume(m), maj: m.maj || null });
    }

    const ref = String(corps.ref || "");
    if (!REF_VALIDE.test(ref)) return authResp(400, { error: "Référence invalide" });

    if (corps.action === "enregistrer") {
      const data = corps.data;
      if (!data || typeof data !== "object" || Array.isArray(data) || !data.metadata) {
        return authResp(400, { error: "Avis invalide" });
      }
      const brut = JSON.stringify(data);
      const empreinte = crypto.createHash("sha1").update(brut).digest("hex");
      const resume = assainirResume(corps.resume);
      const maintenant = Date.now();
      const avant = await meta(store, cleDoc(compte, ref));

      let version = null, diffusions = Number(avant.diffusions) || 0, empreinteVersion = avant.empreinte_version || "";
      if (corps.version && typeof corps.version === "object") {
        const motif = MOTIFS.includes(corps.version.motif) ? corps.version.motif : "manuel";
        // Une version non diffusée identique à la dernière version n'apporte rien.
        if (estDiffusee(motif) || empreinte !== empreinteVersion) {
          const id = `${String(maintenant).padStart(13, "0")}-${motif}`;
          await store.set(prefixeVersions(compte, ref) + id, brut, {
            metadata: { ...resume, libelle: texte(corps.version.libelle, 120), auteur: found.user.email, empreinte },
          });
          version = { id, ts: maintenant, motif, diffusee: estDiffusee(motif) };
          empreinteVersion = empreinte;
          if (estDiffusee(motif)) diffusions++;
          else await elaguerVersionsManuelles(store, compte, ref);
        }
      }

      await store.set(cleDoc(compte, ref), brut, {
        metadata: { ...resume, maj: new Date(maintenant).toISOString(), auteur: found.user.email, empreinte, empreinte_version: empreinteVersion, diffusions },
      });
      return authResp(200, { ok: true, ref, maj: new Date(maintenant).toISOString(), version, diffusions });
    }

    if (corps.action === "supprimer") {
      const versions = await listerVersions(store, compte, ref);
      if (versions.some((v) => v.diffusee)) {
        return authResp(409, { error: "Suppression interdite : une version de cet avis a été diffusée (PDF, partage ou facture).", locked: true });
      }
      await Promise.all(versions.map((v) => store.delete(v.cle)));
      await store.delete(cleDoc(compte, ref));
      return authResp(200, { ok: true, ref });
    }

    if (corps.action === "supprimer_version") {
      const v = lireIdVersion(String(corps.id || ""));
      if (!v) return authResp(400, { error: "Version invalide" });
      if (v.diffusee) return authResp(409, { error: "Une version diffusée ne peut pas être supprimée.", locked: true });
      await store.delete(prefixeVersions(compte, ref) + v.id);
      return authResp(200, { ok: true, ref, id: v.id });
    }

    return authResp(400, { error: "Action inconnue" });
  } catch (e) {
    console.error("[avis-store]", e.message);
    return authResp(503, { error: "Stockage indisponible", blobs_error: true });
  }
};

async function elaguerVersionsManuelles(store, compte, ref) {
  try {
    const manuelles = (await listerVersions(store, compte, ref)).filter((v) => !v.diffusee);
    await Promise.all(manuelles.slice(VERSIONS_MANUELLES_MAX).map((v) => store.delete(v.cle)));
  } catch (e) { console.error("[avis-store] élagage :", e.message); }
}
