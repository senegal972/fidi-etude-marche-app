// Netlify Function — Fiscalité locale (taxe foncière bâti/non-bâti)
// POST /api/fiscalite  body: { code_insee }
// Source : data.economie.gouv.fr — fiscalite-locale-des-particuliers

import { cacheGet, cacheSet, cacheTag } from "./_cache.mjs";

const TIMEOUT_MS = 10000;
const FISCAL_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

async function fetchTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

function num(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }

  const codeInsee = (b.code_insee || "").trim();
  if (!codeInsee) return jsonResp(400, { error: "code_insee requis" });

  const cacheKey = cacheTag("fiscalite", codeInsee);
  const cached = await cacheGet(cacheKey);
  if (cached) return jsonResp(200, cached);

  try {
    const params = new URLSearchParams({
      where: `codinsee="${codeInsee}" OR code_insee="${codeInsee}"`,
      limit: "5",
      order_by: "an desc",
    });
    const r = await fetchTimeout(`${FISCAL_URL}?${params}`);
    if (!r.ok) return jsonResp(200, { code_insee: codeInsee, disponible: false });

    const data = await r.json();
    const results = data?.results;
    if (!results?.length) return jsonResp(200, { code_insee: codeInsee, disponible: false });

    const rec = results[0];
    const out = {
      code_insee: codeInsee,
      disponible: true,
      annee:            rec.an ?? rec.annee ?? null,
      taux_tfb_commune: num(rec.taux_tfb_com ?? rec.taux_tfb),
      taux_tfb_total:   num(rec.taux_tfb_total ?? rec.taux_tfb_globale),
      taux_tfnb:        num(rec.taux_tfnb_com ?? rec.taux_tfnb),
      base_nette_tfb:   num(rec.base_nette_tfb ?? rec.base_tfb),
      produit_tfb:      num(rec.produit_tfb ?? rec.produit_tfb_com),
      source: "data.economie.gouv.fr — Fiscalité locale des particuliers",
    };

    await cacheSet(cacheKey, out);
    return jsonResp(200, out);
  } catch (e) {
    return jsonResp(500, { error: e.message });
  }
};
