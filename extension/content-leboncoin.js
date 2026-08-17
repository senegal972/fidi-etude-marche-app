// FIDI ACM — extracteur LeBonCoin (v1.1.0)
// LBC est SPA Next.js : sur navigation entre fiches, __NEXT_DATA__ n'est pas
// toujours re-hydraté. On cross-checke l'ID URL vs list_id du NEXT_DATA :
// si mismatch → NEXT_DATA stale → on force le fallback DOM sur la page visible.
(function () {
  'use strict';
  function n(v) { if (v == null) return null; var x = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')); return isFinite(x) ? x : null; }
  function meta(name) { var e = document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]'); return e ? (e.getAttribute('content') || '') : ''; }
  function txt(sel) { var e = document.querySelector(sel); return e ? e.textContent.trim() : ''; }

  function urlListId() {
    // /ad/ventes_immobilieres/xxx/1234567890 ou /ad/foo/1234567890
    var m = location.pathname.match(/\/(\d{7,})(?:$|\/|\?)/);
    return m ? m[1] : '';
  }

  function extractFromNextData(expectedId) {
    try {
      var nd = document.getElementById('__NEXT_DATA__');
      if (!nd) return null;
      var j = JSON.parse(nd.textContent);
      var ad = null;
      function find(o, depth) {
        if (!o || depth > 12) return;
        if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) find(o[i], depth + 1); return; }
        if (typeof o === 'object') {
          if (o.list_id && o.subject && o.price != null) {
            // Si expectedId fourni, on veut CE list_id précis
            if (!expectedId || String(o.list_id) === String(expectedId)) { ad = o; return; }
          }
          for (var k in o) if (o.hasOwnProperty(k)) { find(o[k], depth + 1); if (ad) return; }
        }
      }
      find(j, 0);
      return ad;
    } catch (e) { return null; }
  }

  function extractFromDom() {
    var out = {};
    out.titre = meta('og:title') || txt('h1, [data-qa-id="adview_title"]');
    out.description = meta('og:description') || meta('description');
    out.photo = meta('og:image');

    // Prix : plusieurs sélecteurs possibles
    var priceEl = document.querySelector('[data-qa-id="adview_price"] span, [data-qa-id="adview_price"], span[class*="price"]');
    if (priceEl) out.prix = n(priceEl.textContent);
    if (!out.prix) {
      // Fallback : cherche pattern "123 456 €" sur la page visible
      var bodyTxt = document.body ? (document.body.innerText || '') : '';
      var mp = bodyTxt.match(/(\d[\d\s]{2,})\s*€/);
      if (mp) out.prix = n(mp[1]);
    }

    // Attributs (surface, pièces, chambres, DPE) : on cherche par label proche
    var attrs = document.querySelectorAll('[data-qa-id="criteria_item"], [class*="Criteria"] li, [class*="attribute"] li');
    attrs.forEach(function (el) {
      var t = (el.textContent || '').toLowerCase();
      if (!out.surface && /surface|m²/.test(t)) { var m = t.match(/(\d+[.,]?\d*)\s*m²/); if (m) out.surface = n(m[1]); }
      if (!out.pieces && /pi[eè]ce/.test(t)) { var m2 = t.match(/(\d+)\s*pi[eè]ce/); if (m2) out.pieces = n(m2[1]); }
      if (!out.chambres && /chambre/.test(t)) { var m3 = t.match(/(\d+)\s*chambre/); if (m3) out.chambres = n(m3[1]); }
      if (!out.dpe && /dpe|classe/.test(t)) { var m4 = t.match(/\b([A-G])\b/); if (m4) out.dpe = m4[1]; }
    });
    // Filet de sécurité : parse texte brut de la page si toujours vide
    if (!out.surface || !out.pieces) {
      var body = document.body ? (document.body.innerText || '') : '';
      if (!out.surface) { var ms = body.match(/(\d+[.,]?\d*)\s*m²/); if (ms) out.surface = n(ms[1]); }
      if (!out.pieces) { var mpi = body.match(/(\d+)\s*pi[eè]ces?/i); if (mpi) out.pieces = n(mpi[1]); }
    }
    return out;
  }

  window.__fidiExtract = function () {
    var nature = (window.__fidiDetectNature && window.__fidiDetectNature()) || 'vente';
    var out = { source: 'leboncoin', url: location.href, nature: nature };
    out.ref = urlListId();

    // 1. Essaie NEXT_DATA avec ID URL comme filtre (évite le stale)
    var ad = extractFromNextData(out.ref);

    // 2. Si NEXT_DATA n'a pas l'ID courant → on ignore et on prend le DOM
    if (ad) {
      out.titre = ad.subject || '';
      out.description = (ad.body || '').slice(0, 800);
      out.prix = n(ad.price && (Array.isArray(ad.price) ? ad.price[0] : ad.price));
      if (!out.ref) out.ref = String(ad.list_id || '');
      if (ad.location) {
        out.commune = ad.location.city || '';
        out.cp = ad.location.zipcode || '';
      }
      if (ad.attributes) {
        ad.attributes.forEach(function (a) {
          var k = (a.key || '').toLowerCase(), v = a.value || a.value_label;
          if (k === 'square') out.surface = n(v);
          if (k === 'rooms' || k === 'nb_rooms') out.pieces = out.pieces || n(v);
          if (k === 'bedrooms') out.chambres = n(v);
          if (k === 'land_plot_surface') out.surface_terrain = n(v);
          if (k === 'real_estate_type') out.type = v;
          if (k === 'energy_rate') out.dpe = String(v).toUpperCase();
          if (k === 'ges') out.ges = String(v).toUpperCase();
        });
      }
      if (ad.images && ad.images.urls && ad.images.urls.length) out.photo = ad.images.urls[0];
    } else {
      // Fallback DOM systématique
      var dom = extractFromDom();
      Object.keys(dom).forEach(function (k) { if (dom[k] != null && dom[k] !== '') out[k] = dom[k]; });
    }

    // Compléments manquants depuis meta
    if (!out.titre) out.titre = meta('og:title');
    if (!out.description) out.description = meta('og:description') || meta('description');
    if (!out.photo) out.photo = meta('og:image');

    // Location : le prix extrait = loyer mensuel → bascule dans out.loyer
    if (out.nature === 'location' && out.prix) {
      out.loyer = out.prix;
      out.prix = null;
      // Charges depuis attributs LBC (charges_included / charges)
      var body = document.body ? document.body.innerText || '' : '';
      var mch = body.match(/charges\s*(?:comprises?|incluses?|\(cc\))?[^\d]{0,10}(\d+)\s*€/i);
      if (mch) out.charges = n(mch[1]);
    }

    // Normalise type
    if (out.type) {
      out.type = /maison|villa/i.test(out.type) ? 'Maison'
        : /appartement/i.test(out.type) ? 'Appartement'
        : /terrain/i.test(out.type) ? 'Terrain'
        : /local|commerce|bureau/i.test(out.type) ? 'Local' : out.type;
    } else if (out.titre) {
      out.type = /maison|villa/i.test(out.titre) ? 'Maison'
        : /appartement|studio|t\d/i.test(out.titre) ? 'Appartement'
        : /terrain/i.test(out.titre) ? 'Terrain' : '';
    }

    return out;
  };
})();
