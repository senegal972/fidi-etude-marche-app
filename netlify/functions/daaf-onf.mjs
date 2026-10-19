// Netlify Function — Usage des sols DAAF (RPG agricole) + ONF (forêts publiques)
// GET /api/daaf-onf?lat=14.60&lon=-61.00
//
// Interroge la Géoplateforme IGN (data.geopf.fr, SANS clé — l'ancienne API wxs.ign.fr
// à clé est fermée). Pour le point donné (petit BBOX), renvoie :
//   - rpg   : parcelle agricole déclarée PAC (groupe de culture, surface)   [DAAF]
//   - onf   : forêt publique (domaniale / départementale / communale)       [ONF]
//   - foret : formation végétale BD Forêt (best-effort, surtout métropole)
// Chaque bloc vaut null si rien au point. Jamais d'erreur 500 bloquante.

const WFS = "https://data.geopf.fr/wfs/ows";
const CRS = "urn:ogc:def:crs:OGC:1.3:CRS84"; // BBOX en lon,lat
const RPG_YEARS = ["2024", "2023"];          // année la plus récente d'abord
const FETCH_MS = 8000;

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const resp = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

// Groupes de culture RPG (code_group 1..28).
const RPG_GROUPES = {
  "1": "Blé tendre", "2": "Maïs (grain / ensilage)", "3": "Orge", "4": "Autres céréales",
  "5": "Colza", "6": "Tournesol", "7": "Autres oléagineux", "8": "Protéagineux",
  "9": "Plantes à fibres", "11": "Gel (sans production)", "14": "Riz", "15": "Légumineuses à grains",
  "16": "Fourrage", "17": "Estives et landes", "18": "Prairies permanentes", "19": "Prairies temporaires",
  "20": "Vergers", "21": "Vignes", "22": "Fruits à coque", "23": "Oliviers",
  "24": "Autres cultures industrielles", "25": "Légumes ou fleurs", "26": "Canne à sucre",
  "27": "Arboriculture", "28": "Divers",
};

async function wfsFirst(typename, bbox) {
  const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
    + `&TYPENAMES=${encodeURIComponent(typename)}&OUTPUTFORMAT=application/json`
    + `&COUNT=1&BBOX=${bbox.join(",")},${encodeURIComponent(CRS)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && Array.isArray(d.features) && d.features.length) ? d.features[0] : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resp(200, {});
  const q = event.queryStringParameters || {};
  const lat = Number(q.lat), lon = Number(q.lon);
  if (!isFinite(lat) || !isFinite(lon)) return resp(400, { error: "lat et lon requis" });

  // BBOX ~60 m autour du point (lon,lat).
  const dLat = 0.0004, dLon = dLat / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];

  // RPG : essaie l'année la plus récente, repli sur l'année précédente.
  const rpgTask = (async () => {
    for (const y of RPG_YEARS) {
      const f = await wfsFirst(`RPG.${y}:parcelles_graphiques`, bbox);
      if (f) { f.__annee = y; return f; }
    }
    return null;
  })();

  const [rpgF, onfF, foretF] = await Promise.all([
    rpgTask,
    wfsFirst("ONF.FORETS_PUBLIQUES:ONF_FORETS_PUBLIQUES", bbox),
    wfsFirst("LANDCOVER.FORESTINVENTORY.V2:formation_vegetale", bbox),
  ]);

  let rpg = null;
  if (rpgF) {
    const p = rpgF.properties || {};
    const grp = String(p.code_group || "");
    rpg = {
      groupe_code: grp,
      groupe: RPG_GROUPES[grp] || ("Groupe " + (grp || "?")),
      culture_code: p.code_cultu || "",
      surface_ha: (p.surf_parc != null) ? Number(p.surf_parc) : null,
      annee: rpgF.__annee || null,
      source: "RPG (PAC) — DAAF / IGN",
    };
  }

  let onf = null;
  if (onfF) {
    const p = onfF.properties || {};
    const dom = String(p.cdom_frt || "").toUpperCase() === "OUI";
    onf = {
      nom: p.llib_frt || "Forêt publique",
      domaniale: dom,
      type: dom ? "Forêt domaniale (État — gestion ONF)" : "Forêt publique (collectivité — régime forestier ONF)",
      departement: p.cinse_dep || "",
      source: "ONF — Forêts publiques / IGN",
    };
  }

  let foret = null;
  if (foretF) {
    const p = foretF.properties || {};
    foret = {
      formation: p.tfv || p.libelle || p.essence || p.tfv_g11 || "Formation végétale",
      source: "BD Forêt V2 — IGN",
    };
  }

  return resp(200, {
    point: { lat, lon },
    rpg, onf, foret,
    agricole: !!rpg,
    forestier: !!onf,
  });
};
