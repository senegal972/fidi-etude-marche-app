// Netlify Function — INPN / PatriNat : Natura 2000 + ZNIEFF (zones naturelles protégées)
// GET /api/inpn?lat=X&lon=Y&radius=0.15
// Source : Géoplateforme IGN (data.geopf.fr) — couches PatriNat (MNHN), SANS clé.
// Utilité : signale une contrainte environnementale forte (inconstructibilité,
//   évaluation d'incidences Natura 2000, statut ZNIEFF) impactant un terrain.

import { j, wfsGetFeature } from "./_ogc.mjs";

const GEOPF_WFS = "https://data.geopf.fr/wfs/ows";
// typeName → libellé lisible + criticité
const LAYERS = [
  { layer: "patrinat_sic:sic",         label: "Natura 2000 — Directive Habitats (SIC/ZSC)", crit: "forte" },
  { layer: "patrinat_zps:zps",         label: "Natura 2000 — Directive Oiseaux (ZPS)",      crit: "forte" },
  { layer: "patrinat_znieff1:znieff1", label: "ZNIEFF type I (secteur de fort intérêt)",     crit: "moyenne" },
  { layer: "patrinat_znieff2:znieff2", label: "ZNIEFF type II (grand ensemble naturel)",     crit: "faible" },
];

function nomZone(p) {
  return p.nom || p.name || p.libelle || p.sitename || p.site_nom || p.tzn || p.id_mnhn || "";
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  if (event.httpMethod !== "GET") return j(405, { error: "GET requis" });
  const q = event.queryStringParameters || {};
  const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
  const radius = Math.max(0.05, Math.min(1, parseFloat(q.radius) || 0.15));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return j(400, { error: "lat+lon requis" });

  const zones = [];
  const attempts = [];
  for (const L of LAYERS) {
    try {
      const fc = await wfsGetFeature(GEOPF_WFS, L.layer, lat, lon, radius, 3);
      const feats = (fc && fc.features) || [];
      if (feats.length) {
        feats.forEach((f) => {
          zones.push({ type: L.label, criticite: L.crit, nom: nomZone(f.properties || {}) });
        });
      }
      attempts.push({ layer: L.layer, count: feats.length });
    } catch (e) { attempts.push({ layer: L.layer, error: e.message }); }
  }

  const protege = zones.length > 0;
  const critMax = zones.some((z) => z.criticite === "forte") ? "forte"
                : zones.some((z) => z.criticite === "moyenne") ? "moyenne"
                : zones.length ? "faible" : "aucune";

  return j(200, {
    ok: true,
    source: "INPN / PatriNat (MNHN) via Géoplateforme IGN",
    params: { lat, lon, radius_km: radius },
    protege, criticite_max: critMax,
    count: zones.length, zones, attempts,
    note: protege
      ? "Zone naturelle protégée à proximité — vérifier l'incidence sur la constructibilité (Natura 2000 = évaluation d'incidences ; ZNIEFF = inventaire, contrainte selon PLU)."
      : "Aucune zone Natura 2000 / ZNIEFF détectée à proximité (n'exclut pas d'autres protections locales).",
  });
};
