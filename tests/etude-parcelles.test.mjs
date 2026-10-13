// Régression — persistance des parcelles terrain multiples (save → Notion → réouverture).
// Bug : une étude multi-parcelles rechargée ne conservait que la 1re parcelle, car les
// parcelles supplémentaires n'étaient jamais sérialisées. Ce test verrouille le round-trip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { P } from "../netlify/functions/_notion.mjs";
import { propsToEtude } from "../netlify/functions/_etude_fields.mjs";

// Reproduit la sérialisation exacte de notion-save (le champ est écrit hors etudeToProps).
function storeParcelles(list) {
  return { "Parcelles terrain": P.text(JSON.stringify(Array.isArray(list) ? list : [])) };
}

test("parcelles terrain : round-trip save → propsToEtude (3 parcelles conservées)", () => {
  const input = [
    { section: "0L", numero: "0663", contenance: 1200 },
    { section: "0L", numero: "0664", contenance: 980 },
    { section: "0M", numero: "0012", contenance: 734 },
  ];
  const { data } = propsToEtude(storeParcelles(input), []);
  assert.deepEqual(data.terrainParcelles, input, "les 3 parcelles doivent survivre au round-trip");
  assert.equal(data.terrainParcelles.length, 3);
});

test("parcelles terrain : champ absent → tableau vide (pas de crash)", () => {
  const { data } = propsToEtude({}, []);
  assert.deepEqual(data.terrainParcelles, []);
});

test("parcelles terrain : JSON corrompu → tableau vide (robustesse)", () => {
  const { data } = propsToEtude({ "Parcelles terrain": P.text("{pas du json") }, []);
  assert.deepEqual(data.terrainParcelles, []);
});

test("parcelles terrain : liste vide round-trip → tableau vide", () => {
  const { data } = propsToEtude(storeParcelles([]), []);
  assert.deepEqual(data.terrainParcelles, []);
});
