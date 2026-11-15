'use strict';
// Tests voor Bancontact via PAY.POS (App2App) en de terugval naar paynl-start.
// Gebruik: node tests/app2app.cjs (Node 18+, geen npm). Doet geen echte pay.nl-oproepen.
// (a) betalen.js in een vm met een minimale DOM, fetch-mock en nep-brug (window.AndroidPaynl).
// (b) netlify/functions/paynl-app2app-prepare.js en -verify.js met een fetch-mock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
let fouten = 0;
const testen = [];
function test(naam, fn) { testen.push({ naam, fn }); }

const rust = (ms) => new Promise(r => setTimeout(r, ms || 30));
const BETALEN = fs.readFileSync(path.join(root, 'betalen.js'), 'utf8');
const UUID = '0b5e2b6e-1c1f-4d7e-9a0a-3f6f2a1b9c11';
const TX = 'EX-1234-5678-9012';

// --- (a) betalen.js in een vm ---

function nepElement() {
  return { textContent: '', innerHTML: '', value: '', onclick: null,
    classList: { add() {}, remove() {}, toggle() {} } };
}

// Nep-brug zoals WebViewCompat.addWebMessageListener: postMessage(string) + message-events
function maakBrug(opties) {
  const o = Object.assign({ installed: true, nfcEnabled: true, open: { ok: true } }, opties);
  const brug = {
    berichten: [],
    luisteraar: null,
    postMessage(tekst) {
      assert.equal(typeof tekst, 'string');
      const msg = JSON.parse(tekst);
      brug.berichten.push(msg);
      let antwoord = null;
      if (msg.type === 'getStatus') {
        antwoord = { type: 'status', ok: true, installed: o.installed, nfcEnabled: o.nfcEnabled };
      } else if (msg.type === 'open') {
        antwoord = Object.assign({ type: 'open-result' }, o.open);
      } else if (msg.type === 'drain') {
        antwoord = { type: 'none' };
      } else if (msg.type === 'hello') {
        antwoord = { type: 'hello-ack', version: '1' };
      }
      if (antwoord) setTimeout(() => brug.push(Object.assign(antwoord, { requestId: msg.requestId })), 0);
    },
    addEventListener(type, fn) { if (type === 'message') brug.luisteraar = fn; },
    push(obj) { if (brug.luisteraar) brug.luisteraar({ data: JSON.stringify(obj) }); },
    types() { return brug.berichten.map(m => m.type); },
    laatste(type) { return brug.berichten.filter(m => m.type === type).pop(); }
  };
  return brug;
}

// antwoorden: { '/api/...': (body, url) => ({ status, json }) }
function maakKassa(brug, antwoorden) {
  const elementen = {};
  const opslag = {};
  const k = {
    oproepen: [],
    wacht: [],
    fout: [],
    ok: [],
    bewaard: []
  };
  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      getElementById: (id) => elementen[id] || (elementen[id] = nepElement()),
      querySelectorAll: () => []
    },
    localStorage: {
      getItem: (s) => (s in opslag ? opslag[s] : null),
      setItem: (s, v) => { opslag[s] = String(v); },
      removeItem: (s) => { delete opslag[s]; }
    },
    bon: [{ naam: 'Cola', prijs: 2.5, aantal: 2 }],
    rekening: null,
    bonTotaalCents: () => 500,
    euro: (c) => '€' + (c / 100).toFixed(2).replace('.', ','),
    BETAALMIDDELEN: { cash: 'Cash', bon: 'Bon', bancontact_terminal: 'Bancontact terminal', bancontact_qr: 'Bancontact QR', swipedrinks: 'Swipedrinks' },
    fetch: async (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : null;
      k.oproepen.push({ url: String(url), method: (init && init.method) || 'GET', body });
      const pad = String(url).split('?')[0];
      const fn = antwoorden && antwoorden[pad];
      const a = fn ? fn(body, url) : { status: 404, json: { error: 'niet gemockt' } };
      return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.json };
    }
  };
  if (brug) ctx.AndroidPaynl = brug;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(BETALEN, ctx, { filename: 'betalen.js' });
  // UI en opslaan vervangen door mocks
  ctx.toonWacht = (titel, tekst) => k.wacht.push(tekst);
  ctx.toonFout = (tekst) => k.fout.push(tekst);
  ctx.toonOk = (tekst) => k.ok.push(tekst);
  ctx.sluitBetalen = () => { ctx.stopBancontact(); k.gesloten = true; };
  ctx.bewaarBetaling = async (methode, ref) => { k.bewaard.push([methode, ref]); return true; };
  k.ctx = ctx;
  k.paden = () => k.oproepen.map(o => o.url.split('?')[0]);
  return k;
}

