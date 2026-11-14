// Afrekenen (cash, bon, Bancontact via pay.nl, Swipedrinks) en rekeningen.
// Alles wat opgeslagen wordt is in centen.

let opslaanBezig = false;   // één betaling = één save
let okTimer = null;

// Bancontact (pay.nl) polling
let bcSessie = 0;
let bcTimer = null;
let bcInFlight = false;
let bcLaatste = null;       // { id, mode } voor "opnieuw controleren"
let bcActief = null;        // pay.nl-id van de lopende betaling (voor Annuleer)

const BC_POLL_MS = 2000;
const BC_TIMEOUT_MS = 120000;

// --- Popup ---

function openBetOverlay() {
  document.querySelectorAll('.bet-totaal').forEach(el => { el.textContent = euro(bonTotaalCents()); });
  document.getElementById('bet-overlay').classList.remove('verborgen');
}

function sluitBetalen() {
  stopBancontact();
  clearTimeout(okTimer);
  document.getElementById('bet-overlay').classList.add('verborgen');
}

function toonBetScherm(id) {
  document.querySelectorAll('#bet-overlay .bet-stap').forEach(el => el.classList.add('verborgen'));
  document.getElementById(id).classList.remove('verborgen');
}

function toonWacht(titel, tekst, annuleerbaar) {
  document.getElementById('bet-wacht-titel').textContent = titel;
  document.getElementById('bet-wacht-tekst').textContent = tekst;
  document.getElementById('bet-qr').classList.add('verborgen');
  document.getElementById('bet-wacht-annuleer').classList.toggle('verborgen', !annuleerbaar);
  toonBetScherm('bet-wacht');
}

function toonOk(tekst, extra) {
  document.getElementById('bet-ok-tekst').textContent = tekst;
  document.getElementById('bet-ok-extra').textContent = extra || '';
  toonBetScherm('bet-ok');
  clearTimeout(okTimer);
  // Met wisselgeld blijft het scherm staan tot "Sluiten"
  if (!extra) okTimer = setTimeout(sluitBetalen, 1500);
}

// opnieuw: optionele functie achter de knop "Opnieuw"
function toonFout(tekst, opnieuw, knopTekst) {
  document.getElementById('bet-fout-tekst').textContent = tekst;
  const knop = document.getElementById('bet-fout-opnieuw');
  knop.classList.toggle('verborgen', !opnieuw);
  knop.textContent = knopTekst || 'Opnieuw proberen';
  knop.onclick = opnieuw || null;
  openBetOverlay();
  toonBetScherm('bet-fout');
}

function openBetalen() {
  openBetOverlay();
  toonBetScherm('bet-keuze');
}

function naarSwipedrinks() {
  sluitBetalen();
  openSwipedrinks();
}

// --- Cash ---

function toonCash() {
  document.getElementById('bet-ontvangen').value = '';
  document.getElementById('bet-wisselgeld').textContent = '';
  toonBetScherm('bet-cash');
}

function wisselgeldCents() {
  const tekst = document.getElementById('bet-ontvangen').value.trim().replace(',', '.');
  const ontvangen = Math.round(parseFloat(tekst) * 100);
  if (!tekst || isNaN(ontvangen)) return null;
  return ontvangen - bonTotaalCents();
}

function toonWisselgeld() {
  const w = wisselgeldCents();
  document.getElementById('bet-wisselgeld').textContent =
    w === null ? '' : (w < 0 ? 'Nog te betalen: ' + euro(-w) : 'Wisselgeld: ' + euro(w));
}

// --- Cash en Bon: meteen registreren ---

async function betaalDirect(methode) {
  if (opslaanBezig || bon.length === 0) return;
  const w = methode === 'cash' ? wisselgeldCents() : null;
  if (w !== null && w < 0) {
    document.getElementById('bet-wisselgeld').textContent = 'Ontvangen bedrag is te laag';
    return;
  }
  toonWacht('Opslaan', 'Betaling opslaan...', false);
  if (await bewaarBetaling(methode, null)) {
    toonOk('Betaald met ' + BETAALMIDDELEN[methode], w ? 'Wisselgeld: ' + euro(w) : '');
  }
}

// --- Opslaan van een betaling (hook, ook gebruikt door swipedrinks.js) ---
// Geeft true terug als alles opgeslagen is; dan is de bon gewist.
// Bij een fout blijft de bon staan en toont de popup een foutmelding met "Opnieuw".

