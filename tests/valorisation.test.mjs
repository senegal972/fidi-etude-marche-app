// « Valoriser le bien » : fiche descriptive et plus-value indicative de l'estimation vénale.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const window = {}; new Function("window", "document", lire("valorisation.js"))(window, undefined);
const V = window.FidiValorisation;
const BASE = { med: 300000, min: 255000, max: 360000 };

test("sans rien de coché : la valeur ne change pas", () => {
  const r = V.calculer({ atouts: {}, annexes: {} }, BASE, 2500);
  assert.deepEqual([r.med, r.min, r.max, r.pct, r.annexes_eur, r.gain], [300000, 255000, 360000, 0, 0, 0]);
});

test("atouts en pourcentage et annexes pondérées : valeur × (1 + %) + surface × coefficient × prix au m²", () => {
  const f = { atouts: { piscine: { actif: true, pct: 8 }, vue_mer: { actif: true, pct: 15 }, clim: { actif: false, pct: 2 } },
    annexes: { terrasse_couverte: { actif: true, surface: 20, coef: 0.5 }, garage: { actif: true, surface: "18", coef: "" }, cave: { actif: false, surface: 10 } } };
  const r = V.calculer(f, BASE, 2500);
  assert.equal(r.pct, 23);
  assert.equal(r.annexes_eur, 20 * 0.5 * 2500 + 18 * 0.5 * 2500, "le garage prend son coefficient par défaut (0,5)");
  assert.equal(r.med, Math.round(300000 * 1.23 + 47500));
  assert.equal(r.min, Math.round(255000 * 1.23 + 47500));
  assert.equal(r.max, Math.round(360000 * 1.23 + 47500));
  assert.equal(r.gain, r.med - 300000);
  assert.deepEqual(Array.from(r.lignes, (l) => l.cle), ["piscine", "vue_mer", "terrasse_couverte", "garage"]);
  assert.equal(r.cumulEleve, false);
});

test("pourcentage laissé vide : valeur proposée ; cumul élevé signalé ; valeurs bornées", () => {
  assert.equal(V.calculer({ atouts: { piscine: { actif: true, pct: "" } } }, BASE, 2500).pct, 8);
  const tout = { atouts: Object.fromEntries(V.ATOUTS.map((a) => [a.cle, { actif: true }])) };
  assert.equal(V.calculer(tout, BASE, 2500).cumulEleve, true);
  assert.equal(V.calculer({ atouts: { piscine: { actif: true, pct: 500 } } }, BASE, 2500).pct, 60, "un atout ne dépasse pas 60 %");
  assert.equal(V.calculer({ annexes: { garage: { actif: true, surface: 20, coef: 3 } } }, BASE, 2500).annexes_eur, 20 * 2500, "coefficient plafonné à 1");
  assert.equal(V.calculer({ annexes: { garage: { actif: true, surface: 20, coef: 0.5 } } }, BASE, 0).annexes_eur, 0, "sans prix au m², l'annexe n'est pas chiffrée");
});

test("typologie et surfaces par pièce", () => {
  assert.equal(V.typologie({ pieces: 3 }), "T3");
  assert.equal(V.typologie({ pieces: 1 }), "T1 / studio");
  assert.equal(V.typologie({ pieces: "", chambres: 3 }), "T4", "3 chambres + le séjour");
  assert.equal(V.typologie({}), "");
  assert.equal(V.surfacePiece({ longueur: "4,5", largeur: "3" }), 13.5);
  assert.equal(V.surfacePiece({ longueur: 4, largeur: 3, surface: 11.2 }), 11.2, "une surface saisie prime");
  assert.equal(V.resumeComposition({ pieces: 4, chambres: 3, sdb: 1, sde: 1, wc: 2, habitable: 98.5 }), "T4 · 3 chambres · 1 salle de bain · 1 salle d'eau · 2 WC · 98,5 m² habitables");
});

test("catalogue : clés uniques, coefficients entre 0 et 1, repères indiqués", () => {
  const cles = [...V.ANNEXES, ...V.ATOUTS].map((x) => x.cle);
  assert.equal(new Set(cles).size, cles.length);
  for (const a of V.ANNEXES) assert.ok(a.coef > 0 && a.coef <= 1, a.cle);
  for (const a of V.ATOUTS) assert.ok(a.pct > 0 && a.repere && a.groupe, a.cle);
  for (const k of ["piscine", "vue_mer", "vue_panoramique", "sans_vis_a_vis", "grand_terrain"]) assert.ok(V.ATOUTS.some((a) => a.cle === k), k);
  for (const k of ["terrasse_couverte", "carbet", "garage"]) assert.ok(V.ANNEXES.some((a) => a.cle === k), k);
});