const startOk = () => ({ status: 200, json: { id: UUID, orderId: '123', redirect: 'https://pay.nl/x', status: 'PENDING' } });
const prepareOk = () => ({
  status: 200,
  json: {
    attemptId: 'att-1',
    reference: 'KASSA1700000000000abc',
    nonce: 'a'.repeat(32),
    payload: {
      description: 'Kassa KASSA1700000000000abc',
      reference: 'KASSA1700000000000abc',
      returnUrl: 'kassaswipe://paynl-return/' + 'a'.repeat(32),
      amount: { value: 500, currency: 'EUR' },
      integration: { testMode: false, tipMode: { enabled: false } }
    }
  }
});

test('browser: terminal gebruikt enkel paynl-start', async () => {
  const k = maakKassa(null, { '/api/paynl-start': startOk });
  await k.ctx.startBancontact('terminal');
  await rust();
  k.ctx.stopBancontact();
  assert.deepEqual(k.paden(), ['/api/paynl-start']);
  assert.equal(k.oproepen[0].body.mode, 'terminal');
  assert.equal(k.oproepen[0].body.amountCents, 500);
});

test('browser: qr gebruikt enkel paynl-start', async () => {
  const k = maakKassa(null, { '/api/paynl-start': startOk });
  k.ctx.QRCode = function () {};
  await k.ctx.startBancontact('qr');
  await rust();
  k.ctx.stopBancontact();
  assert.deepEqual(k.paden(), ['/api/paynl-start']);
  assert.equal(k.oproepen[0].body.mode, 'qr');
});

test('brug: qr blijft via paynl-start, geen getStatus', async () => {
  const brug = maakBrug();
  const k = maakKassa(brug, { '/api/paynl-start': startOk });
  k.ctx.QRCode = function () {};
  await k.ctx.startBancontact('qr');
  await rust();
  k.ctx.stopBancontact();
  assert.deepEqual(k.paden(), ['/api/paynl-start']);
  assert.ok(!brug.types().includes('getStatus'));
  assert.ok(!brug.types().includes('open'));
});

test('brug: "ready" wordt één keer gestuurd bij het laden', async () => {
  const brug = maakBrug();
  maakKassa(brug, {});
  assert.deepEqual(brug.types(), ['ready']);
});

for (const [naam, opties] of [['PAY.POS niet geïnstalleerd', { installed: false }], ['NFC uit', { nfcEnabled: false }]]) {
  test('brug, ' + naam + ': terminal valt terug op paynl-start', async () => {
    const brug = maakBrug(opties);
    const k = maakKassa(brug, { '/api/paynl-start': startOk });
    await k.ctx.startBancontact('terminal');
    await rust();
    k.ctx.stopBancontact();
    assert.deepEqual(k.paden(), ['/api/paynl-start']);
    assert.ok(brug.types().includes('getStatus'));
    assert.ok(!brug.types().includes('open'));
    assert.equal(k.fout.length, 0);
  });
}

test('brug zonder antwoord op getStatus: terugval op paynl-start', async () => {
  const brug = maakBrug();
  brug.postMessage = (t) => { brug.berichten.push(JSON.parse(t)); }; // antwoordt nooit
  const k = maakKassa(brug, { '/api/paynl-start': startOk });
  await k.ctx.startBancontact('terminal');
  await rust(1700);
  k.ctx.stopBancontact();
  assert.deepEqual(k.paden(), ['/api/paynl-start']);
});

test('brug: open geeft APP_NOT_INSTALLED -> terugval op paynl-start', async () => {
  const brug = maakBrug({ open: { ok: false, error: 'APP_NOT_INSTALLED' } });
  const k = maakKassa(brug, { '/api/paynl-app2app-prepare': prepareOk, '/api/paynl-start': startOk });
  await k.ctx.startBancontact('terminal');
  await rust();
  k.ctx.stopBancontact();
  assert.deepEqual(k.paden(), ['/api/paynl-app2app-prepare', '/api/paynl-start']);
  assert.equal(k.fout.length, 0);
});

