// Confidentialité des documents (études, avis de valeur) : qui voit quoi. Règles appliquées CÔTÉ SERVEUR par toutes les routes qui
// listent, ouvrent, enregistrent ou suppriment un dossier — l'écran ne fait que présenter ce que le serveur a laissé passer.
//
//   • chaque dossier porte son propriétaire (« Propriétaire » dans Notion = e-mail du compte ; avis en ligne : dossier du compte) ;
//   • chacun voit ses propres documents ;
//   • un compte choisit qui voit les siens : « prive » (lui seul), « groupe » (tous les membres de son groupe),
//     « choisi » (les membres de son groupe qu'il désigne) — champs « Partage documents » et « Partage avec » du compte ;
//   • jamais d'un groupe à l'autre : sans groupe commun (champ « Réseau »), aucun partage ;
//   • DEUX ÉCOSYSTÈMES (champ « Écosystème » du compte, fixé par l'administrateur) :
//       – « interne » : le cercle de l'administrateur (ses collaborateurs, ses sociétés, les réseaux rattachés). Il en voit tous les
//         documents, et fixe ces réglages à la création d'un compte ou dans sa fiche ;
//       – « public » : les clients qui ont acheté une prestation. L'ADMINISTRATEUR N'A ACCÈS À AUCUNE DE LEURS DONNÉES (études, avis,
//         clients, factures), ni son cercle. Il ne gère que le compte lui-même (mot de passe, statut, crédits).
//     Aucun partage ne franchit la frontière entre les deux écosystèmes ;
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
    statut: readSelect(p["Statut"]) || "Actif", groupe: lireGroupe(p), partage: pa.mode, avec: pa.avec, ecosysteme: lireEcosysteme(p) };
}
export const ECOSYSTEMES = ["interne", "public"];
export const LIBELLE_ECOSYSTEME = { interne: "Interne", public: "Public" };
// « Public » seulement si la fiche le dit : un compte sans valeur est du cercle de l'administrateur (comptes antérieurs).
export const lireEcosysteme = (props) => (norm(readSelect((props || {})["Écosystème"]) || "") === "public" ? "public" : "interne");
export const estPublic = (c) => !!c && c.ecosysteme === "public";
// Même groupe ET même écosystème : un client public ne rejoint jamais un groupe du cercle interne, même s'il en porte le nom.
export const memeGroupe = (a, b) => !!(a && b && norm(a.groupe) && norm(a.groupe) === norm(b.groupe) && (a.ecosysteme || "interne") === (b.ecosysteme || "interne"));

// Le compte `lecteur` peut-il voir les documents du compte `proprietaire` ? Pur, testé.
export function peutVoir(lecteur, proprietaire) {
  if (!lecteur) return false;
  if (proprietaire && proprietaire.email && email(proprietaire.email) === email(lecteur.email)) return true;
  // Administrateur : tout son écosystème (et les dossiers sans propriétaire), JAMAIS les données d'un client public.
  if (lecteur.role === "Administrateur") return !estPublic(proprietaire);
  if (!proprietaire || !proprietaire.email) return false;            // dossier sans propriétaire : administrateur seulement
  if (!memeGroupe(lecteur, proprietaire)) return false;              // jamais d'un groupe à l'autre
  if (proprietaire.partage === "groupe") return true;
  if (proprietaire.partage === "choisi") return (proprietaire.avec || []).map(email).includes(email(lecteur.email));
  return false;
}
// Seuls le propriétaire et l'administrateur modifient ou suppriment.
// compteProprietaire (facultatif) : fiche du propriétaire, pour l'administrateur — il ne modifie pas le dossier d'un client public.
export function peutModifier(lecteur, emailProprietaire, compteProprietaire) {
  if (!lecteur) return false;
  if (!!emailProprietaire && email(emailProprietaire) === email(lecteur.email)) return true;
  if (lecteur.role === "Administrateur") return !estPublic(compteProprietaire);
  return false;
}
// Même décision, en lisant la fiche du propriétaire quand le lecteur est administrateur. Refus si les comptes ne peuvent pas être lus.
export async function peutModifierDossier(lecteur, emailProprietaire) {
  if (!lecteur) return false;
  if (!!emailProprietaire && email(emailProprietaire) === email(lecteur.email)) return true;
  if (lecteur.role !== "Administrateur") return false;
  if (!emailProprietaire) return true;                               // dossier antérieur, sans propriétaire
  try { const c = (await chargerComptes()).find((x) => x.email === email(emailProprietaire)) || null; return !estPublic(c); } catch { return false; }
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
  const proprietaire = proprietaireDePage(page), admin = lecteur.role === "Administrateur";
  if (proprietaire && proprietaire === email(lecteur.email)) return { voir: true, modifier: true, proprietaire, nom: lecteur.nom || "" };
  if (!proprietaire) return { voir: admin, modifier: admin, proprietaire };
  const comptes = await chargerComptes();
  const compte = comptes.find((c) => c.email === proprietaire) || null;
  const voir = peutVoir(lecteur, compte);
  return { voir, modifier: admin && voir, proprietaire, nom: voir && compte ? (compte.nom || "") : "" };
}

// E-mails des comptes dont le lecteur peut voir les documents, les clients et les factures (lui compris). L'administrateur voit tout :
// { admin:true }. Si la liste des comptes ne peut pas être lue, un compte ordinaire ne voit que les siens.
export async function emailsVisibles(lecteur) {
  let comptes = [];
  if (lecteur.role === "Administrateur") {
    // L'administrateur voit tout SAUF les données des comptes publics (exclus). Comptes illisibles : il ne voit que les siennes.
    try { comptes = await chargerComptes(); } catch { return { admin: false, emails: [lecteur.email], exclus: [] }; }
    return { admin: true, emails: [], exclus: comptes.filter(estPublic).map((c) => c.email) };
  }
  try { comptes = await chargerComptes(); } catch { comptes = []; }
  const emails = new Set(comptesVisibles(lecteur, comptes).map((c) => c.email));
  emails.add(lecteur.email);
  return { admin: false, emails: Array.from(emails).filter(Boolean), exclus: [] };
}
// Un élément (contact, facture) rattaché au compte `proprietaire` est-il dans la portée rendue par emailsVisibles ?
export const dansPortee = (portee, proprietaire) => (portee.admin ? !(portee.exclus || []).includes(email(proprietaire)) : portee.emails.includes(email(proprietaire)));
// Colonne « propriétaire » d'une base quelconque (factures, contacts) : créée au besoin, false si impossible.
export async function colonneCompte(databaseId, nom = PROP_PROPRIETAIRE) {
  try { return !!(await ensureProperty(databaseId, nom, { rich_text: {} })); } catch { return false; }
}
