// Klanten-bestelapp: artikelen kiezen en de bestelling als QR tonen aan de kassa.
// Producten komen uit producten.js, de QR-tekst uit bestelcode.js (beide gedeeld met de kassa).
// Geen betaling, geen login, geen server: alles blijft op de gsm van de klant.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const BEWAAR = 'bestel.code'; // bestelling bewaren bij herladen (sessionStorage)
  const MAX = 99;

  const producten = window.KASSA_PRODUCTEN;
  const categorieen = window.KASSA_CATEGORIEEN;
  const B = window.Bestelcode;
  let aantallen = {}; // product-id -> aantal

  function euro(cent) {
    return '€' + (cent / 100).toFixed(2).replace('.', ',');
  }

  function maak(tag, klasse, tekst) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  // --- Opbouwen ---

  function bouw() {
    const tabs = $('tabs'), lijst = $('lijst');
    categorieen.forEach(c => {
      const items = producten.filter(p => p.categorie === c.id);
      if (!items.length) return;
      const tab = maak('button', 'tab', c.titel);
      tab.type = 'button';
      tab.dataset.cat = c.id;
      tabs.append(tab);

      const sectie = maak('section', 'sectie');
      sectie.id = 'cat-' + c.id;
      sectie.append(maak('h2', '', c.titel));
      items.forEach(p => sectie.append(bouwRij(p)));
      lijst.append(sectie);
    });
  }

  function bouwRij(p) {
    const rij = maak('div', 'rij');
    rij.id = 'p-' + p.id;
    rij.dataset.id = p.id;
    const info = maak('div', 'info');
    info.append(maak('span', 'naam', p.naam));
    info.append(p.prijs != null ? maak('span', 'prijs', euro(Math.round(p.prijs * 100)))
      : maak('span', 'prijs prijs-kassa', 'prijs aan de kassa'));
    const min = maak('button', 'stap min', '−');
    min.type = 'button';
    min.dataset.delta = '-1';
    min.setAttribute('aria-label', p.naam + ' minder');
    const plus = maak('button', 'stap plus', '+');
    plus.type = 'button';
    plus.dataset.delta = '1';
    plus.setAttribute('aria-label', p.naam + ' meer');
    rij.append(info, min, maak('span', 'aantal', '0'), plus);
    return rij;
  }

  // --- Tekenen ---

  function tekenRij(id) {
    const rij = $('p-' + id);
    if (!rij) return;
    const n = aantallen[id] || 0;
    rij.querySelector('.aantal').textContent = String(n);
    rij.querySelector('.min').disabled = n <= 0;
    rij.querySelector('.plus').disabled = n >= MAX;
    rij.classList.toggle('gekozen', n > 0);
  }

  // Gekozen artikelen in de volgorde van producten.js
  function gekozen() {
    return producten.filter(p => aantallen[p.id] > 0).map(p => ({ product: p, aantal: aantallen[p.id] }));
  }

  function tekenTotaal() {
    const g = gekozen();
    const cent = g.reduce((s, x) => s + (x.product.prijs != null ? Math.round(x.product.prijs * 100) * x.aantal : 0), 0);
    const zonder = g.filter(x => x.product.prijs == null).reduce((s, x) => s + x.aantal, 0);
    const stuks = g.reduce((s, x) => s + x.aantal, 0);
    $('totaal').textContent = euro(cent);
    let extra = stuks ? stuks + (stuks === 1 ? ' artikel' : ' artikelen') : 'Nog niets gekozen';
    if (zonder) extra += ' · ' + zonder + ' zonder prijs (prijs aan de kassa)';
    $('totaal-extra').textContent = extra;
    $('maak-qr').disabled = stuks === 0;
    bewaar();
    return { cent, zonder, stuks, g };
  }

  function tekenAlles() {
    producten.forEach(p => tekenRij(p.id));
    tekenTotaal();
  }

  // --- Bewaren (overleeft herladen van de pagina) ---

  function code() {
    return B.encodeBestelling(gekozen().map(x => ({ id: x.product.id, aantal: x.aantal })));
  }

  function bewaar() {
    try { sessionStorage.setItem(BEWAAR, code()); } catch (e) {}
  }

  function herstel() {
    let items = null;
    try { items = B.decodeBestelling(sessionStorage.getItem(BEWAAR)); } catch (e) {}
    (items || []).forEach(i => {
      const p = B.zoekProduct(i.id, producten);
      if (p) aantallen[p.id] = i.aantal;
    });
  }

  // --- QR ---

  function toonQR() {
    const t = tekenTotaal();
    if (!t.stuks) return;
    const vak = $('qr-code');
    vak.replaceChildren();
    const maat = Math.max(200, Math.min(420, window.innerWidth - 48, window.innerHeight - 300));
    if (typeof QRCode === 'undefined') {
      vak.append(maak('p', 'fout', 'De QR-code kon niet geladen worden. Controleer je internet en probeer opnieuw.'));
    } else {
      new QRCode(vak, { text: code(), width: maat, height: maat, correctLevel: QRCode.CorrectLevel.M });
    }
    const sam = $('qr-samenvatting');
    sam.replaceChildren();
    const ul = maak('ul');
    t.g.forEach(x => ul.append(maak('li', '', x.aantal + '× ' + x.product.naam)));
    sam.append(ul);
    let tot = 'Totaal: ' + euro(t.cent);
    if (t.zonder) tot += ' + ' + t.zonder + ' zonder prijs';
    sam.append(maak('p', 'qr-totaal', tot));
    $('bestel-scherm').classList.add('verborgen');
    $('qr-scherm').classList.remove('verborgen');
    window.scrollTo(0, 0);
  }

  function terug() {
    $('qr-scherm').classList.add('verborgen');
    $('bestel-scherm').classList.remove('verborgen');
  }

  function nieuw() {
    aantallen = {};
    tekenAlles();
    terug();
    window.scrollTo(0, 0);
  }

  // --- Knoppen ---

  function opKlik(e) {
    const knop = e.target.closest('button[data-delta]');
    const rij = knop && knop.closest('[data-id]');
    if (!rij) return;
    const id = rij.dataset.id;
    aantallen[id] = Math.max(0, Math.min(MAX, (aantallen[id] || 0) + Number(knop.dataset.delta)));
    if (!aantallen[id]) delete aantallen[id];
    tekenRij(id);
    tekenTotaal();
  }

  function opTab(e) {
    const tab = e.target.closest('[data-cat]');
    if (!tab) return;
    const sectie = $('cat-' + tab.dataset.cat);
    const kop = document.querySelector('.kop');
    window.scrollTo({ top: sectie.getBoundingClientRect().top + window.scrollY - kop.offsetHeight - 4, behavior: 'smooth' });
  }

  function start() {
    if (!producten || !categorieen || !B) {
      $('lijst').append(maak('p', 'fout', 'De artikellijst kon niet geladen worden. Herlaad de pagina.'));
      return;
    }
    bouw();
    herstel();
    tekenAlles();
    $('lijst').addEventListener('click', opKlik);
    $('tabs').addEventListener('click', opTab);
    $('maak-qr').addEventListener('click', toonQR);
    $('qr-terug').addEventListener('click', terug);
    $('qr-nieuw').addEventListener('click', nieuw);
  }

  start();
})();