test('brug: open geeft BUSY -> foutmelding, geen paynl-start', async () => {
  const brug = maakBrug({ open: { ok: false, error: 'BUSY' } });
  const k = maakKassa(brug, { '/api/paynl-app2app-prepare': prepareOk, '/api/paynl-start': startOk });
  await k.ctx.startBancontact('terminal');
  await rust();
  assert.deepEqual(k.paden(), ['/api/paynl-app2app-prepare']);
  assert.match(k.fout[0], /PAY\.POS is nog bezig/);
});

// Start een App2App-betaling tot PAY.POS open is
async function startApp2App(verify) {
  const brug = maakBrug();
  const k = maakKassa(brug, {
    '/api/paynl-app2app-prepare': prepareOk,
    '/api/paynl-app2app-verify': verify || (() => ({ status: 500, json: {} })),
    '/api/paynl-start': startOk,
    '/api/paynl-status': () => ({ status: 200, json: { action: 'PAID' } }),
    '/api/paynl-abort': () => ({ status: 200, json: { ok: true } })
  });
  await k.ctx.startBancontact('terminal');
  await rust();
  return { brug, k };
}

test('App2App: prepare en open, geen paynl-start', async () => {
  const { brug, k } = await startApp2App();
  assert.deepEqual(k.paden(), ['/api/paynl-app2app-prepare']);
  assert.deepEqual(k.oproepen[0].body, { amountCents: 500, testMode: false });
  const open = brug.laatste('open');
  assert.ok(open, 'geen open');
  assert.equal(open.attemptId, 'att-1');
  assert.equal(open.nonce, 'a'.repeat(32));
  assert.equal(open.payload.returnUrl, 'kassaswipe://paynl-return/' + 'a'.repeat(32));
  assert.equal(k.wacht[k.wacht.length - 1], 'Volg de instructies in PAY.POS...');
  assert.equal(k.bewaard.length, 0);
});

test('App2App: return + verify paid=true -> geboekt, ack en clear-open', async () => {
  const { brug, k } = await startApp2App(() => ({
    status: 200, json: { paid: true, id: TX, action: 'PAID', code: 100, amountCents: 500, reference: 'KASSA1700000000000abc' }
  }));
  brug.push({ type: 'return', nonce: 'a'.repeat(32), params: { orderId: TX, statusAction: 'PAID' } });
  await rust();
  assert.deepEqual(k.paden(), ['/api/paynl-app2app-prepare', '/api/paynl-app2app-verify']);
  assert.deepEqual(k.oproepen[1].body, { orderId: TX, reference: 'KASSA1700000000000abc', amountCents: 500 });
  assert.deepEqual(k.bewaard, [['bancontact_terminal', TX]]);
  assert.equal(k.ok[0], 'Betaald met Bancontact terminal');
  assert.equal(brug.laatste('return-ack').nonce, 'a'.repeat(32));
  assert.equal(brug.laatste('clear-open').attemptId, 'att-1');
  // Dezelfde return nog eens (bv. via drain): niet dubbel boeken
  brug.push({ type: 'return', nonce: 'a'.repeat(32), params: { orderId: TX, statusAction: 'PAID' } });
  await rust();
  assert.equal(k.bewaard.length, 1);
});

test('App2App: return zegt PAID maar verify paid=false -> niet geboekt', async () => {
  const { brug, k } = await startApp2App(() => ({
    status: 200, json: { paid: false, id: TX, action: 'CANCELLED', code: -90, amountCents: 500, reference: 'KASSA1700000000000abc' }
  }));
  brug.push({ type: 'return', nonce: 'a'.repeat(32), params: { orderId: TX, statusAction: 'PAID' } });
  await rust();
  assert.equal(k.bewaard.length, 0);
  assert.equal(k.fout[0], 'Betaling geannuleerd');
  assert.ok(!k.paden().includes('/api/paynl-start'));
  assert.ok(!k.paden().includes('/api/paynl-status'));
  assert.equal(brug.laatste('return-ack').nonce, 'a'.repeat(32));
});

test('App2App: bedrag klopt niet (check) -> niet geboekt', async () => {
  const { brug, k } = await startApp2App(() => ({
    status: 200, json: { paid: false, id: TX, action: 'PAID', code: 100, amountCents: 1, reference: 'x', check: 'amount' }
  }));
  brug.push({ type: 'return', nonce: 'a'.repeat(32), params: { orderId: TX } });
  await rust();
  assert.equal(k.bewaard.length, 0);
  assert.match(k.fout[0], /klopt niet/);
});

