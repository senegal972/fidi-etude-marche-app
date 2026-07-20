// ═══════════════════════════════════════════════════════════════════════════
// FIDI · Moteur de rapport A4 — Étude de marché
// Gabarit documentaire paginé (couverture, synthèse, marché, transactions,
// contexte, localisation, mentions). Chaque bloc est insécable ; chaque
// section démarre sur une nouvelle page. Branché sur tous les boutons
// d'impression : le navigateur imprime CE document, pas la page écran.
// Sources de données : window.__fidiData / __fidiInputs / __fidiTrans /
// __fidiCtx / __fidiLoyers / __fidiGpu (posées par index.html).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const num = (n) => (n == null || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('fr-FR');
  const eur = (n) => (n == null || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('fr-FR') + ' €';
  const dec2 = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateFr = () => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };

  // Export d'un graphique Chart.js en image (haute résolution)
  function chartImg(canvasId, alt) {
    try {
      const c = (window.Chart && Chart.getChart) ? Chart.getChart(canvasId) : null;
      if (!c) return '';
      const url = c.toBase64Image('image/png', 1);
      return '<img class="rpt-chart" src="' + url + '" alt="' + esc(alt || '') + '">';
    } catch (e) { return ''; }
  }

  // Carte statique IGN (plan) via le proxy same-origin (imprime sans CORS)
  function staticMapUrl(lat, lon) {
    const dLat = 0.005, dLon = 0.007;
    const bbox = [(lat - dLat), (lon - dLon), (lat + dLat), (lon + dLon)].map(v => v.toFixed(6)).join(',');
    const wms = 'https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
      + '&LAYERS=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLES=&CRS=EPSG:4326'
      + '&BBOX=' + bbox + '&WIDTH=1100&HEIGHT=640&FORMAT=image/png';
    return '/api/img-proxy?url=' + encodeURIComponent(wms);
  }

  // ── Styles du document (portés par le gabarit lui-même) ───────────────────
  const RPT_CSS = `
#rapportRoot{ -webkit-print-color-adjust:exact; print-color-adjust:exact;
  font-family:'Segoe UI',Arial,sans-serif; color:#1a2233; font-size:9.5pt; line-height:1.45; }
#rapportRoot *{ box-sizing:border-box; }
#rapportRoot .rpt-page{ break-after:page; }
#rapportRoot .rpt-page:last-child{ break-after:auto; }
#rapportRoot .rpt-block{ break-inside:avoid; }
#rapportRoot h1,#rapportRoot h2,#rapportRoot h3{ margin:0; font-weight:800; color:#1a3a6e; }
#rapportRoot h2{ font-size:14pt; border-bottom:2.5pt solid #1a3a6e; padding-bottom:4pt; margin-bottom:10pt; break-after:avoid; }
#rapportRoot h3{ font-size:10.5pt; margin:8pt 0 4pt; break-after:avoid; }
#rapportRoot p{ margin:0 0 6pt; }
#rapportRoot table{ width:100%; border-collapse:collapse; font-size:8pt; }
#rapportRoot thead{ display:table-header-group; }
#rapportRoot tr{ break-inside:avoid; }
#rapportRoot th{ background:#1a3a6e; color:#fff; padding:4pt 5pt; text-align:left; font-weight:600; }
#rapportRoot th.txt-r, #rapportRoot td.txt-r{ text-align:right; }
#rapportRoot td{ padding:3.5pt 5pt; border-bottom:.5pt solid #d8dee8; }
#rapportRoot tbody tr:nth-child(even) td{ background:#f4f6fa; }
#rapportRoot .rpt-chart{ width:100%; max-height:75mm; object-fit:contain; }
#rapportRoot .rpt-band{ background:#1a3a6e; color:#fff; padding:6mm 8mm; border-radius:2mm; }
#rapportRoot .rpt-kpis{ display:flex; gap:3mm; flex-wrap:wrap; }
#rapportRoot .rpt-kpi{ flex:1 1 38mm; border:1pt solid #d8dee8; border-top:3pt solid #1a3a6e; border-radius:2mm; padding:3mm 4mm; }
#rapportRoot .rpt-kpi .v{ font-size:14pt; font-weight:800; color:#1a3a6e; }
#rapportRoot .rpt-kpi .l{ font-size:7pt; text-transform:uppercase; letter-spacing:.4pt; color:#6a7385; }
#rapportRoot .rpt-kpi .s{ font-size:7.5pt; color:#6a7385; }
#rapportRoot .rpt-cols{ display:flex; gap:5mm; }
#rapportRoot .rpt-cols > div{ flex:1; }
#rapportRoot .rpt-note{ font-size:7pt; color:#6a7385; margin-top:3pt; }
#rapportRoot .rpt-badge{ display:inline-block; padding:1pt 6pt; border-radius:8pt; font-size:7.5pt; font-weight:700; color:#fff; }
#rapportRoot .rpt-foot{ margin-top:6mm; padding-top:2mm; border-top:.75pt solid #d8dee8;
  display:flex; justify-content:space-between; font-size:7pt; color:#6a7385; }
#rapportRoot .rpt-sec{ margin-bottom:7mm; }
/* Couverture */
#rapportRoot .rpt-cover{ text-align:center; }
#rapportRoot .rpt-cover .brand{ background:#1a3a6e; color:#fff; padding:10mm 8mm; border-radius:3mm; margin-bottom:12mm; }
#rapportRoot .rpt-cover .brand .t1{ font-size:20pt; font-weight:900; letter-spacing:1pt; }
#rapportRoot .rpt-cover .brand .t2{ font-size:9pt; color:#c5d5ea; margin-top:2mm; }
#rapportRoot .rpt-cover .doc-title{ font-size:22pt; font-weight:900; color:#1a3a6e; margin:6mm 0 2mm; }
#rapportRoot .rpt-cover .doc-sub{ font-size:12pt; color:#3d4c66; margin-bottom:8mm; }
#rapportRoot .rpt-cover .meta{ display:inline-block; text-align:left; border:1pt solid #d8dee8; border-radius:2mm; padding:5mm 8mm; margin-top:8mm; font-size:9pt; }
#rapportRoot .rpt-cover .meta td{ border:none; background:none!important; padding:1.5pt 6pt; }
#rapportRoot .rpt-cover .meta td:first-child{ color:#6a7385; }
#rapportRoot .rpt-cover img.cover-map{ width:88%; max-height:78mm; object-fit:cover; border-radius:2mm; border:1pt solid #d8dee8; margin-top:8mm; }
/* Jauge score */
#rapportRoot .score-wrap{ display:flex; align-items:center; gap:6mm; }
#rapportRoot .axes td{ font-size:8pt; }
#rapportRoot .dpe-bar{ display:flex; height:7mm; border-radius:1.5mm; overflow:hidden; font-size:7pt; color:#fff; text-align:center; }
`;

  // ── Sections ───────────────────────────────────────────────────────────────
  function footer(page, total, ref) {
    return '<div class="rpt-foot"><span>FIDI Conseil · contact@fidiconseil.com</span>'
      + '<span>' + esc(ref || '') + '</span><span>Page ' + page + ' / ' + total + '</span></div>';
  }

  function coverPage(d, inputs, ref) {
    const loc = d.localisation || {};
    const dest = (inputs.destinataire || (document.getElementById('inputDestinataire') || {}).value || '').trim();
    const LAB = { maison: 'Maison', appartement: 'Appartement', terrain: 'Terrain', local: 'Local professionnel', tous: 'Immeuble' };
    const typ = LAB[(d.type_bien || '').toLowerCase()] || d.type_bien || '—';
    const mapImg = (loc.lat && loc.lon) ? '<img class="cover-map" src="' + staticMapUrl(loc.lat, loc.lon) + '" alt="Plan de situation">' : '';
    return '<div class="rpt-page rpt-cover">'
      + '<div class="brand"><div class="t1">FIDI CONSEIL</div><div class="t2">Immobilier · Études de marché · Données publiques françaises</div></div>'
      + '<div class="doc-title">Étude de marché immobilière</div>'
      + '<div class="doc-sub">' + esc(loc.label || loc.city || '') + '</div>'
      + '<table class="meta"><tbody>'
      + (dest ? '<tr><td>Destinataire</td><td><strong>' + esc(dest) + '</strong></td></tr>' : '')
      + '<tr><td>Date</td><td>' + dateFr() + '</td></tr>'
      + '<tr><td>Référence</td><td>' + esc(ref) + '</td></tr>'
      + '<tr><td>Type de bien</td><td>' + esc(typ) + (inputs.surface ? ' · ' + inputs.surface + ' m²' : '') + '</td></tr>'
      + '<tr><td>Périmètre</td><td>' + esc(inputs.perimetre || '—') + '</td></tr>'
      + '</tbody></table>'
      + mapImg
      + '<div class="rpt-note" style="margin-top:10mm;">Document établi à partir des données publiques officielles (DVF, INSEE, ADEME, Géorisques, IGN).</div>'
      + '</div>';
  }

  function scoreGaugeSvg(score) {
    const total = (score && score.total) || 0;
    const col = (score && score.couleur) || '#1a3a6e';
    const r = 34, c = 2 * Math.PI * r, off = c * (1 - Math.min(total, 100) / 100);
    return '<svg width="95" height="95" viewBox="0 0 95 95">'
      + '<circle cx="47.5" cy="47.5" r="' + r + '" fill="none" stroke="#e6eaf2" stroke-width="9"/>'
      + '<circle cx="47.5" cy="47.5" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round" '
      + 'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 47.5 47.5)"/>'
      + '<text x="47.5" y="45" text-anchor="middle" font-size="19" font-weight="800" fill="' + col + '">' + total + '</text>'
      + '<text x="47.5" y="60" text-anchor="middle" font-size="8" fill="#6a7385">/ 100</text></svg>';
  }

  function synthesePage(d, inputs, ref) {
    const sc = d.score || {}, est = d.estimation, ests = d.estimations || {};
    const per = (d.dvf_periodes && d.dvf_periodes[0]) || {};
    const val = d.valoris || {};
    const info = d.commune_info || {};

    // Axes du score
    const axes = sc.axes ? Object.values(sc.axes).map(a =>
      '<tr><td>' + esc(a.label) + '</td><td class="txt-r"><strong>' + a.note + '</strong>/' + a.max + '</td><td>' + esc(a.detail || '') + '</td></tr>'
    ).join('') : '';

    // Texte de synthèse narrative (repris de l'écran s'il existe)
    let narratif = '';
    try {
      const n = document.querySelector('#syntheseRow .chart-card');
      if (n) narratif = '<div class="rpt-block rpt-sec"><h3>Synthèse</h3><div style="font-size:9pt;">' + n.innerHTML.replace(/<h6[^>]*>[\s\S]*?<\/h6>/, '') + '</div></div>';
    } catch (e) { }

    const kpis =
      '<div class="rpt-kpis rpt-block rpt-sec">'
      + '<div class="rpt-kpi"><div class="l">Prix médian maison</div><div class="v">' + (val.maison ? eur(val.maison.prix_median_m2) : '—') + '</div><div class="s">par m² bâti</div></div>'
      + '<div class="rpt-kpi"><div class="l">Prix médian appartement</div><div class="v">' + (val.appartement ? eur(val.appartement.prix_median_m2) : '—') + '</div><div class="s">par m² bâti</div></div>'
      + '<div class="rpt-kpi"><div class="l">Prix médian terrain</div><div class="v">' + (val.terrain ? eur(val.terrain.prix_median_m2) : '—') + '</div><div class="s">par m² de terrain</div></div>'
      + '<div class="rpt-kpi"><div class="l">Ventes ' + esc(per.periode || '') + '</div><div class="v">' + num(per.nb_total) + '</div><div class="s">mutations DVF</div></div>'
      + '<div class="rpt-kpi"><div class="l">Population</div><div class="v">' + num(info.population) + '</div><div class="s">' + esc(info.nom || '') + '</div></div>'
      + '</div>';

    let estHtml = '';
    if (est) {
      const LAB = { maison: 'Maison', appartement: 'Appartement', terrain: 'Terrain', local: 'Local', tous: 'Immeuble' };
      estHtml = '<div class="rpt-band rpt-block rpt-sec"><div style="display:flex;justify-content:space-between;align-items:center;">'
        + '<div><div style="font-size:8pt;color:#c5d5ea;text-transform:uppercase;letter-spacing:.5pt;">Estimation vénale — ' + esc(LAB[(d.type_bien || '').toLowerCase()] || 'Bien') + ' · ' + (est.surface || '—') + ' m²</div>'
        + '<div style="font-size:20pt;font-weight:900;">' + eur(est.valeur_med) + '</div>'
        + '<div style="font-size:8pt;color:#c5d5ea;">Base : ' + eur(est.prix_m2) + '/m² (médiane du marché local)</div></div>'
        + '<div style="text-align:right;font-size:9pt;"><div>Fourchette basse : <strong>' + eur(est.valeur_min) + '</strong></div>'
        + '<div>Fourchette haute : <strong>' + eur(est.valeur_max) + '</strong></div></div>'
        + '</div></div>';
    }

    let estTypes = '';
    const tdefs = [['maison', 'Maison', '#e4241c'], ['appartement', 'Appartement', '#0d6efd'], ['terrain', 'Terrain', '#198754']];
    const cards = tdefs.filter(t => ests[t[0]] && ests[t[0]].valeur_med != null).map(t => {
      const e = ests[t[0]];
      return '<div class="rpt-kpi" style="border-top-color:' + t[2] + ';"><div class="l" style="color:' + t[2] + ';">' + t[1] + (e.standard ? ' (surface std)' : '') + '</div>'
        + '<div class="v">' + eur(e.valeur_med) + '</div>'
        + '<div class="s">' + num(e.surface) + ' m² × ' + eur(e.prix_m2) + '/m² · ' + eur(e.valeur_min) + ' – ' + eur(e.valeur_max) + '</div></div>';
    }).join('');
    if (cards) estTypes = '<div class="rpt-block rpt-sec"><h3>Estimation vénale par type de bien</h3><div class="rpt-kpis">' + cards + '</div>'
      + '<div class="rpt-note">Le type analysé utilise la surface saisie ; les autres une surface standard (maison 100 m², appartement 70 m², terrain 500 m²).</div></div>';

    return '<div class="rpt-page">'
      + '<h2>1 · Synthèse & potentiel</h2>'
      + '<div class="score-wrap rpt-block rpt-sec">' + scoreGaugeSvg(sc)
      + '<div style="flex:1;"><div style="font-size:12pt;font-weight:800;color:' + (sc.couleur || '#1a3a6e') + ';">Potentiel : ' + esc(sc.verdict || '—') + '</div>'
      + '<table class="axes"><tbody>' + axes + '</tbody></table></div></div>'
      + kpis + estHtml + estTypes + narratif
      + footer(2, 7, ref) + '</div>';
  }

  function marchePage(d, ref) {
    const dvfA = d.dvf_annees || [];
    const rows = dvfA.map(r =>
      '<tr><td>' + r.annee + '</td><td class="txt-r">' + num(r.nb_total) + '</td>'
      + '<td class="txt-r">' + num(r.nb_maison) + '</td><td class="txt-r">' + (r.prix_m2_maison != null ? eur(r.prix_m2_maison) : '—') + '</td>'
      + '<td class="txt-r">' + num(r.nb_appart) + '</td><td class="txt-r">' + (r.prix_m2_appart != null ? eur(r.prix_m2_appart) : '—') + '</td>'
      + '<td class="txt-r">' + num(r.nb_terrain) + '</td><td class="txt-r">' + (r.prix_m2_terrain != null ? eur(r.prix_m2_terrain) : '—') + '</td></tr>'
    ).join('');
    return '<div class="rpt-page">'
      + '<h2>2 · Marché immobilier local (DVF)</h2>'
      + '<div class="rpt-cols rpt-sec"><div class="rpt-block"><h3>Évolution des prix au m²</h3>' + chartImg('prixChart', 'Évolution des prix') + '</div>'
      + '<div class="rpt-block"><h3>Volume de transactions</h3>' + chartImg('transChart', 'Transactions par an') + '</div></div>'
      + '<div class="rpt-block"><h3>Détail par année</h3>'
      + '<table><thead><tr><th>Année</th><th class="txt-r">Ventes</th><th class="txt-r">Maisons</th><th class="txt-r">€/m² maison</th>'
      + '<th class="txt-r">Apparts</th><th class="txt-r">€/m² appart</th><th class="txt-r">Terrains</th><th class="txt-r">€/m² terrain</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '<div class="rpt-note">Source : Demandes de valeurs foncières (DVF), mutations regroupées, prix médians sur ventes mono-bien.</div></div>'
      + footer(3, 7, ref) + '</div>';
  }

  function transactionsPage(d, ref) {
    const all = window.__fidiTrans || [];
    const MAXROWS = 80;
    const rows = all.slice(0, MAXROWS).map(t => {
      const dist = t.distance_m != null ? (t.distance_m < 1000 ? Math.round(t.distance_m) + ' m' : (t.distance_m / 1000).toFixed(1) + ' km') : '—';
      return '<tr><td>' + esc(t.date || '—') + '</td><td>' + esc((t.adresse || '—').slice(0, 34)) + '</td>'
        + '<td>' + esc(t.type_local || '—') + (t.multi ? ' *' : '') + '</td>'
        + '<td class="txt-r">' + (t.surface_bati != null ? num(t.surface_bati) : '—') + '</td>'
        + '<td class="txt-r">' + (t.surface_terrain != null ? num(t.surface_terrain) : '—') + '</td>'
        + '<td class="txt-r">' + (t.valeur != null ? eur(t.valeur) : '—') + '</td>'
        + '<td class="txt-r">' + (t.prix_m2 != null ? eur(t.prix_m2) : (t.multi ? 'n/s' : '—')) + '</td>'
        + '<td class="txt-r">' + dist + '</td></tr>';
    }).join('');
    if (!all.length) return '';
    return '<div class="rpt-page">'
      + '<h2>3 · Transactions de référence (' + num(all.length) + ' ventes)</h2>'
      + '<table><thead><tr><th>Date</th><th>Adresse</th><th>Type</th><th class="txt-r">Bâti m²</th>'
      + '<th class="txt-r">Terrain m²</th><th class="txt-r">Prix</th><th class="txt-r">€/m²</th><th class="txt-r">Dist.</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + (all.length > MAXROWS ? '<div class="rpt-note">' + num(all.length - MAXROWS) + ' transactions supplémentaires disponibles dans l\'application.</div>' : '')
      + '<div class="rpt-note">* vente portant sur plusieurs biens : prix global, €/m² non significatif. Source DVF Etalab.</div>'
      + footer(4, 7, ref) + '</div>';
  }

  function contextePage(d, ref) {
    const ctx = window.__fidiCtx || {};
    const fisc = ctx.fisc || {}, vac = ctx.vac || {}, del = ctx.del || {};
    const risques = d.risques || {}, dpe = d.dpe || {};

    // Barre DPE
    const DPE_COL = { A: '#00a06d', B: '#52b153', C: '#a5c93c', D: '#f4e70f', E: '#f0b40f', F: '#eb8235', G: '#d7221f' };
    const totDpe = Object.values(dpe).reduce((s, v) => s + v, 0);
    let dpeBar = '';
    if (totDpe > 0) {
      dpeBar = '<div class="rpt-block rpt-sec"><h3>Parc énergétique (DPE)</h3><div class="dpe-bar">'
        + ['A', 'B', 'C', 'D', 'E', 'F', 'G'].filter(k => dpe[k]).map(k => {
          const p = (dpe[k] / totDpe * 100);
          return '<div style="width:' + p.toFixed(1) + '%;background:' + DPE_COL[k] + ';line-height:7mm;">' + (p > 6 ? k + ' ' + Math.round(p) + '%' : '') + '</div>';
        }).join('') + '</div>'
        + '<div class="rpt-note">' + num(totDpe) + ' diagnostics recensés (ADEME).</div></div>';
    }

    const top3 = (del.top_3 || []).map(t => esc(t.categorie) + ' (' + num(t.faits) + ')').join(' · ');
    const risqList = Array.isArray(risques.synthese) ? risques.synthese.join(', ') : '';

    const cols =
      '<div class="rpt-cols rpt-sec">'
      + '<div class="rpt-kpi"><div class="l">Taxe foncière ' + esc(fisc.annee || '') + '</div>'
      + '<div class="v">' + (fisc.taux_tfb_total != null ? dec2(fisc.taux_tfb_total) + ' %' : '—') + '</div>'
      + '<div class="s">taux TFB total (commune : ' + (fisc.taux_tfb_commune != null ? dec2(fisc.taux_tfb_commune) + ' %' : '—') + ')</div></div>'
      + '<div class="rpt-kpi"><div class="l">Vacance des logements</div>'
      + '<div class="v">' + (vac.taux_vacance != null ? dec2(vac.taux_vacance) + ' %' : '—') + '</div>'
      + '<div class="s">' + (vac.nb_logements_vacants != null ? num(vac.nb_logements_vacants) + ' logements vacants · ' : '') + (vac.zone_tendue ? 'zone tendue' : 'hors zone tendue') + '</div></div>'
      + '<div class="rpt-kpi"><div class="l">Sécurité ' + esc(del.annee || '') + '</div>'
      + '<div class="v">' + (del.taux_pour_1000 != null ? dec2(del.taux_pour_1000) + ' ‰' : '—') + '</div>'
      + '<div class="s">' + (del.faits_total != null ? num(del.faits_total) + ' faits constatés' : 'données indisponibles') + '</div></div>'
      + '</div>'
      + (top3 ? '<div class="rpt-note rpt-sec">Principales catégories : ' + top3 + '</div>' : '');

    const risquesHtml =
      '<div class="rpt-block rpt-sec"><h3>Risques naturels & technologiques</h3><table><tbody>'
      + (risques.sismicite ? '<tr><td>Sismicité</td><td>' + esc(risques.sismicite.libelle || ('zone ' + risques.sismicite.zone)) + '</td></tr>' : '')
      + (risques.radon ? '<tr><td>Radon</td><td>Catégorie ' + esc(risques.radon.classe) + '</td></tr>' : '')
      + (risqList ? '<tr><td>Risques recensés</td><td>' + esc(risqList) + '</td></tr>' : '')
      + (risques.icpe ? '<tr><td>Installations classées (3 km)</td><td>' + num(risques.icpe.count) + '</td></tr>' : '')
      + '</tbody></table><div class="rpt-note">Source : Géorisques.</div></div>';

    // Rendement locatif
    const loy = window.__fidiLoyers || null;
    let loyHtml = '';
    if (loy && loy.disponible !== false) {
      const tb = (d.type_bien || 'maison').toLowerCase();
      const isM = tb.indexOf('maison') >= 0;
      const lm2 = isM ? loy.loyer_m2_maison : loy.loyer_m2_appartement;
      const per = (d.dvf_periodes && d.dvf_periodes[0]) || {};
      const pv = (d.estimation && d.estimation.prix_m2) || (isM ? per.prix_m2_maison : per.prix_m2_appart) || null;
      const rend = (lm2 && pv) ? (lm2 * 12 / pv * 100) : null;
      loyHtml = '<div class="rpt-block rpt-sec"><h3>Rendement locatif indicatif</h3><div class="rpt-kpis">'
        + '<div class="rpt-kpi"><div class="l">Loyer marché</div><div class="v">' + (lm2 ? dec2(lm2) + ' €' : '—') + '</div><div class="s">par m²/mois (' + esc(loy.libelle || '') + ' ' + esc(loy.annee || '') + ')</div></div>'
        + '<div class="rpt-kpi"><div class="l">Prix de vente</div><div class="v">' + (pv ? eur(pv) : '—') + '</div><div class="s">par m² (médiane)</div></div>'
        + '<div class="rpt-kpi"><div class="l">Rendement brut</div><div class="v">' + (rend != null ? dec2(rend) + ' %' : '—') + '</div><div class="s">hors charges et fiscalité</div></div>'
        + '</div></div>';
    }

    return '<div class="rpt-page">'
      + '<h2>4 · Contexte local</h2>'
      + cols + loyHtml + dpeBar + risquesHtml
      + footer(5, 7, ref) + '</div>';
  }

  function localisationPage(d, ref) {
    const loc = d.localisation || {};
    const gpu = window.__fidiGpu || {};
    const z = gpu.zone, p = gpu.parcelle;
    const mapImg = (loc.lat && loc.lon) ? '<img class="rpt-chart" style="max-height:95mm;object-fit:cover;border:1pt solid #d8dee8;border-radius:2mm;" src="' + staticMapUrl(loc.lat, loc.lon) + '" alt="Plan de situation">' : '';
    return '<div class="rpt-page">'
      + '<h2>5 · Localisation, cadastre & urbanisme</h2>'
      + '<div class="rpt-block rpt-sec">' + mapImg + '</div>'
      + '<div class="rpt-block rpt-sec"><table><tbody>'
      + '<tr><td style="width:38mm;">Adresse analysée</td><td><strong>' + esc(loc.label || '—') + '</strong></td></tr>'
      + '<tr><td>Commune</td><td>' + esc(loc.city || '—') + ' (' + esc(loc.citycode || '') + ')</td></tr>'
      + (p ? '<tr><td>Référence cadastrale</td><td><strong>' + esc((p.section || '') + ' ' + (p.numero || '')) + '</strong>'
        + (p.contenance ? ' · contenance ' + num(p.contenance) + ' m²' : '') + '</td></tr>' : '')
      + (z ? '<tr><td>Zonage PLU</td><td><strong>' + esc(z.libelle || '') + '</strong>' + (z.libelong ? ' — ' + esc(z.libelong) : '') + (z.typezone ? ' (type ' + esc(z.typezone) + ')' : '') + '</td></tr>'
        : '<tr><td>Zonage PLU</td><td>Document d\'urbanisme non numérisé sur le GPU pour cette commune.</td></tr>')
      + '</tbody></table>'
      + '<div class="rpt-note">Sources : IGN Géoplateforme, Géoportail de l\'Urbanisme, cadastre Etalab.</div></div>'
      + footer(6, 7, ref) + '</div>';
  }

  function mentionsPage(ref) {
    return '<div class="rpt-page">'
      + '<h2>6 · Méthodologie, sources & mentions</h2>'
      + '<div class="rpt-block rpt-sec"><h3>Méthodologie</h3>'
      + '<p>Les prix médians au m² sont calculés à partir des mutations DVF regroupées par vente (une mutation = une vente), en excluant les ventes multi-biens dont le prix global ne permet pas un prix unitaire fiable. Les estimations vénales résultent du produit surface × prix médian local, encadré d\'une fourchette de −15 % à +20 % reflétant l\'état et la situation du bien. Le score de potentiel agrège cinq axes notés sur 20 : activité du marché, tendance des prix, attractivité, parc énergétique et risques.</p></div>'
      + '<div class="rpt-block rpt-sec"><h3>Sources officielles</h3><table><tbody>'
      + '<tr><td>Transactions immobilières</td><td>DVF — Demandes de valeurs foncières (Etalab / DGFiP)</td></tr>'
      + '<tr><td>Cadastre & cartographie</td><td>IGN Géoplateforme, cadastre Etalab</td></tr>'
      + '<tr><td>Urbanisme</td><td>Géoportail de l\'Urbanisme (GPU)</td></tr>'
      + '<tr><td>Démographie</td><td>INSEE (geo.api.gouv.fr)</td></tr>'
      + '<tr><td>Énergie</td><td>ADEME — diagnostics de performance énergétique</td></tr>'
      + '<tr><td>Risques</td><td>Géorisques (BRGM / MTE)</td></tr>'
      + '<tr><td>Loyers</td><td>Carte des loyers DHUP/MEF</td></tr>'
      + '<tr><td>Fiscalité, vacance, sécurité</td><td>data.economie.gouv.fr · opendatasoft · SSMSI</td></tr>'
      + '</tbody></table></div>'
      + '<div class="rpt-block rpt-sec"><h3>Mentions</h3>'
      + '<p style="font-size:8pt;color:#6a7385;">Ce document est une étude indicative établie à partir de données publiques. Il ne constitue ni une expertise immobilière au sens de la charte de l\'expertise, ni un avis de valeur opposable. FIDI Conseil ne saurait être tenu responsable des décisions prises sur la seule base de ce document.</p>'
      + '<p style="margin-top:6mm;"><strong>FIDI Conseil</strong> · Martinique · contact@fidiconseil.com</p></div>'
      + footer(7, 7, ref) + '</div>';
  }

  // ── Assemblage & impression ────────────────────────────────────────────────
  function buildRapportHTML() {
    const d = window.__fidiData;
    if (!d) return null;
    const inputs = window.__fidiInputs || {};
    const ref = (typeof window.etudeRef === 'function' || typeof etudeRef === 'function')
      ? (window.etudeRef || etudeRef)(d, inputs) : '';
    return '<style>' + RPT_CSS + '</style>'
      + coverPage(d, inputs, ref)
      + synthesePage(d, inputs, ref)
      + marchePage(d, ref)
      + transactionsPage(d, ref)
      + contextePage(d, ref)
      + localisationPage(d, ref)
      + mentionsPage(ref);
  }

  // Attend le chargement des images du rapport (carte statique, graphiques)
  function waitImages(root, timeoutMs) {
    const imgs = Array.from(root.querySelectorAll('img'));
    if (!imgs.length) return Promise.resolve();
    return Promise.race([
      Promise.all(imgs.map(im => im.complete ? Promise.resolve()
        : new Promise(res => { im.onload = im.onerror = res; }))),
      new Promise(res => setTimeout(res, timeoutMs || 6000)),
    ]);
  }

  async function printRapport(onDone) {
    const html = buildRapportHTML();
    if (!html) { alert('Lancez une analyse avant d\'imprimer.'); if (onDone) onDone(); return; }
    let root = document.getElementById('rapportRoot');
    if (!root) { root = document.createElement('div'); root.id = 'rapportRoot'; document.body.appendChild(root); }
    root.innerHTML = html;
    document.body.classList.add('rapport-printing');
    await waitImages(root, 6000);
    const done = () => {
      document.body.classList.remove('rapport-printing');
      root.innerHTML = '';
      window.removeEventListener('afterprint', done);
      if (onDone) onDone();
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 120);
  }

  window.FidiRapport = { print: printRapport, buildHTML: buildRapportHTML };
})();
