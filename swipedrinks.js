// ⚠️ Vervang dit door jouw echte event token
const SD_TOKEN = '5t4o3Q4hQvZBC8Qz34cH';
const SD_API = '/api';

let sdQRCode = null;    // de gegenereerde QR string van de API
let sdPollTimer = null; // interval voor polling
let sdTimeoutTimer = null; // timeout na 30 seconden
let sdScanner = null;   // camera scanner instantie

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
  if (bon.length === 0) {
    alert('De bon is leeg!');
    return;
  }

  // Bereken totaal (afgerond naar heel getal = tokens)
  const totaal = bon.reduce((som, item) => som + item.prijs * item.aantal, 0);
  const tokens = Math.round(totaal);

  // Toon overlay en keuze scherm
  document.getElementById('sd-overlay').classList.remove('verborgen');
  toonSdScherm('sd-keuze');
  document.getElementById('sd-totaal-tokens').textContent = tokens;
  document.getElementById('sd-totaal-qr').textContent = tokens;

  // Genereer betaal-QR via API
  try {
    const data = await sdPost('generateQR', { total: tokens });
    sdQRCode = data.qrcode;
  } catch (err) {
    alert('Kon geen betaling aanmaken: ' + err.message);
    sluitSwipedrinks();
  }
}

// --- Flow A: klant scant de QR ---

function flowA() {
  toonSdScherm('sd-qr-display');

  // Maak QR-afbeelding van de sdQRCode string
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
}

// --- Flow B: bartender scant klantenkaart ---

function flowB() {
  toonSdScherm('sd-scanner');
  document.getElementById('sd-scan-status').textContent = 'Camera starten...';

  if (window.Html5QrcodeScanner) {
    sdScanner = new Html5QrcodeScanner('sd-camera', {
      fps: 10,
      qrbox: { width: 250, height: 250 }
    });

    sdScanner.render(
      async (userQR) => {
        await stopScanner();
        document.getElementById('sd-scan-status').textContent = 'Kaart gescand, betaling koppelen...';

        try {
          await sdPost('updateUserInQR', { qrcode: sdQRCode, userQR: userQR });
          startPolling();
        } catch (err) {
          toonMislukt('Fout bij koppelen: ' + err.message);
        }
      },
      () => {
        // Scan fout — scanner blijft proberen, geen actie nodig
      }
    );

    document.getElementById('sd-scan-status').textContent = 'Scan de Swipedrinks kaart van de klant';
  } else {
    alert('Camera-bibliotheek kon niet geladen worden. Herlaad de pagina.');
  }
}

// --- Stop camera scanner ---

async function stopScanner() {
  if (sdScanner) {
    try { await sdScanner.clear(); } catch (e) {}
    sdScanner = null;
  }
}

// --- Polling: controleer betaalstatus elke 500ms ---

function startPolling() {
  stopPolling();

  // Timeout na 30 seconden
  sdTimeoutTimer = setTimeout(() => {
    stopPolling();
    toonMislukt('Tijdslimiet overschreden (30 seconden)');
  }, 30000);

  sdPollTimer = setInterval(async () => {
    try {
      const data = await sdPost('checkQR', { qrcode: sdQRCode });

      if (data.status === 1) {
        stopPolling();
        toonGeslaagd();
      } else if (data.status === 2) {
        stopPolling();
        toonMislukt('Onvoldoende tokens');
      }
      // status 0 = wachten, ga door met pollen
    } catch (err) {
      stopPolling();
      toonMislukt('Netwerkfout: ' + err.message);
    }
  }, 500);
}

function stopPolling() {
  if (sdPollTimer) { clearInterval(sdPollTimer); sdPollTimer = null; }
  if (sdTimeoutTimer) { clearTimeout(sdTimeoutTimer); sdTimeoutTimer = null; }
}

// --- Resultaatschermen ---

function toonGeslaagd() {
  toonSdScherm('sd-success');
  // Na 2 seconden: bon wissen en sluiten
  setTimeout(() => {
    wisAlles();
    sluitSwipedrinks();
  }, 2000);
}

function toonMislukt(boodschap) {
  toonSdScherm('sd-failed');
  document.getElementById('sd-failed-boodschap').textContent = boodschap;
}

// --- Sluiten ---

function sluitSwipedrinks() {
  stopPolling();
  stopScanner();
  document.getElementById('sd-overlay').classList.add('verborgen');
  sdQRCode = null;
}

// --- Hulpfunctie: toon één scherm, verberg de rest ---

function toonSdScherm(id) {
  const schermen = ['sd-keuze', 'sd-qr-display', 'sd-scanner', 'sd-success', 'sd-failed'];
  schermen.forEach(s => document.getElementById(s).classList.add('verborgen'));
  document.getElementById(id).classList.remove('verborgen');
}
