// Carte — fiche d'une parcelle au clic (module autonome carte-parcelle.js, FidiParcelle).
// Le comportement réel (clic, bulle, fiche, calques, téléphone) a été vérifié dans un navigateur avec les services
// publics réels ; ces tests gardent les branchements et la logique pure.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const html = lire("index.html"), mod = lire("carte-parcelle.js");
const entre = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

// Le module chargé hors navigateur, pour tester ses fonctions pures.
const fenetre = { document: { getElementById: () => null } };
vm.runInNewContext(mod, { window: fenetre, document: fenetre.document, fetch: async () => { throw new Error("réseau interdit en test"); }, setTimeout, Promise, Math, JSON, Number, String, Object, isFinite, parseFloat, encodeURIComponent });
const P = fenetre.FidiParcelle;

test("le module est chargé avant l'écran et branché sur la carte de l'étude", () => {
  assert.match(html, /<script src="\/carte-parcelle\.js"><\/script>/);
  const bloc = entre("FidiParcelle.attacher({", "});");
  for (const cle of ["carte: mapInstance", "clicFond: true", "origine:", "parcellePrincipale:", "zonePrincipale:", "ventes:", "urlRisques: '/api/georisques-adresse'"]) {
    assert.ok(bloc.includes(cle), "option absente : " + cle);
  }
  // L'ancien code n'est plus dupliqué dans la page.
  assert.ok(!html.includes("async function ficheParcelleAuClic("));
});

test("les calques qui captent le clic ouvrent la même fiche", () => {
  const zonage = entre("async function loadZonage(){", "// ─── Fiche d'une parcelle");
  assert.ok(zonage.includes("ficheParcelleAuClic(e.latlng, feat.properties)"));
  assert.ok(!zonage.includes("bindPopup("), "le calque Zonage ne doit plus ouvrir sa propre bulle");
  assert.ok(html.includes("parcelleLayer.on('click', (e)=>{ L.DomEvent.stop(e); ficheParcelleAuClic(e.latlng); });"));
  assert.ok(entre("function drawExtraParcelles(){", "// Met à jour la ligne").includes("ficheParcelleAuClic(e.latlng)"));
});

test("module : interface publique, noms historiques, sources publiques sans clé", () => {
  for (const f of ["attacher", "auClic", "fermer", "detail", "copier", "action", "ventesDeLaParcelle", "bulleHTML"]) assert.equal(typeof P[f], "function", f);
  for (const n of ["ficheParcelleAuClic", "ficheParcFermer", "ficheParcDetail", "ficheParcCopier"]) assert.equal(typeof fenetre[n], "function", n);
  for (const u of ["https://apicarto.ign.fr/api", "/cadastre/parcelle?geom=", "/gpu/zone-urba?geom=", "/gpu/assiette-sup-s?geom=", "/gpu/prescription-surf?geom=",
    "https://api-adresse.data.gouv.fr/reverse/", "https://app.dvf.etalab.gouv.fr/api/mutations3/"]) assert.ok(mod.includes(u), u);
  // Le clic sur le fond ignore ce qui est déjà cliquable ; un clic plus récent annule le précédent ; le contour ne capte pas les clics.
  assert.ok(mod.includes(".leaflet-interactive, .leaflet-control, .leaflet-popup"));
  assert.ok(mod.includes("if (id !== I.requete) return;"));
  assert.ok(mod.includes("interactive: false"));
  // Un service public qui échoue est réessayé une fois.
  assert.match(mod, /function lire\(url, essais\)/);
  assert.ok(!/api[_-]?key|token=/i.test(mod), "aucune clé dans le module");
});

