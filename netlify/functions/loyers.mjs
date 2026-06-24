// Netlify Function — Loyers de marché (Carte des loyers, data.gouv.fr 2024)
// POST /api/loyers  body: { code_insee }
// Retourne le loyer médian d'annonce €/m²/mois (maison + appartement) par commune.
// Source : "Carte des loyers" — indicateurs d'annonce DHUP/MEF (open data).

import { cacheGet, cacheSet, cacheTag } from "./_cache.mjs";

const TIMEOUT_MS = 15000;
const CSV_MAISON = "https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2024/20241205-145700/pred-mai-mef-dhup.csv";
const CSV_APPART = "https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2024/20241205-153050/pred-app-mef-dhup.csv";
const ANNEE = 2024;

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

function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/"/g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

// Cherche la ligne d'une commune dans le CSV ; renvoie loyer €/m²/mois + libellé.
// Colonnes : id_zone;INSEE_C;LIBGEO;EPCI;DEP;REG;loypredm2;lwr.IPm2;upr.IPm2;...
async function lookupLoyer(url, codeInsee) {
  const r = await fetchTimeout(url, TIMEOUT_MS);
  if (!r.ok) return null;
  const text = await r.text();
  const target = `"${codeInsee}"`;
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.indexOf(target) === -1) continue;
    const f = line.split(";");
    if ((f[1] || "").replace(/"/g, "") !== codeInsee) continue;
    return {
      loyer_m2: parseNum(f[6]),
      borne_basse: parseNum(f[7]),
      borne_haute: parseNum(f[8]),
      libelle: (f[2] || "").replace(/"/g, ""),
    };
  }
  return null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});

  let b = {};
  try { b = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Corps JSON invalide" }); }

  const codeInsee = (b.code_insee || "").trim();
  if (!codeInsee) return jsonResp(400, { error: "code_insee requis" });

  const cacheKey = cacheTag("loyers", codeInsee);
  const cached = await cacheGet(cacheKey);
  if (cached) return jsonResp(200, cached);

  try {
    const [maison, appart] = await Promise.all([
      lookupLoyer(CSV_MAISON, codeInsee).catch(() => null),
      lookupLoyer(CSV_APPART, codeInsee).catch(() => null),
    ]);

    if (!maison && !appart) {
      const out = { code_insee: codeInsee, disponible: false, annee: ANNEE,
        message: "Loyers non disponibles pour cette commune." };
      return jsonResp(200, out);
    }

    const out = {
      code_insee: codeInsee,
      disponible: true,
      annee: ANNEE,
      source: "Carte des loyers (DHUP/MEF, data.gouv.fr)",
      libelle: (maison && maison.libelle) || (appart && appart.libelle) || "",
      loyer_m2_maison: maison ? maison.loyer_m2 : null,
      loyer_m2_appartement: appart ? appart.loyer_m2 : null,
      borne_basse_maison: maison ? maison.borne_basse : null,
      borne_haute_maison: maison ? maison.borne_haute : null,
      borne_basse_appartement: appart ? appart.borne_basse : null,
      borne_haute_appartement: appart ? appart.borne_haute : null,
    };
    await cacheSet(cacheKey, out);
    return jsonResp(200, out);
  } catch (e) {
    return jsonResp(500, { error: e.message });
  }
};