async function bewaarBetaling(methode, ref) {
  if (opslaanBezig || bon.length === 0) return false;
  opslaanBezig = true;
  try {
    await slaBetalingOp(methode, ref);
    bon = [];
    rekening = null;
    tekenBon();
    return true;
  } catch (err) {
    const alBetaald = methode !== 'cash' && methode !== 'bon';
    const tekst = alBetaald
      ? 'Betaald, maar opslaan mislukt: ' + err.message + '. De bon is bewaard. Niet opnieuw laten betalen, enkel opnieuw opslaan.'
      : 'Opslaan mislukt: ' + err.message + '. De bon is bewaard.';
    toonFout(tekst, () => opnieuwOpslaan(methode, ref), 'Opnieuw opslaan');
    return false;
  } finally {
    opslaanBezig = false;
  }
}

async function opnieuwOpslaan(methode, ref) {
  toonWacht('Opslaan', 'Betaling opslaan...', false);
  if (await bewaarBetaling(methode, ref)) toonOk('Opgeslagen (' + BETAALMIDDELEN[methode] + ')');
}

async function slaBetalingOp(methode, ref) {
  const d = dbNodig();
  const items = bonItems();
  const betaald = {
    status: 'paid',
    payment_method: methode,
    payment_ref: ref || null,
    paid_at: new Date().toISOString(),
    total_cents: bonTotaalCents()
  };

  if (rekening) {
    await vervangItems(rekening.id, items);
    const rijen = dbCheck(await d.from('orders').update(betaald)
      .eq('id', rekening.id).eq('status', 'open').select('id'));
    if (!rijen.length) throw new Error('deze rekening is niet meer open');
  } else {
    const order = dbCheck(await d.from('orders').insert(betaald).select('id').single());
    await voegItemsToe(order.id, items);
  }
}

// Items toevoegen aan een nieuwe order. Lukt dat niet, dan wordt de order
// geannuleerd (verwijderen mag niet), zodat een nieuwe poging geen dubbel geeft.
async function voegItemsToe(orderId, items) {
  const res = await db.from('order_items').insert(items.map(i => ({ ...i, order_id: orderId })));
  if (res.error) {
    await db.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
    throw new Error(res.error.message);
  }
}

// Items van een bestaande order vervangen door de huidige bon.
// Eerst nieuwe items toevoegen, dan de oude verwijderen: bij een fout gaat niets verloren
// en een nieuwe poging geeft opnieuw het juiste resultaat.
async function vervangItems(orderId, items) {
  const order = dbCheck(await db.from('orders').select('status').eq('id', orderId).single());
  if (order.status !== 'open') throw new Error('deze rekening is niet meer open');
  const oud = dbCheck(await db.from('order_items').select('id').eq('order_id', orderId));
  dbCheck(await db.from('order_items').insert(items.map(i => ({ ...i, order_id: orderId }))));
  if (oud.length) {
    dbCheck(await db.from('order_items').delete().in('id', oud.map(r => r.id)));
  }
}

// --- Bancontact via pay.nl ---

async function startBancontact(mode) {
  if (bon.length === 0) return;
  stopBancontact();
  const sessie = bcSessie;
  toonWacht('Bancontact', 'Betaling starten...', true);

  try {
    const res = await fetch('/api/paynl-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: bonTotaalCents(), mode: mode, reference: 'KASSA' + Date.now() })
    });
    const data = await res.json().catch(() => ({}));
    if (sessie !== bcSessie) return;
    if (res.status === 503) throw new Error('Bancontact is nog niet ingesteld');
    if (!res.ok || !data.id) throw new Error(data.error || 'Fout ' + res.status);

    if (mode === 'qr') {
      if (typeof QRCode === 'undefined' || !data.redirect) throw new Error('QR-code kon niet getoond worden');
      const vak = document.getElementById('bet-qr');
      vak.innerHTML = '';
      new QRCode(vak, { text: data.redirect, width: 220, height: 220 });
      vak.classList.remove('verborgen');
      document.getElementById('bet-wacht-tekst').textContent = 'Laat de klant de QR-code scannen...';
    } else {
      document.getElementById('bet-wacht-tekst').textContent = 'Volg de instructies op de terminal...';
    }
    pollBancontact(data.id, mode);
    bcActief = data.id;
  } catch (err) {
    if (sessie !== bcSessie) return;
    toonFout(err.message === 'Bancontact is nog niet ingesteld' ? err.message : 'Bancontact starten mislukt: ' + err.message);
  }
}

