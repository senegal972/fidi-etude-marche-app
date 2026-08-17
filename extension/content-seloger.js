// FIDI ACM — extracteur SeLoger (v1.1.0)
// SeLoger a plusieurs schémas d'URL et un rendu SPA sur certaines routes.
// Stratégie : JSON-LD (le plus fiable, ré-hydraté sur nav) → NEXT_DATA →
// OpenGraph → fallback DOM regex. Cross-check ID URL vs ID trouvé.
(function () {
  'use strict';
  function n(v) { if (v == null) return null; var x = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')); return isFinite(x) ? x : null; }
  function meta(name) { var e = document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]'); return e ? (e.getAttribute('content') || '') : ''; }
  function txt(sel) { var e = document.querySelector(sel); return e ? e.textContent.trim() : ''; }

  function urlRefId() {
    // /detail/annonce/achat/appartement/{ville}/{id-numérique}
    // /annonces/achat/{...}/{id-numérique}
    var m = location.pathname.match(/(\d{7,})/g);
    return m ? m[m.length - 1] : ''; // dernier nombre long
  }

  // Vérifie que le doc courant correspond à l'URL (évite le JSON-LD stale
  // d'une précédente fiche non purgée sur navigation SPA)
  function pageMatchesUrl() {
    var idUrl = urlRefId();
    if (!idUrl) return true;
    var body = document.body ? document.body.textContent : '';
    return body.indexOf(idUrl) >= 0;
  }

  window.__fidiExtract = function () {
    var nature = (window.__fidiDetectNature && window.__fidiDetectNature()) || 'vente';
    var out = { source: 'seloger', url: location.href, nature: nature };
    var fresh = pageMatchesUrl();

    // 1. JSON-LD
    if (fresh) {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        try {
          var j = JSON.parse(scripts[i].textContent);
          var arr = Array.isArray(j) ? j : [j];
          for (var k = 0; k < arr.length; k++) {
            var d = arr[k];
            var t = d['@type'] || '';
            if (t === 'Product' || t === 'Residence' || t === 'Offer' ||
                t === 'RealEstateListing' || (t + '').indexOf('Estate') >= 0 ||
                d.offers || d.price) {
              out.titre = out.titre || d.name || '';
              out.description = out.description || d.description || '';
              var offers = d.offers || d.priceSpecification;
              if (offers) {
                var off = Array.isArray(offers) ? offers[0] : offers;
                out.prix = out.prix || n(off.price || (off.priceSpecification && off.priceSpecification.price) || d.price);
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
    }

    // 2. NEXT_DATA (certaines pages SeLoger)
    if (fresh && (!out.prix || !out.surface)) {
      try {
        var nd = document.getElementById('__NEXT_DATA__');
        if (nd) {
          var raw = nd.textContent;
          var idUrl = urlRefId();
          if (!idUrl || raw.indexOf(idUrl) >= 0) {
            // Regex simple sur la donnée sérialisée
            if (!out.prix) { var mp = raw.match(/"price"\s*:\s*(\d+)/); if (mp) out.prix = n(mp[1]); }
            if (!out.surface) { var ms = raw.match(/"livingArea"\s*:\s*(\d+)/); if (ms) out.surface = n(ms[1]); }
            if (!out.pieces) { var mpi = raw.match(/"rooms"\s*:\s*(\d+)/); if (mpi) out.pieces = n(mpi[1]); }
            if (!out.chambres) { var mc = raw.match(/"bedrooms"\s*:\s*(\d+)/); if (mc) out.chambres = n(mc[1]); }
            if (!out.commune) { var mv = raw.match(/"city"\s*:\s*"([^"]+)"/); if (mv) out.commune = mv[1]; }
            if (!out.cp) { var mz = raw.match(/"zipCode"\s*:\s*"?(\d{5})"?/); if (mz) out.cp = mz[1]; }
          }
        }
      } catch (_) {}
    }

    // 3. OpenGraph
    if (!out.titre) out.titre = meta('og:title');
    if (!out.description) out.description = meta('og:description') || meta('description');
    if (!out.photo) out.photo = meta('og:image');

    // 4. Fallback DOM textuel — utilise le TEXTE VISIBLE de la page courante
    var bodyText = document.body ? (document.body.innerText || '') : '';
    if (!out.prix) {
      var priceEl = document.querySelector('[data-testid="price"], [class*="rice"] [class*="alue"], [class*="etailPrice"], span[class*="Price"]');
      if (priceEl) out.prix = n(priceEl.textContent);
      if (!out.prix) {
        var mp2 = bodyText.match(/(\d[\d\s]{2,})\s*€/);
        if (mp2) out.prix = n(mp2[1]);
      }
    }
    if (!out.pieces) { var mpi2 = bodyText.match(/(\d+)\s*pi[eè]ces?/i); if (mpi2) out.pieces = n(mpi2[1]); }
    if (!out.surface) { var ms2 = bodyText.match(/(\d+[.,]?\d*)\s*m[²2]/); if (ms2) out.surface = n(ms2[1]); }
    if (!out.chambres) { var mc2 = bodyText.match(/(\d+)\s*chambres?/i); if (mc2) out.chambres = n(mc2[1]); }

    // Location : le prix = loyer mensuel → bascule dans out.loyer
    if (out.nature === 'location' && out.prix) {
      out.loyer = out.prix;
      out.prix = null;
      var bT = document.body ? document.body.innerText || '' : '';
      var mch = bT.match(/charges\s*(?:comprises?|incluses?|\(cc\))?[^\d]{0,10}(\d+)\s*€/i);
      if (mch) out.charges = n(mch[1]);
    }

    // Référence annonce depuis URL
    out.ref = urlRefId();

    // Type depuis titre
    if (out.titre) {
      out.type = /maison|villa/i.test(out.titre) ? 'Maison'
        : /appartement|studio|t\d/i.test(out.titre) ? 'Appartement'
        : /terrain/i.test(out.titre) ? 'Terrain'
        : /local|commerce|bureau/i.test(out.titre) ? 'Local' : '';
    }

    return out;
  };
})();
