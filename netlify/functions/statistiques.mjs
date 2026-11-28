// /api/statistiques — statistiques d'usage pour l'administrateur : études et avis par mois, par type de bien, par secteur, par groupe.
//
// Auth : session exigée avant tout le reste, rôle Administrateur.
//
// CONFIDENTIALITÉ : la route ne rend que des COMPTES (nombres), jamais un dossier, un client ni une adresse.
//   • cercle interne : détail par groupe et par utilisateur ;
//   • écosystème public (clients) : totaux seulement, et secteurs à partir de 3 dossiers (SEUIL_PUBLIC) — aucun détail par compte.
// Sources : bases Notion Études et Avis (date, commune, type de bien, propriétaire) et liste des comptes.
import { DB, hasToken, queryDatabase, readText, readSelect } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { chargerComptes, proprietaireDePage } from "./_documents.mjs";

export const SEUIL_PUBLIC = 3;
const PAGES_MAX = 10; // 1 000 dossiers par base
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const cle = (s) => String(s || "").trim().toLowerCase();
const propre = (s) => String(s || "").trim().replace(/\s+/g, " ");

// Agrège des dossiers { type:"etude"|"avis", date:"AAAA-MM-JJ", commune, bien, proprietaire } — pur, testé.
export function agreger(dossiers, comptes, maintenant = new Date()) {
  const parEmail = Object.fromEntries((comptes || []).map((c) => [c.email, c]));
  const ecoDe = (d) => { const c = parEmail[cle(d.proprietaire)]; return c && c.ecosysteme === "public" ? "public" : "interne"; };
  const vide = () => ({ etudes: 0, avis: 0 });
  const plus = (o, d) => { o[d.type === "avis" ? "avis" : "etudes"]++; return o; };
  const jour = 86400000, il30 = maintenant.getTime() - 30 * jour;
  // Douze derniers mois, du plus ancien au plus récent.
  const mois = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1)); mois.push(d.toISOString().slice(0, 7)); }
  const parMois = Object.fromEntries(mois.map((m) => [m, { mois: m, ...vide() }]));
  const totaux = { ...vide(), etudes30: 0, avis30: 0 }, parEco = { interne: vide(), public: vide() };
  const secteurs = {}, secteursPublic = {}, biens = {}, jours = JOURS.map((nom) => ({ jour: nom, total: 0 })), groupes = {}, personnes = {}, actifs = { interne: new Set(), public: new Set() };

  for (const d of dossiers || []) {
    const t = Date.parse(d.date); if (!Number.isFinite(t)) continue;
    const eco = ecoDe(d), recent = t >= il30;
    plus(totaux, d); plus(parEco[eco], d);
    if (recent) { totaux[d.type === "avis" ? "avis30" : "etudes30"]++; if (d.proprietaire) actifs[eco].add(cle(d.proprietaire)); }
    const m = String(d.date).slice(0, 7); if (parMois[m]) plus(parMois[m], d);
    jours[(new Date(t).getUTCDay() + 6) % 7].total++;
    const commune = propre(d.commune) || "Non renseignée", bien = propre(d.bien) || "Non renseigné";
    // Secteurs détaillés : cercle interne. Ceux des clients publics sont comptés à part, sous seuil (sinon une soustraction les révélerait).
    if (eco === "interne") plus(secteurs[commune] || (secteurs[commune] = { commune, ...vide() }), d);
    if (eco === "public") plus(secteursPublic[commune] || (secteursPublic[commune] = { commune, ...vide() }), d);
    plus(biens[bien] || (biens[bien] = { bien, ...vide() }), d);
    // Détail par groupe et par personne : cercle interne seulement.
    if (eco === "interne") {
      const c = parEmail[cle(d.proprietaire)] || null, g = (c && propre(c.groupe)) || (d.proprietaire ? "Sans groupe" : "Dossiers antérieurs (sans compte)");
      plus(groupes[g] || (groupes[g] = { groupe: g, ...vide() }), d);
      if (c) { const p = personnes[c.email] || (personnes[c.email] = { nom: c.nom || c.email, groupe: propre(c.groupe), ...vide(), dernier: "" }); plus(p, d); if (String(d.date) > p.dernier) p.dernier = String(d.date).slice(0, 10); }
    }
  }
  const tri = (o) => Object.values(o).map((x) => ({ ...x, total: x.etudes + x.avis })).sort((a, b) => b.total - a.total);
  const nbComptes = (eco) => (comptes || []).filter((c) => (c.ecosysteme === "public" ? "public" : "interne") === eco && c.statut !== "Désactivé").length;
  return {
    totaux, parMois: mois.map((m) => parMois[m]), parEcosysteme: parEco,
    secteurs: tri(secteurs).slice(0, 15), typesBien: tri(biens).slice(0, 10), jours,
    groupes: tri(groupes), utilisateurs: tri(personnes).slice(0, 20),
    // Clients publics : un secteur n'apparaît qu'à partir de SEUIL_PUBLIC dossiers, pour qu'aucun dossier ne soit reconnaissable.
    secteursPublic: tri(secteursPublic).filter((x) => x.total >= SEUIL_PUBLIC).slice(0, 10),
    comptes: { interne: nbComptes("interne"), public: nbComptes("public"), actifs30: { interne: actifs.interne.size, public: actifs.public.size } },
  };
}

async function lireBase(base, type) {
  const out = []; let cursor;
  for (let i = 0; i < PAGES_MAX; i++) {
    const r = await queryDatabase(base, { page_size: 100, start_cursor: cursor, sorts: [{ property: "Date", direction: "descending" }] });
    for (const pg of r.results || []) {
      const p = pg.properties || {};
      out.push({ type, date: (p["Date"] && p["Date"].date && p["Date"].date.start) || "", commune: readText(p["Commune"]), bien: readSelect(p["Type de bien"]) || "", proprietaire: proprietaireDePage(pg) });
    }
    if (!r.has_more) break; cursor = r.next_cursor;
  }
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });
  let me = null;
  try { me = await currentUser(event); } catch { return authResp(503, { error: "Vérification de la connexion impossible, réessayez." }); }
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });
  if (!hasToken()) return authResp(503, { error: "Service non configuré." });
  try {
    const [comptes, etudes, avis] = await Promise.all([chargerComptes(), lireBase(DB.etude, "etude"), lireBase(DB.avis, "avis")]);
    return authResp(200, { ok: true, calcule_le: new Date().toISOString(), seuil_public: SEUIL_PUBLIC, plafond: PAGES_MAX * 100, ...agreger([...etudes, ...avis], comptes) });
  } catch (e) {
    console.error("[statistiques]", e.message);
    return authResp(e.status || 500, { error: "Statistiques indisponibles pour l'instant, réessayez." });
  }
};
