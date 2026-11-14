// Bestelcode: de bestelling van de klanten-bestelapp (bestel/) als korte QR-tekst.
// Gedeeld door de kiosk (maakt de QR) en de kassa (bestelscan.js leest de QR).
//
// Formaat:  KB1:<id>*<aantal>,<id>*<aantal>,...
//   bv.     KB1:01*2,13*1,X01*3
// - id: product-id uit producten.js; het voorvoegsel 'K50-' valt weg ('K50-01' -> '01').
// - aantal: geheel getal 1..99.
// Lezen is vergevingsgezind: spaties, hoofdletters, 'K50-'-voorvoegsel en dubbele ids
// (opgeteld, max 99) mogen. Onleesbare stukken worden overgeslagen en geteld.
(function (global) {
  'use strict';

  const VOORVOEGSEL = 'KB1:';
  const MAX_AANTAL = 99;

  // 'K50-01' -> '01', 'k50-7' -> '07', ' x01 ' -> 'X01'. Ongeldig -> ''.
  function kortId(id) {
    let t = String(id == null ? '' : id).replace(/\s+/g, '').toUpperCase().replace(/^K50-/, '');
    if (/^\d$/.test(t)) t = '0' + t;
    return /^[A-Z0-9]{1,8}$/.test(t) ? t : '';
  }

  // Zoekt het product voor een (korte of volledige) id, of null.
  function zoekProduct(id, producten) {
    const k = kortId(id);
    return (k && (producten || []).find(p => kortId(p.id) === k)) || null;
  }

  // [{ id, aantal }] -> 'KB1:01*2,X01*3'. Aantallen 0 of ongeldig vallen weg, dubbele ids opgeteld.
  function encodeBestelling(items) {
    return VOORVOEGSEL + voegSamen(items).map(i => i.id + '*' + i.aantal).join(',');
  }

  function voegSamen(items) {
    const uit = [];
    for (const item of items || []) {
      const id = kortId(item && item.id);
      const aantal = Number(item && item.aantal);
      if (!id || !Number.isInteger(aantal) || aantal < 1) continue;
      const bestaand = uit.find(i => i.id === id);
      if (bestaand) bestaand.aantal = Math.min(MAX_AANTAL, bestaand.aantal + aantal);
      else uit.push({ id, aantal: Math.min(MAX_AANTAL, aantal) });
    }
    return uit;
  }

  // 'KB1:...' -> { items: [{ id, aantal }], ongeldig: n }, of null als het geen bestelcode is.
  function leesBestelling(tekst) {
    const t = String(tekst == null ? '' : tekst).trim();
    if (t.slice(0, VOORVOEGSEL.length).toUpperCase() !== VOORVOEGSEL) return null;
    const ruw = [];
    let ongeldig = 0;
    for (const stuk of t.slice(VOORVOEGSEL.length).split(/[,;\n]/)) {
      const s = stuk.replace(/\s+/g, '');
      if (!s) continue;
      const m = /^([^*]+)\*(\d{1,3})$/.exec(s);
      const id = m ? kortId(m[1]) : '';
      const aantal = m ? Number(m[2]) : 0;
      if (!id || aantal < 1 || aantal > MAX_AANTAL) { ongeldig++; continue; }
      ruw.push({ id, aantal });
    }
    return { items: voegSamen(ruw), ongeldig };
  }

  // 'KB1:...' -> [{ id, aantal }], of null als het geen bestelcode is.
  function decodeBestelling(tekst) {
    const r = leesBestelling(tekst);
    return r ? r.items : null;
  }

  const api = { VOORVOEGSEL, MAX_AANTAL, kortId, zoekProduct, encodeBestelling, leesBestelling, decodeBestelling };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Bestelcode = api;
})(typeof window === 'undefined' ? globalThis : window);
