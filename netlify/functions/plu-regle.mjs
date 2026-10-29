// Netlify Function — Règles de zone lues DANS le règlement écrit du PLU (PDF)
// GET /api/plu-regle?lat=X&lon=Y&zone=UGf1
// Télécharge le règlement écrit de la parcelle, en extrait le texte (unpdf) et
// renvoie l'emprise au sol et la hauteur RÉELLES de la zone détectée.
// Best-effort : renvoie found:false si le motif n'est pas reconnu (le client
// retombe alors sur l'estimation indicative par type de zone). Jamais injecté
// en dur côté rapport sans mention « lu dans le règlement ».
//
// Chaîne : apicarto gpu/document → pièces GPU → PDF règlement écrit → texte.

import { extractText, getDocumentProxy } from "unpdf";

const TIMEOUT_MS = 10000;
const PDF_TIMEOUT_MS = 20000;
const APICARTO = "https://apicarto.ign.fr/api";
const GPU = "https://www.geoportail-urbanisme.gouv.fr/api";

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=86400",
};
function j(status, body) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

async function fetchJSON(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "FIDI-Etude-Marche/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function pointGeom(lat, lon) {
  return encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [lon, lat] }));
}
function fileUrl(id, name) { return `${GPU}/document/${id}/files/${encodeURIComponent(name)}`; }

function isReglementEcrit(f) {
  const n = String(f.name || "").toLowerCase();
  const t = String(f.title || "").toLowerCase();
  if (/_reglement_graphique_/.test(n)) return false;
  if (/règlement écrit|reglement ecrit/.test(t)) return true;
  return /_reglement_\d{6,}\.pdf$/.test(n) && !/pprn|rlp/.test(n);
}

// Emprise au sol (%) de la zone : cherche chaque occurrence du code de zone
// puis, dans une fenêtre, « emprise au sol … limitée à X % ».
function empriseForZone(text, zone) {
  const T = text.toUpperCase();
  const z = zone.toUpperCase();
  let i = -1;
  while ((i = T.indexOf(z, i + 1)) >= 0) {
    const win = text.slice(i, i + 320).replace(/\s+/g, " ");
    const m = win.match(/emprise au sol[\s\S]{0,90}?limit[ée]+e?\s*à\s*(\d+(?:[.,]\d+)?)\s*%/i);
    if (m) return { pct: parseFloat(m[1].replace(",", ".")), txt: m[1].replace(",", ".") + " %" };
  }
  return null;
}

// Hauteur de la zone : bloc « Secteur <code> » (ou secteur parent sans suffixe
// chiffré) → « hauteur à l'égout … X m » (+ hauteur totale si présente).
function hauteurForZone(text, zone) {
  const T = text.toUpperCase();
  const candidates = [zone.toUpperCase(), zone.toUpperCase().replace(/\d+$/, "")];
  for (const code of candidates) {
    for (const kw of ["SECTEUR " + code, "SOUS-SECTEUR " + code, code]) {
      const start = T.lastIndexOf(kw);
      if (start < 0) continue;
      const block = text.slice(start, start + 600).replace(/\s+/g, " ");
      const eg = block.match(/hauteur\s+à\s+l.égout[\s\S]{0,60}?(\d+(?:[.,]\d+)?)\s*m(?:è|e)tres?/i);
      const tot = block.match(/hauteur\s+totale[\s\S]{0,60}?(\d+(?:[.,]\d+)?)\s*m(?:è|e)tres?/i);
      if (eg || tot) {
        const parts = [];
        if (eg) parts.push("égout " + eg[1].replace(",", ".") + " m");
        if (tot) parts.push("total " + tot[1].replace(",", ".") + " m");
        return { txt: parts.join(" / "), egout_m: eg ? parseFloat(eg[1].replace(",", ".")) : null };
      }
    }
  }
  return null;
}

async function fetchPdfBytes(url, ms = PDF_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "FIDI-Etude-Marche/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });

  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat);
  const lon = parseFloat(q.lon);
  const zone = String(q.zone || "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat + lon requis" });
  if (!zone) return j(200, { ok: true, found: false, note: "zone non fournie" });

  try {
    const g = pointGeom(lat, lon);
    const docFC = await fetchJSON(`${APICARTO}/gpu/document?geom=${g}`);
    const feat = (docFC.features || [])[0];
    if (!feat || !feat.properties) return j(200, { ok: true, found: false, note: "Document GPU absent." });
    const p = feat.properties;
    const id = p.gpu_doc_id || p.id;

    let files = [];
    try { files = await fetchJSON(`${GPU}/document/${id}/files`); } catch (e) { files = []; }
    const reg = (files || []).find(isReglementEcrit);
    if (!reg) return j(200, { ok: true, found: false, note: "Règlement écrit non identifié.", document: { id, commune: p.grid_title } });

    const url = fileUrl(id, reg.name);
    let text = "";
    try {
      const bytes = await fetchPdfBytes(url);
      const pdf = await getDocumentProxy(bytes);
      const r = await extractText(pdf, { mergePages: true });
      text = (r && r.text) || "";
    } catch (e) {
      return j(200, { ok: true, found: false, reglement_url: url, note: "Lecture PDF impossible : " + e.message });
    }

    const emprise = empriseForZone(text, zone);
    const hauteur = hauteurForZone(text, zone);
    const found = !!(emprise || hauteur);

    return j(200, {
      ok: true,
      found,
      zone,
      emprise_pct: emprise ? emprise.pct : null,
      emprise_txt: emprise ? emprise.txt : null,
      hauteur_txt: hauteur ? hauteur.txt : null,
      hauteur_egout_m: hauteur ? hauteur.egout_m : null,
      reglement_url: url,
      document: { id, commune: p.grid_title || "", insee: p.grid_name || "", maj: p.gpu_timestamp || "" },
      source: "Règlement écrit du PLU (lecture automatique — à vérifier)",
    });
  } catch (e) {
    return j(200, { ok: false, found: false, error: e.message });
  }
};
