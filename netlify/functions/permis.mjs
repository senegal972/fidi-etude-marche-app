// Netlify Function — Permis de construire (SITADEL + DPE-Neuf comme proxy)
// POST /api/permis  body: { code_insee, postcode }
// SITADEL n'expose pas d'API REST nationale. Cet endpoint fournit :
//   1. Liens vers les viewers officiels
//   2. Comptage des "logements neufs" via ADEME DPE Neuf (proxy de construction récente)

import { cacheGet, cacheSet, cacheTag } from "./_cache.mjs";

const TIMEOUT_MS = 8000;
const DPE_NEUF_URL    = "https://data.ademe.fr/data-fair/api/v1/datasets/g3cgx7jb3cmys5voxz1mrm22/lines";
const ANNUAIRE_URL    = "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";

const CORS_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function fetchTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function fetchDpeNeuf(codeInsee) {
  const cacheKey = cacheTag("dpeneuf", codeInsee);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const url = `${DPE_NEUF_URL}?size=500&q=${codeInsee}&q_fields=code_insee_ban&sort=-date_etablissement_dpe` +
              `&select=numero_dpe,adresse_ban,date_etablissement_dpe,type_batiment,surface_habitable_logement,` +
              `etiquette_dpe,etiquette_ges,annee_construction,identifiant_ban,complement_adresse_batiment`;
  try {
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return [];
    const data = await r.json();
    const rows = (data.results || []).map((x) => ({
      numero_dpe: x.numero_dpe || "",
      adresse: x.adresse_ban || "—",
      complement: x.complement_adresse_batiment || "",
      identifiant_ban: x.identifiant_ban || "",
      date: x.date_etablissement_dpe || null,
      type: x.type_batiment || "—",
      surface: x.surface_habitable_logement || null,
      dpe: x.etiquette_dpe || null,
      ges: x.etiquette_ges || null,
      annee_construction: x.annee_construction || null,
    }));
    if (rows.length) await cacheSet(cacheKey, rows);
    return rows;
  } catch (e) { return []; }
}

// Service urbanisme / mairie via API service-public.fr
async function fetchMairie(codeInsee) {
  const cacheKey = cacheTag("mairie", codeInsee);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const where = encodeURIComponent(`code_insee_commune="${codeInsee}" AND pivot LIKE "mairie"`);
    const url = `${ANNUAIRE_URL}?where=${where}&limit=1`;
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return null;
    const data = await r.json();
    const rec = (data.results || [])[0];
    if (!rec) return null;
    const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
    const adresse = (parse(rec.adresse) || [{}])[0];
    const tel = (parse(rec.telephone) || [{}])[0];
    const site = (parse(rec.site_internet) || [{}])[0];
    const horaires = parse(rec.plage_ouverture) || [];
    const result = {
      nom: rec.nom || "",
      siret: rec.siret || "",
      adresse_complete: adresse ?
        `${adresse.numero_voie || ""}${adresse.complement2 ? ", "+adresse.complement2 : ""}, ${adresse.code_postal || ""} ${adresse.nom_commune || ""}`.trim() : "",
      telephone: tel.valeur || "",
      courriel: rec.adresse_courriel || "",
      site_internet: site.valeur || "",
      formulaire_contact: rec.formulaire_contact || "",
      horaires: horaires.map((h) => ({
        jour: h.nom_jour_debut === h.nom_jour_fin ? h.nom_jour_debut : `${h.nom_jour_debut}–${h.nom_jour_fin}`,
        matin: h.valeur_heure_debut_1 && h.valeur_heure_fin_1 ? `${h.valeur_heure_debut_1}–${h.valeur_heure_fin_1}` : "",
        apresmidi: h.valeur_heure_debut_2 && h.valeur_heure_fin_2 ? `${h.valeur_heure_debut_2}–${h.valeur_heure_fin_2}` : "",
      })),
      url_service_public: rec.url_service_public || "",
    };
    await cacheSet(cacheKey, result);
    return result;
  } catch (e) { return null; }
}

function aggregateByYear(rows) {
  const out = {};
  for (const r of rows) {
    const y = (r.date || "").slice(0, 4);
    if (!y) continue;
    out[y] = (out[y] || 0) + 1;
  }
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const codeInsee = (body.code_insee || "").trim();
  if (!codeInsee) return jsonResp(400, { error: "code_insee requis" });

  const [newBuilds, mairie] = await Promise.all([
    fetchDpeNeuf(codeInsee),
    fetchMairie(codeInsee),
  ]);
  const byYear = aggregateByYear(newBuilds);

  return jsonResp(200, {
    code_insee: codeInsee,
    proxy_logements_neufs: {
      source: "ADEME DPE Logements Neufs (depuis juillet 2021)",
      total: newBuilds.length,
      par_annee: byYear,
      recents: newBuilds.slice(0, 30),
    },
    mairie,
    sources_officielles: [
      {
        nom: "SITADEL — viewer Statistiques DD",
        description: "Indicateurs trimestriels permis de construire/aménager par commune",
        url: `https://app-sitadel.statistiques.developpement-durable.gouv.fr/?codeInsee=${codeInsee}`,
      },
      {
        nom: "data.gouv.fr — bases SITADEL",
        description: "Bases mensuelles complètes (CSV/XLS)",
        url: "https://www.data.gouv.fr/fr/datasets/?q=sitadel&sort=-created",
      },
      {
        nom: "Géoportail Urbanisme",
        description: "Documents d'urbanisme et permis géo-localisés",
        url: `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=2.4&lat=46.5&zoom=6&insee=${codeInsee}`,
      },
      {
        nom: "Service Public — Demande PC/DP",
        description: "Démarches officielles permis de construire et déclaration préalable",
        url: "https://www.service-public.fr/particuliers/vosdroits/N319",
      },
    ],
    disclaimer: {
      titre: "Numéros PC et DP",
      message: "Les numéros individuels de Permis de Construire (PC) et Déclarations Préalables (DP) ne sont pas exposés via une API publique nationale temps réel. Seul Auvergne-Rhône-Alpes publie un dataset géolocalisé. Pour obtenir un numéro précis, contactez directement le service urbanisme de la mairie ci-contre ou consultez les affichages publics en mairie. Les numéros de diagnostic DPE (logements neufs) listés ci-dessus servent de référence indirecte pour les constructions récemment achevées.",
    },
    note: "Proxy 'logements neufs' = construction récente terminée + diagnostiquée (ADEME DPE Neuf). Chaque enregistrement inclut un numéro DPE officiel.",
  });
};
