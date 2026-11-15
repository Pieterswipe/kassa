'use strict';
// Browsertest: in een gewone browser (zonder window.AndroidPaynl) gaat Bancontact Terminal
// via /api/paynl-start en nooit via /api/paynl-app2app-*. Doet geen echte pay.nl-oproepen:
// alle /api/** worden onderschept, externe scripts (CDN) krijgen een lege stub.
//
// Gebruik (playwright-core is geen dependency van de kassa):
//   NODE_PATH=/tmp/pw-shot/node_modules node tests/app2app-browser.cjs
// Optioneel: CHROME=/pad/naar/chrome (standaard /usr/bin/google-chrome-stable).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Kleine statische server voor de kassamap
function serveer() {
  const server = http.createServer((req, res) => {
    let pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pad.endsWith('/')) pad += 'index.html';
    const bestand = path.join(root, path.normalize(pad));
    if (!bestand.startsWith(root + path.sep) || !fs.existsSync(bestand) || fs.statSync(bestand).isDirectory()) {
      res.writeHead(404); res.end('niet gevonden'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(bestand)] || 'application/octet-stream' });
    fs.createReadStream(bestand).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serveer();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox']
  });
  let fout = null;
  try {
    const page = await browser.newPage();
    const api = [];
    const paginaFouten = [];
    page.on('pageerror', e => paginaFouten.push(e.message));

    // Externe scripts (supabase, qrcode, html5-qrcode): lege stub, geen netwerk nodig
    await page.route(url => !url.href.startsWith(base), route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' }));
    // Alle API-oproepen onderscheppen
    await page.route(base + '/api/**', route => {
      const url = new URL(route.request().url());
      api.push({ pad: url.pathname, body: route.request().postData() });
      if (url.pathname === '/api/paynl-start') {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: '0b5e2b6e-1c1f-4d7e-9a0a-3f6f2a1b9c11', orderId: '1', redirect: null, status: 'PENDING' }) });
      }
      if (url.pathname === '/api/paynl-status') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ action: 'PENDING', code: 20 }) });
      }
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'niet verwacht in deze test' }) });
    });

    await page.goto(base + '/index.html');
    assert.equal(await page.evaluate(() => typeof window.AndroidPaynl), 'undefined');
    assert.equal(await page.evaluate(() => typeof startBancontact), 'function');

    // Product met vaste prijs op de bon zetten via de echte knop
    const knop = page.locator('.categorie:not(.verborgen) .item-knop:not([data-vraag-prijs])').first();
    await knop.click();
    assert.ok(await page.evaluate(() => bon.length) > 0, 'bon is leeg');
    const totaal = await page.evaluate(() => bonTotaalCents());

    // Afrekenen -> Bancontact -> Terminal
    await page.click('.afrekenen-knop');
    await page.click('#bet-keuze button:has-text("Bancontact")');
    const startVerzoek = page.waitForRequest(r => r.url().endsWith('/api/paynl-start'));
    await page.click('#bet-bc button:has-text("Terminal")');
    const verzoek = await startVerzoek;
    const body = JSON.parse(verzoek.postData());
    assert.equal(body.mode, 'terminal');
    assert.equal(body.amountCents, totaal);

    await page.waitForFunction(() =>
      document.getElementById('bet-wacht-tekst').textContent === 'Volg de instructies op de terminal...');
    // Even laten pollen (paynl-status, gemockt)
    await page.waitForTimeout(2500);

    const paden = api.map(a => a.pad);
    assert.ok(paden.includes('/api/paynl-start'), 'geen paynl-start');
    assert.ok(!paden.some(p => p.startsWith('/api/paynl-app2app')), 'App2App aangeroepen: ' + paden.join(', '));
    assert.equal(paden.filter(p => p === '/api/paynl-start').length, 1);
    assert.deepEqual(paginaFouten, []);
    console.log('ok   browser: Bancontact Terminal -> /api/paynl-start, geen App2App (' + paden.join(', ') + ')');
  } catch (err) {
    fout = err;
    console.log('FOUT ' + (err && err.message));
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(fout ? 1 : 0);
})();