test('App2App: return voor een andere nonce boekt niet op de lopende bon', async () => {
  const { brug, k } = await startApp2App(() => ({
    status: 200, json: { paid: true, id: TX, action: 'PAID', code: 100, amountCents: 500, reference: 'x' }
  }));
  brug.push({ type: 'return', nonce: 'b'.repeat(32), params: { orderId: TX, statusAction: 'PAID' } });
  await rust();
  assert.equal(k.bewaard.length, 0);
  assert.match(k.fout[0], /niet geboekt/);
});

test('App2App: Annuleer roept geen paynl-abort, geeft de brug vrij', async () => {
  const { brug, k } = await startApp2App();
  await k.ctx.annuleerWacht();
  await rust();
  assert.ok(!k.paden().includes('/api/paynl-abort'));
  assert.equal(brug.laatste('clear-open').attemptId, 'att-1');
  assert.equal(k.gesloten, true);
});

test('cloud: Annuleer roept nog steeds paynl-abort', async () => {
  const k = maakKassa(null, { '/api/paynl-start': startOk, '/api/paynl-abort': () => ({ status: 200, json: { ok: true } }) });
  await k.ctx.startBancontact('terminal');
  await rust();
  await k.ctx.annuleerWacht();
  assert.deepEqual(k.paden(), ['/api/paynl-start', '/api/paynl-abort']);
  assert.ok(k.oproepen[1].url.includes(encodeURIComponent(UUID)));
});

// --- (b) Netlify-functies ---

const echteFetch = global.fetch;
const envOud = { ...process.env };
function zetAuth(aan) {
  // Dummy-waarden, geen echte tokens
  if (aan) { process.env.PAYNL_TOKEN_CODE = 'AT-test-0000'; process.env.PAYNL_API_TOKEN = 'dummy'; }
  else { delete process.env.PAYNL_TOKEN_CODE; delete process.env.PAYNL_API_TOKEN; }
}
delete process.env.PAYNL_REST_BASE;
const prepare = require(path.join(root, 'netlify', 'functions', 'paynl-app2app-prepare.js')).handler;
const verify = require(path.join(root, 'netlify', 'functions', 'paynl-app2app-verify.js')).handler;
const post = (body) => ({ httpMethod: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: {} });
const lees = (r) => JSON.parse(r.body);

