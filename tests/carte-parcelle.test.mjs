// Carte de l'étude — fiche d'une parcelle au clic (v1.16). Garde-fous statiques :
// le comportement lui-même se vérifie dans un navigateur (clic sur le fond, sur une zone, sur téléphone).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const entre = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

test("le clic sur le fond de carte ouvre la fiche, sans prendre le clic des repères déjà cliquables", () => {
  const bloc = entre("mapInstance.on('click', (e)=>{", "} else {");
  assert.ok(bloc.includes(".leaflet-interactive"), "les éléments cliquables doivent être ignorés");
  assert.ok(bloc.includes("ficheParcelleAuClic(e.latlng)"));
});

test("une zone PLU cliquée donne la fiche de la parcelle, plus seulement le nom de la zone", () => {
  const zonage = entre("async function loadZonage(){", "// ─── Fiche d'une parcelle");
  assert.ok(zonage.includes("ficheParcelleAuClic(e.latlng, feat.properties)"));
  assert.ok(!zonage.includes("bindPopup("), "le calque Zonage ne doit plus ouvrir sa propre bulle");
});

test("la parcelle étudiée et les parcelles ajoutées ouvrent la même fiche", () => {
  assert.ok(html.includes("parcelleLayer.on('click', (e)=>{ L.DomEvent.stop(e); ficheParcelleAuClic(e.latlng); });"));
  assert.ok(entre("function drawExtraParcelles(){", "// Met à jour la ligne").includes("ficheParcelleAuClic(e.latlng)"));
});

test("fiche : fonctions présentes, sources publiques, liens déjà utilisés ailleurs dans l'étude", () => {
  for (const f of ["ficheParcelleAuClic", "ficheParcBulleHTML", "ficheParcDetail", "ficheParcVentes", "ficheParcFermer", "ficheParcLiens"]) {
    assert.ok(html.includes("function " + f + "("), f);
  }
  const fiche = entre("// ─── Fiche d'une parcelle", "function ficheParcCopier(){");
  assert.ok(fiche.includes("https://apicarto.ign.fr/api/cadastre/parcelle?geom="));
  assert.ok(fiche.includes("https://apicarto.ign.fr/api/gpu/zone-urba?geom="));
  assert.ok(fiche.includes("https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon='+lon+'&lat='+lat+'&zoom=18"));
  // Ventes : celles déjà chargées par l'étude, rapprochées par l'identifiant de parcelle.
  assert.ok(fiche.includes("t.id_parcelle === idu"));
  // Un clic plus récent annule l'affichage du précédent.
  assert.ok(fiche.includes("if(reqId !== _ficheParcReq) return;"));
  // Le contour tracé ne doit pas capter les clics suivants.
  assert.ok(fiche.includes("interactive:false"));
});

test("téléphone : fiche sous la carte, jamais imprimée", () => {
  assert.ok(html.includes("window.matchMedia('(max-width: 768px)').matches"));
  assert.ok(html.includes("@media print{ #ficheParcPanneau,#carteAstuce{display:none!important;} }"));
  assert.ok(html.includes(".pdf-mode #ficheParcPanneau,.pdf-mode #carteAstuce{display:none!important;}"));
});
