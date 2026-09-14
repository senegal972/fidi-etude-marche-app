// Netlify Function — RPG (Registre Parcellaire Graphique, parcelles agricoles PAC)
// GET /api/rpg?lat=X&lon=Y&radius=0.2
// Source : Géoplateforme IGN (data.geopf.fr) — couche RPG.LATEST:parcelles_graphiques.
// SANS clé (wxs.ign.fr + clé IGN est DÉPRÉCIÉ depuis 2024, remplacé par data.geopf.fr).
// Utilité : détecter si le terrain est une parcelle agricole DÉCLARÉE à la PAC (DAAF/RPG).
//   → signal fort pour la valorisation en « terrain agricole » plutôt qu'à bâtir.

import { j, wfsGetFeature, simplifyGeoJson } from "./_ogc.mjs";

const GEOPF_WFS = "https://data.geopf.fr/wfs/ows";
const RPG_LAYER = "RPG.LATEST:parcelles_graphiques";

// Groupes de cultures RPG (code_group → libellé). Couvre métropole + DOM.
const GROUPES = {
  "1": "Blé tendre", "2": "Maïs (grain / ensilage)", "3": "Orge", "4": "Autres céréales",
  "5": "Colza", "6": "Tournesol", "7": "Autres oléagineux", "8": "Protéagineux",
  "9": "Plantes à fibres", "10": "Semences", "11": "Gel (surfaces gelées)", "14": "Riz",
  "15": "Légumineuses à grains", "16": "Fourrage", "17": "Estives et landes",
  "18": "Prairies permanentes", "19": "Prairies temporaires", "20": "Vergers",
  "21": "Vignes", "22": "Fruits à coque", "23": "Oliviers", "24": "Autres cultures industrielles (canne, etc.)",
  "25": "Légumes ou fleurs", "28": "Divers (dont bananeraie, jachère)",
};

function labelParcelle(p) {
  const grp = GROUPES[String(p.code_group)] || ("Groupe culture " + (p.code_group || "?"));
  const surf = Number(p.surf_parc);
  const ha = Number.isFinite(surf) ? surf.toFixed(2) + " ha" : "";
  return {
    id_parcel: p.id_parcel || "",
    code_culture: p.code_cultu || "",
    groupe: grp,
    surface_ha: Number.isFinite(surf) ? surf : null,
    libelle: grp + (ha ? " — " + ha : ""),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const radius = Math.max(0.05, Math.min(2, parseFloat(q.radius) || 0.2));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });

  try {
    const fc = await wfsGetFeature(GEOPF_WFS, RPG_LAYER, lat, lon, radius, 10);
    const props = simplifyGeoJson(fc);
    const items = props.map(labelParcelle);
    return j(200, {
      ok: true,
      source: "Géoplateforme IGN — RPG (déclarations PAC / DAAF)",
      layer: RPG_LAYER,
      params: { lat, lon, radius_km: radius },
      agricole_declare: items.length > 0,
      count: items.length,
      items,
      note: items.length
        ? "Parcelle(s) agricole(s) déclarée(s) à la PAC à proximité — appuie une valorisation en terrain agricole."
        : "Aucune parcelle RPG à proximité : pas de déclaration PAC connue (n'exclut pas un usage agricole non déclaré).",
    });
  } catch (e) {
    return j(200, {
      ok: true, source: "RPG (échec requête)", params: { lat, lon, radius_km: radius },
      agricole_declare: false, count: 0, items: [], error: e.message,
      note: "Couche RPG indisponible pour l'instant — réessayer. Vérif manuelle : Géoportail → couche « Parcelles agricoles (RPG) ».",
    });
  }
};
