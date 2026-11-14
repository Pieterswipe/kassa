// Gedeelde prijshulpjes voor de kassaknoppen (kassa.js) en de bonscanner (bonscan.js).
// Eén plek voor naam-normalisatie, prijs parsen en de onthouden prijzen in localStorage,
// zodat knoppen en scanner nooit uit elkaar lopen.
// Laadt vóór kassa.js; kassa.js en bonscan.js lezen window.KassaPrijzen pas bij gebruik.
(function (global) {
  'use strict';

  const PRIJZEN_SLEUTEL = 'kassa.bonscan.prijzen';

  // Hoofdletters en spaties gelijk trekken: "  Leffe   BLOND " -> "leffe blond"
  function normNaam(naam) {
    return String(naam == null ? '' : naam).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // "2,50" / "2.5" / "€ 2,50" -> 250 (centen). Ongeldig, 0 of negatief -> null.
  function prijsNaarCent(tekst) {
    const t = String(tekst == null ? '' : tekst).replace(/€/g, '').replace(/\s+/g, '');
    if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
    const cent = Math.round(parseFloat(t.replace(',', '.')) * 100);
    return cent > 0 ? cent : null;
  }

  // Onthouden prijzen: { "genormaliseerde naam": centen }
  function leesGeleerd() {
    try { return JSON.parse(global.localStorage.getItem(PRIJZEN_SLEUTEL)) || {}; } catch (e) { return {}; }
  }

  function bewaarGeleerd(nieuw) {
    if (!nieuw || !Object.keys(nieuw).length) return;
    try {
      global.localStorage.setItem(PRIJZEN_SLEUTEL, JSON.stringify(Object.assign(leesGeleerd(), nieuw)));
    } catch (e) {}
  }

  // Onthouden prijs (centen) voor één naam, of null.
  function geleerdePrijs(naam, geleerd) {
    const cent = (geleerd || leesGeleerd())[normNaam(naam)];
    return Number.isInteger(cent) && cent > 0 ? cent : null;
  }

  const api = { PRIJZEN_SLEUTEL, normNaam, prijsNaarCent, leesGeleerd, bewaarGeleerd, geleerdePrijs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.KassaPrijzen = api;
})(typeof window === 'undefined' ? globalThis : window);
