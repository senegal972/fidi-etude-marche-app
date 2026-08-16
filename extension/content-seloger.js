// FIDI ACM — extracteur SeLoger
// Stratégie : JSON-LD (RealEstateListing) puis meta OpenGraph, fallback DOM.
(function () {
  'use strict';
  function n(v) { if (v == null) return null; var x = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')); return isFinite(x) ? x : null; }
  function txt(sel) { var e = document.querySelector(sel); return e ? e.textContent.trim() : ''; }
  function meta(name) { var e = document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]'); return e ? (e.getAttribute('content') || '') : ''; }

  window.__fidiExtract = function () {
    var out = { source: 'seloger', url: location.href };

    // 1. JSON-LD (le plus fiable)
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var j = JSON.parse(scripts[i].textContent);
        var arr = Array.isArray(j) ? j : [j];
        for (var k = 0; k < arr.length; k++) {
          var d = arr[k];
          if (d['@type'] === 'Product' || d['@type'] === 'Residence' || d['@type'] === 'Offer' || d['@type'] === 'RealEstateListing' || (d['@type'] || '').indexOf('Estate') >= 0) {
            out.titre = out.titre || d.name || '';
            out.description = out.description || d.description || '';
            var offers = d.offers || d.priceSpecification;
            if (offers) {
              var off = Array.isArray(offers) ? offers[0] : offers;
              out.prix = out.prix || n(off.price || off.priceSpecification && off.priceSpecification.price);
            }
            if (d.floorSize) out.surface = out.surface || n(d.floorSize.value || d.floorSize);
            if (d.numberOfRooms) out.pieces = out.pieces || n(d.numberOfRooms);
            if (d.numberOfBedrooms) out.chambres = out.chambres || n(d.numberOfBedrooms);
            if (d.address) {
              var a = d.address;
              out.commune = out.commune || (a.addressLocality || '');
              out.cp = out.cp || (a.postalCode || '');
              out.adresse = out.adresse || (a.streetAddress || '');
            }
            if (d.image) out.photo = out.photo || (Array.isArray(d.image) ? d.image[0] : d.image);
          }
        }
      } catch (_) {}
    }

    // 2. OpenGraph / meta
    if (!out.titre) out.titre = meta('og:title');
    if (!out.description) out.description = meta('og:description') || meta('description');
    if (!out.photo) out.photo = meta('og:image');

    // 3. Fallback DOM (sélecteurs actuels — à ajuster si SeLoger change)
    if (!out.prix) {
      var p = txt('[data-testid="price"], .Summarystyled__PriceText, .detail-price, [class*="rice"] [class*="alue"]');
      out.prix = n(p);
    }
    if (!out.surface || !out.pieces) {
      // Cherche "3 pièces · 75 m²" dans divers conteneurs
      var caract = document.body.textContent || '';
      if (!out.pieces) { var mp = caract.match(/(\d+)\s*pi[eè]ces?/i); if (mp) out.pieces = n(mp[1]); }
      if (!out.surface) { var ms = caract.match(/(\d+[.,]?\d*)\s*m[²2]/i); if (ms) out.surface = n(ms[1]); }
    }
    if (!out.commune) {
      // Segment URL /annonces/achat/appartement/fort-de-france-972/
      var seg = location.pathname.split('/').filter(Boolean);
      var city = seg.find(function (s) { return /-\d{3}$/.test(s) || /^[a-z-]{4,}$/i.test(s); });
      if (city) out.commune = city.replace(/-\d+$/, '').replace(/-/g, ' ');
    }

    // Réf annonce depuis URL SeLoger
    var m = location.href.match(/(\d{8,})/);
    if (m) out.ref = m[1];

    out.type = out.titre && /maison|villa/i.test(out.titre) ? 'Maison' : (out.titre && /appartement|studio|t\d/i.test(out.titre) ? 'Appartement' : (out.titre && /terrain/i.test(out.titre) ? 'Terrain' : ''));

    return out;
  };
})();
