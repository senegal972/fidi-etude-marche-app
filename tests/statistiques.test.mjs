// Statistiques d'usage (administrateur) : agrégats seulement ; détail réservé au cercle interne ; clients publics sous seuil.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.JWT_SECRET = process.env.JWT_SECRET || "secret-de-test-suffisamment-long-0123456789";
const S = await import("../netlify/functions/statistiques.mjs");
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const COMPTES = [{ email: "a@x.fr", nom: "Alice", groupe: "Sextant", ecosysteme: "interne", statut: "Actif" }, { email: "b@x.fr", nom: "Bruno", groupe: "Optimmo Dom", ecosysteme: "interne", statut: "Actif" },
  { email: "c@y.fr", nom: "Client C", groupe: "", ecosysteme: "public", statut: "Actif" }, { email: "d@y.fr", nom: "Client D", groupe: "", ecosysteme: "public", statut: "Désactivé" }];
const d = (type, date, commune, bien, proprietaire) => ({ type, date, commune, bien, proprietaire });
const JEU = [d("etude", "2026-11-20", "Le Lamentin", "Maison", "a@x.fr"), d("etude", "2026-11-21", "Le Lamentin", "Terrain", "a@x.fr"), d("avis", "2026-11-22", "Le Lamentin", "Maison", "a@x.fr"),
  d("etude", "2026-09-03", "Sainte-Luce", "Maison", "b@x.fr"), d("etude", "2025-10-01", "Ducos", "Maison", "b@x.fr"), d("etude", "2026-08-10", "Le Robert", "Terrain", ""),
  d("etude", "2026-11-10", "Le Marin", "Maison", "c@y.fr"), d("etude", "2026-11-11", "Le Marin", "Maison", "c@y.fr"), d("avis", "2026-11-12", "Le Marin", "Maison", "c@y.fr"), d("etude", "2026-11-13", "Le Diamant", "Maison", "c@y.fr"),
  d("etude", "pas une date", "X", "Y", "a@x.fr")];
const R = S.agreger(JEU, COMPTES, new Date("2026-11-28T12:00:00Z"));

test("totaux, 30 jours, douze mois glissants, jours de la semaine", () => {
  assert.deepEqual(R.totaux, { etudes: 8, avis: 2, etudes30: 5, avis30: 2 }, "la date illisible est ignorée");
  assert.equal(R.parMois.length, 12); assert.equal(R.parMois[0].mois, "2025-12"); assert.equal(R.parMois[11].mois, "2026-11");
  assert.deepEqual(R.parMois[11], { mois: "2026-11", etudes: 5, avis: 2 });
  assert.equal(R.parMois.reduce((t, m) => t + m.etudes + m.avis, 0), 9, "le dossier d'octobre 2025 est hors des douze mois");
  assert.equal(R.jours.reduce((t, j) => t + j.total, 0), 10); assert.equal(R.jours[4].jour, "Vendredi");
});

test("cercle interne : secteurs, groupes et utilisateurs détaillés", () => {
  assert.deepEqual(R.secteurs[0], { commune: "Le Lamentin", etudes: 2, avis: 1, total: 3 });
  assert.deepEqual(R.groupes.map((g) => [g.groupe, g.total]), [["Sextant", 3], ["Optimmo Dom", 2], ["Dossiers antérieurs (sans compte)", 1]]);
  assert.deepEqual(R.utilisateurs.map((u) => [u.nom, u.etudes, u.avis, u.dernier]), [["Alice", 2, 1, "2026-11-22"], ["Bruno", 2, 0, "2026-09-03"]]);
  assert.deepEqual(R.parEcosysteme, { interne: { etudes: 5, avis: 1 }, public: { etudes: 3, avis: 1 } });
});

test("clients publics : jamais de détail par compte ; un secteur seulement à partir du seuil ; pas de soustraction possible", () => {
  assert.ok(!JSON.stringify(R.utilisateurs).includes("Client"), "aucun client public dans les utilisateurs");
  assert.ok(!R.groupes.some((g) => /Client/.test(g.groupe)));
  assert.ok(!R.secteurs.some((s) => s.commune === "Le Marin" || s.commune === "Le Diamant"), "les secteurs détaillés ne comptent que le cercle interne");
  assert.deepEqual(R.secteursPublic, [{ commune: "Le Marin", etudes: 2, avis: 1, total: 3 }], "Le Diamant (1 dossier) reste sous le seuil");
  assert.equal(S.SEUIL_PUBLIC, 3);
  assert.deepEqual(R.comptes, { interne: 2, public: 1, actifs30: { interne: 1, public: 1 } }, "le compte désactivé n'est pas compté");
  assert.ok(!JSON.stringify(R).includes("@"), "aucune adresse e-mail dans la réponse");
});

test("/api/statistiques : administrateur seulement ; écran branché", async () => {
  assert.equal((await S.handler({ httpMethod: "GET", headers: {} })).statusCode, 401);
  const src = lire("netlify/functions/statistiques.mjs");
  assert.match(src, /role !== "Administrateur"\) return authResp\(403/);
  assert.ok(src.indexOf("currentUser(event)") < src.indexOf("chargerComptes()"));
  const page = lire("index.html");
  assert.match(page, /\(admin \? '<div class="tab-pane fade" id="tabStats">'/); assert.match(page, /FidiStatistiques\.monter\(\)/);
  assert.match(lire("netlify.toml"), /from\s+=\s+"\/api\/statistiques"/);
  const js = lire("compte-statistiques.js");
  assert.match(js, /Voir en tableau/, "le graphique a son équivalent en tableau");
  assert.match(js, /Vous n\\'avez pas accès aux dossiers des clients publics/);
});