test("branchements : bouton, rappel sous l'estimation, raccord avec l'état et la ruine, nouvelle analyse", () => {
  const page = lire("index.html");
  assert.match(page, /id="btnValoriser" onclick="FidiValorisation\.ouvrir\(\)"/);
  assert.match(page, /id="valoResume"/); assert.match(page, /id="valoAppliedTag"/);
  assert.equal((page.match(/FidiValorisation\.apresAjustement\(\)/g) || []).length, 2, "après la décote d'état et après l'ajustement « ruine »");
  assert.match(page, /FidiValorisation\.reinitialiser\(\)/);
  assert.match(page, /valorisation\.js/); assert.match(page, /valorisation\.css/);
  // L'écran n'a pas de style en ligne (classes de valorisation.css) ; seul le bloc du rapport imprimé, avant la partie écran, en porte.
  const src = lire("valorisation.js");
  assert.doesNotMatch(src.slice(src.indexOf("if (typeof document === 'undefined') return;")), /style="/, "pas de style en ligne à l'écran");
});

// ── Fiche du bien dans le rapport A4 et conservation avec l'étude ────────────
const FICHE = { pieces: 4, chambres: 3, sdb: 1, sde: 1, wc: 2, habitable: 98.5, terrain: 640, exposition: "Sud-Est", assainissement: "Individuel (fosse)", mitoyennete: "Indépendant",
  listePieces: [{ nom: "Salon / séjour", longueur: "6", largeur: "4,5" }, { nom: "Chambre <1>", surface: "12" }, { nom: "", longueur: "", largeur: "", surface: "" }],
  atouts: { piscine: { actif: true, pct: 8 }, vue_mer: { actif: true, pct: 15 } }, annexes: { terrasse_couverte: { actif: true, surface: 20, coef: 0.5 } } };

test("rapport A4 : composition, pièces et total, effets de la valorisation, réserves", () => {
  const r = V.calculer(FICHE, BASE, 2500);
  const html = V.htmlRapport({ fiche_bien: FICHE, estimation: { valorisation: { pct: r.pct, annexes_eur: r.annexes_eur, lignes: r.lignes, avant_med: 300000, med: r.med } } });
  assert.match(html, /Fiche descriptive du bien/);
  assert.match(html, /T4 · 3 chambres · 1 salle de bain · 1 salle d'eau · 2 WC · 98,5 m² habitables/);
  for (const t of ["Sud-Est", "Individuel (fosse)", "640 m²", "6 × 4,5 m", "27 m²", "12 m²", "39 m²", "Piscine", "+ 8 %", "Vue mer", "+ 15 %", "20 m² × 0,5", "+ 25", "300", "sans barème officiel", "ne valent pas mesurage"]) assert.ok(html.includes(t), t);
  assert.match(html, /Chambre &lt;1&gt;/, "le nom d'une pièce est échappé");
  assert.equal((html.match(/<tr>/g) || []).length, 1 + 2 + 1 + 1 + 3 + 1, "la ligne de pièce vide n'est pas imprimée");
});

test("rapport A4 : sans valorisation appliquée, les atouts cochés sont relevés sans chiffre ; sans fiche, rien", () => {
  const html = V.htmlRapport({ fiche_bien: FICHE, estimation: {} });
  assert.match(html, /Annexes et atouts relevés \(non chiffrés dans l'estimation\)/);
  assert.match(html, /Terrasse couverte \/ varangue \(20 m²\) · Piscine · Vue mer/);
  assert.doesNotMatch(html, /\+ 8 %/);
  assert.equal(V.htmlRapport({ estimation: {} }), "");
  assert.equal(V.htmlRapport({ fiche_bien: { listePieces: [], atouts: {}, annexes: {} }, estimation: {} }), "", "fiche vide : pas de bloc");
});

test("la fiche est enregistrée avec l'étude et revient à la réouverture", async () => {
  process.env.NOTION_TOKEN = process.env.NOTION_TOKEN || "x";
  const { propsToEtude } = await import("../netlify/functions/_etude_fields.mjs");
  const json = JSON.stringify({ fiche: FICHE, valorisation: { pct: 23, annexes_eur: 25000, lignes: [], avant_med: 300000, med: 394000, avant: BASE } });
  const p = { "Fiche du bien": { rich_text: [{ plain_text: json.slice(0, 200) }, { plain_text: json.slice(200) }] }, "Estimation": { number: 394000 }, "Surface m2": { number: 98 }, "Prix m2": { number: 2500 } };
  const { data } = propsToEtude(p, []);
  assert.equal(data.fiche_bien.chambres, 3);
  if (data.estimation) assert.equal(data.estimation.valorisation.avant.med, 300000);
  assert.equal(propsToEtude({}, []).data.fiche_bien, undefined, "étude sans fiche : rien d'ajouté");
  const save = lire("netlify/functions/notion-save.mjs");
  assert.match(save, /props\["Fiche du bien"\] = bigText\(json\)/);
  assert.match(lire("index.html"), /FidiValorisation\.restaurer\(\)/);
  assert.match(lire("rapport-a4.js"), /FidiValorisation\.htmlRapport\(d\)/);
});
