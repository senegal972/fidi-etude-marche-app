// Helper partagé DVF — nettoyage et regroupement des mutations
//
// PROBLÈME DVF : l'API mutations3 renvoie UNE LIGNE PAR LOT, pas par vente.
//   - valeur_fonciere = prix TOTAL de la mutation, RÉPÉTÉ sur chaque lot
//   - surface_terrain = surface de la PARCELLE, répétée par lot
//   - une mutation (id_mutation) peut couvrir plusieurs lots / parcelles / types
//
// Diviser valeur_fonciere par la surface d'un seul lot donne des €/m² aberrants
// (ex : 515 600 € / 26 m² = 19 831 €/m²). La SEULE méthode correcte est de
// regrouper par id_mutation puis d'agréger proprement.

export function parseFloatSafe(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(",", ".").trim();
  if (!s || s.toLowerCase() === "nan" || s.toLowerCase() === "none") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function extractSection(idParcelle) {
  if (!idParcelle || idParcelle.length < 10) return "";
  if (idParcelle.length >= 14) return idParcelle.slice(8, 10).trim().toUpperCase();
  const base = idParcelle.replace(/[0-9]+$/, "");
  return base.length >= 2 ? base.slice(-2).trim().toUpperCase() : "";
}

// Normalise le type_local DVF en libellé court
function normType(t) {
  if (!t || t === "None") return "";
  if (/local/i.test(t)) return "Local";
  return t; // Maison, Appartement, Dépendance
}

// Bornes anti-aberration pour les €/m² bâti
const PM2_MIN = 100;
const PM2_MAX = 60000;

// Regroupe les lignes DVF brutes par mutation et renvoie une vente propre par mutation.
// Chaque objet : { id_mutation, date, year, valeur, type, multi, surface_bati,
//   surface_terrain, surface_terrain_brute, nb_pieces, prix_m2, prix_m2_terrain,
//   lat, lon, code_postal, id_parcelle, section, nature_culture, nb_lots }
export function cleanMutations(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.nature_mutation !== "Vente") continue;
    const id = r.id_mutation ||
      `${r.date_mutation || ""}|${r.valeur_fonciere || ""}|${r.id_parcelle || ""}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(r);
  }

  const out = [];
  for (const [id, lots] of groups) {
    const first = lots[0];
    const valeur = parseFloatSafe(first.valeur_fonciere);

    // ── Surface bâtie : somme des lots bâti distincts, par type ──
    const batiSeen = new Set();
    const batiByType = {};
    let nbPieces = 0;
    for (const l of lots) {
      const ty = normType(l.type_local);
      const sb = parseFloatSafe(l.surface_reelle_bati);
      if (sb && sb > 0 && (ty === "Maison" || ty === "Appartement" || ty === "Local" || ty === "Dépendance")) {
        const key = `${l.id_parcelle || ""}|${ty}|${sb}|${l.nombre_pieces_principales || ""}`;
        if (batiSeen.has(key)) continue; // déduplique les lignes identiques (numero_disposition)
        batiSeen.add(key);
        batiByType[ty] = (batiByType[ty] || 0) + sb;
        const p = parseInt(l.nombre_pieces_principales);
        if (Number.isFinite(p) && p > 0) nbPieces += p;
      }
    }

    // ── Surface terrain : somme sur les parcelles DISTINCTES ──
    const parcTerr = new Map();
    lots.forEach((l, i) => {
      const st = parseFloatSafe(l.surface_terrain);
      if (st && st > 0) {
        const pid = l.id_parcelle || `_${i}`;
        if (!parcTerr.has(pid) || parcTerr.get(pid) < st) parcTerr.set(pid, st);
      }
    });
    let sumTerrain = 0;
    for (const v of parcTerr.values()) sumTerrain += v;
    sumTerrain = Math.round(sumTerrain) || 0;

    // ── Classification ──
    const mainTypes = Object.keys(batiByType).filter((t) => t !== "Dépendance");
    let type, surfaceBati = null, multi = false, showTerrain = true;

    if (mainTypes.length === 0 && batiByType["Dépendance"]) {
      type = "Dépendance";
      surfaceBati = Math.round(batiByType["Dépendance"]);
    } else if (mainTypes.length === 0) {
      type = sumTerrain > 0 ? "Terrain" : "Autre";
    } else if (mainTypes.length === 1) {
      type = mainTypes[0];
      surfaceBati = Math.round(batiByType[type]);
    } else {
      type = "Bien multiple";
      multi = true;
      surfaceBati = Math.round(mainTypes.reduce((a, t) => a + batiByType[t], 0));
    }

    // ── Prix au m² (seulement si fiable) ──
    let prixM2 = null, prixM2Terrain = null;
    if (type === "Terrain") {
      prixM2Terrain = (valeur && valeur >= 1000 && sumTerrain >= 50)
        ? Math.round(valeur / sumTerrain) : null;
      prixM2 = prixM2Terrain;
      surfaceBati = null;
    } else if ((type === "Maison" || type === "Appartement" || type === "Local") && surfaceBati) {
      if (valeur && valeur >= 5000 && surfaceBati >= 10) {
        const pm = Math.round(valeur / surfaceBati);
        if (pm >= PM2_MIN && pm <= PM2_MAX) prixM2 = pm;
      }
    }
    // Appartement = lot en copropriété : le terrain est celui de la parcelle commune
    if (type === "Appartement") showTerrain = false;

    const latS = parseFloatSafe(first.latitude);
    const lonS = parseFloatSafe(first.longitude);
    const primary = lots.find((l) => parseFloatSafe(l.surface_reelle_bati) > 0) || first;
    const num = (primary.adresse_numero || "").trim();
    const suf = (primary.adresse_suffixe || "").trim();
    const voie = (primary.adresse_nom_voie || "").trim();
    const adresse = [num, suf, voie].filter(Boolean).join(" ") || "—";

    out.push({
      id_mutation: id,
      date: (first.date_mutation || "").slice(0, 10),
      year: parseInt((first.date_mutation || "").slice(0, 4)) || null,
      adresse,
      valeur: valeur ? Math.round(valeur) : null,
      type,
      type_local: type, // alias pour compat frontend
      multi,
      surface_bati: surfaceBati,
      surface_terrain: showTerrain ? (sumTerrain || null) : null,
      surface_terrain_brute: sumTerrain || null,
      nb_pieces: nbPieces > 0 ? nbPieces : null,
      prix_m2: prixM2,
      prix_m2_terrain: prixM2Terrain,
      lat: latS,
      lon: lonS,
      code_postal: primary.code_postal || "",
      id_parcelle: primary.id_parcelle || "",
      section: extractSection(primary.id_parcelle || ""),
      nature_culture: first.nature_culture || "",
      nb_lots: lots.length,
    });
  }
  return out;
}

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
