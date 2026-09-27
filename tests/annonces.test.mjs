// Tests unitaires du moteur de veille annonces : extraction, dédoublonnage,
// score de similarité, détection du bien sujet. Aucune I/O réseau.
import test from "node:test";
import assert from "node:assert/strict";
import { dedup, similarite, estBienSujet, extractFromHtml } from "../netlify/functions/_annonces.mjs";

test("extractFromHtml : JSON-LD RealEstateListing (prix + surface)", () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@type":"RealEstateListing","offers":{"price":"850000"},"floorSize":{"value":"120"},"numberOfBedrooms":"3"}</script>
    <meta property="og:title" content="Villa vue mer"/>
    <meta property="og:description" content="Belle villa avec piscine et vue mer"/>
    </head><body>Villa 120 m² 3 chambres piscine</body></html>`;
  const a = extractFromHtml("https://exemple.fr/annonce/1", html, "");
  assert.equal(a.prix, 850000);
  assert.equal(a.surface_hab, 120);
  assert.equal(a.chambres, 3);
  assert.equal(a.piscine, true);
  assert.equal(a.vue_mer, true);
  assert.equal(a.prix_m2, Math.round(850000 / 120));
});

test("extractFromHtml : repli regex (prix € + terrain)", () => {
  const html = `<html><body>Terrain à bâtir constructible de 1 200 m² de terrain. Prix 450 000 €</body></html>`;
  const a = extractFromHtml("https://exemple.fr/terrain/2", html, "");
  assert.equal(a.prix, 450000);
  assert.equal(a.surface_terrain, 1200);
  assert.equal(a.nature, "terrain");
});

test("dedup : supprime deux annonces même source + même prix", () => {
  const items = [
    { source: "a.fr", prix: 500000, surface_terrain: null, quartier: "Q" },
    { source: "a.fr", prix: 500000, surface_terrain: null, quartier: "Q" },
    { source: "b.fr", prix: 600000, surface_terrain: null, quartier: "Q" },
  ];
  assert.equal(dedup(items).length, 2);
});

test("similarite : bien identique score élevé, bien différent score bas", () => {
  const critere = { surface_hab: 120, surface_terrain: 1000, quartier: "Marigot", commune: "SBH", piscine: true, vue_mer: true, chambres: 3, budget_indicatif: 850000 };
  const proche = { surface_hab: 120, surface_terrain: 1000, quartier: "Marigot", commune: "SBH", piscine: true, vue_mer: true, chambres: 3, prix: 850000 };
  const loin = { surface_hab: 40, surface_terrain: 200, quartier: "Autre", commune: "X", piscine: false, vue_mer: false, chambres: 1, prix: 200000 };
  assert.ok(similarite(proche, critere) > similarite(loin, critere));
  assert.ok(similarite(proche, critere) >= 90);
});

test("estBienSujet : terrain ±3 % + même quartier + surface ±10 %", () => {
  const critere = { surface_terrain: 1125, surface_hab: 169, quartier: "Marigot" };
  const sujet = { surface_terrain: 1130, surface_hab: 170, quartier: "Marigot" };
  const autre = { surface_terrain: 1400, surface_hab: 250, quartier: "Marigot" };
  assert.equal(estBienSujet(sujet, critere), true);
  assert.equal(estBienSujet(autre, critere), false);
});
