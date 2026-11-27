// /api/bienvenue — réglages de l'e-mail de bienvenue envoyé à chaque nouveau compte : mot d'accueil, liens (vidéo, présentation),
// pièces jointes (PDF, PowerPoint, Word, image ; 4 Mo par fichier, 3 fichiers).
//
// Auth : session exigée avant tout le reste, rôle Administrateur.
//
// GET                         → { reglages:{ message, liens[], pieces[] }, envoi:true|false, limites }
// GET  ?piece=<id>            → le fichier (contrôle par l'administrateur)
// POST { action:"enregistrer", message, liens:[{ libelle, url }] }
// POST { action:"ajouter_piece", nom, base64 }
// POST { action:"retirer_piece", id }
// POST { action:"essai" }     → envoie l'e-mail de bienvenue, tel qu'il est réglé, à l'administrateur connecté
import crypto from "node:crypto";
import { authResp, currentUser } from "./_auth.mjs";
import { getNamedStore } from "./_blobs.mjs";
import { identiteCompte } from "./_identite.mjs";
import { BIENVENUE_STORE, LIENS_MAX, PIECES_MAX, TAILLE_PIECE_MAX, assainirReglages, assainirPiece, lireReglages, envoyerBienvenue } from "./_bienvenue.mjs";

export async function traiter(event, me, store) {
  const envoi = !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
  const limites = { liens: LIENS_MAX, pieces: PIECES_MAX, taille: TAILLE_PIECE_MAX };
  if (event.httpMethod === "GET") {
    const id = String((event.queryStringParameters || {}).piece || "");
    if (id) {
      if (!/^[a-f0-9]{16}$/.test(id)) return authResp(400, { error: "Référence invalide." });
      const f = await store.get("f/" + id, { type: "json" }).catch(() => null);
      if (!f || !f.base64) return authResp(404, { error: "Fichier introuvable." });
      return { statusCode: 200, isBase64Encoded: true, body: f.base64,
        headers: { "Content-Type": f.type || "application/octet-stream", "Content-Disposition": `inline; filename="${String(f.nom || "document").replace(/[^\w .()-]/g, "_")}"`, "Cache-Control": "private, no-store" } };
    }
    return authResp(200, { reglages: await lireReglages(event, store), envoi, limites });
  }
  if (event.httpMethod !== "POST") return authResp(405, { error: "Méthode non admise." });
  let b = {};
  try { b = JSON.parse(event.body || "{}") || {}; } catch { return authResp(400, { error: "Demande illisible." }); }
  const actuel = await lireReglages(event, store);

  if (b.action === "enregistrer") {
    const r = assainirReglages(b);
    if (!r.ok) return authResp(400, { error: r.erreur });
    const reglages = { ...r.valeur, pieces: actuel.pieces };
    await store.setJSON("reglages", reglages);
    return authResp(200, { ok: true, reglages, envoi, limites });
  }
  if (b.action === "ajouter_piece") {
    if (actuel.pieces.length >= PIECES_MAX) return authResp(400, { error: `${PIECES_MAX} pièces jointes au plus. Retirez-en une d'abord.` });
    const r = assainirPiece(b);
    if (!r.ok) return authResp(400, { error: r.erreur });
    const id = crypto.randomBytes(8).toString("hex");
    await store.setJSON("f/" + id, { nom: r.valeur.nom, type: r.valeur.type, base64: r.valeur.base64 }); // le fichier d'abord
    const reglages = { ...actuel, pieces: [...actuel.pieces, { id, nom: r.valeur.nom, type: r.valeur.type, taille: r.valeur.taille }] };
    await store.setJSON("reglages", reglages);
    return authResp(200, { ok: true, reglages, envoi, limites });
  }
  if (b.action === "retirer_piece") {
    const id = String(b.id || "");
    const reglages = { ...actuel, pieces: actuel.pieces.filter((p) => p.id !== id) };
    await store.setJSON("reglages", reglages);
    if (/^[a-f0-9]{16}$/.test(id)) await store.delete("f/" + id).catch(() => {});
    return authResp(200, { ok: true, reglages, envoi, limites });
  }
  if (b.action === "essai") {
    const etat = await envoyerBienvenue({ event, email: me.user.email, nom: me.user.nom, choisirMotDePasse: false, store, essai: true, identite: await identiteCompte(event, me) });
    if (etat === "non_configure") return authResp(503, { error: "L'envoi d'e-mails n'est pas réglé (RESEND_API_KEY, RESEND_FROM)." });
    if (etat !== "envoye") return authResp(502, { error: "L'e-mail d'essai n'a pas pu partir. Réessayez." });
    return authResp(200, { ok: true, envoye_a: me.user.email });
  }
  return authResp(400, { error: "Action inconnue." });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });
  let me = null;
  try { me = await currentUser(event); } catch { return authResp(503, { error: "Vérification de la connexion impossible, réessayez." }); }
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });
  let store;
  try { store = await getNamedStore(event, BIENVENUE_STORE); }
  catch (e) { console.error("[bienvenue]", e.message); return authResp(503, { error: "Stockage indisponible, réessayez.", blobs_error: true }); }
  try { return await traiter(event, me, store); }
  catch (e) { console.error("[bienvenue]", e.message); return authResp(500, { error: "Enregistrement impossible, réessayez." }); }
};
