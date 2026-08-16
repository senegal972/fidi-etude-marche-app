// FIDI ACM — extracteur LeBonCoin
// Stratégie : NEXT_DATA (Next.js) + JSON-LD + meta + fallback DOM.
(function () {
  'use strict';
  function n(v) { if (v == null) return null; var x = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')); return isFinite(x) ? x : null; }
  function meta(name) { var e = document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]'); return e ? (e.getAttribute('content') || '') : ''; }

  window.__fidiExtract = function () {
    var out = { source: 'leboncoin', url: location.href };

    // 1. NEXT_DATA : LBC est un Next.js, données JSON complètes disponibles
    try {
      var nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        var j = JSON.parse(nd.textContent);
        var ad = null;
        // Recherche récursive de l'objet annonce
        function find(o, depth) {
          if (!o || depth > 10) return;
          if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) find(o[i], depth + 1); return; }
          if (typeof o === 'object') {
            if (o.list_id && o.subject && o.price != null) { ad = o; return; }
            for (var k in o) if (o.hasOwnProperty(k)) find(o[k], depth + 1);
          }
        }
        find(j, 0);
        if (ad) {
          out.titre = ad.subject || '';
          out.description = (ad.body || '').slice(0, 800);
          out.prix = n(ad.price && (ad.price[0] || ad.price));
          out.ref = String(ad.list_id || '');
          if (ad.location) {
            out.commune = ad.location.city || '';
            out.cp = ad.location.zipcode || '';
          }
          if (ad.attributes) {
            ad.attributes.forEach(function (a) {
              var k = (a.key || '').toLowerCase(), v = a.value || a.value_label;
              if (k === 'square') out.surface = n(v);
              if (k === 'rooms') out.pieces = n(v);
              if (k === 'nb_rooms') out.pieces = out.pieces || n(v);
              if (k === 'bedrooms') out.chambres = n(v);
              if (k === 'land_plot_surface') out.surface_terrain = n(v);
              if (k === 'real_estate_type') out.type = v;
              if (k === 'energy_rate') out.dpe = String(v).toUpperCase();
              if (k === 'ges') out.ges = String(v).toUpperCase();
            });
          }
          if (ad.images && ad.images.urls && ad.images.urls.length) out.photo = ad.images.urls[0];
        }
      }
    } catch (_) {}

    // 2. Meta OG fallback
    if (!out.titre) out.titre = meta('og:title');
    if (!out.description) out.description = meta('og:description') || meta('description');
    if (!out.photo) out.photo = meta('og:image');

    // 3. Fallback DOM
    if (!out.prix) {
      var pe = document.querySelector('[data-qa-id="adview_price"] span, [data-qa-id="adview_price"]');
      if (pe) out.prix = n(pe.textContent);
    }
    if (!out.ref) {
      var m = location.pathname.match(/\/ad\/[^/]+\/(\d+)/);
      if (m) out.ref = m[1];
    }
    // Normalise type
    if (out.type) {
      out.type = /maison|villa/i.test(out.type) ? 'Maison'
        : /appartement/i.test(out.type) ? 'Appartement'
        : /terrain/i.test(out.type) ? 'Terrain'
        : /local|commerce|bureau/i.test(out.type) ? 'Local' : out.type;
    }

    return out;
  };
})();
