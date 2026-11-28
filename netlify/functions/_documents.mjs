// Confidentialité des documents (études, avis de valeur) : qui voit quoi. Règles appliquées CÔTÉ SERVEUR par toutes les routes qui
// listent, ouvrent, enregistrent ou suppriment un dossier — l'écran ne fait que présenter ce que le serveur a laissé passer.
//
//   • chaque dossier porte son propriétaire (« Propriétaire » dans Notion = e-mail du compte ; avis en ligne : dossier du compte) ;
//   • chacun voit ses propres documents ;
//   • un compte choisit qui voit les siens : « prive » (lui seul), « groupe » (tous les membres de son groupe),
//     « choisi » (les membres de son groupe qu'il désigne) — champs « Partage documents » et « Partage avec » du compte ;
//   • jamais d'un groupe à l'autre : sans groupe commun (champ « Réseau »), aucun partage ;
//   • l'administrateur voit tout, et fixe ces réglages à la création d'un compte ou dans sa fiche ;
//   • un dossier sans propriétaire (enregistré avant la 1.50) n'est visible que de l'administrateur.
// Seuls le propriétaire et l'administrateur modifient ou suppriment un dossier : un partage ne donne que la lecture.
import { DB, queryDatabase, readText, readSelect, ensureProperty } from "./_notion.mjs";

export const PARTAGES = ["prive", "groupe", "choisi"];
export const LIBELLE_PARTAGE = { prive: "Privé", groupe: "Groupe", choisi: "Personnes choisies" };
export const PROP_PROPRIETAIRE = "Propriétaire";
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const email = (s) => String(s || "").trim().toLowerCase();

function lireGroupe(props) {
  const p = props["Réseau"];
  if (!p) return "";
  if (Array.isArray(p.rich_text)) return p.rich_text.map((t) => t.plain_text || "").join("").trim();
  return (p.select && p.select.name) || "";
}
export function lirePartage(props) {
  const brut = norm(readSelect(props["Partage documents"]) || "");
  const mode = brut.startsWith("groupe") ? "groupe" : brut.startsWith("personnes") ? "choisi" : "prive";
  const avec = String(readText(props["Partage avec"]) || "").split(/[\s,;]+/).map(email).filter((e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e));
  return { mode, avec: Array.from(new Set(avec)).slice(0, 60) };
}
// Page Notion d'un compte → ce qu'il faut pour décider de la visibilité.
export function compteDePage(page) {
  const p = (page && page.properties) || {};
  const pa = lirePartage(p);
  return { id: page.id, email: email(readText(p["Email"])), nom: readText(p["Nom"]) || "", role: readSelect(p["Rôle"]) || "Collaborateur",
    statut: readSelect(p["Statut"]) || "Actif", groupe: lireGroupe(p), partage: pa.mode, avec: pa.avec };
}
export const memeGroupe = (a, b) => !!(a && b && norm(a.groupe) && norm(a.groupe) === norm(b.groupe));

// Le compte `lecteur` peut-il voir les documents du compte `proprietaire` ? Pur, testé.
export function peutVoir(lecteur, proprietaire) {
  if (!lecteur) return false;
  if (lecteur.role === "Administrateur") return true;
  if (!proprietaire || !proprietaire.email) return false;            // dossier sans propriétaire : administrateur seulement
  if (email(proprietaire.email) === email(lecteur.email)) return true;
  if (!memeGroupe(lecteur, proprietaire)) return false;              // jamais d'un groupe à l'autre
  if (proprietaire.partage === "groupe") return true;
  if (proprietaire.partage === "choisi") return (proprietaire.avec || []).map(email).includes(email(lecteur.email));
  return false;
}
// Seuls le propriétaire et l'administrateur modifient ou suppriment.
export function peutModifier(lecteur, emailProprietaire) {
  if (!lecteur) return false;
  if (lecteur.role === "Administrateur") return true;
  return !!emailProprietaire && email(emailProprietaire) === email(lecteur.email);
}
// Réglage demandé → réglage enregistré : les personnes désignées doivent être du même groupe que le compte.
export function assainirPartage(compte, demande, comptes) {
  const mode = PARTAGES.includes(demande && demande.mode) ? demande.mode : "prive";
  if (mode !== "prive" && !norm(compte.groupe)) return { ok: false, erreur: "Ce compte n'appartient à aucun groupe : ses documents ne peuvent être partagés avec personne. L'administrateur attribue le groupe." };
  const membres = (comptes || []).filter((c) => c.email && c.email !== compte.email && memeGroupe(c, compte)).map((c) => c.email);
  const voulus = Array.from(new Set((Array.isArray(demande && demande.avec) ? demande.avec : []).map(email)));
  const hors = voulus.filter((e) => !membres.includes(e));
  if (mode === "choisi" && hors.length) return { ok: false, erreur: "Hors de votre groupe : " + hors.join(", ") + ". Le partage ne se fait qu'entre membres d'un même groupe." };
  return { ok: true, valeur: { mode, avec: mode === "choisi" ? voulus : [] } };
}

// Tous les comptes (une à trois pages de 100). Lève si Notion ne répond pas : l'appelant refuse alors l'accès.
export async function chargerComptes() {
  const out = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const r = await queryDatabase(DB.users, { page_size: 100, start_cursor: cursor });
    out.push(...(r.results || []).map(compteDePage).filter((c) => c.email));
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  return out;
}
// Compte du lecteur à partir de la session (currentUser).
export const lecteurDe = (found) => compteDePage(found.page);
// Propriétaire inscrit sur une page de dossier.
export const proprietaireDePage = (page) => email(readText(((page && page.properties) || {})[PROP_PROPRIETAIRE]));
// Comptes dont le lecteur peut voir les documents (lui compris).
export const comptesVisibles = (lecteur, comptes) => (comptes || []).filter((c) => peutVoir(lecteur, c));

// Page d'un dossier par sa référence (avec ses propriétés, dont le propriétaire).
export async function pageParRef(databaseId, ref) {
  const r = await queryDatabase(databaseId, { filter: { property: "Référence", title: { equals: ref } }, page_size: 1 });
  return (r.results && r.results[0]) || null;
}
// La colonne « Propriétaire » existe-t-elle (créée au besoin) ? Sans elle, rien n'est montré à un compte ordinaire.
export async function colonneProprietaire(databaseId) {
  try { return !!(await ensureProperty(databaseId, PROP_PROPRIETAIRE, { rich_text: {} })); } catch { return false; }
}
// Décision d'accès à un dossier pour un lecteur : { voir, modifier, proprietaire }. Charge les comptes seulement si nécessaire.
export async function accesDossier(lecteur, page) {
  const proprietaire = proprietaireDePage(page);
  const modifier = peutModifier(lecteur, proprietaire);
  if (modifier) return { voir: true, modifier: true, proprietaire };
  if (!proprietaire) return { voir: false, modifier: false, proprietaire };
  const comptes = await chargerComptes();
  const compte = comptes.find((c) => c.email === proprietaire) || null;
  return { voir: peutVoir(lecteur, compte), modifier: false, proprietaire };
}
