// Frontend-token blijft als fallback tot SD_TOKEN in Netlify staat.
// Daarna kan deze constante verdwijnen; de functies gebruiken eerst de env-var.
const SD_TOKEN = '5t4o3Q4hQvZBC8Qz34cH';
const SD_API = '/api';

let sdQRCode = null;           // gegenereerde QR-string van de API
let sdQRTokens = null;         // tokenbedrag waarvoor die QR geldt
let sdGeneratePromise = null;  // lopende generateQR-aanvraag
let sdPollTimer = null;
let sdTimeoutTimer = null;
let sdScanner = null;
let sdPollInFlight = false;
let sdSettled = false;
let sdOpening = false;
let sdFlowStarted = false;
let sdScanHandled = false;
let sdSessie = 0;              // stijgt bij openen/sluiten, voorkomt late callbacks

// --- API helper ---

async function sdPost(endpoint, body) {
  const response = await fetch(`${SD_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SD_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`API fout: ${response.status}`);
  return response.json();
}

// --- Swipedrinks openen ---

async function openSwipedrinks() {
  if (sdOpening) return;
  if (bon.length === 0) {
    alert('De bon is leeg!');
    return;
  }

  const totaal = bon.reduce((som, item) => som + item.prijs * item.aantal, 0);
  const tokens = Math.round(totaal);

  sdOpening = true;
  sdSessie += 1;
  const sessie = sdSessie;
  sdFlowStarted = false;
  sdSettled = false;
  sdScanHandled = false;

  document.getElementById('sd-overlay').classList.remove('verborgen');
  toonSdScherm('sd-keuze');
  document.getElementById('sd-totaal-tokens').textContent = tokens;
  document.getElementById('sd-totaal-qr').textContent = tokens;
  setFlowButtonsEnabled(false);
  verbergKeuzeFout();

  try {
    if (sdQRCode && sdQRTokens === tokens) {
      toonKeuzeKlaar();
    } else {
      setKeuzeStatus('QR aanmaken...');
      await ensureQR(tokens);
      if (sessie !== sdSessie || !overlayOpen()) return;
      toonKeuzeKlaar();
    }
  } catch (err) {
    if (sessie === sdSessie && overlayOpen()) toonKeuzeFout(err.message);
  } finally {
    if (sessie === sdSessie) sdOpening = false;
  }
}

function opnieuwQRAanmaken() {
  sdQRCode = null;
  sdQRTokens = null;
  sdGeneratePromise = null;
  sdOpening = false;
  openSwipedrinks();
}

async function ensureQR(tokens) {
  if (tokens == null) {
    const totaal = bon.reduce((som, item) => som + item.prijs * item.aantal, 0);
    tokens = Math.round(totaal);
  }

  if (sdQRCode && sdQRTokens === tokens) return sdQRCode;
  if (sdGeneratePromise && sdQRTokens === tokens) return sdGeneratePromise;

  sdQRCode = null;
  sdQRTokens = tokens;
  sdGeneratePromise = (async () => {
    const data = await sdPost('generateQR', { total: tokens });
    if (!data || !data.qrcode) throw new Error('Geen QR-code ontvangen');
    sdQRCode = data.qrcode;
    return sdQRCode;
  })();

  try {
    return await sdGeneratePromise;
  } catch (err) {
    sdGeneratePromise = null;
    sdQRCode = null;
    sdQRTokens = null;
    throw err;
  }
}

// --- Flow A: klant scant de QR ---

async function flowA() {
  if (sdFlowStarted) return;
  sdFlowStarted = true;
  const sessie = sdSessie;
  setFlowButtonsEnabled(false);

  try {
    await ensureQR();
    if (sessie !== sdSessie || !overlayOpen()) return;
    if (!sdQRCode) throw new Error('Geen QR-code beschikbaar');
    if (typeof QRCode === 'undefined') {
      throw new Error('QR-bibliotheek kon niet geladen worden. Herlaad de pagina.');
    }

    toonSdScherm('sd-qr-display');
    const container = document.getElementById('sd-qr-image');
    container.innerHTML = '';
    new QRCode(container, {
      text: sdQRCode,
      width: 200,
      height: 200,
      colorDark: '#000000',
      colorLight: '#ffffff'
    });
    document.getElementById('sd-wacht-tekst').textContent = 'Wachten op betaling...';
    startPolling();
  } catch (err) {
    if (sessie !== sdSessie) return;
    sdFlowStarted = false;
    if (overlayOpen()) toonKeuzeFout(err.message);
  }
}

// --- Flow B: bartender scant klantenkaart ---

async function flowB() {
  if (sdFlowStarted) return;
  sdFlowStarted = true;
  sdScanHandled = false;
  const sessie = sdSessie;
  setFlowButtonsEnabled(false);

  toonSdScherm('sd-scanner');
  document.getElementById('sd-scan-status').textContent = 'Camera starten...';

  try {
    await ensureQR();
    if (sessie !== sdSessie || !overlayOpen()) return;
    if (!sdQRCode) throw new Error('Geen QR-code beschikbaar');
    await startCamera(sessie);
    if (sessie !== sdSessie || !overlayOpen()) {
      await stopScanner();
      return;
    }
    document.getElementById('sd-scan-status').textContent = 'Scan de Swipedrinks kaart van de klant';
  } catch (err) {
    await stopScanner();
    if (sessie !== sdSessie || !overlayOpen()) return;
    sdFlowStarted = false;
    if (!sdQRCode) {
      toonKeuzeFout(err.message);
      return;
    }
    // Terug naar keuze zodat opnieuw scannen of QR tonen meteen kan
    toonSdScherm('sd-keuze');
    toonKeuzeKlaar();
    const status = document.getElementById('sd-keuze-status');
    status.textContent = cameraFoutTekst(err);
    status.classList.remove('verborgen', 'sd-wacht');
    status.classList.add('sd-fout');
  }
}

async function startCamera(sessie) {
  if (!window.isSecureContext) {
    throw new Error('https');
  }
  if (typeof Html5Qrcode === 'undefined') {
    throw new Error('bibliotheek');
  }

  await stopScanner();
  if (sessie !== sdSessie) return;

  const cameraEl = document.getElementById('sd-camera');
  cameraEl.innerHTML = '';

  const scanner = new Html5Qrcode('sd-camera');
  sdScanner = scanner;
  const config = { fps: 10, qrbox: 250 };

  try {
    await scanner.start(
      { facingMode: 'environment' },
      config,
      onKaartGescand,
      function () {}
    );
  } catch (err) {
    try { await scanner.stop(); } catch (e) {}
    if (sessie !== sdSessie) return;

    let cameras;
    try {
      cameras = await Html5Qrcode.getCameras();
    } catch (e) {
      throw err;
    }
    if (!cameras || cameras.length === 0) {
      throw new Error('geen-camera');
    }
    if (sessie !== sdSessie) return;

    await scanner.start(cameras[0].id, config, onKaartGescand, function () {});
  }

  if (sessie !== sdSessie) {
    await stopScanner();
  }
}

async function onKaartGescand(userQR) {
  if (sdScanHandled || sdSettled) return;
  sdScanHandled = true;
  const sessie = sdSessie;
  document.getElementById('sd-scan-status').textContent = 'Kaart gescand, betaling koppelen...';
  await stopScanner();

  try {
    await ensureQR();
    if (sessie !== sdSessie || !overlayOpen() || sdSettled) return;
    if (!sdQRCode) throw new Error('Geen QR-code beschikbaar');
    await sdPost('updateUserInQR', { qrcode: sdQRCode, userQR: userQR });
    if (sessie !== sdSessie || !overlayOpen() || sdSettled) return;
    startPolling();
  } catch (err) {
    if (sessie === sdSessie && overlayOpen() && !sdSettled) {
      toonMislukt('Fout bij koppelen: ' + err.message);
    }
  }
}

function cameraFoutTekst(err) {
  if (!window.isSecureContext || (err && err.message === 'https')) {
    return 'Camera werkt alleen via een beveiligde verbinding (HTTPS). Open de kassa via https.';
  }
  if (err && err.message === 'bibliotheek') {
    return 'Camera-bibliotheek kon niet geladen worden. Herlaad de pagina.';
  }
  const raw = err ? ((err.name || '') + ' ' + (err.message || '')) : '';
  const msg = raw.toLowerCase();
  if (msg.includes('notallowed') || msg.includes('permission') || msg.includes('denied')) {
    return 'Geen toegang tot de camera. Sta camera toe in de browserinstellingen en probeer opnieuw.';
  }
  if (
    (err && err.message === 'geen-camera') ||
    msg.includes('notfound') ||
    msg.includes('no camera') ||
    msg.includes('requested device not found')
  ) {
    return 'Geen camera gevonden.';
  }
  return 'Camera kon niet worden gestart' + (err && err.message ? ': ' + err.message : '.');
}

// --- Stop camera ---

async function stopScanner() {
  const scanner = sdScanner;
  sdScanner = null;
  if (!scanner) return;
  try {
    await scanner.stop();
  } catch (e) {}
  try {
    if (typeof scanner.clear === 'function') await scanner.clear();
  } catch (e) {}
  const cameraEl = document.getElementById('sd-camera');
  if (cameraEl) cameraEl.innerHTML = '';
}

// --- Polling: controleer betaalstatus elke 500ms ---

function startPolling() {
  stopPolling();
  sdSettled = false;
  sdPollInFlight = false;
  const sessie = sdSessie;

  sdTimeoutTimer = setTimeout(() => {
    if (sessie !== sdSessie) return;
    verwerkResultaat('timeout');
  }, 30000);

  sdPollTimer = setInterval(() => pollStatus(sessie), 500);
}

async function pollStatus(sessie) {
  if (sessie !== sdSessie || sdSettled || sdPollInFlight) return;
  if (!overlayOpen()) {
    stopPolling();
    return;
  }
  if (!sdQRCode) return;

  sdPollInFlight = true;
  try {
    const data = await sdPost('checkQR', { qrcode: sdQRCode });
    if (sessie !== sdSessie || sdSettled) return;
    if (!overlayOpen()) {
      stopPolling();
      return;
    }
    if (data.status === 1) {
      verwerkResultaat('success');
    } else if (data.status === 2) {
      verwerkResultaat('tokens');
    }
  } catch (err) {
    if (sessie === sdSessie && !sdSettled && overlayOpen()) {
      verwerkResultaat('netwerk', err.message);
    }
  } finally {
    if (sessie === sdSessie) sdPollInFlight = false;
  }
}

function verwerkResultaat(type, extra) {
  if (sdSettled) return;
  sdSettled = true;
  stopPolling();
  stopScanner();

  if (type === 'success') {
    toonGeslaagd();
  } else if (type === 'tokens') {
    toonMislukt('Onvoldoende tokens');
  } else if (type === 'timeout') {
    toonMislukt('Tijdslimiet overschreden (30 seconden)');
  } else {
    toonMislukt('Netwerkfout: ' + (extra || 'onbekend'));
  }
}

function stopPolling() {
  if (sdPollTimer) { clearInterval(sdPollTimer); sdPollTimer = null; }
  if (sdTimeoutTimer) { clearTimeout(sdTimeoutTimer); sdTimeoutTimer = null; }
}

// --- Resultaatschermen ---

async function toonGeslaagd() {
  const ref = sdQRCode;
  wissenQR();
  toonSdScherm('sd-success');
  // Order bewaren (betalen.js). Mislukt dat, dan toont die een foutmelding en blijft de bon staan.
  const opgeslagen = await bewaarBetaling('swipedrinks', ref);
  if (!opgeslagen) {
    sluitSwipedrinks();
    return;
  }
  setTimeout(sluitSwipedrinks, 2000);
}

function toonMislukt(boodschap) {
  toonSdScherm('sd-failed');
  document.getElementById('sd-failed-boodschap').textContent = boodschap;
}

// --- Sluiten ---

function sluitSwipedrinks() {
  sdSessie += 1;
  sdSettled = true;
  sdFlowStarted = false;
  sdOpening = false;
  sdScanHandled = false;
  stopPolling();
  stopScanner();
  document.getElementById('sd-overlay').classList.add('verborgen');
  // sdQRCode blijft bewaard, zodat een nieuwe poging met hetzelfde bedrag die hergebruikt
}

function wissenQR() {
  sdQRCode = null;
  sdQRTokens = null;
  sdGeneratePromise = null;
}

function overlayOpen() {
  const el = document.getElementById('sd-overlay');
  return el && !el.classList.contains('verborgen');
}

// --- Keuzescherm ---

function setFlowButtonsEnabled(aan) {
  document.getElementById('sd-btn-flow-a').disabled = !aan;
  document.getElementById('sd-btn-flow-b').disabled = !aan;
}

function setKeuzeStatus(tekst) {
  const status = document.getElementById('sd-keuze-status');
  status.textContent = tekst;
  status.classList.remove('verborgen', 'sd-fout');
  status.classList.add('sd-wacht');
  document.getElementById('sd-btn-retry').classList.add('verborgen');
}

function toonKeuzeKlaar() {
  const status = document.getElementById('sd-keuze-status');
  status.textContent = '';
  status.classList.add('verborgen');
  status.classList.remove('sd-fout');
  document.getElementById('sd-btn-retry').classList.add('verborgen');
  setFlowButtonsEnabled(true);
}

function toonKeuzeFout(boodschap) {
  toonSdScherm('sd-keuze');
  const status = document.getElementById('sd-keuze-status');
  status.textContent = 'Kon geen betaling aanmaken: ' + boodschap;
  status.classList.remove('verborgen', 'sd-wacht');
  status.classList.add('sd-fout');
  document.getElementById('sd-btn-retry').classList.remove('verborgen');
  setFlowButtonsEnabled(false);
}

function verbergKeuzeFout() {
  document.getElementById('sd-btn-retry').classList.add('verborgen');
  const status = document.getElementById('sd-keuze-status');
  status.classList.remove('sd-fout');
}

// --- Hulpfunctie: toon één scherm, verberg de rest ---

function toonSdScherm(id) {
  const schermen = ['sd-keuze', 'sd-qr-display', 'sd-scanner', 'sd-success', 'sd-failed'];
  schermen.forEach(s => document.getElementById(s).classList.add('verborgen'));
  document.getElementById(id).classList.remove('verborgen');
}
