// Netlify Function — Logements vacants + zone TLV
// POST /api/vacance  body: { code_insee }
// Sources : public.opendatasoft.com — logements-vacants / liste-communes-tlv

import { cacheGet, cacheSet, cacheTag } from "./_cache.mjs";

const TIMEOUT_MS = 10000;
const VACANCE_URL = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/logements-vacants-du-parc-prive-par-commune/records";
const TLV_URL    = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/liste-des-communes-selon-le-zonage-tlv/records";

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

function num(v) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "JSON invalide" }); }

  const codeInsee = (b.code_insee || "").trim();
  if (!codeInsee) return jsonResp(400, { error: "code_insee requis" });

  const cacheKey = cacheTag("vacance", codeInsee);
  const cached = await cacheGet(cacheKey);
  if (cached) return jsonResp(200, cached);

  const out = { code_insee: codeInsee, disponible: false };

  try {
    // Logements vacants
    const p1 = new URLSearchParams({
      where: `code_commune="${codeInsee}" OR codgeo="${codeInsee}"`,
      limit: "5",
      order_by: "annee desc",
    });
    const r1 = await fetchTimeout(`${VACANCE_URL}?${p1}`);
    if (r1.ok) {
      const d1 = await r1.json();
      const res = d1?.results?.[0];
      if (res) {
        out.disponible = true;
        out.annee = res.annee ?? res.an ?? null;
        const vac = num(res.nb_lv ?? res.nblogvac ?? res.nb_logements_vacants);
        const tot = num(res.nb_lgt ?? res.nblog ?? res.nb_logements);
        out.nb_logements_vacants = vac;
        out.nb_logements_total   = tot;
        if (vac != null && tot != null && tot > 0) {
          out.taux_vacance = Math.round((vac / tot) * 10000) / 100; // 2 décimales
        }
      }
    }

    // Zone TLV
    const p2 = new URLSearchParams({
      where: `code_commune="${codeInsee}" OR codgeo="${codeInsee}" OR insee_com="${codeInsee}"`,
      limit: "1",
    });
    const r2 = await fetchTimeout(`${TLV_URL}?${p2}`);
    if (r2.ok) {
      const d2 = await r2.json();
      const tlv = d2?.results?.[0];
      out.zone_tendue    = !!tlv;
      out.tlv_applicable = !!tlv;
      out.libelle_zone   = tlv?.zone ?? tlv?.libelle_zone ?? null;
    } else {
      out.zone_tendue    = false;
      out.tlv_applicable = false;
    }

    out.source = "public.opendatasoft.com — Logements vacants & zonage TLV";
    await cacheSet(cacheKey, out);
    return jsonResp(200, out);
  } catch (e) {
    return jsonResp(500, { error: e.message });
  }
};
