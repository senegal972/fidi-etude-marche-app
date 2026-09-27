// Tests des Netlify Functions de l'avis de valeur v2 : ESM, CORS, OPTIONS, repli, pas de secret.
import test from "node:test";
import assert from "node:assert/strict";

const ev = (method, body, qs) => ({ httpMethod: method, body: body ? JSON.stringify(body) : "", queryStringParameters: qs || {}, headers: {} });

test("avis-de-valeur : OPTIONS renvoie 200 + CORS", async () => {
  const { handler } = await import("../netlify/functions/avis-de-valeur.mjs");
  const r = await handler(ev("OPTIONS"));
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Access-Control-Allow-Origin"], "*");
});

test("avis-de-valeur : corps minimal (rétro-compat) → 200 sans erreur", async () => {
  const { handler } = await import("../netlify/functions/avis-de-valeur.mjs");
  const r = await handler(ev("POST", { bien: { cp: "97200" } }));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.equal(b.ok, true);
  assert.ok(b.valeur && b.valeur.synthese);
  assert.equal(b.territoire.code, "972");
});

test("avis-de-valeur : fixture Marigot → synthèse 5,30 M€ au central", async () => {
  const { handler } = await import("../netlify/functions/avis-de-valeur.mjs");
  const body = {
    bien: { cp: "97133", surfaceCarrez: 0 },
    cadastre: { shonAutorisee: 169, shobAutorisee: 370, contenance: 1125 },
    methodesV2: {
      comparaison: { prixM2Bas: 28000, prixM2Central: 32000, prixM2Haut: 36000 },
      solConstruction: { chargeFonciere: { bas: 2400000, central: 2700000, haut: 3000000 }, coutShonM2: 7000, coutAnnexesM2: 1500, forfait: 150000, vetustePct: 20, prime: { bas: 10, central: 15, haut: 20 } },
      lots: [
        { nombre: 2, mode: "annuel", loyerMensuel: 2200 },
        { nombre: 2, mode: "annuel", loyerMensuel: 3200 },
        { nombre: 1, mode: "saisonnier", semaines: 20, prixSemaine: 9000 },
      ],
      charges: { gestionSaisonnierePct: 25, vacancePct: 5, forfaitCharges: 35000 },
      taux: { bas: 4.5, central: 4.0, haut: 3.5 },
      poids: { comparaison: 40, solConstruction: 20, capitalisation: 40 },
    },
  };
  const r = await handler(ev("POST", body));
  const b = JSON.parse(r.body);
  assert.equal(b.valeur.synthese.bas, 4700000);
  assert.equal(b.valeur.synthese.central, 5300000);
  assert.equal(b.valeur.synthese.haut, 6000000);
  assert.equal(b.territoire.code, "977"); // Saint-Barthélemy
});

test("avis-de-valeur : cadastre multi-parcelles → contenance totale sommée", async () => {
  const { handler } = await import("../netlify/functions/avis-de-valeur.mjs");
  const body = { bien: { cp: "97133" }, cadastre: { mode: "multiple", parcelles: [{ section: "AX", numero: "7", contenance: 1125 }, { section: "AX", numero: "8", contenance: 875 }] } };
  const r = await handler(ev("POST", body));
  const b = JSON.parse(r.body);
  assert.equal(b.foncier.nb_parcelles, 2);
  assert.equal(b.foncier.contenance_totale, 2000);
});

test("annonces : repli sans clé → statut indisponible, pas de 500", async () => {
  delete process.env.SEARCH_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const { handler } = await import("../netlify/functions/annonces.mjs");
  const r = await handler(ev("POST", { commune: "Saint-Barthélemy" }));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.equal(b.statut, "indisponible");
});

test("annonces : OPTIONS → 200 CORS", async () => {
  const { handler } = await import("../netlify/functions/annonces.mjs");
  const r = await handler(ev("OPTIONS"));
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Access-Control-Allow-Methods"].includes("POST"), true);
});

test("territoire : GET cp=97133 → Saint-Barthélemy (hors DVF)", async () => {
  const { handler } = await import("../netlify/functions/territoire.mjs");
  const r = await handler(ev("GET", null, { cp: "97133" }));
  const b = JSON.parse(r.body);
  assert.equal(b.territoire.code, "977");
  assert.equal(b.territoire.dvf_disponible, false);
});

test("aucun secret en dur dans les fonctions avis v2", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["avis-de-valeur.mjs", "annonces.mjs", "_annonces.mjs", "_avis_calcul.mjs"]) {
    const src = readFileSync(new URL("../netlify/functions/" + f, import.meta.url), "utf8");
    assert.ok(!/sk-[A-Za-z0-9]{20}/.test(src), `${f} ne doit pas contenir de clé API`);
    assert.ok(!/BSA[A-Za-z0-9_-]{20}/.test(src), `${f} ne doit pas contenir de token Brave`);
  }
});
