// Netlify Function — Délinquance communale (Ministère de l'Intérieur)
// POST /api/delinquance  body: { code_insee, population? }
// Source : public.opendatasoft.com — donnees-de-delinquance-*

import { cacheGet, cacheSet, cacheTag } from "./_cache.mjs";

const TIMEOUT_MS = 12000;
const DELIN_URL = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/donnees-de-delinquance-enregistrees-a-l-echelle-communale-departementale-et-regionale/records";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

async function fetchTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }

  const codeInsee  = (b.code_insee || "").trim();
  const population = parseInt(b.population, 10) || 0;
  if (!codeInsee) return jsonResp(400, { error: "code_insee requis" });

  const cacheKey = cacheTag("delinquance", codeInsee);
  const cached = await cacheGet(cacheKey);
  if (cached) return jsonResp(200, { ...cached, taux_pour_1000: population > 0 && cached.faits_total ? Math.round(cached.faits_total / population * 10000) / 10 : null });

  try {
    const params = new URLSearchParams({
      where: `codgeo_2024="${codeInsee}" OR codgeo="${codeInsee}"`,
      limit: "100",
      order_by: "annee desc",
    });
    const r = await fetchTimeout(`${DELIN_URL}?${params}`);
    if (!r.ok) return jsonResp(200, { code_insee: codeInsee, disponible: false });

    const data = await r.json();
    const rows = data?.results;
    if (!rows?.length) return jsonResp(200, { code_insee: codeInsee, disponible: false });

    // Aggregate by year and category
    const byYear = {};
    const byCat  = {};
    let maxAnnee = "";

    for (const row of rows) {
      const annee = String(row.annee ?? row.an ?? "");
      const cat   = row.classe ?? row.indicateur ?? "Autre";
      const faits = parseInt(row.faits ?? row.nbfaits ?? 0, 10) || 0;

      byYear[annee] = (byYear[annee] ?? 0) + faits;
      if (annee > maxAnnee) maxAnnee = annee;

      if (annee === maxAnnee) byCat[cat] = (byCat[cat] ?? 0) + faits;
    }

    // Rebuild byCat for actual maxAnnee (first pass might not have it)
    const byCatFinal = {};
    for (const row of rows) {
      const annee = String(row.annee ?? row.an ?? "");
      if (annee !== maxAnnee) continue;
      const cat  = row.classe ?? row.indicateur ?? "Autre";
      const faits = parseInt(row.faits ?? row.nbfaits ?? 0, 10) || 0;
      byCatFinal[cat] = (byCatFinal[cat] ?? 0) + faits;
    }

    const total = Object.values(byCatFinal).reduce((s, v) => s + v, 0);
    const top3  = Object.entries(byCatFinal).sort((a, b) => b[1] - a[1]).slice(0, 3)
                        .map(([categorie, faits]) => ({ categorie, faits }));
    const serie = Object.entries(byYear).sort(([a], [b]) => a.localeCompare(b))
                        .map(([annee, faits]) => ({ annee, faits }));

    const out = {
      code_insee: codeInsee,
      disponible: true,
      annee:      maxAnnee || null,
      faits_total: total,
      top_3:      top3,
      serie_annuelle: serie,
      source: "public.opendatasoft.com — Délinquance communale MI",
    };

    // Cache sans taux (population variable)
    await cacheSet(cacheKey, out);

    return jsonResp(200, {
      ...out,
      taux_pour_1000: population > 0 && total > 0 ? Math.round(total / population * 10000) / 10 : null,
    });
  } catch (e) {
    return jsonResp(500, { error: e.message });
  }
};
