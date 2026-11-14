// Bonscanner in de kassa: papieren vierzonebon (Z50) scannen en de artikelen op de bon zetten.
//
// Werking in het kort:
// - De beeldherkenning zit in bonscanner/ (kopie van Pieterswipe/bon-scanner, volledig in de browser).
// - "Scan bon" opent de camera (createLiveBonScanner). Na herkenning volgt een controlescherm.
// - Bonartikelen worden op naam gekoppeld aan de kassaproducten uit producten.js
//   (vaste prijs, of prijs null = prijs wordt gevraagd).
//   Alle 50 bonartikelen zijn een kassaproduct. Extra koppelingen: vul ALIASSEN hieronder aan.
//   Ontbreekt de prijs, dan vraagt het controlescherm ze ("Prijs nodig"); die prijs wordt
//   onthouden in localStorage (prijzen.js) en geldt daarna ook voor de knop.
// - "Op de bon zetten" telt alles bij de huidige `bon` op (zoals voegToe) en roept tekenBon() aan.
// - Hetzelfde controlescherm dient ook voor "Scan bestelling" (bestelscan.js): window.toonBestelControle.
//
// De pure functies onderaan "Pure functies" worden getest met: node tests/bonscan.cjs
(function () {
  'use strict';

  // Bonnaam -> kassanaam, voor artikelen die anders heten. Sleutels hoofdletterongevoelig.
  // Voorbeeld: 'jupiler 0.0': 'Jupiler'
  const ALIASSEN = {};

  const MAX_AANTAL = 999;

  // Gedeelde prijshulpjes (prijzen.js). Pas bij gebruik opgehaald, zodat de laadvolgorde niet uitmaakt.
  function P() {
    return typeof module !== 'undefined' && module.exports ? require('./prijzen.js') : window.KassaPrijzen;
  }
  function B() { // bestelcode.js
    return typeof module !== 'undefined' && module.exports ? require('./bestelcode.js') : window.Bestelcode;
  }

  // ---------------------------------------------------------------------------
  // Pure functies (geen DOM)
  // ---------------------------------------------------------------------------

  const normNaam = naam => P().normNaam(naam);
  const prijsNaarCent = tekst => P().prijsNaarCent(tekst);

  // Zoekt het kassaproduct voor een bonnaam (eerst alias, dan rechtstreeks op naam).
  function zoekKassaProduct(bonNaam, producten, aliassen) {
    const tabel = {};
    Object.keys(aliassen || {}).forEach(k => { tabel[normNaam(k)] = aliassen[k]; });
    const n = normNaam(bonNaam);
    const kandidaten = tabel[n] ? [normNaam(tabel[n]), n] : [n];
    for (const doel of kandidaten) {
      const p = (producten || []).find(p => normNaam(p.naam) === doel);
      if (p) return p;
    }
    return null;
  }

  // Koppeling van één bonartikel:
  // - 'kassa'       kassaknop; vaste prijs van de knop wint, anders de onthouden prijs
  // - 'prijs-nodig' kassaknop zonder vaste of onthouden prijs (cent null)
  // - 'geleerd'     geen kassaknop, wel een eerder ingegeven prijs
  // - 'onbekend'    geen kassaknop en geen prijs (cent null)
  function koppel(bonNaam, producten, geleerd, aliassen) {
    const g = geleerd || {};
    const p = zoekKassaProduct(bonNaam, producten, aliassen);
    if (p) {
      if (p.prijs != null) return { soort: 'kassa', naam: p.naam, cent: Math.round(p.prijs * 100) };
      const cent = P().geleerdePrijs(p.naam, g);
      return cent ? { soort: 'kassa', naam: p.naam, cent: cent } : { soort: 'prijs-nodig', naam: p.naam, cent: null };
    }
    const cent = P().geleerdePrijs(bonNaam, g);
    if (cent) return { soort: 'geleerd', naam: bonNaam, cent: cent };
    return { soort: 'onbekend', naam: bonNaam, cent: null };
  }

  // Rijen uit het scanresultaat die getoond moeten worden: aantal > 0 of onzeker (null).
  function regelsUitResultaat(result, productNamen) {
    const redenen = { unseen: 'Nog niet gelezen.', unreadable: 'Vakjes onleesbaar.', unstable: 'Aantal nog niet bevestigd.' };
    const uit = [];
    (result.rows || []).forEach((row, index) => {
      if (!row) return;
      const onzeker = row.quantity === null;
      if (!onzeker && !(row.quantity > 0)) return;
      const ink = row.inkCandidates || row.candidates || [];
      uit.push({
        index: index,
        bonNaam: productNamen[index],
        aantal: onzeker ? 0 : row.quantity,
        onzeker: onzeker,
        ink: onzeker ? ink.slice() : [],
        reden: onzeker ? (ink.length ? 'Lijkt aangeduid bij ' + ink.join(' of ') + '.' : redenen[row.manualReason] || 'Vergelijk met de papieren bon.') : '',
        manualReason: row.manualReason || '',
        crop: row.reviewCrop || ''
      });
    });
    return uit;
  }

  // Regels voor het controlescherm uit een gescande bestelling (bestelcode.js: [{ id, aantal }]).
  // Onbekende id -> "Onbekend artikel (id)" met prijsveld/Overslaan; die prijs wordt niet onthouden.
  function regelsUitBestelling(items, producten, geleerd) {
    const uit = [];
    (items || []).forEach((item, index) => {
      const aantal = Number(item && item.aantal);
      if (!Number.isInteger(aantal) || aantal < 1) return;
      const p = B().zoekProduct(item.id, producten);
      const koppeling = p ? koppel(p.naam, producten, geleerd, {})
        : { soort: 'onbekend', naam: 'Onbekend artikel (' + item.id + ')', cent: null, nietOnthouden: true };
      uit.push({ index, bonNaam: koppeling.naam, aantal, onzeker: false, ink: [], reden: '', manualReason: '',
        crop: '', koppeling, invoer: { tekst: '', overslaan: false } });
    });
    return uit;
  }

  // Onzekere rij zonder inkt die nooit gelezen werd (mag in één keer op "Geen").
  function isOngelezen(regel) {
    return regel.onzeker && regel.manualReason === 'unseen' && !regel.ink.length;
  }

  // Verzamelt wat op de bon moet. regel: { bonNaam, aantal, onzeker, koppeling, invoer: { tekst, overslaan } }
  function verzamel(regels) {
    const uit = [];
    const nieuwePrijzen = {};
    let vragen = 0, zonderPrijs = 0;
    for (const r of regels) {
      if (r.onzeker) { vragen++; continue; }
      if (!(r.aantal > 0)) continue;
      const invoer = r.invoer || {};
      if (invoer.overslaan) continue;
      let cent = r.koppeling.cent;
      if (cent == null) {
        cent = prijsNaarCent(invoer.tekst);
        if (cent == null) { zonderPrijs++; continue; }
        // kassanaam: dan geldt de prijs ook voor de knop (niet voor onbekende bestel-ids)
        if (!r.koppeling.nietOnthouden) nieuwePrijzen[normNaam(r.koppeling.naam)] = cent;
      }
      uit.push({ naam: r.koppeling.naam, prijs: cent / 100, aantal: r.aantal });
    }
    return { klaar: vragen === 0 && zonderPrijs === 0 && uit.length > 0, uit, nieuwePrijzen, vragen, zonderPrijs };
  }

  // Zelfde logica als voegToe in kassa.js: bestaand item (zelfde naam) -> aantal optellen.
  function voegRegelsToe(lijst, regels) {
    for (const r of regels) {
      const bestaand = lijst.find(item => item.naam === r.naam);
      if (bestaand) bestaand.aantal += r.aantal;
      else lijst.push({ naam: r.naam, prijs: r.prijs, aantal: r.aantal });
    }
    return lijst;
  }

  const pure = { ALIASSEN, normNaam, zoekKassaProduct, prijsNaarCent, koppel,
    regelsUitResultaat, regelsUitBestelling, isOngelezen, verzamel, voegRegelsToe };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = pure;
    return;
  }
  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------------------------
  // Scherm (alleen in de browser)
  // ---------------------------------------------------------------------------

  const $ = id => document.getElementById(id);
  const ZONES = [['TL', 'Linksboven'], ['TR', 'Rechtsboven'], ['BL', 'Linksonder'], ['BR', 'Rechtsonder']];

  let live = null;      // createLiveBonScanner-instantie (lui aangemaakt)
  let kijken = false;   // camera loopt en wacht op een bon
  let regels = [];      // regels van het controlescherm
  let bron = 'bon';     // 'bon' of 'bestelling': bepaalt wat "Scan opnieuw" doet

  // Kassaproducten uit producten.js.
  function leesKassaProducten() {
    return window.KASSA_PRODUCTEN || [];
  }

  function prijsTekst(cent) {
    return typeof euro === 'function' ? euro(cent) : '€' + (cent / 100).toFixed(2).replace('.', ',');
  }

  function scannerBeschikbaar() {
    return typeof window.createLiveBonScanner === 'function' && typeof window.scanForm === 'function' && !!window.ZoneBonForm;
  }

  // De Swipedrinks-scanner of een betaalscherm mag niet tegelijk open zijn.
  function anderSchermOpen() {
    const open = id => { const e = $(id); return e && !e.classList.contains('verborgen'); };
    const sdCamera = typeof sdScanner !== 'undefined' && sdScanner; // swipedrinks.js
    return open('sd-overlay') || open('bet-overlay') || open('kb-overlay') || !!sdCamera;
  }

  function maak(tag, klasse, tekst) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  function toon(id, aan) { $(id).classList.toggle('verborgen', !aan); }

  function toonStap(id) {
    toon('bs-scan', id === 'bs-scan');
    toon('bs-controle', id === 'bs-controle');
  }

  // --- Openen / sluiten ---

  function openBonScan() {
    if (!scannerBeschikbaar()) {
      alert('De bonscanner kon niet geladen worden. Herlaad de pagina.');
      return;
    }
    if (anderSchermOpen()) {
      alert('Sluit eerst het Swipedrinks- of afrekenscherm.');
      return;
    }
    bron = 'bon';
    $('bs-overlay').classList.remove('verborgen');
    startScan();
  }

  function startScan() {
    stopCamera();
    regels = [];
    toonStap('bs-scan');
    toonZones({ active: false });
    toon('bs-fout', false);
    toon('bs-opnieuw', false);
    toon('bs-play', false);
    $('bs-status').textContent = 'Camera openen…';
    try {
      if (!live) live = maakLive();
      kijken = true;
      live.start();
    } catch (err) {
      toonScanFout('De camera kon niet gestart worden.');
    }
  }

  // Camera volledig vrijgeven.
  function stopCamera() {
    kijken = false;
    try { if (live) live.stop(); } catch (e) {}
    const video = $('bs-video');
    if (video && video.srcObject) {
      try { video.srcObject.getTracks().forEach(t => t.stop()); } catch (e) {}
      video.pause();
      video.srcObject = null;
    }
  }

  function sluitBonScan() {
    stopCamera();
    regels = [];
    $('bs-regels').replaceChildren();
    $('bs-overlay').classList.add('verborgen');
  }

  function toonScanFout(tekst) {
    kijken = false;
    toonZones({ active: false });
    toon('bs-play', false);
    $('bs-status').textContent = '';
    $('bs-fout').textContent = tekst;
    toon('bs-fout', true);
    toon('bs-opnieuw', true);
  }

  // --- Live scanner ---

  function maakLive() {
    return window.createLiveBonScanner({
      video: $('bs-video'),
      onStatus(tekst) { if (kijken) $('bs-status').textContent = tekst; },
      onZones(state) { if (kijken) toonZones(state); },
      onDetected({ result }) {
        if (!kijken) return;
        stopCamera();
        try {
          toonControle(result);
        } catch (err) {
          toonScanFout('De bon kon niet gelezen worden. Scan opnieuw.');
        }
      },
      onPlaybackRequired() {
        if (kijken) toon('bs-play', true);
      },
      onError(tekst) {
        stopCamera();
        toonScanFout(tekst || 'De camera kon niet geopend worden.');
      },
      onCancel() {
        stopCamera();
        toonScanFout('De camera is gestopt omdat de pagina niet zichtbaar was.');
      }
    });
  }

  function toonZones(state) {
    const actief = !!(state && state.active);
    toon('bs-zones', actief);
    toon('bs-herstel', actief && !!state.recovery);
    toon('bs-zelfde', actief && state.recovery === 'same-sheet');
    toon('bs-manueel', actief && !!state.canFinishPartial);
    if (!actief) return;
    $('bs-manueel').textContent = state.recovery ? 'Bewaarde bon manueel afwerken' : 'De rest manueel';
    const done = state.done || [], visible = state.visible || [], review = state.review || [];
    for (const [id] of ZONES) {
      const cel = $('bs-zone-' + id);
      let stand = 'nog-niet', tekst = 'nog niet';
      if (done.includes(id)) { stand = 'gelezen'; tekst = review.includes(id) ? '✓ gelezen (vraag)' : '✓ gelezen'; }
      else if (!state.recovery && (state.target === id || visible.includes(id))) { stand = 'bezig'; tekst = 'bezig…'; }
      cel.dataset.stand = stand;
      cel.querySelector('small').textContent = tekst;
    }
  }

  // --- Controlescherm ---

  function toonControle(result) {
    const vormen = { Z50: window.ZoneBonForm, K50: window.LargeBonForm, K01: window.BonForm };
    const vorm = vormen[result && result.template];
    if (!vorm || !Array.isArray(result.rows) || result.rows.length !== vorm.products.length) {
      throw new Error('onvolledige bon');
    }
    const geleerd = P().leesGeleerd();
    const kassaProducten = leesKassaProducten();
    regels = regelsUitResultaat(result, vorm.products).map(r => Object.assign(r, {
      koppeling: koppel(r.bonNaam, kassaProducten, geleerd, ALIASSEN),
      invoer: { tekst: '', overslaan: false }
    }));
    $('bs-controle-titel').textContent = 'Controleer de bon';
    $('bs-controle-info').textContent = result.partial === true
      ? 'Gedeeltelijk gescand. Kijk op de papieren bon en beslis de open vragen.'
      : 'Vergelijk met de papieren bon en pas aan waar nodig.';
    toonStap('bs-controle');
    tekenControle();
  }

  // Controlescherm voor een gescande bestelling (bestelscan.js). items: [{ id, aantal }]
  function toonBestelControle(items, ongeldig) {
    stopCamera();
    bron = 'bestelling';
    regels = regelsUitBestelling(items, leesKassaProducten(), P().leesGeleerd());
    const onbekend = regels.filter(r => r.koppeling.nietOnthouden).length;
    let info = 'Vergelijk met de klant en pas aan waar nodig.';
    if (onbekend) info += ' ' + onbekend + (onbekend === 1 ? ' onbekend artikel' : ' onbekende artikelen') + ': prijs ingeven of overslaan.';
    if (ongeldig) info += ' ' + ongeldig + (ongeldig === 1 ? ' onleesbare regel' : ' onleesbare regels') + ' genegeerd.';
    $('bs-controle-titel').textContent = 'Controleer de bestelling';
    $('bs-controle-info').textContent = info;
    $('bs-overlay').classList.remove('verborgen');
    toonStap('bs-controle');
    tekenControle();
  }

  function scanOpnieuw() {
    if (bron === 'bestelling' && typeof window.openBestelScan === 'function') {
      sluitBonScan();
      window.openBestelScan();
    } else {
      startScan();
    }
  }

  function tekenControle() {
    const lijst = $('bs-regels');
    if (!regels.length) {
      lijst.replaceChildren(maak('li', 'bs-leeg', 'Geen artikelen aangeduid op de bon.'));
    } else {
      lijst.replaceChildren(...regels.map(tekenRegel));
    }
    const ongelezen = regels.filter(isOngelezen).length;
    toon('bs-alle-geen', ongelezen > 0);
    $('bs-alle-geen').textContent = 'Alle ' + ongelezen + ' ongelezen = geen';
    werkKnopBij();
  }

  function tekenRegel(r, i) {
    const k = r.koppeling;
    const li = maak('li', 'bs-regel' + (r.onzeker ? ' bs-onzeker' : r.aantal === 0 ? ' bs-nul' : ''));
    li.dataset.i = String(i);

    const kop = maak('div', 'bs-regel-kop');
    kop.append(maak('span', 'bs-naam', k.naam));
    if (k.soort === 'kassa') kop.append(maak('span', 'bs-prijs', prijsTekst(k.cent)));
    else if (k.soort === 'geleerd') kop.append(maak('span', 'bs-prijs', 'Bekend: ' + prijsTekst(k.cent)));
    else if (k.soort === 'prijs-nodig') kop.append(maak('span', 'bs-prijs bs-niet-in-kassa', 'Prijs nodig'));
    else kop.append(maak('span', 'bs-prijs bs-niet-in-kassa', 'Niet in kassa'));
    li.append(kop);

    if (r.onzeker) {
      li.append(maak('small', 'bs-reden', r.reden));
      if (r.crop) {
        const img = maak('img', 'bs-crop');
        img.src = r.crop;
        img.alt = 'De zes bolletjes van ' + r.bonNaam + ' op de gescande bon, van 1 tot 6.';
        li.append(img);
      }
      const keuzes = maak('div', 'bs-keuzes');
      for (let q = 0; q <= 6; q++) {
        const b = maak('button', 'bs-keuze' + (r.ink.includes(q) ? ' bs-hint' : ''), q ? String(q) : 'Geen');
        b.type = 'button';
        b.dataset.keuze = String(q);
        keuzes.append(b);
      }
      li.append(keuzes);
      return li;
    }

    const stap = maak('div', 'bs-stepper');
    const min = maak('button', 'bs-stap', '−');
    min.type = 'button';
    min.dataset.delta = '-1';
    min.disabled = r.aantal <= 0;
    const plus = maak('button', 'bs-stap', '+');
    plus.type = 'button';
    plus.dataset.delta = '1';
    plus.disabled = r.aantal >= MAX_AANTAL;
    stap.append(min, maak('span', 'bs-aantal', String(r.aantal)), plus);
    li.append(stap);

    if (k.cent == null && r.aantal > 0) { // 'prijs-nodig' of 'onbekend'
      const rij = maak('div', 'bs-prijsveld');
      const veld = maak('input', 'bet-input bs-prijs-input');
      veld.dataset.prijs = '1';
      veld.inputMode = 'decimal';
      veld.placeholder = 'Prijs (bv. 2,50)';
      veld.value = r.invoer.tekst;
      veld.disabled = r.invoer.overslaan;
      veld.classList.toggle('bs-ongeldig', !!r.invoer.tekst && prijsNaarCent(r.invoer.tekst) == null);
      const over = maak('button', 'rek-knop bs-overslaan' + (r.invoer.overslaan ? ' bs-aan' : ''),
        r.invoer.overslaan ? 'Overgeslagen' : 'Overslaan');
      over.type = 'button';
      over.dataset.overslaan = '1';
      rij.append(veld, over);
      li.append(rij);
    }
    return li;
  }

  function werkKnopBij() {
    const v = verzamel(regels);
    $('bs-zet').disabled = !v.klaar;
    const stuks = v.uit.reduce((s, r) => s + r.aantal, 0);
    const cent = v.uit.reduce((s, r) => s + Math.round(r.prijs * 100) * r.aantal, 0);
    let tekst = stuks ? stuks + ' stuks · ' + prijsTekst(cent) : 'Nog niets om toe te voegen';
    if (v.vragen) tekst += ' · nog ' + v.vragen + (v.vragen === 1 ? ' vraag' : ' vragen');
    if (v.zonderPrijs) tekst += ' · ' + v.zonderPrijs + ' zonder prijs';
    $('bs-totaal').textContent = tekst;
  }

  function regelVan(e) {
    const li = e.target.closest('[data-i]');
    return li ? regels[Number(li.dataset.i)] : null;
  }

  function opKlikRegels(e) {
    const knop = e.target.closest('button');
    const r = knop && regelVan(e);
    if (!r) return;
    if (knop.dataset.keuze !== undefined) {
      if (!r.onzeker) return;
      r.aantal = Number(knop.dataset.keuze);
      r.onzeker = false;
    } else if (knop.dataset.delta !== undefined) {
      r.aantal = Math.max(0, Math.min(MAX_AANTAL, r.aantal + Number(knop.dataset.delta)));
    } else if (knop.dataset.overslaan !== undefined) {
      r.invoer.overslaan = !r.invoer.overslaan;
    } else {
      return;
    }
    tekenControle();
  }

  function opInvoerRegels(e) {
    if (!e.target.dataset || !e.target.dataset.prijs) return;
    const r = regelVan(e);
    if (!r) return;
    r.invoer.tekst = e.target.value;
    e.target.classList.toggle('bs-ongeldig', !!r.invoer.tekst && prijsNaarCent(r.invoer.tekst) == null);
    werkKnopBij(); // niet hertekenen: dan blijft de cursor in het veld
  }

  function alleOngelezenGeen() {
    regels.forEach(r => { if (isOngelezen(r)) { r.aantal = 0; r.onzeker = false; } });
    tekenControle();
  }

  function zetOpBon() {
    const v = verzamel(regels);
    if (!v.klaar) return;
    if (typeof bon === 'undefined' || typeof tekenBon !== 'function') {
      alert('De bon van de kassa is niet beschikbaar.');
      return;
    }
    P().bewaarGeleerd(v.nieuwePrijzen);
    voegRegelsToe(bon, v.uit); // `bon` en tekenBon komen uit kassa.js
    tekenBon();
    if (typeof toonOnthoudenPrijzen === 'function') toonOnthoudenPrijzen(); // nieuwe prijzen op de knoppen
    sluitBonScan();
  }

  // --- Knoppen koppelen ---

  function koppelKnoppen() {
    if (!$('bs-overlay')) return;
    $('bs-annuleer').addEventListener('click', sluitBonScan);
    $('bs-sluit').addEventListener('click', sluitBonScan);
    $('bs-opnieuw').addEventListener('click', startScan);
    $('bs-scan-opnieuw').addEventListener('click', scanOpnieuw);
    $('bs-play').addEventListener('click', () => {
      if (!kijken || !live) return;
      toon('bs-play', false);
      live.resumePlayback();
    });
    $('bs-zelfde').addEventListener('click', () => { if (kijken && live) live.continueSameBon(); });
    $('bs-nieuw').addEventListener('click', () => { if (kijken && live) live.newBon(); });
    $('bs-manueel').addEventListener('click', () => { if (kijken && live) live.finishPartial(); });
    $('bs-regels').addEventListener('click', opKlikRegels);
    $('bs-regels').addEventListener('input', opInvoerRegels);
    $('bs-alle-geen').addEventListener('click', alleOngelezenGeen);
    $('bs-zet').addEventListener('click', zetOpBon);
    // Camera ook vrijgeven als de pagina verlaten wordt.
    window.addEventListener('pagehide', stopCamera);
  }

  koppelKnoppen();
  window.openBonScan = openBonScan;
  window.toonBestelControle = toonBestelControle;
})();
