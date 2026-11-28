// /api/documents — confidentialité des documents du compte connecté (études, avis de valeur). Règles : _documents.mjs.
//
// Auth : session exigée avant tout le reste.
//
// GET                                   → { moi:{ email, nom, groupe, partage, avec[], admin }, membres:[{ email, nom }] }
//                                          membres = comptes actifs du même groupe (ceux avec qui un partage est possible)
// POST { action:"partage", mode, avec } → règle qui voit MES documents : "prive" | "groupe" | "choisi" (+ e-mails de mon groupe)
// POST { action:"attribuer", kind, ref, email }   administrateur : donne un propriétaire à un dossier (ex. dossier antérieur)
import { DB, P, hasToken, updatePage, ensureProperty } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { lecteurDe, chargerComptes, assainirPartage, memeGroupe, pageParRef, colonneProprietaire, PROP_PROPRIETAIRE, LIBELLE_PARTAGE } from "./_documents.mjs";

// Écrit le réglage de partage d'un compte (page Notion du compte). Utilisé aussi par la console d'administration.
export async function ecrirePartage(pageId, valeur) {
  await ensureProperty(DB.users, "Partage documents", { select: {} });
  await ensureProperty(DB.users, "Partage avec", { rich_text: {} });
  await updatePage(pageId, { "Partage documents": P.select(LIBELLE_PARTAGE[valeur.mode]), "Partage avec": P.text((valeur.avec || []).join(", ").slice(0, 1900)) });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });
  let found = null;
  try { found = await currentUser(event); } catch { return authResp(503, { error: "Vérification de la connexion impossible, réessayez." }); }
  if (!found) return authResp(401, { error: "Connexion requise.", need_auth: true });
  if (!hasToken()) return authResp(503, { error: "Service non configuré." });
  const moi = lecteurDe(found), admin = moi.role === "Administrateur";

  try {
    const comptes = await chargerComptes();
    const membres = comptes.filter((c) => c.email !== moi.email && c.statut !== "Désactivé" && memeGroupe(c, moi)).map((c) => ({ email: c.email, nom: c.nom || c.email }));
    const vue = () => ({ moi: { email: moi.email, nom: moi.nom, groupe: moi.groupe, partage: moi.partage, avec: moi.avec, admin }, membres });

    if (event.httpMethod === "GET") return authResp(200, vue());
    if (event.httpMethod !== "POST") return authResp(405, { error: "Méthode non admise." });
    let b = {};
    try { b = JSON.parse(event.body || "{}") || {}; } catch { return authResp(400, { error: "Demande illisible." }); }

    if (b.action === "partage") {
      const r = assainirPartage(moi, { mode: b.mode, avec: b.avec }, comptes);
      if (!r.ok) return authResp(400, { error: r.erreur });
      await ecrirePartage(moi.id, r.valeur);
      moi.partage = r.valeur.mode; moi.avec = r.valeur.avec;
      return authResp(200, { ok: true, ...vue() });
    }
    if (b.action === "attribuer") {
      if (!admin) return authResp(403, { error: "Réservé aux administrateurs." });
      const kind = String(b.kind || "").toLowerCase(), ref = String(b.ref || "").trim(), cible = String(b.email || "").trim().toLowerCase();
      if (!["etude", "avis"].includes(kind) || !ref) return authResp(400, { error: "Dossier non précisé." });
      if (!comptes.some((c) => c.email === cible)) return authResp(400, { error: "Compte inconnu : " + cible });
      const base = kind === "etude" ? DB.etude : DB.avis;
      if (!(await colonneProprietaire(base))) return authResp(503, { error: "Attribution impossible pour l'instant, réessayez." });
      const page = await pageParRef(base, ref);
      if (!page) return authResp(404, { error: "Dossier introuvable : " + ref });
      await updatePage(page.id, { [PROP_PROPRIETAIRE]: P.text(cible) });
      return authResp(200, { ok: true, ref, proprietaire: cible });
    }
    return authResp(400, { error: "Action inconnue." });
  } catch (e) {
    console.error("[documents]", e.message);
    return authResp(e.status || 500, { error: "Opération impossible, réessayez." });
  }
};
