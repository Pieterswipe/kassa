// Gsm (≤700px): zwevende capsule onderaan, bevestigingskaartjes en de bon als lade van rechts.
// - Tik op de capsule of veeg naar links  -> lade open (dezelfde .bon, niets gedupliceerd).
// - Veeg naar rechts, tik op de waas, "Producten" of Escape -> lade dicht.
// - In de open lade: veeg een bonregel naar links -> die regel verwijderen.
// - "↶ laatste ongedaan" naast de capsule en "Ongedaan" op het kaartje -> toevoeging terugdraaien.
// Haakt in op voegToe en tekenBon uit kassa.js; de betaal- en scanlogica blijft ongemoeid.
// Boven 700px doet dit bestand niets zichtbaars (CSS verbergt capsule, waas en bevestigingen).
(function () {
  'use strict';

  const GSM = window.matchMedia('(max-width: 700px)');
  const DREMPEL = 70;      // minimale horizontale afstand (px) voor een veeg
  const VERHOUDING = 1.2;  // |dx| moet duidelijk groter zijn dan |dy|
  const BESLIS = 10;       // na zoveel px beslissen: horizontaal of verticaal

  const html = document.documentElement;
  const lade = document.getElementById('bon-lade');
  const capsule = document.getElementById('capsule');
  const waas = document.getElementById('lade-waas');
  const sluitKnop = document.getElementById('lade-sluit');
  const bevestigingen = document.getElementById('bevestigingen');
  const capN = document.getElementById('cap-n');
  const capLaatste = document.getElementById('cap-laatste');
  const capTotaal = document.getElementById('cap-totaal');
  const ongedaanKnop = document.getElementById('cap-ongedaan');
  const KAART_DUUR = 4500; // zo lang blijft een kaartje (met "Ongedaan") staan
  if (!lade || !capsule || !waas || typeof window.voegToe !== 'function' || typeof window.tekenBon !== 'function') return;

  // Naam van het laatst toegevoegde artikel (via voegToe)
  let laatsteNaam = null;

  function bonNu() {
    try { return Array.isArray(bon) ? bon : []; } catch (e) { return []; }
  }

  function geld(item) {
    return euro(Math.round(item.prijs * 100) * item.aantal);
  }

  // --- Capsule bijwerken ---
  function verversCapsule() {
    const lijst = bonNu();
    const aantal = lijst.reduce((som, i) => som + i.aantal, 0);
    // Laatste regel: het laatst getikte artikel, anders de laatste regel van de bon
    let laatste = laatsteNaam ? lijst.find(i => i.naam === laatsteNaam) : null;
    if (!laatste) {
      laatsteNaam = null;
      laatste = lijst.length ? lijst[lijst.length - 1] : null;
    }
    capN.textContent = String(aantal);
    capLaatste.replaceChildren();
    if (laatste) {
      const naam = document.createElement('span');
      naam.className = 'lt-naam';
      naam.textContent = laatste.naam;
      capLaatste.append(laatste.aantal + '× ', naam);
    } else {
      capLaatste.textContent = 'Nog niets op de bon';
    }
    capTotaal.textContent = euro(bonTotaalCents());
    capsule.setAttribute('aria-label', 'Bon openen: ' + aantal + (aantal === 1 ? ' artikel' : ' artikelen') +
      ', totaal ' + capTotaal.textContent);
    verversOngedaan();
  }

  // "↶ laatste ongedaan": enkel zichtbaar als er iets terug te draaien valt
  function verversOngedaan() {
    if (!ongedaanKnop) return;
    const kan = typeof window.heeftOngedaan === 'function' && window.heeftOngedaan();
    ongedaanKnop.hidden = !kan;
  }
  window.verversCapsule = verversCapsule;

  // --- Bevestigingskaartje boven de capsule ---
  // Altijd maar één kaartje: een nieuwe tik vervangt het vorige meteen (timers van het oude
  // kaartje worden geannuleerd), daarna vervaagt het na KAART_DUUR.
  let kaartTimers = [];

  function wisKaartje() {
    kaartTimers.forEach(clearTimeout);
    kaartTimers = [];
    if (bevestigingen) bevestigingen.replaceChildren();
  }

  function toonBevestiging(item, id) {
    if (!bevestigingen || !GSM.matches || isOpen()) return;
    wisKaartje();
    const kaart = document.createElement('div');
    kaart.className = 'bev';
    const plus = document.createElement('b');
    plus.textContent = '+1';
    const naam = document.createElement('span');
    naam.className = 'bev-naam';
    naam.textContent = item.naam;
    const n = document.createElement('span');
    n.className = 'bev-n';
    n.textContent = item.aantal + '×';
    const prijs = document.createElement('span');
    prijs.className = 'bev-prijs';
    prijs.textContent = geld(item);
    kaart.append(plus, naam, n, prijs);
    if (id != null && typeof window.laatsteOngedaan === 'function') {
      const terug = document.createElement('button');
      terug.type = 'button';
      terug.className = 'bev-ongedaan';
      terug.textContent = 'Ongedaan';
      terug.setAttribute('aria-label', item.naam + ' ongedaan maken');
      terug.addEventListener('click', () => {
        window.laatsteOngedaan(id);
        if (kaart.isConnected) wisKaartje();
      });
      kaart.append(terug);
    }
    bevestigingen.append(kaart);
    kaartTimers = [
      setTimeout(() => kaart.classList.add('weg'), KAART_DUUR),
      setTimeout(() => { kaart.remove(); kaartTimers = []; }, KAART_DUUR + 400)
    ];

    capsule.classList.remove('veer');
    void capsule.offsetWidth; // animatie opnieuw starten
    capsule.classList.add('veer');
  }

  // --- Inhaken op kassa.js (alle oproepen lopen via de globale namen) ---
  const origVoegToe = window.voegToe;
  window.voegToe = function (naam) {
    laatsteNaam = naam;
    const r = origVoegToe.apply(this, arguments);
    const item = bonNu().find(i => i.naam === naam);
    if (item) toonBevestiging(item, r);
    return r;
  };

  const origTekenBon = window.tekenBon;
  window.tekenBon = function () {
    const r = origTekenBon.apply(this, arguments);
    verversCapsule();
    return r;
  };

  // --- Lade open/dicht ---
  function isOpen() {
    return html.classList.contains('lade-open');
  }

  function openLade() {
    if (!GSM.matches || isOpen()) return;
    html.classList.add('lade-open');
    capsule.setAttribute('aria-expanded', 'true');
    wisKaartje();
    if (sluitKnop) sluitKnop.focus({ preventScroll: true });
  }

  function sluitLade() {
    if (!isOpen()) return;
    const focusInLade = lade.contains(document.activeElement);
    html.classList.remove('lade-open');
    capsule.setAttribute('aria-expanded', 'false');
    if (focusInLade && GSM.matches) capsule.focus({ preventScroll: true });
  }

  window.openBonLade = openLade;
  window.sluitBonLade = sluitLade;

  capsule.addEventListener('click', openLade);
  if (ongedaanKnop) {
    ongedaanKnop.addEventListener('click', () => {
      if (typeof window.laatsteOngedaan === 'function') window.laatsteOngedaan();
    });
  }
  waas.addEventListener('click', sluitLade);
  if (sluitKnop) sluitKnop.addEventListener('click', sluitLade);

  // Is er een betaal- of scanscherm open?
  function overlayOpen() {
    return !!document.querySelector('.sd-overlay:not(.verborgen)');
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen() && !overlayOpen()) sluitLade();
  });

  // --- Veeggebaren (enkel op de gsm) ---
  // Start: op de kaart (.producten) of de capsule -> veeg links opent;
  //        op de open lade of de waas -> veeg rechts sluit;
  //        op een bonregel in de open lade (niet op −/+/×) -> veeg links verwijdert die regel.
  // De tabrij (.zijbalk) doet niet mee: die scrolt zelf horizontaal.
  let veeg = null;
  let negeerKlikTot = 0;

  function magStarten(doel) {
    if (!(doel instanceof Element)) return false;
    if (overlayOpen()) return false;
    if (doel.closest('input, textarea, select, video, [contenteditable], .sd-overlay, .zijbalk')) return false;
    if (isOpen()) return !!doel.closest('#bon-lade, #lade-waas');
    return !!doel.closest('.producten, #capsule');
  }

  function bijStart(e) {
    if (e.touches.length !== 1 || !magStarten(e.target)) { veeg = null; return; }
    const t = e.touches[0];
    // Regel om te wissen: enkel in de open lade en niet gestart op een regelknop
    const regel = isOpen() && !e.target.closest('button') ? e.target.closest('#bon-lijst li') : null;
    veeg = { x: t.clientX, y: t.clientY, richting: null, regel: regel };
  }

  function bijBeweging(e) {
    if (!veeg) return;
    if (e.touches.length !== 1) { veeg = null; return; }
    const t = e.touches[0];
    const dx = t.clientX - veeg.x, dy = t.clientY - veeg.y;
    if (!veeg.richting && (Math.abs(dx) > BESLIS || Math.abs(dy) > BESLIS)) {
      // Overwegend verticaal: geen veeg, de lijst scrolt gewoon
      if (Math.abs(dy) >= Math.abs(dx)) { veeg = null; return; }
      veeg.richting = 'h';
    }
  }

  function bijEinde(e) {
    if (!veeg) return;
    const start = veeg;
    veeg = null;
    if (start.richting !== 'h' || overlayOpen()) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) < DREMPEL || Math.abs(dx) < VERHOUDING * Math.abs(dy)) return;
    if (dx < 0 && !isOpen()) {
      openLade();
      negeerKlikTot = Date.now() + 450;
    } else if (dx < 0 && start.regel && start.regel.isConnected && typeof window.verwijderRegel === 'function') {
      // Regels staan in dezelfde volgorde als `bon` (tekenBon), dus positie = index
      window.verwijderRegel(Array.prototype.indexOf.call(start.regel.parentNode.children, start.regel));
      negeerKlikTot = Date.now() + 450;
    } else if (dx > 0 && isOpen()) {
      sluitLade();
      negeerKlikTot = Date.now() + 450;
    }
  }

  function bijAnnuleer() { veeg = null; }

  // Na een geslaagde veeg geen "tik" laten doorgaan (bv. op een productknop of de capsule)
  function slikKlik(e) {
    if (Date.now() < negeerKlikTot) {
      negeerKlikTot = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const passief = { passive: true };
  let actief = false;

  function zetVeegActief(aan) {
    if (aan === actief) return;
    actief = aan;
    const m = aan ? 'addEventListener' : 'removeEventListener';
    document[m]('touchstart', bijStart, passief);
    document[m]('touchmove', bijBeweging, passief);
    document[m]('touchend', bijEinde, passief);
    document[m]('touchcancel', bijAnnuleer, passief);
    document[m]('click', slikKlik, true);
    if (!aan) veeg = null;
  }

  function bijBreedte() {
    zetVeegActief(GSM.matches);
    // Naar tablet/desktop: lade dicht, de gewone bon staat weer rechts
    if (!GSM.matches) {
      sluitLade();
      wisKaartje();
    }
  }

  if (GSM.addEventListener) GSM.addEventListener('change', bijBreedte);
  else if (GSM.addListener) GSM.addListener(bijBreedte);

  bijBreedte();
  verversCapsule();
})();
