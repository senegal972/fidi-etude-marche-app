// ═══════════════════════════════════════════════════════════════════════════
// FIDI · Kit d'implantation — surface de plancher réalisable et schéma indicatif
// Part du contour cadastral de chaque parcelle et des règles de zone lues dans
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
    (geoms || []).forEach((g, gi) => {
      if (!g || !g.coordinates) return;
      const list = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      list.forEach((rings) => { const rs = rings.slice(); rs.geom = gi; polys.push(rs); });
    });
    if (!polys.length) return null;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    polys.forEach((rs) => rs.forEach((r) => r.forEach((c) => {
      mnx = Math.min(mnx, c[0]); mxx = Math.max(mxx, c[0]); mny = Math.min(mny, c[1]); mxy = Math.max(mxy, c[1]);
    })));
    const lon0 = (mnx + mxx) / 2, lat0 = (mny + mxy) / 2, kx = M_PAR_DEG_LON * Math.cos(lat0 * Math.PI / 180);
    return polys.map((rs) => {
      const out = rs.map((r) => r.map((c) => [(c[0] - lon0) * kx, -(c[1] - lat0) * M_PAR_DEG_LAT, c[0], c[1]]));
      out.geom = rs.geom;
      return out;
    });
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
  // Un côté partagé sur une partie seulement est découpé aux sommets de la parcelle voisine.
  // « cle » situe le côté sur le terrain : la même dans toutes les vues (ensemble, parcelle).
  function listeCotes(polys) {
    const bruts = [];
    polys.forEach((rings, p) => rings.forEach((r) => {
      const n = r.length - (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? 1 : 0);
      for (let i = 0; i < n; i++) bruts.push({ a: r[i], b: r[(i + 1) % n], p });
    }));
    const cotes = [];
    bruts.forEach((c) => {
      const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], l2 = dx * dx + dy * dy;
      const ts = [0, 1];
      if (l2) bruts.forEach((o) => {
        if (o.p === c.p) return;
        if (distSeg(o.a[0], o.a[1], c.a, c.b) >= 0.6) return;
        const t = ((o.a[0] - c.a[0]) * dx + (o.a[1] - c.a[1]) * dy) / l2;
        if (t > 0 && t < 1) ts.push(t);
      });
      ts.sort((x, y) => x - y);
      const at = (t) => [0, 1, 2, 3].map((k) => c.a[k] + (c.b[k] - c.a[k]) * t);
      for (let i = 0; i + 1 < ts.length; i++) {
        if ((ts[i + 1] - ts[i]) * Math.sqrt(l2) < 0.05) continue;
        cotes.push({ a: ts[i] === 0 ? c.a : at(ts[i]), b: ts[i + 1] === 1 ? c.b : at(ts[i + 1]), p: c.p });
      }
    });
    cotes.forEach((c) => {
      const mx = (c.a[0] + c.b[0]) / 2, my = (c.a[1] + c.b[1]) / 2;
      c.interne = bruts.some((o) => o.p !== c.p && distSeg(mx, my, o.a, o.b) < 0.6);
      c.long = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
      c.cle = ((c.a[2] + c.b[2]) / 2).toFixed(6) + ',' + ((c.a[3] + c.b[3]) / 2).toFixed(6);
    });
    return cotes.map((c, id) => Object.assign(c, { id }));
  }

  // Deux parcelles se touchent-elles sur au moins 1 m ? Un simple point de contact ne compte pas.
  function contigues(g1, g2) {
    const polys = toMetres([g1, g2]);
    if (!polys || polys.length < 2) return false;
    return listeCotes(polys).filter((c) => c.interne && polys[c.p].geom === 0).reduce((s, c) => s + c.long, 0) >= 1;
  }

  // Unités foncières : parcelles contiguës ET de même zone. Seules ces parcelles peuvent
  // porter un projet commun. Deux parcelles séparées ou de zones différentes restent à part.
  function grouper(parcelles) {
    const n = parcelles.length, chef = parcelles.map((_, i) => i);
    const racine = (i) => (chef[i] === i ? i : (chef[i] = racine(chef[i])));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = parcelles[i], b = parcelles[j];
      if (!a.geom || !b.geom || a.zone !== b.zone) continue;
      if (contigues(a.geom, b.geom)) chef[racine(j)] = racine(i);
    }
    const out = new Map();
    parcelles.forEach((p, i) => { const r = racine(i); if (!out.has(r)) out.set(r, []); out.get(r).push(p); });
    return Array.from(out.values());
  }

  // Somme de plusieurs résultats. Une emprise inconnue n'est jamais remplacée par une estimation :
  // le total est alors marqué « incomplet ».
  function agreger(resultats) {
    const somme = (k) => resultats.reduce((s, r) => s + (r[k] != null ? r[k] : 0), 0);
    const connus = resultats.filter((r) => r.emprise_m2 != null);
    const res = { polys: null, cotes: [], runs: [], batiments: [], surface: somme('surface'), nb: somme('nb'), agrege: true };
    res.incomplet = connus.length < resultats.length;
    res.constructible_m2 = resultats.some((r) => r.constructible_m2 != null) ? somme('constructible_m2') : null;
    if (connus.length) {
      ['emprise_max_m2', 'emprise_m2', 'sdp', 'sdp_min', 'sdp_max'].forEach((k) => { res[k] = somme(k); });
    } else { res.emprise_max_m2 = null; res.emprise_m2 = null; }
    const niv = new Set(connus.map((r) => r.niveaux));
    res.niveaux = niv.size === 1 ? connus[0].niveaux : null;
    res.batiLong = resultats[0] ? resultats[0].batiLong : BATI_LONG;
    res.batiLarg = resultats[0] ? resultats[0].batiLarg : BATI_LARG;
    return res;
  }

  // Points de la parcelle (grille en degrés), pour situer ses zones du PLU.
  function dansGeom(x, y, g) {
    const list = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    return list.some((rs) => dansPolygone(x, y, rs));
  }
  function echantillons(g, cote) {
    if (!g || !g.coordinates) return [];
    const list = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    list.forEach((rs) => rs.forEach((r) => r.forEach((c) => {
      mnx = Math.min(mnx, c[0]); mxx = Math.max(mxx, c[0]); mny = Math.min(mny, c[1]); mxy = Math.max(mxy, c[1]);
    })));
    const n = cote || 15, pts = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = mnx + (i + 0.5) * (mxx - mnx) / n, y = mny + (j + 0.5) * (mxy - mny) / n;
      if (dansGeom(x, y, g)) pts.push([x, y]);
    }
    return pts;
  }
  // Point à l'intérieur de la parcelle, le plus près du centre de ses points.
  function pointInterieur(g) {
    const pts = echantillons(g);
    if (!pts.length) return null;
    const mx = pts.reduce((s, q) => s + q[0], 0) / pts.length, my = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    return pts.reduce((a, b) => (Math.hypot(b[0] - mx, b[1] - my) < Math.hypot(a[0] - mx, a[1] - my) ? b : a));
  }
  // Parts de la parcelle dans chaque zone du PLU, de la plus grande à la plus petite.
  function partsZones(g, features) {
    const pts = echantillons(g);
    const compte = features.map(() => 0);
    pts.forEach((q) => {
      const i = features.findIndex((f) => f && f.geometry && dansGeom(q[0], q[1], f.geometry));
      if (i >= 0) compte[i]++;
    });
    const tot = compte.reduce((s, v) => s + v, 0);
    return features.map((f, i) => ({ feature: f, part: tot ? compte[i] / tot : 0 })).sort((x, y) => y.part - x.part);
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
    const voieCles = new Set(p.voieCles || []);
    cotes.forEach((c) => { if (voieCles.has(c.cle)) voie.add(c.id); });
    cotes.forEach((c) => { c.voie = voie.has(c.id); });
    res.noms = p.noms || null;
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
    res.cotes.forEach((c) => { if (c.voie) voie.add(c.id); });
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
        o += '<line class="impl-cote no-print" data-cle="' + c.cle + '" x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="transparent" stroke-width="16" style="cursor:pointer;"><title>Cliquer : côté sur voie / limite séparative</title></line>';
      }
    });
    // Nom de chaque parcelle, quand le schéma en montre plusieurs.
    if (res.noms && res.noms.length > 1) {
      const vus = new Set();
      res.polys.forEach((rs) => {
        if (vus.has(rs.geom) || !res.noms[rs.geom]) return;
        vus.add(rs.geom);
        const pts = rs[0], q = px(pts.reduce((t, c) => t + c[0], 0) / pts.length, pts.reduce((t, c) => t + c[1], 0) / pts.length);
        o += '<text x="' + q[0].toFixed(1) + '" y="' + q[1].toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#7a1f45" stroke="#fff" stroke-width="3" paint-order="stroke">' + String(res.noms[rs.geom]).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>';
      });
    }
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

  const api = { compute, svg, defauts, grouper, agreger, partsZones, pointInterieur, COEF_PLANCHER };

  // ── Interface écran ───────────────────────────────────────────────────────
  if (typeof document !== 'undefined') {
    const CHAMPS_ZONE = ['emprisePct', 'reculVoie', 'reculLimites', 'niveaux', 'ecart'];
    const CHAMPS_PROJET = ['coef', 'batiLong', 'batiLarg'];
    const m2 = (n) => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('fr-FR') + ' m²';
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const SANS_CONTOUR = 'Surface saisie sans contour';

    function etat() {
      const d = window.__fidiData; if (!d) return null;
      if (!d.implantation) d.implantation = { visible: false, valeurs: {}, voieCotes: [] };
      const st = d.implantation;
      if (!st.valeurs) st.valeurs = {};
      if (!st.voieCotes) st.voieCotes = [];
      if (!st.voieCles) st.voieCles = [];
      if (!st.valeursZones) st.valeursZones = {};
      return st;
    }
    function surfaceTerrain() {
      try { if (typeof window.terrainTotalSurface === 'function' && window.terrainTotalSurface() > 0) return window.terrainTotalSurface(); } catch (e) {}
      const p = (window.__fidiGpu || {}).parcelle; return p ? Number(p.contenance) || 0 : 0;
    }
    const refDe = (o) => (((o && o.section) || '') + ' ' + ((o && o.numero) || '')).trim();
    const codeZone = (z) => String((z && (z.libelle || z.libelong || z.typezone)) || '').trim();
    const natureDe = (typezone) => {
      const t = String(typezone || '').toUpperCase();
      if (t.startsWith('AU') || t.startsWith('U')) return 'constructible';
      if (t.startsWith('A')) return 'agricole';
      if (t.startsWith('N')) return 'naturel';
      return 'inconnu';
    };

    // Parcelles du terrain : principale, puis supplémentaires. Une surface saisie à la main,
    // sans référence, reste comptée, sur une ligne à part et sans contour.
    function parcellesTerrain() {
      const gpu = window.__fidiGpu || {};
      const out = [];
      if (gpu.parcelle || gpu.parcelleGeom) {
        out.push({ ref: refDe(gpu.parcelle) || 'Parcelle principale', geom: gpu.parcelleGeom || null, contenance: Number(gpu.parcelle && gpu.parcelle.contenance) || 0, principale: true });
      }
      const vues = new Set(out.map((p) => p.ref));
      (window.__extraParcFeatures || []).forEach((f) => {
        if (!f || !f.geometry) return;
        const pp = f.properties || {};
        const ref = refDe(pp) || 'Parcelle ' + (out.length + 1);
        if (vues.has(ref)) return;
        vues.add(ref);
        out.push({ ref, geom: f.geometry, contenance: Number(pp.contenance) || 0 });
      });
      const reste = surfaceTerrain() - out.reduce((s, p) => s + p.contenance, 0);
      if (reste > 0.5) out.push({ ref: SANS_CONTOUR, geom: null, contenance: reste });
      return out;
    }

    // ── Zone du PLU et règlement de chaque parcelle (lecture une seule fois) ──
    const zonesLues = new Map();
    let reglesLues = new Map(), reglesClef = null;
    const clefGeom = (g) => JSON.stringify(g.coordinates).slice(0, 200);

    async function lireZone(p, cle) {
      const fin = (v) => { zonesLues.set(cle, v); if (v.etat === 'ok' && !p.principale) lireRegles(v.code, p.geom); refresh(); };
      try {
        const arrondi = (c) => (typeof c[0] === 'number' ? [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))] : c.map(arrondi));
        let geom = JSON.stringify({ type: p.geom.type, coordinates: arrondi(p.geom.coordinates) });
        if (encodeURIComponent(geom).length > 6000) {
          const q = pointInterieur(p.geom);
          if (!q) { fin({ etat: 'echec' }); return; }
          geom = JSON.stringify({ type: 'Point', coordinates: q });
        }
        const r = await fetch('https://apicarto.ign.fr/api/gpu/zone-urba?geom=' + encodeURIComponent(geom));
        const fc = r.ok ? await r.json() : null;
        const feats = (fc && fc.features) || [];
        if (!feats.length) { fin({ etat: 'echec' }); return; }
        const parts = feats.length > 1 ? partsZones(p.geom, feats) : [{ feature: feats[0], part: 1 }];
        const pr = parts[0].feature.properties || {};
        fin({
          etat: 'ok', code: codeZone(pr), typezone: pr.typezone || '',
          autres: parts.slice(1).filter((x) => x.part >= 0.05).map((x) => ({ code: codeZone(x.feature.properties), part: x.part })),
          part: parts[0].part,
        });
      } catch (e) { fin({ etat: 'echec' }); }
    }
    function lireRegles(code, geom) {
      const principale = codeZone((window.__fidiGpu || {}).zone);
      if (!code || code === principale || reglesLues.has(code)) return;
      const q = pointInterieur(geom);
      if (!q) { reglesLues.set(code, { etat: 'echec' }); return; }
      const carte = reglesLues;
      carte.set(code, { etat: 'attente' });
      fetch('/api/plu-regle?v=2&lat=' + encodeURIComponent(q[1]) + '&lon=' + encodeURIComponent(q[0]) + '&zone=' + encodeURIComponent(code))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((d) => { carte.set(code, { etat: d ? 'ok' : 'echec', data: d }); refresh(); });
    }
    function preparerZones(parcs) {
      if (reglesClef !== window.__fidiPluRegleClef) { reglesClef = window.__fidiPluRegleClef; reglesLues = new Map(); }
      if (parcs.length < 2) return;
      parcs.forEach((p) => {
        if (!p.geom) return;
        const cle = clefGeom(p.geom);
        if (!zonesLues.has(cle)) { zonesLues.set(cle, { etat: 'attente' }); lireZone(p, cle); }
        else {
          const z = zonesLues.get(cle);
          if (z.etat === 'ok' && !p.principale) lireRegles(z.code, p.geom);
        }
      });
    }
    // Zone retenue pour une parcelle. La principale garde la zone de l'étude.
    function habiller(parcs) {
      const zp = (window.__fidiGpu || {}).zone || {};
      const principale = codeZone(zp);
      parcs.forEach((p) => {
        const lue = p.geom ? zonesLues.get(clefGeom(p.geom)) : null;
        p.lue = lue || null;
        if (p.principale || !lue || lue.etat !== 'ok' || !lue.code) {
          p.zone = principale;
          p.typezone = zp.typezone || '';
          p.zoneEtat = (p.principale || !p.geom) ? 'ok' : (lue && lue.etat === 'ok' ? 'ok' : (lue ? lue.etat : 'attente'));
        } else { p.zone = lue.code; p.typezone = lue.typezone; p.zoneEtat = 'ok'; }
      });
    }

    // Paramètres d'une zone. Règles (emprise, reculs, niveaux, écart) : par zone.
    // Hypothèses de projet (bâtiment, coefficient) : communes à tout le terrain.
    function parametresZone(zone, typezone) {
      const st = etat();
      const principale = codeZone((window.__fidiGpu || {}).zone);
      const estPrincipale = !zone || zone === principale;
      const lu = estPrincipale ? { etat: window.__fidiPluRegle ? 'ok' : 'attente', data: window.__fidiPluRegle } : (reglesLues.get(zone) || { etat: 'attente' });
      const data = lu.data || {};
      const def = defauts(data.regles || null);
      const saisies = estPrincipale ? st.valeurs : (st.valeursZones[zone] || {});
      const val = {};
      CHAMPS_ZONE.forEach((k) => { val[k] = saisies[k] !== undefined ? saisies[k] : def[k]; });
      CHAMPS_PROJET.forEach((k) => { val[k] = st.valeurs[k] !== undefined ? st.valeurs[k] : def[k]; });
      const nat = natureDe(typezone);
      return { def, val, nat, saisies, url: data.reglement_url || '', etat: lu.etat, zone,
        calc: Object.assign({}, val, {
          empriseNonReglementee: def.empriseNonReglementee && saisies.emprisePct === undefined,
          constructible: !(nat === 'agricole' || nat === 'naturel'),
        }) };
    }
    function calculer(groupe) {
      const st = etat();
      const P = parametresZone(groupe[0].zone, groupe[0].typezone);
      const geomsG = groupe.map((p) => p.geom).filter(Boolean);
      const tout = groupe.every((p) => p.contenance > 0);
      return compute(Object.assign({}, P.calc, {
        geoms: geomsG, noms: groupe.filter((p) => p.geom).map((p) => p.ref),
        contenance: tout ? groupe.reduce((s, p) => s + p.contenance, 0) : 0,
        voieCotes: [], voieCles: st.voieCles,
      }));
    }
    // Études enregistrées avec des numéros de côté : converties en clés de terrain.
    function migrerVoies(parcs) {
      const st = etat();
      if (!st.voieCotes.length) return;
      const g = parcs.map((p) => p.geom).filter(Boolean);
      const polys = toMetres(g);
      if (!polys) return;
      const cotes = listeCotes(polys);
      st.voieCotes = st.voieCotes.filter((id) => {
        if (!cotes[id]) return true;
        if (!st.voieCles.includes(cotes[id].cle)) st.voieCles.push(cotes[id].cle);
        return false;
      });
    }

    function lienPage(src, url) {
      if (!src || !src.page) return '<span class="impl-src" style="color:#8a6d3b;">hypothèse</span>';
      const label = 'règlement p. ' + src.page;
      return url
        ? '<a class="impl-src" href="' + esc(url) + '#page=' + src.page + '" target="_blank" rel="noopener" title="' + esc(src.citation || '') + '" style="color:#1a6b3a;">' + label + '</a>'
        : '<span class="impl-src" style="color:#1a6b3a;" title="' + esc(src.citation || '') + '">' + label + '</span>';
    }
    function champ(k, label, unite, val, src, attrs, zone) {
      return '<tr><td style="color:#556;">' + label + '</td>'
        + '<td style="white-space:nowrap;"><input type="number" class="form-control form-control-sm d-inline-block impl-in" data-champ="' + k + '" data-zone="' + esc(zone || '') + '" value="' + esc(val) + '" style="width:76px;" ' + (attrs || 'min="0" step="0.5"') + '> ' + unite + '</td>'
        + '<td style="font-size:.72rem;">' + src + '</td></tr>';
    }

    const LEGENDE = '<div class="d-flex flex-wrap gap-3 mt-1" style="font-size:.72rem;color:#556;">' +
      '<span><span style="display:inline-block;width:14px;height:3px;background:#d6336c;vertical-align:middle;"></span> limite séparative</span>' +
      '<span><span style="display:inline-block;width:14px;height:4px;background:#fd7e14;vertical-align:middle;"></span> côté sur voie</span>' +
      '<span><span style="display:inline-block;width:12px;height:10px;background:#bfe3cd;vertical-align:middle;"></span> zone après reculs</span>' +
      '<span><span style="display:inline-block;width:12px;height:10px;background:#1a4b8e;vertical-align:middle;"></span> bâtiment</span>' +
      '</div>';
    function lignesResultat(res) {
      return [
        ['Surface du terrain', m2(res.surface)],
        ['Zone restant après reculs', m2(res.constructible_m2)],
        ['Emprise au sol maximale', res.emprise_max_m2 != null ? m2(res.emprise_max_m2) : '—'],
        ['Emprise retenue', res.emprise_m2 != null ? m2(res.emprise_m2) + (res.limite_par === 'reculs' ? ' <span class="text-muted">(limitée par les reculs)</span>' : '') : '—'],
        ['<b>Surface de plancher réalisable</b>', res.sdp != null ? '<b style="color:#1a4b8e;">' + m2(res.sdp_min) + ' à ' + m2(res.sdp_max) + '</b>' : '—'],
        ['<b>Bâtiments implantables</b>', res.emprise_m2 != null ? '<b style="color:#1a4b8e;">' + res.nb + '</b> <span class="text-muted">de ' + res.batiLong + ' × ' + res.batiLarg + ' m</span>' : '—'],
      ].map((l) => '<tr><td style="color:#556;">' + l[0] + '</td><td class="text-end">' + l[1] + '</td></tr>').join('');
    }
    function colonneSchema(res, P) {
      if (!res.polys) return '<div class="text-muted small">Contour indisponible : pas de schéma.</div>';
      const aide = res.voieInconnue && Number(P.val.reculVoie) !== Number(P.val.reculLimites)
        ? '<div class="no-print mt-1" style="font-size:.74rem;color:#b45309;"><i class="bi bi-hand-index me-1"></i>Cliquez le ou les côtés sur voie. Tant qu\'aucun n\'est marqué, le plus grand recul s\'applique partout.</div>'
        : '<div class="no-print mt-1 text-muted" style="font-size:.72rem;"><i class="bi bi-hand-index me-1"></i>Cliquez un côté pour le marquer « sur voie ».</div>';
      return svg(res) + LEGENDE + aide;
    }
    function tableParametres(zones, multi) {
      const st = etat();
      const sourceDe = (P, k, s) => P.saisies[k] !== undefined ? '<span class="impl-src" style="color:#556;">saisie</span>' : lienPage(s, P.url);
      let h = '';
      zones.forEach((Z) => {
        const P = parametresZone(Z.zone, Z.typezone), def = P.def;
        const empSrc = P.saisies.emprisePct !== undefined ? '<span class="impl-src" style="color:#556;">saisie</span>'
          : (def.empriseNonReglementee ? '<span class="impl-src" style="color:#1a6b3a;">non réglementée</span> ' + lienPage(def.srcEmprise, P.url) : (def.emprisePct !== '' ? lienPage(def.srcEmprise, P.url) : '<span class="impl-src" style="color:#8a6d3b;">à saisir</span>'));
        const refAxe = def.reculVoieRef ? ' <span class="text-muted">(compté depuis l\'' + esc(def.reculVoieRef) + ')</span>' : '';
        const lecture = P.etat === 'attente' ? ' <span class="text-muted fw-normal">(lecture du règlement en cours…)</span>' : '';
        h += '<div class="fw-semibold small mb-1">' + (multi ? 'Règles de la zone ' + esc(Z.zone || '?') : 'Paramètres') + lecture + '</div>' +
          '<table class="table table-sm mb-1" style="font-size:.76rem;"><tbody>' +
          champ('emprisePct', 'Emprise au sol', '%', P.val.emprisePct, empSrc, 'min="0" max="100" step="1"', Z.zone) +
          champ('reculVoie', 'Recul voie' + refAxe, 'm', P.val.reculVoie, sourceDe(P, 'reculVoie', def.srcVoie), null, Z.zone) +
          champ('reculLimites', 'Recul limites', 'm', P.val.reculLimites, sourceDe(P, 'reculLimites', def.srcLimites), null, Z.zone) +
          champ('niveaux', 'Niveaux', '', P.val.niveaux, sourceDe(P, 'niveaux', def.srcNiveaux), 'min="1" step="1"', Z.zone) +
          champ('ecart', 'Écart entre bâtiments', 'm', P.val.ecart, sourceDe(P, 'ecart', def.srcEcart), null, Z.zone) +
          (multi ? '</tbody></table>' : '');
        if (!multi) {
          const hyp = (k) => st.valeurs[k] !== undefined ? '<span class="impl-src" style="color:#556;">saisie</span>' : lienPage(null);
          h += champ('coef', 'Plancher / brut', '', P.val.coef, hyp('coef'), 'min="0.5" max="1" step="0.01"', '') +
            champ('batiLong', 'Bâtiment : longueur', 'm', P.val.batiLong, hyp('batiLong'), 'min="3" step="1"', '') +
            champ('batiLarg', 'Bâtiment : largeur', 'm', P.val.batiLarg, hyp('batiLarg'), 'min="3" step="1"', '') +
            '</tbody></table>';
        }
        if (def.enLimitePossible) h += '<div class="text-muted" style="font-size:.7rem;">Implantation en limite possible sous conditions : voir le règlement. Saisir 0 pour ce scénario.</div>';
      });
      if (multi) {
        const P = parametresZone(zones[0].zone, zones[0].typezone);
        const hyp = (k) => st.valeurs[k] !== undefined ? '<span class="impl-src" style="color:#556;">saisie</span>' : lienPage(null);
        h += '<div class="fw-semibold small mb-1 mt-2">Hypothèses de projet (tout le terrain)</div>' +
          '<table class="table table-sm mb-1" style="font-size:.76rem;"><tbody>' +
          champ('coef', 'Plancher / brut', '', P.val.coef, hyp('coef'), 'min="0.5" max="1" step="0.01"', '') +
          champ('batiLong', 'Bâtiment : longueur', 'm', P.val.batiLong, hyp('batiLong'), 'min="3" step="1"', '') +
          champ('batiLarg', 'Bâtiment : largeur', 'm', P.val.batiLarg, hyp('batiLarg'), 'min="3" step="1"', '') +
          '</tbody></table>';
      }
      return h + '<button type="button" class="btn btn-sm btn-outline-secondary py-0 mt-1 no-print" id="implReset">Revenir aux valeurs du règlement</button>';
    }
    const zonesDistinctes = (parcs) => {
      const m = new Map();
      parcs.forEach((p) => { if (!m.has(p.zone)) m.set(p.zone, { zone: p.zone, typezone: p.typezone }); });
      return Array.from(m.values());
    };
    function alertes(parcs) {
      let a = '';
      const alerte = (t) => '<div class="alert alert-warning py-1 px-2 small mb-2">' + t + '</div>';
      const zones = zonesDistinctes(parcs), multi = zones.length > 1;
      zones.forEach((Z) => {
        const P = parametresZone(Z.zone, Z.typezone), nom = multi ? ' ' + esc(Z.zone || '?') : '';
        if (P.calc.constructible === false) a += alerte('Zone' + nom + ' ' + (P.nat === 'agricole' ? 'agricole' : 'naturelle') + ' : constructibilité très restreinte. Le schéma montre seulement la géométrie du terrain.');
        if (P.def.empriseAmbigue && P.saisies.emprisePct === undefined) a += alerte('Le règlement donne plusieurs emprises pour la zone' + nom + ' selon le quartier (' + P.def.empriseAmbigue.join(' %, ') + ' %). Saisissez la bonne valeur.');
        else if (P.etat !== 'attente' && P.calc.constructible !== false && P.val.emprisePct === '' && !P.calc.empriseNonReglementee) a += alerte('Emprise au sol' + (multi ? ' de la zone' + nom : '') + ' non lue dans le règlement. Saisissez la valeur pour obtenir les surfaces et le nombre de bâtiments.');
      });
      parcs.forEach((p) => {
        if (p.lue && p.lue.etat === 'ok' && p.lue.autres && p.lue.autres.length) {
          const pc = (v) => Math.round(v * 100) + ' %';
          a += alerte('Parcelle ' + esc(p.ref) + ' à cheval sur plusieurs zones : ' + esc(p.lue.code) + ' (' + pc(p.lue.part) + ')' + p.lue.autres.map((o) => ', ' + esc(o.code) + ' (' + pc(o.part) + ')').join('') + '. Les règles de ' + esc(p.zone || '?') + ' sont appliquées à toute la parcelle.');
        }
        if (!p.principale && p.geom && p.zoneEtat === 'echec') a += alerte('Zone de la parcelle ' + esc(p.ref) + ' non trouvée : règles de la zone principale appliquées, à vérifier.');
      });
      if (!parcs.some((p) => p.geom)) a += alerte('Contour de parcelle indisponible : schéma non dessiné, surfaces sans effet des reculs.');
      if (parcs.some((p) => p.ref === SANS_CONTOUR)) a += alerte('Une surface a été saisie sans référence cadastrale : comptée dans le total, sans schéma ni effet des reculs.');
      return a;
    }
    function ligneRecap(cle, nom, zone, r, st, fort) {
      const actif = st.vue === cle || (!st.vue && cle === 'ensemble');
      const plancher = r.sdp != null ? m2(r.sdp_min) + ' à ' + m2(r.sdp_max) + (r.incomplet ? ' <span class="text-muted">(partiel)</span>' : '') : '—';
      return '<tr' + (cle ? ' data-impl-vue="' + esc(cle) + '" style="cursor:pointer;' + (actif ? 'background:#eef4fb;' : '') + '"' : '') + '>' +
        '<td>' + (fort ? '<b>' + esc(nom) + '</b>' : esc(nom)) + '</td><td>' + esc(zone) + '</td>' +
        '<td class="text-end">' + m2(r.surface) + '</td><td class="text-end">' + m2(r.constructible_m2) + '</td>' +
        '<td class="text-end">' + (r.emprise_m2 != null ? m2(r.emprise_m2) : '—') + '</td>' +
        '<td class="text-end">' + (fort ? '<b>' + plancher + '</b>' : plancher) + '</td>' +
        '<td class="text-end">' + (r.emprise_m2 != null ? (fort ? '<b>' + r.nb + '</b>' : r.nb) : '—') + '</td></tr>';
    }

    function refresh() {
      const row = document.getElementById('implantationRow');
      const d = window.__fidiData;
      if (!row || !d) return;
      const st = etat();
      row.classList.remove('d-none');

      let parcs = parcellesTerrain();
      if (!parcs.length) parcs = [{ ref: SANS_CONTOUR, geom: null, contenance: surfaceTerrain() }];
      preparerZones(parcs);
      habiller(parcs);
      migrerVoies(parcs);

      const multi = parcs.length > 1;
      const groupes = grouper(parcs);
      const resGroupes = groupes.map(calculer);
      const resParcelles = multi ? parcs.map((p) => calculer([p])) : resGroupes;
      const total = resGroupes.length === 1 ? resGroupes[0] : agreger(resGroupes);
      window.__fidiImplantation = total;

      // Ligne « surface de plancher » du tableau de constructibilité : toujours l'ensemble du terrain.
      const cSdp = document.getElementById('cSdpVal');
      if (cSdp) {
        const detail = total.niveaux ? total.niveaux + ' niveau' + (total.niveaux > 1 ? 'x' : '') + ', estimation' : 'estimation';
        cSdp.innerHTML = total.sdp != null
          ? '<span class="fw-semibold" style="color:#1a4b8e;">' + m2(total.sdp_min) + ' à ' + m2(total.sdp_max) + '</span> <span class="text-muted" style="font-size:.85em;">(' + detail + (total.incomplet ? ', partiel' : '') + ')</span>'
          : '—';
      }

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

      const AVERTISSEMENT = '<div class="text-muted mt-2" style="font-size:.68rem;"><i class="bi bi-exclamation-triangle me-1" style="color:#fd7e14;"></i>Schéma et surfaces <b>indicatifs</b>, calculés sur le contour cadastral. Ils ne remplacent ni le règlement complet (pente, servitudes, stationnement, risques), ni un plan de masse, ni l\'avis d\'un architecte ou d\'un géomètre. La surface de plancher remplace la SHON depuis 2012.</div>';
      const PA = (g) => parametresZone(g[0].zone, g[0].typezone);
      const unBloc = (res, P, droite) => '<div class="row g-3"><div class="col-12 col-lg-7">' + colonneSchema(res, P) + '</div><div class="col-12 col-lg-5"><table class="table table-sm mb-2" style="font-size:.78rem;"><tbody>' + lignesResultat(res) + '</tbody></table>' + (droite || '') + '</div></div>';

      // Un seul terrain d'un seul tenant : même présentation qu'avec une seule parcelle.
      if (!multi) {
        body.innerHTML = alertes(parcs) + unBloc(total, PA(groupes[0]), tableParametres(zonesDistinctes(parcs), false)) + AVERTISSEMENT;
        return;
      }

      // Plusieurs parcelles : tableau automatique, puis schémas de la vue choisie.
      const refs = parcs.map((p) => p.ref);
      let vue = st.vue || 'ensemble';
      if (vue !== 'ensemble' && vue !== 'toutes' && !refs.includes(vue)) vue = 'ensemble';
      const memeLot = groupes.length < parcs.length;
      const sommeSeparee = agreger(resParcelles);
      const bouton = (cle, nom) => '<button type="button" class="btn btn-sm ' + (vue === cle ? 'btn-primary' : 'btn-outline-primary') + ' py-0" data-impl-vue="' + esc(cle) + '">' + esc(nom) + '</button>';
      const selecteur = '<div class="d-flex flex-wrap gap-1 mb-2 no-print align-items-center" style="font-size:.76rem;"><span class="text-muted me-1">Proposition :</span>' +
        bouton('ensemble', 'Ensemble') + parcs.filter((p) => p.geom).map((p) => bouton(p.ref, p.ref)).join('') + bouton('toutes', 'Toutes les propositions') + '</div>';
      const zoneTexte = (p) => p.zoneEtat === 'attente' ? 'lecture…' : ((p.zone || '—') + (p.zoneEtat === 'echec' ? ' (à vérifier)' : ''));
      const zonesEns = zonesDistinctes(parcs);
      let recap = '<table class="table table-sm mb-2" style="font-size:.76rem;"><thead><tr><th>Parcelle</th><th>Zone</th><th class="text-end">Surface</th><th class="text-end">Après reculs</th><th class="text-end">Emprise</th><th class="text-end">Plancher</th><th class="text-end">Bâtiments</th></tr></thead><tbody>' +
        parcs.map((p, i) => ligneRecap(p.geom ? p.ref : '', p.ref, zoneTexte(p), resParcelles[i], st, false)).join('');
      if (memeLot) recap += ligneRecap('', 'Somme, parcelles traitées séparément', '', sommeSeparee, st, false);
      recap += ligneRecap('ensemble', 'Ensemble du terrain', zonesEns.length === 1 ? (zonesEns[0].zone || '—') : zonesEns.length + ' zones', total, st, true) + '</tbody></table>';
      const nomGroupe = (g) => g.map((p) => p.ref).join(' + ');
      let explication;
      if (groupes.length === 1) explication = 'L\'ensemble traite les ' + parcs.length + ' parcelles comme un seul terrain : les limites communes ne donnent plus de recul.';
      else if (memeLot) explication = 'L\'ensemble regroupe les parcelles contiguës de même zone (' + groupes.filter((g) => g.length > 1).map(nomGroupe).map(esc).join(' ; ') + '). Les autres restent à part : elles sont séparées ou en zone différente.';
      else explication = 'Ces parcelles sont séparées ou en zones différentes : l\'ensemble additionne chaque parcelle avec ses propres règles, sans projet commun.';
      recap += '<div class="text-muted mb-2" style="font-size:.72rem;">' + explication + '</div>';

      const titre = (t) => '<div class="fw-semibold small mt-2 mb-1" style="color:#1a4b8e;">' + esc(t) + '</div>';
      let schemas = '', visibles = parcs;
      if (vue === 'ensemble') {
        if (groupes.length === 1) schemas = unBloc(resGroupes[0], PA(groupes[0]), tableParametres(zonesEns, zonesEns.length > 1));
        else schemas = groupes.filter((g) => g.some((p) => p.geom)).map((g) => titre((g.length > 1 ? 'Ensemble : ' : 'Parcelle à part : ') + nomGroupe(g)) + unBloc(resGroupes[groupes.indexOf(g)], PA(g))).join('') + '<div class="row g-3 mt-1"><div class="col-12">' + tableParametres(zonesEns, zonesEns.length > 1) + '</div></div>';
      } else if (vue === 'toutes') {
        const blocs = parcs.map((p, i) => (p.geom ? titre('Parcelle ' + p.ref + ' seule') + unBloc(resParcelles[i], PA([p])) : ''));
        if (memeLot) groupes.forEach((g, i) => { if (g.length > 1) blocs.push(titre('Ensemble : ' + nomGroupe(g)) + unBloc(resGroupes[i], PA(g))); });
        schemas = blocs.join('') + '<div class="row g-3 mt-1"><div class="col-12">' + tableParametres(zonesEns, zonesEns.length > 1) + '</div></div>';
      } else {
        const i = refs.indexOf(vue), p = parcs[i];
        visibles = [p];
        schemas = titre('Parcelle ' + p.ref + ' seule') + unBloc(resParcelles[i], PA([p]), tableParametres(zonesDistinctes([p]), false));
      }
      body.innerHTML = alertes(visibles) + selecteur + recap + schemas + AVERTISSEMENT;
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
      const k = t.getAttribute('data-champ'), zone = t.getAttribute('data-zone') || '';
      const principale = codeZone((window.__fidiGpu || {}).zone);
      let cible = st.valeurs;
      if (zone && zone !== principale && CHAMPS_ZONE.includes(k)) {
        if (!st.valeursZones[zone]) st.valeursZones[zone] = {};
        cible = st.valeursZones[zone];
      }
      if (t.value === '') delete cible[k]; else cible[k] = Number(t.value);
      marqueModifie(); refresh();
    });
    document.addEventListener('click', (e) => {
      const t = e.target; if (!t || !t.getAttribute) return;
      const st = etat(); if (!st) return;
      if (t.id === 'implReset') { st.valeurs = {}; st.valeursZones = {}; marqueModifie(); refresh(); return; }
      const cle = t.getAttribute('data-cle');
      if (cle != null) {
        const i = st.voieCles.indexOf(cle);
        if (i >= 0) st.voieCles.splice(i, 1); else st.voieCles.push(cle);
        marqueModifie(); refresh();
        return;
      }
      const v = t.closest ? t.closest('[data-impl-vue]') : null;
      if (v && document.getElementById('implantationBody') && document.getElementById('implantationBody').contains(v)) {
        st.vue = v.getAttribute('data-impl-vue'); marqueModifie(); refresh();
      }
    });
    api.refresh = refresh;
    api.toggle = toggle;
  }

  if (typeof window !== 'undefined') window.FidiImplantation = api;
})();
