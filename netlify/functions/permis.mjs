// Netlify Function — Permis de construire (SITADEL + DPE-Neuf comme proxy)
// POST /api/permis  body: { code_insee, postcode }
// SITADEL n'expose pas d'API REST nationale. Cet endpoint fournit :
//   1. Liens vers les viewers officiels
//   2. Comptage des "logements neufs" via ADEME DPE Neuf (proxy de construction récente)

import { cacheGet, cacheSet, cacheTag } from "./_cache.mjs";

const TIMEOUT_MS = 8000;
const DPE_NEUF_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/g3cgx7jb3cmys5voxz1mrm22/lines";

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
  const url = `${DPE_NEUF_URL}?size=500&q=${codeInsee}&q_fields=code_insee_ban` +
              `&select=adresse_ban,date_etablissement_dpe,type_batiment,surface_habitable_logement,etiquette_dpe`;
  try {
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return [];
    const data = await r.json();
    const rows = (data.results || []).map((x) => ({
      adresse: x.adresse_ban || "—",
      date: x.date_etablissement_dpe || null,
      type: x.type_batiment || "—",
      surface: x.surface_habitable_logement || null,
      dpe: x.etiquette_dpe || null,
    }));
    if (rows.length) await cacheSet(cacheKey, rows);
    return rows;
  } catch (e) { return []; }
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

  const newBuilds = await fetchDpeNeuf(codeInsee);
  const byYear = aggregateByYear(newBuilds);

  return jsonResp(200, {
    code_insee: codeInsee,
    proxy_logements_neufs: {
      source: "ADEME DPE Logements Neufs (depuis juillet 2021)",
      total: newBuilds.length,
      par_annee: byYear,
      recents: newBuilds.slice(0, 20),
    },
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
    ],
    note: "L'API SITADEL nationale temps réel n'est pas publique. Le proxy 'logements neufs' (DPE Neuf ADEME) reflète la construction récente terminée et diagnostiquée.",
  });
};
