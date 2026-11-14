// Scan bestelling: de QR van de klanten-bestelapp (bestel/) lezen met html5-qrcode.
// Alleen codes die met 'KB1:' beginnen worden aanvaard (bestelcode.js).
// Na een geldige code: camera stoppen en het controlescherm van de bonscanner tonen
// (window.toonBestelControle uit bonscan.js). Daarna gewoon Afrekenen.
// Camera-instellingen zoals swipedrinks.js: { fps: 10, qrbox: 250 }, camera achteraan.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let scanner = null;   // lopende Html5Qrcode
  let sessie = 0;       // stijgt bij openen/sluiten, voorkomt late callbacks
  let verwerkt = false; // geldige code al gelezen
  let meldTimer = null;

  function overlayOpen() {
    const e = $('kb-overlay');
    return e && !e.classList.contains('verborgen');
  }

  // Swipedrinks, afrekenen of de bonscanner mogen niet tegelijk open zijn.
  function anderSchermOpen() {
    const open = id => { const e = $(id); return e && !e.classList.contains('verborgen'); };
    const sdCamera = typeof sdScanner !== 'undefined' && sdScanner; // swipedrinks.js
    return open('sd-overlay') || open('bet-overlay') || open('bs-overlay') || !!sdCamera;
  }

  function status(tekst) { $('kb-status').textContent = tekst; }

  function toonFout(tekst) {
    status('');
    $('kb-fout').textContent = tekst;
    $('kb-fout').classList.remove('verborgen');
    $('kb-opnieuw').classList.remove('verborgen');
  }

  function openBestelScan() {
    if (overlayOpen()) return;
    if (!window.Bestelcode || typeof window.toonBestelControle !== 'function') {
      alert('De bestelscanner kon niet geladen worden. Herlaad de pagina.');
      return;
    }
    if (anderSchermOpen()) {
      alert('Sluit eerst het Swipedrinks-, afreken- of bonscanscherm.');
      return;
    }
    $('kb-overlay').classList.remove('verborgen');
    start();
  }

  async function start() {
    sessie += 1;
    const mijn = sessie;
    verwerkt = false;
    $('kb-fout').classList.add('verborgen');
    $('kb-opnieuw').classList.add('verborgen');
    status('Camera openen…');
    try {
      await startCamera(mijn);
      if (mijn === sessie) status('Richt de camera op de QR-code van de klant.');
    } catch (err) {
      if (mijn !== sessie) return;
      await stopCamera();
      toonFout(typeof cameraFoutTekst === 'function' ? cameraFoutTekst(err) : 'Camera kon niet worden gestart.');
    }
  }

  async function startCamera(mijn) {
    if (!window.isSecureContext) throw new Error('https');
    if (typeof Html5Qrcode === 'undefined') throw new Error('bibliotheek');
    await stopCamera();
    if (mijn !== sessie) return;
    $('kb-camera').innerHTML = '';
    const s = new Html5Qrcode('kb-camera');
    scanner = s;
    const config = { fps: 10, qrbox: 250 };
    const opCode = tekst => opGescand(tekst, mijn);
    try {
      await s.start({ facingMode: 'environment' }, config, opCode, function () {});
    } catch (err) {
      try { await s.stop(); } catch (e) {}
      if (mijn !== sessie) return;
      let cameras;
      try { cameras = await Html5Qrcode.getCameras(); } catch (e) { throw err; }
      if (!cameras || !cameras.length) throw new Error('geen-camera');
      if (mijn !== sessie) return;
      await s.start(cameras[0].id, config, opCode, function () {});
    }
    if (mijn !== sessie) { // intussen gesloten: deze camera alsnog stoppen
      if (scanner === s) scanner = null;
      await stopScanner(s);
    }
  }

  async function opGescand(tekst, mijn) {
    if (verwerkt || mijn !== sessie) return;
    const bestelling = window.Bestelcode.leesBestelling(tekst);
    if (!bestelling) {
      // Andere QR (bv. Swipedrinks-kaart): melden en verder scannen.
      status('Dit is geen bestelling-QR. Scan de QR uit de bestelapp.');
      clearTimeout(meldTimer);
      meldTimer = setTimeout(() => {
        if (mijn === sessie && !verwerkt) status('Richt de camera op de QR-code van de klant.');
      }, 2000);
      return;
    }
    verwerkt = true;
    status('Bestelling gelezen…');
    await sluitBestelScan();
    window.toonBestelControle(bestelling.items, bestelling.ongeldig);
  }

  // Camera volledig vrijgeven.
  async function stopCamera() {
    const s = scanner;
    scanner = null;
    await stopScanner(s);
  }

  async function stopScanner(s) {
    if (!s) return;
    try { await s.stop(); } catch (e) {}
    try { if (typeof s.clear === 'function') await s.clear(); } catch (e) {}
    const vak = $('kb-camera');
    if (vak) vak.innerHTML = '';
  }

  async function sluitBestelScan() {
    sessie += 1;
    clearTimeout(meldTimer);
    $('kb-overlay').classList.add('verborgen');
    await stopCamera();
  }

  function koppelKnoppen() {
    if (!$('kb-overlay')) return;
    $('kb-annuleer').addEventListener('click', sluitBestelScan);
    $('kb-opnieuw').addEventListener('click', start);
    window.addEventListener('pagehide', () => { sluitBestelScan(); });
  }

  koppelKnoppen();
  window.openBestelScan = openBestelScan;
})();