test('prepare: 405, 400, 503 en ongeldig bedrag', async () => {
  zetAuth(true);
  assert.equal((await prepare({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await prepare(post('{kapot'))).statusCode, 400);
  for (const a of [0, -1, 1.5, '500', 10000001, null]) {
    assert.equal((await prepare(post({ amountCents: a }))).statusCode, 400, String(a));
  }
  zetAuth(false);
  const r = await prepare(post({ amountCents: 500 }));
  assert.equal(r.statusCode, 503);
  assert.equal(lees(r).error, 'Bancontact is nog niet ingesteld');
});

test('prepare: payload zonder terminalcode, geen pay.nl-oproep', async () => {
  zetAuth(true);
  delete process.env.PAYNL_TERMINAL_CODE;
  let geroepen = false;
  global.fetch = async () => { geroepen = true; throw new Error('mag niet'); };
  const r = await prepare(post({ amountCents: 1234, testMode: true }));
  global.fetch = echteFetch;
  assert.equal(geroepen, false);
  assert.equal(r.statusCode, 200);
  const d = lees(r);
  assert.match(d.nonce, /^[0-9a-f]{32}$/);
  assert.match(d.reference, /^[A-Za-z0-9]{1,32}$/);
  assert.ok(d.attemptId && typeof d.attemptId === 'string');
  assert.deepEqual(d.payload, {
    description: ('Kassa ' + d.reference).slice(0, 64),
    reference: d.reference,
    returnUrl: 'kassaswipe://paynl-return/' + d.nonce,
    amount: { value: 1234, currency: 'EUR' },
    integration: { testMode: true, tipMode: { enabled: false } }
  });
  const d2 = lees(await prepare(post({ amountCents: 1, description: 'x'.repeat(100) })));
  assert.notEqual(d2.nonce, d.nonce);
  assert.notEqual(d2.attemptId, d.attemptId);
  assert.equal(d2.payload.description, 'x'.repeat(64));
  assert.equal(d2.payload.integration.testMode, false);
});

// fetch-mock voor Transaction:Info
function mockPaynl(status, body) {
  const log = [];
  global.fetch = async (url, init) => {
    log.push({ url: String(url), init });
    if (status === 'netwerk') throw new Error('ECONNREFUSED');
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return log;
}

const txInfo = (over) => Object.assign({
  id: TX, reference: 'KASSA1', amount: { value: 500, currency: 'EUR' }, status: { code: 100, action: 'PAID' }
}, over);

test('verify: ongeldig id, 405 en 503', async () => {
  zetAuth(true);
  const log = mockPaynl(200, txInfo());
  for (const id of ['', 'https://evil.example/x', '../orders', 'EX-12', 'a b']) {
    assert.equal((await verify(post({ orderId: id }))).statusCode, 400, id);
  }
  assert.equal((await verify({ httpMethod: 'PUT' })).statusCode, 405);
  zetAuth(false);
  assert.equal((await verify(post({ orderId: TX }))).statusCode, 503);
  global.fetch = echteFetch;
  assert.equal(log.length, 0);
});

test('verify: Transaction:Info met Basic auth op rest.pay.nl/v2', async () => {
  zetAuth(true);
  const log = mockPaynl(200, txInfo());
  const r = await verify(post({ orderId: TX, reference: 'KASSA1', amountCents: 500 }));
  global.fetch = echteFetch;
  assert.equal(log[0].url, 'https://rest.pay.nl/v2/transactions/' + TX);
  assert.equal(log[0].init.method, 'GET');
  assert.ok(/^Basic /.test(log[0].init.headers.Authorization));
  assert.deepEqual(lees(r), { paid: true, id: TX, action: 'PAID', code: 100, amountCents: 500, reference: 'KASSA1' });
});

test('verify: GET met query werkt ook; code 100 telt als betaald', async () => {
  zetAuth(true);
  mockPaynl(200, txInfo({ status: { code: '100', action: 'NEW_PPT' } }));
  const r = await verify({ httpMethod: 'GET', queryStringParameters: { orderId: TX, amountCents: '500' } });
  global.fetch = echteFetch;
  assert.equal(lees(r).paid, true);
  assert.equal(lees(r).code, 100);
});

test('verify: niet betaald, of bedrag/referentie fout -> paid=false', async () => {
  zetAuth(true);
  mockPaynl(200, txInfo({ status: { code: 20, action: 'PENDING' } }));
  assert.equal(lees(await verify(post({ orderId: TX }))).paid, false);
  mockPaynl(200, txInfo({ status: { code: -90, action: 'cancel' } }));
  assert.equal(lees(await verify(post({ orderId: TX }))).action, 'CANCEL');
  mockPaynl(200, txInfo());
  let d = lees(await verify(post({ orderId: TX, amountCents: 501 })));
  assert.equal(d.paid, false); assert.equal(d.check, 'amount');
  d = lees(await verify(post({ orderId: TX, reference: 'ANDERS' })));
  assert.equal(d.paid, false); assert.equal(d.check, 'reference');
  mockPaynl(200, { action: 'paid', amount: { value: 500 } }); // terugval: data.action
  assert.equal(lees(await verify(post({ orderId: TX }))).paid, true);
  global.fetch = echteFetch;
});

test('verify: upstreamfout en netwerkfout lekken geen tokens', async () => {
  zetAuth(true);
  mockPaynl(404, { title: 'Not found' });
  let r = await verify(post({ orderId: TX }));
  assert.equal(r.statusCode, 404);
  assert.equal(lees(r).error, 'pay.nl fout 404: Not found');
  mockPaynl('netwerk');
  r = await verify(post({ orderId: TX }));
  assert.equal(r.statusCode, 502);
  global.fetch = echteFetch;
  assert.ok(!r.body.includes('dummy') && !r.body.includes('AT-test'));
});

(async () => {
  for (const t of testen) {
    try {
      await t.fn();
      console.log('ok   ' + t.naam);
    } catch (err) {
      fouten++;
      console.log('FOUT ' + t.naam + '\n     ' + (err && err.message));
    }
  }
  global.fetch = echteFetch;
  process.env = envOud;
  console.log(fouten ? '\n' + fouten + ' test(s) mislukt' : '\nAlle tests geslaagd');
  process.exit(fouten ? 1 : 0);
})();
