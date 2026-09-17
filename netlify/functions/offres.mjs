// Netlify Function — Tarifs & Offres (crédits ImmoData Pro)
// GET  /api/offres            → offres actives (utilisateur connecté ; admin voit tout)
// POST /api/offres {action}   → admin : set_active, set_price
//
// Confidentiel : réservé aux professionnels connectés.

import {
  DB, queryDatabase, updatePage, createPage, ensureProperty, P, hasToken,
  readText, readNumber, readSelect, readCheckbox,
} from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";

const GRILLE_DEFAUT = "Standard";

function offerFromPage(pg) {
  const p = pg.properties || {};
  return {
    id:          pg.id,
    nom:         readText(p["Nom"]),
    module:      readSelect(p["Module"]),
    palier:      readSelect(p["Palier"]),
    credits:     readNumber(p["Crédits"]),
    prix:        readNumber(p["Prix TTC"]),
    prix_credit: readNumber(p["Prix par crédit"]),
    economie:    readNumber(p["Économie %"]),
    recommande:  readCheckbox(p["Recommandé"]),
    active:      readCheckbox(p["Active"]),
    ordre:       readNumber(p["Ordre"]) || 0,
    description: readText(p["Description"]),
    grille:      readSelect(p["Grille"]) || GRILLE_DEFAUT,
  };
}

// Reconstruit les propriétés Notion d'une offre (pour dupliquer dans une autre grille).
function offerToProps(o, grille) {
  const p = {
    "Nom":             P.title(o.nom || "Offre"),
    "Crédits":         P.number(o.credits || 0),
    "Prix TTC":        P.number(o.prix || 0),
    "Prix par crédit": P.number(o.prix_credit || 0),
    "Économie %":      P.number(o.economie || 0),
    "Recommandé":      P.checkbox(!!o.recommande),
    "Active":          P.checkbox(!!o.active),
    "Ordre":           P.number(o.ordre || 0),
    "Grille":          P.select(grille),
  };
  if (o.module) p["Module"] = P.select(o.module);
  if (o.palier) p["Palier"] = P.select(o.palier);
  if (o.description) p["Description"] = P.text(o.description);
  return p;
}

function listeGrilles(offers) {
  const set = new Set([GRILLE_DEFAUT]);
  for (const o of offers) if (o.grille) set.add(o.grille);
  return Array.from(set).sort();
}

