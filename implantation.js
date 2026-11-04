// ═══════════════════════════════════════════════════════════════════════════
// FIDI · Kit d'implantation — surface de plancher réalisable et schéma indicatif
// Part du contour cadastral de la (des) parcelle(s) et des règles de zone lues dans
// le règlement (/api/plu-regle) : zone constructible après reculs, emprise maximale,
// surface de plancher, nombre de bâtiments implantables.
// Le module s'affiche par un bouton manuel. Affiché = imprimé ; masqué = non imprimé.
// Schéma INDICATIF : ne remplace ni un plan de masse ni l'avis d'un professionnel.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const M_PAR_DEG_LAT = 110540, M_PAR_DEG_LON = 111320;
  const HAUTEUR_NIVEAU = 3;       // m par niveau, hypothèse courante
  const COEF_PLANCHER = 0.85;     // surface de plancher / surface brute (hypothèse)
  const COEF_MARGE = 0.05;        // ± pour la fourchette
  const BATI_LONG = 12, BATI_LARG = 10, ECART_DEFAUT = 4, RECUL_DEFAUT = 3;

  // ── Géométrie (pure) ──────────────────────────────────────────────────────
  // geoms GeoJSON (Polygon | MultiPolygon) → polygones en mètres, x vers l'est, y vers le sud.
  function toMetres(geoms) {
    const polys = [];
    (geoms || []).forEach((g) => {
      if (!g || !g.coordinates) return;
      const list = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      list.forEach((rings) => polys.push(rings));
    });
    if (!polys.length) return null;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    polys.forEach((rs) => rs.forEach((r) => r.forEach((c) => {
      mnx = Math.min(mnx, c[0]); mxx = Math.max(mxx, c[0]); mny = Math.min(mny, c[1]); mxy = Math.max(mxy, c[1]);
    })));
    const lon0 = (mnx + mxx) / 2, lat0 = (mny + mxy) / 2, kx = M_PAR_DEG_LON * Math.cos(lat0 * Math.PI / 180);
    return polys.map((rs) => rs.map((r) => r.map((c) => [(c[0] - lon0) * kx, -(c[1] - lat0) * M_PAR_DEG_LAT])));
  }
  function distSeg(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
    return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
  }
  function aireAnneau(r) {
    let s = 0;
    for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }
  function dansPolygone(x, y, rings) {
    let dedans = false;
    rings.forEach((r) => {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], b = r[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) dedans = !dedans;
      }
    });
    return dedans;
  }
  // Côtés de parcelle. Un côté commun à deux parcelles du même terrain n'est pas une limite.
  function listeCotes(polys) {
    const cotes = [];
    polys.forEach((rings, p) => rings.forEach((r) => {
      const n = r.length - (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? 1 : 0);
      for (let i = 0; i < n; i++) cotes.push({ a: r[i], b: r[(i + 1) % n], p, interne: false });
    }));
    cotes.forEach((c) => {
      const mx = (c.a[0] + c.b[0]) / 2, my = (c.a[1] + c.b[1]) / 2;
      c.interne = cotes.some((o) => o.p !== c.p && distSeg(mx, my, o.a, o.b) < 0.6);
      c.long = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
    });
    return cotes.map((c, id) => Object.assign(c, { id }));
  }

  // Calcul complet. p : { geoms, contenance, emprisePct, empriseNonReglementee, reculVoie,
  // reculLimites, voieCotes:[id], niveaux, coef, batiLong, batiLarg, ecart, constructible }
  function compute(p) {
    const polys = toMetres(p.geoms);
    const cotes = polys ? listeCotes(polys) : [];
    const aireGeom = polys ? polys.reduce((s, rs) => s + rs.reduce((t, r, i) => t + (i ? -1 : 1) * aireAnneau(r), 0), 0) : 0;
    const surface = Number(p.contenance) > 0 ? Number(p.contenance) : aireGeom;
    const res = { polys, cotes, surface, aireGeom, cell: 0, runs: [], batiments: [], nb: 0, angle: 0, constructible_m2: null, voieInconnue: false };

    const voie = new Set(p.voieCotes || []);
    const rV = Math.max(0, Number(p.reculVoie) || 0), rL = Math.max(0, Number(p.reculLimites) || 0);
    res.voieInconnue = !cotes.some((c) => voie.has(c.id));
    const reculCote = (c) => c.interne ? 0 : (res.voieInconnue ? Math.max(rV, rL) : (voie.has(c.id) ? rV : rL));

    if (polys && cotes.length) {
      // Repère aligné sur le plus long côté : les bâtiments suivent l'orientation de la parcelle.
      const lg = cotes.reduce((a, b) => (b.long > a.long ? b : a));
      res.angle = Math.atan2(lg.b[1] - lg.a[1], lg.b[0] - lg.a[0]);
      const cos = Math.cos(res.angle), sin = Math.sin(res.angle);
      const rot = (x, y) => [x * cos + y * sin, -x * sin + y * cos];
      let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
      polys.forEach((rs) => rs.forEach((r) => r.forEach((c) => {
        const q = rot(c[0], c[1]); mnu = Math.min(mnu, q[0]); mxu = Math.max(mxu, q[0]); mnv = Math.min(mnv, q[1]); mxv = Math.max(mxv, q[1]);
      })));
      const cell = Math.max(0.25, Math.max(mxu - mnu, mxv - mnv) / 200);
      const nu = Math.ceil((mxu - mnu) / cell), nv = Math.ceil((mxv - mnv) / cell);
      const actifs = cotes.filter((c) => !c.interne);
      const mask = new Uint8Array(nu * nv);
      let nCell = 0;
      for (let j = 0; j < nv; j++) {
        const v = mnv + (j + 0.5) * cell;
        for (let i = 0; i < nu; i++) {
          const u = mnu + (i + 0.5) * cell;
          const x = u * cos - v * sin, y = u * sin + v * cos;
          if (!polys.some((rs) => dansPolygone(x, y, rs))) continue;
          if (actifs.every((c) => distSeg(x, y, c.a, c.b) >= reculCote(c))) { mask[j * nu + i] = 1; nCell++; }
        }
      }
      res.cell = cell; res.origine = [mnu, mnv]; res.nu = nu; res.nv = nv;
      res.constructible_m2 = nCell * cell * cell;
      // Rangées contiguës de cellules, pour le dessin.
      for (let j = 0; j < nv; j++) {
        let i = 0;
        while (i < nu) {
          if (!mask[j * nu + i]) { i++; continue; }
          let k = i; while (k < nu && mask[j * nu + k]) k++;
          res.runs.push([i, j, k - i]); i = k;
        }
      }
      res._mask = mask;
    }

    // Emprise : réglementaire, plafonnée par la zone restant après reculs.
    const pct = Number(p.emprisePct);
    const pctOk = Number.isFinite(pct) && pct > 0 && p.emprisePct !== '' && p.emprisePct != null;
    res.emprise_max_m2 = pctOk ? surface * pct / 100 : (p.empriseNonReglementee ? surface : null);
    const dispo = res.constructible_m2 != null ? res.constructible_m2 : surface;
    res.emprise_m2 = res.emprise_max_m2 == null ? null : Math.min(res.emprise_max_m2, dispo);
    res.limite_par = res.emprise_m2 == null ? null : (res.emprise_max_m2 <= dispo ? 'emprise' : 'reculs');
    if (p.constructible === false && !pctOk) res.emprise_m2 = null;

    const niveaux = Math.max(1, Math.round(Number(p.niveaux) || 1));
    const coef = Number(p.coef) > 0 ? Number(p.coef) : COEF_PLANCHER;
    res.niveaux = niveaux; res.coef = coef;
    if (res.emprise_m2 != null) {
      res.sdp = res.emprise_m2 * niveaux * coef;
      res.sdp_min = res.emprise_m2 * niveaux * Math.max(0.1, coef - COEF_MARGE);
      res.sdp_max = res.emprise_m2 * niveaux * Math.min(1, coef + COEF_MARGE);
    }

    // Bâtiments implantables : placement glouton, dans les deux orientations, plafonné à l'emprise.
    const L = Number(p.batiLong) > 0 ? Number(p.batiLong) : BATI_LONG;
    const l = Number(p.batiLarg) > 0 ? Number(p.batiLarg) : BATI_LARG;
    const e = Number(p.ecart) >= 0 ? Number(p.ecart) : ECART_DEFAUT;
    res.batiLong = L; res.batiLarg = l; res.ecart = e;
    if (res._mask && res.emprise_m2 != null) {
      const budget = Math.floor(res.emprise_m2 / (L * l) + 1e-9);
      const a = placer(res, L, l, e, budget), b = placer(res, l, L, e, budget);
      res.batiments = b.length > a.length ? b : a;
      res.nb = res.batiments.length;
      res.budget = budget;
    }
    delete res._mask;
    return res;
  }
  function placer(res, wM, hM, gM, budget) {
    const { nu, nv, cell, _mask: mask } = res;
    const w = Math.ceil(wM / cell), h = Math.ceil(hM / cell), g = Math.ceil(gM / cell);
    if (budget <= 0 || w > nu || h > nv) return [];
    const sat = new Int32Array((nu + 1) * (nv + 1));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      sat[(j + 1) * (nu + 1) + i + 1] = mask[j * nu + i] + sat[j * (nu + 1) + i + 1] + sat[(j + 1) * (nu + 1) + i] - sat[j * (nu + 1) + i];
    }
    const plein = (i, j) => sat[(j + h) * (nu + 1) + i + w] - sat[j * (nu + 1) + i + w] - sat[(j + h) * (nu + 1) + i] + sat[j * (nu + 1) + i] === w * h;
    const out = [];
    for (let j = 0; j + h <= nv; j++) {
      for (let i = 0; i + w <= nu; i++) {
        if (!plein(i, j)) continue;
        if (out.some((o) => i < o.i + o.w + g && i + w + g > o.i && j < o.j + o.h + g && j + h + g > o.j)) continue;
        out.push({ i, j, w, h });
        if (out.length >= budget) return out;
        i += w + g - 1;
      }
    }
    return out;
  }

  // ── Dessin SVG (pur) ──────────────────────────────────────────────────────
  function svg(res, voieCotes) {
    if (!res.polys) return '';
    const W = 640, H = 430, M = 30;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    res.cotes.forEach((c) => [c.a, c.b].forEach((q) => { mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]); mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]); }));
    const s = Math.min((W - 2 * M) / Math.max(1, mxx - mnx), (H - 2 * M) / Math.max(1, mxy - mny));
    const ox = (W - (mxx - mnx) * s) / 2, oy = (H - (mxy - mny) * s) / 2;
    const px = (x, y) => [(x - mnx) * s + ox, (y - mny) * s + oy];
    const fx = (q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    const cos = Math.cos(res.angle), sin = Math.sin(res.angle);
    const uv = (u, v) => px(u * cos - v * sin, u * sin + v * cos);
    const voie = new Set(voieCotes || []);
    let o = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;background:#fbfcfe;border:1px solid #dfe5ee;border-radius:6px;font-family:Arial,sans-serif;" role="img" aria-label="Schéma indicatif d\'implantation">';
    // Parcelle(s)
    res.polys.forEach((rs) => {
      const d = rs.map((r) => 'M' + r.map((c) => fx(px(c[0], c[1]))).join('L') + 'Z').join('');
      o += '<path d="' + d + '" fill="#fbeef3" fill-rule="evenodd" stroke="none"/>';
    });
    // Zone constructible après reculs
    if (res.runs.length) {
      const [mu, mv] = res.origine, c = res.cell;
      let d = '';
      res.runs.forEach((r) => {
        const u0 = mu + r[0] * c, u1 = mu + (r[0] + r[2]) * c, v0 = mv + r[1] * c, v1 = mv + (r[1] + 1) * c + c * 0.03;
        d += 'M' + fx(uv(u0, v0)) + 'L' + fx(uv(u1, v0)) + 'L' + fx(uv(u1, v1)) + 'L' + fx(uv(u0, v1)) + 'Z';
      });
      o += '<path d="' + d + '" fill="#bfe3cd"/>';
    }
    // Bâtiments
    res.batiments.forEach((b, n) => {
      const [mu, mv] = res.origine, c = res.cell;
      const a = uv(mu + b.i * c, mv + b.j * c), e = uv(mu + (b.i + b.w) * c, mv + b.j * c), f = uv(mu + (b.i + b.w) * c, mv + (b.j + b.h) * c), g = uv(mu + b.i * c, mv + (b.j + b.h) * c);
      o += '<path d="M' + fx(a) + 'L' + fx(e) + 'L' + fx(f) + 'L' + fx(g) + 'Z" fill="#1a4b8e" fill-opacity=".78" stroke="#0f2f5c" stroke-width="1"/>';
      o += '<text x="' + ((a[0] + f[0]) / 2).toFixed(1) + '" y="' + (((a[1] + f[1]) / 2) + 4).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">' + (n + 1) + '</text>';
    });
    // Côtés : couleur selon le type, cotes de longueur, zone cliquable
    const lgMax = Math.max.apply(null, res.cotes.map((c) => c.long).concat(1));
    res.cotes.forEach((c) => {
      const a = px(c.a[0], c.a[1]), b = px(c.b[0], c.b[1]);
      const col = c.interne ? '#b9a6b0' : (voie.has(c.id) ? '#fd7e14' : '#d6336c');
      o += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="' + col + '" stroke-width="' + (voie.has(c.id) ? 4.5 : 2.5) + '"' + (c.interne ? ' stroke-dasharray="4 4"' : '') + '/>';
      if (!c.interne && c.long >= lgMax * 0.12) {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, cx = W / 2, cy = H / 2;
        const nx = -(b[1] - a[1]), ny = b[0] - a[0], nl = Math.hypot(nx, ny) || 1;
        const sg = ((mx - cx) * nx + (my - cy) * ny) >= 0 ? 1 : -1;
        o += '<text x="' + (mx + sg * nx / nl * 12).toFixed(1) + '" y="' + (my + sg * ny / nl * 12 + 3).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#47505f">' + c.long.toFixed(1).replace('.', ',') + ' m</text>';
      }
      if (!c.interne) {
        o += '<line class="impl-cote no-print" data-cote="' + c.id + '" x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="transparent" stroke-width="16" style="cursor:pointer;"><title>Cliquer : côté sur voie / limite séparative</title></line>';
      }
    });
    // Nord + échelle
    o += '<g transform="translate(' + (W - 26) + ',38)"><path d="M0 -18 L6 6 L0 2 L-6 6 Z" fill="#47505f"/><text x="0" y="19" text-anchor="middle" font-size="11" font-weight="700" fill="#47505f">N</text></g>';
    const paliers = [5, 10, 20, 50, 100, 200, 500];
    const lm = paliers.find((v) => v * s >= 60) || 500;
    o += '<g transform="translate(14,' + (H - 14) + ')"><rect width="' + (lm * s).toFixed(1) + '" height="4" fill="#47505f"/><text x="0" y="-5" font-size="10" fill="#47505f">' + lm + ' m</text></g>';
    return o + '</svg>';
  }

  // ── Valeurs par défaut à partir des règles lues (pur) ─────────────────────
  // Chaque valeur porte sa source : page du règlement ou « hypothèse ».
  function defauts(regles) {
    const r = regles || {};
    const h = r.hauteur || {};
    const srcOf = (x) => (x && x.page ? { page: x.page, citation: x.citation } : null);
    let niveaux = 2, srcN = null;
    if (h.r_plus != null) { niveaux = h.r_plus + 1; srcN = srcOf(h); }
    else if (h.egout_m) { niveaux = Math.max(1, Math.floor(h.egout_m / HAUTEUR_NIVEAU)); srcN = srcOf(h); }
    else if (h.total_m) { niveaux = Math.max(1, Math.floor(h.total_m / HAUTEUR_NIVEAU)); srcN = srcOf(h); }
    const recul = (x) => {
      if (!x) return { v: RECUL_DEFAUT, src: null };
      if (x.maximum) return { v: 0, src: srcOf(x) };
      let v = x.m != null ? x.m : null;
      if (x.formule === 'H/2' && h.egout_m) v = Math.max(v || 0, h.egout_m / 2);
      if (v == null) return { v: RECUL_DEFAUT, src: null, cite: srcOf(x) };
      return { v, src: srcOf(x) };
    };
    const voie = recul(r.recul_voie), lim = recul(r.recul_limites), ent = r.entre_batiments;
    let ecart = ECART_DEFAUT, srcE = null;
    if (ent && (ent.m != null || (ent.formule === 'H/2' && h.egout_m))) {
      ecart = Math.max(ent.m || 0, ent.formule === 'H/2' && h.egout_m ? h.egout_m / 2 : 0); srcE = srcOf(ent);
    }
    const em = r.emprise || null;
    return {
      emprisePct: em && em.pct != null ? em.pct : '',
      empriseNonReglementee: !!(em && em.non_reglemente),
      empriseAmbigue: em && em.ambigu ? em.valeurs : null,
      srcEmprise: srcOf(em),
      reculVoie: voie.v, srcVoie: voie.src, reculVoieRef: r.recul_voie && r.recul_voie.reference,
      reculLimites: lim.v, srcLimites: lim.src, enLimitePossible: !!(r.recul_limites && r.recul_limites.en_limite),
      niveaux, srcNiveaux: srcN,
      ecart, srcEcart: srcE,
      coef: COEF_PLANCHER, batiLong: BATI_LONG, batiLarg: BATI_LARG,
    };
  }

  const api = { compute, svg, defauts, COEF_PLANCHER };

  // ── Interface écran ───────────────────────────────────────────────────────
  if (typeof document !== 'undefined') {
    const CHAMPS = ['emprisePct', 'reculVoie', 'reculLimites', 'niveaux', 'coef', 'batiLong', 'batiLarg', 'ecart'];
    const m2 = (n) => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('fr-FR') + ' m²';
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function etat() {
      const d = window.__fidiData; if (!d) return null;
      if (!d.implantation) d.implantation = { visible: false, valeurs: {}, voieCotes: [] };
      return d.implantation;
    }
    function geoms() {
      const gpu = window.__fidiGpu || {};
      const extras = (window.__extraParcFeatures || []).map((f) => f && f.geometry).filter(Boolean);
      return [gpu.parcelleGeom].concat(extras).filter(Boolean);
    }
    function surfaceTerrain() {
      try { if (typeof window.terrainTotalSurface === 'function' && window.terrainTotalSurface() > 0) return window.terrainTotalSurface(); } catch (e) {}
      const p = (window.__fidiGpu || {}).parcelle; return p ? Number(p.contenance) || 0 : 0;
    }
    function natureZone() {
      try { return typeof window.terrainNature === 'function' ? window.terrainNature() : 'inconnu'; } catch (e) { return 'inconnu'; }
    }
    function parametres() {
      const st = etat();
      const reg = (window.__fidiPluRegle && window.__fidiPluRegle.regles) || null;
      const def = defauts(reg);
      const val = {};
      CHAMPS.forEach((k) => { val[k] = st && st.valeurs[k] !== undefined ? st.valeurs[k] : def[k]; });
      const nat = natureZone();
      return { def, val, nat, calc: Object.assign({}, val, {
        geoms: geoms(), contenance: surfaceTerrain(), voieCotes: st ? st.voieCotes : [],
        empriseNonReglementee: def.empriseNonReglementee && (!st || st.valeurs.emprisePct === undefined),
        constructible: !(nat === 'agricole' || nat === 'naturel'),
      }) };
    }
    function lienPage(src) {
      const url = window.__fidiPluRegle && window.__fidiPluRegle.reglement_url;
      if (!src || !src.page) return '<span class="impl-src" style="color:#8a6d3b;">hypothèse</span>';
      const label = 'règlement p. ' + src.page;
      return url
        ? '<a class="impl-src" href="' + esc(url) + '#page=' + src.page + '" target="_blank" rel="noopener" title="' + esc(src.citation || '') + '" style="color:#1a6b3a;">' + label + '</a>'
        : '<span class="impl-src" style="color:#1a6b3a;" title="' + esc(src.citation || '') + '">' + label + '</span>';
    }
    function champ(k, label, unite, val, src, attrs) {
      return '<tr><td style="color:#556;">' + label + '</td>'
        + '<td style="white-space:nowrap;"><input type="number" class="form-control form-control-sm d-inline-block impl-in" data-champ="' + k + '" value="' + esc(val) + '" style="width:76px;" ' + (attrs || 'min="0" step="0.5"') + '> ' + unite + '</td>'
        + '<td style="font-size:.72rem;">' + src + '</td></tr>';
    }

    function refresh() {
      const row = document.getElementById('implantationRow');
      const d = window.__fidiData;
      if (!row || !d) return;
      const st = etat();
      row.classList.remove('d-none');
      const { def, val, nat, calc } = parametres();
      const res = compute(calc);
      window.__fidiImplantation = res;

      // Ligne « surface de plancher » du tableau de constructibilité.
      const cSdp = document.getElementById('cSdpVal');
      if (cSdp) cSdp.innerHTML = res.sdp != null
        ? '<span class="fw-semibold" style="color:#1a4b8e;">' + m2(res.sdp_min) + ' à ' + m2(res.sdp_max) + '</span> <span class="text-muted" style="font-size:.85em;">(' + res.niveaux + ' niveau' + (res.niveaux > 1 ? 'x' : '') + ', estimation)</span>'
        : '—';

      const btn = document.getElementById('btnImplantation');
      const body = document.getElementById('implantationBody');
      const note = document.getElementById('implantationNote');
      if (btn) btn.innerHTML = st.visible
        ? '<i class="bi bi-eye-slash me-1"></i>Masquer (ne pas imprimer)'
        : '<i class="bi bi-eye me-1"></i>Afficher (et imprimer)';
      if (note) note.classList.toggle('d-none', !!st.visible);
      row.classList.toggle('no-print', !st.visible);
      if (!body) return;
      body.classList.toggle('d-none', !st.visible);
      if (!st.visible) { body.innerHTML = ''; return; }

      const lectures = !!window.__fidiPluRegle;
      let alerte = '';
      if (calc.constructible === false) alerte += '<div class="alert alert-warning py-1 px-2 small mb-2">Zone ' + (nat === 'agricole' ? 'agricole' : 'naturelle') + ' : constructibilité très restreinte. Le schéma montre seulement la géométrie du terrain.</div>';
      if (def.empriseAmbigue && (st.valeurs.emprisePct === undefined)) alerte += '<div class="alert alert-warning py-1 px-2 small mb-2">Le règlement donne plusieurs emprises pour cette zone selon le quartier (' + def.empriseAmbigue.join(' %, ') + ' %). Saisissez la bonne valeur.</div>';
      else if (res.emprise_m2 == null && calc.constructible !== false) alerte += '<div class="alert alert-warning py-1 px-2 small mb-2">Emprise au sol non lue dans le règlement. Saisissez la valeur pour obtenir les surfaces et le nombre de bâtiments.</div>';
      if (!geoms().length) alerte += '<div class="alert alert-warning py-1 px-2 small mb-2">Contour de parcelle indisponible : schéma non dessiné, surfaces sans effet des reculs.</div>';

      const empSrc = st.valeurs.emprisePct !== undefined ? '<span class="impl-src" style="color:#556;">saisie</span>'
        : (def.empriseNonReglementee ? '<span class="impl-src" style="color:#1a6b3a;">non réglementée</span> ' + lienPage(def.srcEmprise) : (def.emprisePct !== '' ? lienPage(def.srcEmprise) : '<span class="impl-src" style="color:#8a6d3b;">à saisir</span>'));
      const src = (k, s) => st.valeurs[k] !== undefined ? '<span class="impl-src" style="color:#556;">saisie</span>' : lienPage(s);
      const refAxe = def.reculVoieRef ? ' <span class="text-muted">(compté depuis l\'' + esc(def.reculVoieRef) + ')</span>' : '';
      const enLim = def.enLimitePossible ? '<div class="text-muted" style="font-size:.7rem;">Implantation en limite possible sous conditions : voir le règlement. Saisir 0 pour ce scénario.</div>' : '';

      const lignes = [
        ['Surface du terrain', m2(res.surface)],
        ['Zone restant après reculs', m2(res.constructible_m2)],
        ['Emprise au sol maximale', res.emprise_max_m2 != null ? m2(res.emprise_max_m2) : '—'],
        ['Emprise retenue', res.emprise_m2 != null ? m2(res.emprise_m2) + (res.limite_par === 'reculs' ? ' <span class="text-muted">(limitée par les reculs)</span>' : '') : '—'],
        ['<b>Surface de plancher réalisable</b>', res.sdp != null ? '<b style="color:#1a4b8e;">' + m2(res.sdp_min) + ' à ' + m2(res.sdp_max) + '</b>' : '—'],
        ['<b>Bâtiments implantables</b>', res.emprise_m2 != null ? '<b style="color:#1a4b8e;">' + res.nb + '</b> <span class="text-muted">de ' + res.batiLong + ' × ' + res.batiLarg + ' m</span>' : '—'],
      ].map((l) => '<tr><td style="color:#556;">' + l[0] + '</td><td class="text-end">' + l[1] + '</td></tr>').join('');

      body.innerHTML =
        alerte +
        '<div class="row g-3">' +
          '<div class="col-12 col-lg-7">' + (res.polys ? svg(res, st.voieCotes) : '') +
            '<div class="d-flex flex-wrap gap-3 mt-1" style="font-size:.72rem;color:#556;">' +
              '<span><span style="display:inline-block;width:14px;height:3px;background:#d6336c;vertical-align:middle;"></span> limite séparative</span>' +
              '<span><span style="display:inline-block;width:14px;height:4px;background:#fd7e14;vertical-align:middle;"></span> côté sur voie</span>' +
              '<span><span style="display:inline-block;width:12px;height:10px;background:#bfe3cd;vertical-align:middle;"></span> zone après reculs</span>' +
              '<span><span style="display:inline-block;width:12px;height:10px;background:#1a4b8e;vertical-align:middle;"></span> bâtiment</span>' +
            '</div>' +
            (res.voieInconnue && Number(val.reculVoie) !== Number(val.reculLimites)
              ? '<div class="no-print mt-1" style="font-size:.74rem;color:#b45309;"><i class="bi bi-hand-index me-1"></i>Cliquez le ou les côtés sur voie. Tant qu\'aucun n\'est marqué, le plus grand recul s\'applique partout.</div>'
              : '<div class="no-print mt-1 text-muted" style="font-size:.72rem;"><i class="bi bi-hand-index me-1"></i>Cliquez un côté pour le marquer « sur voie ».</div>') +
          '</div>' +
          '<div class="col-12 col-lg-5">' +
            '<table class="table table-sm mb-2" style="font-size:.78rem;"><tbody>' + lignes + '</tbody></table>' +
            '<div class="fw-semibold small mb-1">Paramètres' + (lectures ? '' : ' <span class="text-muted fw-normal">(lecture du règlement en cours…)</span>') + '</div>' +
            '<table class="table table-sm mb-1" style="font-size:.76rem;"><tbody>' +
              champ('emprisePct', 'Emprise au sol', '%', val.emprisePct, empSrc, 'min="0" max="100" step="1"') +
              champ('reculVoie', 'Recul voie' + refAxe, 'm', val.reculVoie, src('reculVoie', def.srcVoie)) +
              champ('reculLimites', 'Recul limites', 'm', val.reculLimites, src('reculLimites', def.srcLimites)) +
              champ('niveaux', 'Niveaux', '', val.niveaux, src('niveaux', def.srcNiveaux), 'min="1" step="1"') +
              champ('coef', 'Plancher / brut', '', val.coef, src('coef', null), 'min="0.5" max="1" step="0.01"') +
              champ('batiLong', 'Bâtiment : longueur', 'm', val.batiLong, src('batiLong', null), 'min="3" step="1"') +
              champ('batiLarg', 'Bâtiment : largeur', 'm', val.batiLarg, src('batiLarg', null), 'min="3" step="1"') +
              champ('ecart', 'Écart entre bâtiments', 'm', val.ecart, src('ecart', def.srcEcart)) +
            '</tbody></table>' + enLim +
            '<button type="button" class="btn btn-sm btn-outline-secondary py-0 mt-1 no-print" id="implReset">Revenir aux valeurs du règlement</button>' +
          '</div>' +
        '</div>' +
        '<div class="text-muted mt-2" style="font-size:.68rem;"><i class="bi bi-exclamation-triangle me-1" style="color:#fd7e14;"></i>Schéma et surfaces <b>indicatifs</b>, calculés sur le contour cadastral. Ils ne remplacent ni le règlement complet (pente, servitudes, stationnement, risques), ni un plan de masse, ni l\'avis d\'un architecte ou d\'un géomètre. La surface de plancher remplace la SHON depuis 2012.</div>';
    }

    function marqueModifie() { if (window.FidiGuard) window.FidiGuard.setDirty(); }
    function toggle() {
      const st = etat(); if (!st) { alert("Lancez une analyse avant."); return; }
      st.visible = !st.visible; marqueModifie(); refresh();
    }
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('impl-in')) return;
      const st = etat(); if (!st) return;
      const k = t.getAttribute('data-champ');
      if (t.value === '') delete st.valeurs[k]; else st.valeurs[k] = Number(t.value);
      marqueModifie(); refresh();
    });
    document.addEventListener('click', (e) => {
      const t = e.target; if (!t || !t.getAttribute) return;
      const st = etat(); if (!st) return;
      if (t.id === 'implReset') { st.valeurs = {}; marqueModifie(); refresh(); return; }
      const id = t.getAttribute('data-cote');
      if (id == null) return;
      const n = Number(id), i = st.voieCotes.indexOf(n);
      if (i >= 0) st.voieCotes.splice(i, 1); else st.voieCotes.push(n);
      marqueModifie(); refresh();
    });
    api.refresh = refresh;
    api.toggle = toggle;
  }

  if (typeof window !== 'undefined') window.FidiImplantation = api;
})();