function pollBancontact(id, mode) {
  stopBancontact();
  const sessie = bcSessie;
  const start = Date.now();
  bcLaatste = { id: id, mode: mode };
  bcTimer = setInterval(() => bcPollStap(sessie, id, mode, start), BC_POLL_MS);
}

async function bcPollStap(sessie, id, mode, start) {
  if (sessie !== bcSessie) return;
  if (Date.now() - start > BC_TIMEOUT_MS) {
    stopBancontact();
    toonFout(mode === 'terminal'
      ? 'Geen antwoord binnen 2 minuten, controleer de terminal'
      : 'Geen antwoord binnen 2 minuten', () => opnieuwControleren(), 'Status opnieuw controleren');
    return;
  }
  if (bcInFlight) return;
  bcInFlight = true;
  try {
    const res = await fetch('/api/paynl-status?id=' + encodeURIComponent(id));
    const data = await res.json().catch(() => ({}));
    if (sessie !== bcSessie) return;
    if (res.status === 503) {
      stopBancontact();
      toonFout('Bancontact is nog niet ingesteld');
      return;
    }
    if (!res.ok) return; // tijdelijke fout: blijven proberen tot de timeout

    const action = String(data.action || '').toUpperCase();
    const fouten = {
      CANCEL: 'Betaling geannuleerd',
      CANCELLED: 'Betaling geannuleerd',
      DENIED: 'Betaling geweigerd',
      DECLINED: 'Betaling geweigerd',
      FAILED: 'Betaling mislukt',
      EXPIRED: 'Betaling verlopen'
    };
    if (action === 'PAID') {
      stopBancontact();
      toonWacht('Betaald', 'Betaling opslaan...', false);
      const methode = mode === 'qr' ? 'bancontact_qr' : 'bancontact_terminal';
      if (await bewaarBetaling(methode, id)) toonOk('Betaald met ' + BETAALMIDDELEN[methode]);
    } else if (fouten[action]) {
      stopBancontact();
      toonFout(fouten[action]);
    }
  } catch (err) {
    // netwerkfout: volgende poging
  } finally {
    if (sessie === bcSessie) bcInFlight = false;
  }
}

function opnieuwControleren() {
  if (!bcLaatste) return;
  toonWacht('Bancontact', 'Status controleren...', true);
  pollBancontact(bcLaatste.id, bcLaatste.mode);
  bcActief = bcLaatste.id;
}

// Annuleer tijdens het wachten: lopende pay.nl-betaling afbreken, anders gewoon sluiten.
async function annuleerWacht() {
  const id = bcActief;
  if (!id) { sluitBetalen(); return; }
  stopBancontact();
  toonWacht('Bancontact', 'Betaling annuleren...', false);
  try {
    const res = await fetch('/api/paynl-abort?id=' + encodeURIComponent(id), { method: 'POST' });
    if (!res.ok) throw new Error();
    sluitBetalen();
  } catch (err) {
    // Annuleren lukte niet (bv. al betaald): status nakijken, niet zomaar weggooien.
    toonFout('Annuleren lukte niet. Misschien is er al betaald.', () => opnieuwControleren(), 'Status opnieuw controleren');
  }
}

// Stopt het pollen; late antwoorden worden genegeerd door de sessieteller.
function stopBancontact() {
  bcActief = null;
  bcSessie += 1;
  bcInFlight = false;
  if (bcTimer) { clearInterval(bcTimer); bcTimer = null; }
}

// --- Rekeningen ---

async function rekeningKnop() {
  if (bon.length === 0) {
    alert('De bon is leeg!');
    return;
  }
  openBetOverlay();
  if (rekening) {
    await zetOpRekening(rekening.naam);
    return;
  }
  document.getElementById('rek-naam-input').value = '';
  document.getElementById('rek-naam-status').textContent = '';
  toonBetScherm('rek-naam');
  document.getElementById('rek-naam-input').focus();
  laadKlantenlijst();
}

async function laadKlantenlijst() {
  try {
    const klanten = dbCheck(await dbNodig().from('customers').select('name').order('name').limit(1000));
    const lijst = document.getElementById('klanten-lijst');
    lijst.innerHTML = '';
    klanten.forEach(k => {
      const optie = document.createElement('option');
      optie.value = k.name;
      lijst.appendChild(optie);
    });
  } catch (err) {
    document.getElementById('rek-naam-status').textContent = 'Klantenlijst laden mislukt: ' + err.message;
  }
}

function rekeningOpslaan() {
  const naam = document.getElementById('rek-naam-input').value.trim();
  if (!naam) {
    document.getElementById('rek-naam-status').textContent = 'Geef een naam in';
    return;
  }
  zetOpRekening(naam);
}