test("ventes d'une parcelle : une ligne par vente, pas par lot, et les ventes groupées sont signalées", () => {
  const IDU = "97209000AZ0001";
  const m = (o) => ({ id_mutation: "M1", date_mutation: "2024-03-10", nature_mutation: "Vente", valeur_fonciere: "300000.0", id_parcelle: IDU, type_local: "None", surface_reelle_bati: "None", surface_terrain: "None", lot1_numero: "None", ...o });
  const v = P.ventesDeLaParcelle([
    // Une vente de deux lots sur la parcelle (appartement + dépendance) : le prix n'est compté qu'une fois.
    m({ type_local: "Appartement", surface_reelle_bati: "60.0", lot1_numero: "5" }),
    m({ type_local: "Dépendance", lot1_numero: "12" }),
    // La même vente porte aussi sur une autre parcelle.
    m({ id_parcelle: "97209000AZ0002", type_local: "Maison", surface_reelle_bati: "90.0" }),
    // Une vente plus ancienne, terrain seul.
    m({ id_mutation: "M0", date_mutation: "2021-01-05", valeur_fonciere: "80000.0", surface_terrain: "420.0" }),
    // Une vente d'une autre parcelle : ignorée.
    m({ id_mutation: "M9", id_parcelle: "97209000AZ0003", valeur_fonciere: "999999.0" }),
  ], IDU);
  assert.equal(v.length, 2);
  assert.equal(v[0].date, "2024-03-10", "la plus récente d'abord");
  assert.equal(v[0].valeur, 300000);
  assert.deepEqual([...v[0].types].sort(), ["Appartement", "Dépendance"]);
  assert.equal(v[0].bati, 60);
  assert.equal(v[0].autresParcelles, 1);
  assert.equal(v[1].valeur, 80000); assert.equal(v[1].terrain, 420); assert.equal(v[1].autresParcelles, 0);
  assert.deepEqual(P.ventesDeLaParcelle([], IDU), []);
});

test("bulle : parcelle, absence de parcelle, zonage, sans mise en forme injectée", () => {
  const h = P.bulleHTML({ section: "AZ", numero: "0193", nom_com: "Fort-de-France", code_insee: "97209", contenance: 59, idu: "97209000AZ0193" }, { libelle: "UVB2", libelong: "Centre-ville", typezone: "U" }, 14.61, -61.07);
  assert.match(h, /Parcelle AZ 0193/); assert.match(h, /59 m²/); assert.match(h, /UVB2/); assert.match(h, /data-fiche-parc="detail"/);
  const vide = P.bulleHTML(null, null, 14.61, -61.07);
  assert.match(vide, /Aucune parcelle à ce point/); assert.match(vide, /non numérisé/); assert.doesNotMatch(vide, /data-fiche-parc/);
  const piege = P.bulleHTML({ section: "<b>", numero: "1", nom_com: "<script>x</script>" }, null, 0, 0);
  assert.doesNotMatch(piege, /<script>/);
});

test("le cercle du périmètre d'étude ne capte pas les clics (il couvrait toute la carte et bloquait la fiche)", () => {
  const cercle = entre("radiusCircle = L.circle([latRef,lonRef],{", "}).addTo(mapInstance);");
  assert.ok(cercle.includes("interactive:false"), "le cercle doit rester un simple décor");
});

test("plusieurs cartes : chaque carte attachée a sa fiche, la première reste celle des noms historiques", () => {
  assert.ok(mod.includes("if (!defaut) defaut = I;"));
  assert.ok(mod.includes("function auClic(latlng, zoneConnue) { return clicSur(defaut || S, latlng, zoneConnue); }"));
  assert.ok(mod.includes("data-fiche-parc=\"action\""), "actions de l'hôte dans la bulle");
});

test("Nouvelle étude : bouton « Carte », panneau, report de la parcelle dans la recherche", () => {
  const carte = lire("saisie-carte.js"), css = lire("saisie.css"), mob = lire("mobile.css");
  new Function(carte);
  assert.ok(html.includes('id="btnCarteChoix"') && html.includes('id="carteChoix"'));
  assert.match(html, /<script src="\/saisie-carte\.js" defer><\/script>/);
  // Le bouton est dans le même sélecteur que Adresse / Réf. cadastrale, sans devenir un troisième mode de recherche.
  const modes = entre('<span class="saisie-modes"', "</span>");
  assert.ok(modes.includes('id="modeAdresse"') && modes.includes('id="modeCadastre"') && modes.includes('id="btnCarteChoix"'));
  assert.equal((modes.match(/name="searchMode"/g) || []).length, 2);
  for (const f of ["function fidiChoisirParcelle(o){", "function fidiParcelleSaisie(){", "function fidiCommuneSaisie(){"]) assert.ok(html.includes(f), f);
  // Position de départ : commune saisie, géolocalisation, dernière commune ; rien n'est lancé automatiquement.
  assert.ok(carte.includes("navigator.geolocation.getCurrentPosition"));
  assert.ok(carte.includes("https://geo.api.gouv.fr/communes"));
  assert.ok(carte.includes("actions: actionsParcelle") && carte.includes("Étudier cette parcelle") && carte.includes("étude en cours"));
  assert.ok(!carte.includes("lancerAnalyse("), "le choix d'une parcelle ne lance pas l'analyse");
  assert.match(css, /\.saisie-carte-carte\{height:440px/);
  assert.match(mob, /\.saisie-carte-ville input\{font-size:16px;\}/);
});
