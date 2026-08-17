// FIDI ACM — extracteur DomImmo (portail Antilles)
// Stratégie : JSON-LD + meta + fallback DOM générique.
// DomImmo étant un SPA, les sélecteurs peuvent changer — ce fichier est
// facilement éditable (VOIR SECTION "SÉLECTEURS AJUSTABLES" plus bas).
(function () {
  'use strict';
  function n(v) { if (v == null) return null; var x = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')); return isFinite(x) ? x : null; }
  function txt(sel) { var e = document.querySelector(sel); return e ? e.textContent.trim() : ''; }
  function meta(name) { var e = document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]'); return e ? (e.getAttribute('content') || '') : ''; }

  // ─── SÉLECTEURS AJUSTABLES (édite ici si DomImmo change son DOM) ──────
  var SEL = {
    titre: 'h1, [class*="title"], [class*="itre"]',
    prix: '[class*="rice"], [class*="rix"]',
    surface: '[class*="urface"]',
    pieces: '[class*="ieces"], [class*="ièce"]',
    adresse: '[class*="ddress"], [class*="dresse"], [class*="ocation"]',
    ref: '[class*="eference"], [class*="éférence"]',
    description: '[class*="escription"], [class*="ntent"]',
    photo: 'img',
  };

  window.__fidiExtract = function () {
    var nature = (window.__fidiDetectNature && window.__fidiDetectNature()) || 'vente';
    var out = { source: 'domimmo', url: location.href, nature: nature };

    // 1. JSON-LD
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var j = JSON.parse(scripts[i].textContent);
        var arr = Array.isArray(j) ? j : [j];
        for (var k = 0; k < arr.length; k++) {
          var d = arr[k];
          if (d.name && (d.offers || d.price)) {
            out.titre = out.titre || d.name;
            out.description = out.description || d.description;
            var off = d.offers && (Array.isArray(d.offers) ? d.offers[0] : d.offers);
            out.prix = out.prix || n((off && off.price) || d.price);
            if (d.floorSize) out.surface = out.surface || n(d.floorSize.value || d.floorSize);
            if (d.numberOfRooms) out.pieces = out.pieces || n(d.numberOfRooms);
            if (d.address) {
              out.commune = out.commune || (d.address.addressLocality || '');
              out.cp = out.cp || (d.address.postalCode || '');
              out.adresse = out.adresse || (d.address.streetAddress || '');
            }
            if (d.image) out.photo = out.photo || (Array.isArray(d.image) ? d.image[0] : d.image);
          }
        }
      } catch (_) {}
    }

    // 2. OpenGraph
    if (!out.titre) out.titre = meta('og:title') || txt(SEL.titre);
    if (!out.description) out.description = meta('og:description') || meta('description') || txt(SEL.description);
    if (!out.photo) out.photo = meta('og:image');

    // 3. Fallback DOM — cherche prix/surface/pièces dans le texte visible
    var body = document.body.textContent || '';
    if (!out.prix) {
      var mp = body.match(/(\d[\d\s.]{2,})\s*€/);
      if (mp) out.prix = n(mp[1]);
    }
    if (!out.surface) {
      var ms = body.match(/(\d+[.,]?\d*)\s*m[²2]/i);
      if (ms) out.surface = n(ms[1]);
    }
    if (!out.pieces) {
      var mpi = body.match(/(\d+)\s*pi[eè]ces?/i);
      if (mpi) out.pieces = n(mpi[1]);
    }
    if (!out.chambres) {
      var mc = body.match(/(\d+)\s*chambres?/i);
      if (mc) out.chambres = n(mc[1]);
    }
    if (!out.surface_terrain) {
      var mt = body.match(/terrain[^0-9]{0,20}(\d[\d\s.,]{1,})\s*m[²2]/i);
      if (mt) out.surface_terrain = n(mt[1]);
    }

    // 4. Type depuis titre
    if (out.titre) {
      out.type = /maison|villa/i.test(out.titre) ? 'Maison'
        : /appartement|studio|t\d/i.test(out.titre) ? 'Appartement'
        : /terrain/i.test(out.titre) ? 'Terrain'
        : /local|commerce|bureau|entrep/i.test(out.titre) ? 'Local' : '';
    }

    // Location : le prix = loyer → bascule dans out.loyer
    if (out.nature === 'location' && out.prix) {
      out.loyer = out.prix;
      out.prix = null;
      var mch = body.match(/charges\s*(?:comprises?|incluses?)?[^\d]{0,10}(\d+)\s*€/i);
      if (mch) out.charges = n(mch[1]);
    }

    // 5. Réf : essaie URL ou champ dédié
    if (!out.ref) {
      var mr = location.pathname.match(/(\d{4,})/);
      if (mr) out.ref = mr[1];
      else out.ref = txt(SEL.ref).replace(/[^\d]/g, '').slice(0, 20);
    }

    return out;
  };
})();