async function zetOpRekening(naam) {
  if (opslaanBezig || bon.length === 0) return;
  opslaanBezig = true;
  toonWacht('Rekening', 'Rekening opslaan...', false);
  try {
    const d = dbNodig();
    const items = bonItems();
    if (rekening) {
      await vervangItems(rekening.id, items);
      const rijen = dbCheck(await d.from('orders').update({ total_cents: bonTotaalCents() })
        .eq('id', rekening.id).eq('status', 'open').select('id'));
      if (!rijen.length) throw new Error('deze rekening is niet meer open');
    } else {
      const klantId = await zoekOfMaakKlant(naam);
      const open = dbCheck(await d.from('orders').select('id')
        .eq('customer_id', klantId).eq('status', 'open').order('created_at').limit(1));
      if (open.length) {
        const id = open[0].id;
        dbCheck(await d.from('order_items').insert(items.map(i => ({ ...i, order_id: id }))));
        const alle = dbCheck(await d.from('order_items').select('price_cents, qty').eq('order_id', id));
        const totaal = alle.reduce((som, i) => som + i.price_cents * i.qty, 0);
        dbCheck(await d.from('orders').update({ total_cents: totaal }).eq('id', id));
      } else {
        const order = dbCheck(await d.from('orders')
          .insert({ customer_id: klantId, status: 'open', total_cents: bonTotaalCents() })
          .select('id').single());
        await voegItemsToe(order.id, items);
      }
    }
    bon = [];
    rekening = null;
    tekenBon();
    toonOk('Op rekening gezet: ' + naam);
  } catch (err) {
    toonFout('Rekening opslaan mislukt: ' + err.message + '. De bon is bewaard.');
  } finally {
    opslaanBezig = false;
  }
}

async function zoekOfMaakKlant(naam) {
  const d = dbNodig();
  const zoek = async () => dbCheck(await d.from('customers').select('id').eq('name', naam).limit(1));
  let gevonden = await zoek();
  if (gevonden.length) return gevonden[0].id;
  const res = await d.from('customers').insert({ name: naam }).select('id').single();
  if (!res.error) return res.data.id;
  gevonden = await zoek(); // net door een ander toestel aangemaakt?
  if (gevonden.length) return gevonden[0].id;
  throw new Error(res.error.message);
}

async function toonOpenRekeningen() {
  openBetOverlay();
  toonBetScherm('rek-lijst');
  const status = document.getElementById('rek-lijst-status');
  const knoppen = document.getElementById('rek-lijst-knoppen');
  status.textContent = 'Laden...';
  knoppen.innerHTML = '';
  try {
    const orders = dbCheck(await dbNodig().from('orders')
      .select('id, total_cents, customers(name)').eq('status', 'open').order('created_at'));
    status.textContent = orders.length ? '' : 'Geen openstaande rekeningen';
    orders.forEach(o => {
      const naam = (o.customers && o.customers.name) || '(zonder naam)';
      const knop = document.createElement('button');
      knop.className = 'rek-knop';
      const n = document.createElement('span');
      n.textContent = naam;
      const t = document.createElement('span');
      t.textContent = euro(o.total_cents);
      knop.append(n, t);
      knop.onclick = () => laadRekening(o.id, naam);
      knoppen.appendChild(knop);
    });
  } catch (err) {
    status.textContent = 'Laden mislukt: ' + err.message;
  }
}

async function laadRekening(id, naam) {
  if (rekening) {
    status('Er is al een rekening geladen. Wis eerst de bon.');
    return;
  }
  if (bon.length && !confirm('De huidige bon wordt bij de rekening van ' + naam + ' gevoegd. Doorgaan?')) return;
  status('Rekening laden...');
  try {
    const items = dbCheck(await dbNodig().from('order_items')
      .select('product, price_cents, qty').eq('order_id', id));
    items.forEach(i => {
      const prijs = i.price_cents / 100;
      const bestaand = bon.find(b => b.naam === i.product && b.prijs === prijs);
      if (bestaand) bestaand.aantal += i.qty;
      else bon.push({ naam: i.product, prijs: prijs, aantal: i.qty });
    });
    rekening = { id: id, naam: naam };
    tekenBon();
    sluitBetalen();
  } catch (err) {
    status('Rekening laden mislukt: ' + err.message);
  }

  function status(tekst) {
    document.getElementById('rek-lijst-status').textContent = tekst;
  }
}