async function allOffers() {
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await queryDatabase(DB.offres, body);
    out.push(...(res.results || []).map(offerFromPage));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  const MOD = ["Cumulatif", "Études de marché", "Avis de valeur"];
  out.sort((a, b) => (MOD.indexOf(a.module) - MOD.indexOf(b.module)) || (a.ordre - b.ordre));
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Authentification non configurée." });
  if (!hasToken()) return authResp(503, { error: "Notion non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise.", need_auth: true });
  const isAdmin = me.user.role === "Administrateur";

  try {
    if (event.httpMethod === "GET") {
      const offers = await allOffers();
      const grilles = listeGrilles(offers);
      if (isAdmin) {
        return authResp(200, { ok: true, offres: offers, grilles, is_admin: true });
      }
      // Grille du compte connecté (défaut Standard). Repli sur Standard si la grille est vide.
      const maGrille = readSelect((me.page.properties || {})["Grille tarifaire"]) || GRILLE_DEFAUT;
      let visibles = offers.filter((o) => o.active && (o.grille || GRILLE_DEFAUT) === maGrille);
      if (!visibles.length && maGrille !== GRILLE_DEFAUT) {
        visibles = offers.filter((o) => o.active && (o.grille || GRILLE_DEFAUT) === GRILLE_DEFAUT);
      }
      return authResp(200, { ok: true, offres: visibles, grille: maGrille, grilles });
    }

    if (event.httpMethod === "POST") {
      if (!isAdmin) return authResp(403, { error: "Réservé aux administrateurs." });
      let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
      const action = String(b.action || "").toLowerCase();

      // ── Grilles tarifaires multiples ──────────────────────────────────────
      if (action === "list_grids") {
        const offers = await allOffers();
        return authResp(200, { ok: true, grilles: listeGrilles(offers) });
      }
      // Crée une nouvelle grille en DUPLIQUANT une grille source (défaut Standard).
      if (action === "create_grid") {
        const nom = String(b.grille || "").trim().slice(0, 60);
        if (!nom) return authResp(400, { error: "Nom de grille requis." });
        if (nom.toLowerCase() === GRILLE_DEFAUT.toLowerCase()) return authResp(400, { error: "La grille Standard existe déjà." });
        const source = String(b.source || GRILLE_DEFAUT).trim() || GRILLE_DEFAUT;
        const offers = await allOffers();
        if (listeGrilles(offers).some((g) => g.toLowerCase() === nom.toLowerCase())) {
          return authResp(409, { error: "Une grille « " + nom + " » existe déjà." });
        }
        const src = offers.filter((o) => (o.grille || GRILLE_DEFAUT) === source);
        if (!src.length) return authResp(404, { error: "Grille source introuvable : " + source });
        await ensureProperty(DB.offres, "Grille", { select: {} });
        let created = 0;
        for (const o of src) {
          try { await createPage(DB.offres, offerToProps(o, nom)); created++; } catch (e) { /* continue */ }
        }
        return authResp(200, { ok: true, grille: nom, source, created });
      }

      // ── Action bulk : recalcul global depuis un prix par crédit de base ───
      // Prix = round(Crédits × base_module × (1 - Économie/100))
      // Bases métier FIDI par module :
      //   Avis de valeur   50,00 €/cr (Starter 2cr = 100 €)
      //   Études de marché 37,50 €/cr (Starter 2cr =  75 €)
      //   Cumulatif        43,75 €/cr (moyenne, Starter 2cr = 88 €)
      // `bases` = { "<module>": <€/cr> } ; fallback `prix_credit_base` (base uniforme, rétrocompat).
      if (action === "bulk_recalc") {
        const uniform = parseFloat(b.prix_credit_base);
        const bases = (b.bases && typeof b.bases === "object") ? b.bases : null;
        if (!bases && (!Number.isFinite(uniform) || uniform <= 0)) {
          return authResp(400, { error: "bases (par module) ou prix_credit_base (uniforme, >0) requis" });
        }
        // Normalise les clés module en minuscules pour un appariement tolérant aux accents/casse.
        const norm = (s) => String(s || "").trim().toLowerCase();
        const basesNorm = {};
        if (bases) for (const k of Object.keys(bases)) {
          const v = parseFloat(bases[k]);
          if (Number.isFinite(v) && v > 0) basesNorm[norm(k)] = v;
        }
        const baseFor = (mod) => {
          if (bases) {
            const v = basesNorm[norm(mod)];
            if (Number.isFinite(v)) return v;
          }
          return Number.isFinite(uniform) && uniform > 0 ? uniform : null;
        };
        const dryRun = !!b.dry_run;
        const grilleFiltre = b.grille ? String(b.grille).trim() : "";
        const offers = (await allOffers()).filter((o) => !grilleFiltre || (o.grille || GRILLE_DEFAUT) === grilleFiltre);
        const results = [];
        for (const o of offers) {
          if (!o.credits || o.credits <= 0) { results.push({ id: o.id, nom: o.nom, skipped: "credits<=0" }); continue; }
          const base = baseFor(o.module);
          if (!Number.isFinite(base)) { results.push({ id: o.id, nom: o.nom, module: o.module, skipped: "pas de base pour ce module" }); continue; }
          const econ = Number.isFinite(o.economie) ? o.economie : 0;
          const prixCr = Math.round(base * (1 - econ / 100) * 100) / 100;
          const prixTTC = Math.round(o.credits * prixCr);
          if (!dryRun) {
            await updatePage(o.id, {
              "Prix TTC": P.number(prixTTC),
              "Prix par crédit": P.number(prixCr),
            });
          }
          results.push({ id: o.id, nom: o.nom, module: o.module, credits: o.credits, economie: econ, base_credit: base, avant: o.prix, apres: prixTTC, prix_credit: prixCr });
        }
        return authResp(200, { ok: true, dry_run: dryRun, bases: bases || { uniforme: uniform }, count: results.length, results });
      }

      const id = b.id;
      if (!id) return authResp(400, { error: "id requis" });

      if (action === "set_active") {
        await updatePage(id, { "Active": P.checkbox(!!b.active) });
        return authResp(200, { ok: true, id, active: !!b.active });
      }
      if (action === "set_price") {
        const prix = parseFloat(b.prix);
        if (!Number.isFinite(prix) || prix < 0) return authResp(400, { error: "prix invalide" });
        const credits = parseInt(b.credits) || 0;
        const props = { "Prix TTC": P.number(prix) };
        if (credits > 0) props["Prix par crédit"] = P.number(Math.round((prix / credits) * 100) / 100);
        await updatePage(id, props);
        return authResp(200, { ok: true, id, prix });
      }
      return authResp(400, { error: "Action inconnue : " + action });
    }

    return authResp(405, { error: "Méthode non supportée" });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
