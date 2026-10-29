// Netlify Function — Document d'urbanisme (PLU) exact de la parcelle
// GET /api/plu-doc?lat=X&lon=Y
// Retourne le lien DIRECT et vérifié vers le règlement écrit (PDF) du PLU qui
// couvre le point, + les autres pièces (règlements graphiques, rapport, PADD,
// OAP, annexes) et le lien carte Géoportail-Urbanisme centré sur la parcelle.
//
// Chaîne de sources (open data, sans clé) :
//   1. apicarto IGN  gpu/document   → gpu_doc_id + partition + INSEE + type
//   2. GPU           /api/document/{id}/files  → liste des pièces (PDF)
//   3. lien PDF      /api/document/{id}/files/{name}  (302 → data.geopf.fr)
// Couvre la France entière y compris DOM. Si la commune n'a pas versé son
// document au GPU, renvoie ok:true avec document:null (pas d'erreur).

const TIMEOUT_MS = 10000;
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

// Lien PDF officiel (302 → data.geopf.fr). Forme auto-documentée du GPU.
function fileUrl(id, name) {
  return `${GPU}/document/${id}/files/${encodeURIComponent(name)}`;
}

// Classe une pièce du document à partir de son nom de fichier + titre.
function classify(f) {
  const n = String(f.name || "").toLowerCase();
  const t = String(f.title || "").toLowerCase();
  if (/_reglement_graphique_/.test(n)) return "reglement_graphique";
  if (/règlement écrit|reglement ecrit/.test(t)) return "reglement_ecrit";
  // "97209_reglement_20250930.pdf" = règlement écrit ; exclut pprn / rlp.
  if (/_reglement_\d{6,}\.pdf$/.test(n) && !/pprn|rlp/.test(n)) return "reglement_ecrit";
  if (/_rapport_/.test(n)) return "rapport";
  if (/_padd_/.test(n)) return "padd";
  if (/_oap_/.test(n)) return "oap";
  return "autre";
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });

  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat);
  const lon = parseFloat(q.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return j(400, { error: "lat + lon requis (WGS84)" });
  }

  // Lien carte GPU centré + marqueur sur la parcelle (toujours fourni).
  const mapUrl = `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${lon}&lat=${lat}&zoom=18&mlon=${lon}&mlat=${lat}`;

  try {
    const g = pointGeom(lat, lon);
    const docFC = await fetchJSON(`${APICARTO}/gpu/document?geom=${g}`);
    const feat = (docFC.features || [])[0];
    if (!feat || !feat.properties) {
      return j(200, { ok: true, document: null, mapUrl, note: "Aucun document d'urbanisme versé au GPU à ce point." });
    }
    const p = feat.properties;
    const id = p.gpu_doc_id || p.id;

    // Liste des pièces
    let files = [];
    try { files = await fetchJSON(`${GPU}/document/${id}/files`); } catch (e) { files = []; }

    const groups = { reglement_ecrit: [], reglement_graphique: [], rapport: [], padd: [], oap: [], autre: [] };
    for (const f of (files || [])) {
      if (!f || !f.name) continue;
      const cat = classify(f);
      groups[cat].push({ name: f.name, title: f.title || "", path: f.path || "", url: fileUrl(id, f.name) });
    }

    const reglementEcrit = groups.reglement_ecrit[0] || null;

    return j(200, {
      ok: true,
      mapUrl,
      document: {
        id,
        insee: p.grid_name || "",
        commune: p.grid_title || "",
        type: p.du_type || p.type || "",
        titre: p.name || "",
        partition: p.partition || "",
        maj: p.gpu_timestamp || "",
        statut: p.gpu_status || "",
      },
      reglement_ecrit: reglementEcrit,         // pièce la plus utile (lien direct PDF)
      reglements_graphiques: groups.reglement_graphique,
      rapport: groups.rapport,
      padd: groups.padd[0] || null,
      oap: groups.oap[0] || null,
      autres: groups.autre,
      counts: {
        pieces: (files || []).length,
        reglements_graphiques: groups.reglement_graphique.length,
      },
      source: "apicarto IGN (gpu/document) + Géoportail de l'Urbanisme (pièces PDF)",
    });
  } catch (e) {
    return j(200, { ok: false, document: null, mapUrl, error: e.message });
  }
};
