'use strict';
// Tests voor het SwipeDrinks-tokenbedrag op de cent. Gebruik: node tests/swipedrinks.cjs (Node 18+, geen npm).
// swipedrinks.js draait in een vm met een nep-fetch en nep-DOM: er gaat niets naar de echte API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bron = fs.readFileSync(path.join(__dirname, '..', 'swipedrinks.js'), 'utf8');

let fouten = 0;
const wachtrij = [];
function test(naam, fn) { wachtrij.push([naam, fn]); }

function maakContext(bon) {
  const elementen = {};
  const el = (id) => elementen[id] || (elementen[id] = {
    id, textContent: '', disabled: false, style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); } },
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    setAttribute() {}, appendChild() {}, innerHTML: ''
  });
  const aanroepen = [];
  const ctx = {
    bon,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    alert() {},
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null,
      createElement: () => el('x' + Math.random()), addEventListener() {} },
    fetch: async (url, opts) => {
      aanroepen.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ qrcode: 'TEST-QR-' + aanroepen.length }) };
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(bron, ctx, { filename: 'swipedrinks.js' });
  return { ctx, el, aanroepen };
}

const { ctx } = maakContext([]);

test('tokens op de cent afronden', () => {
  assert.equal(ctx.sdTokensVoorTotaal(1.80), 1.8);
  assert.equal(ctx.sdTokensVoorTotaal(1.85), 1.85);
  assert.equal(ctx.sdTokensVoorTotaal(1.854), 1.85);
  assert.equal(ctx.sdTokensVoorTotaal(1.856), 1.86);
  assert.equal(ctx.sdTokensVoorTotaal(0.1 + 0.2), 0.3);
  assert.equal(ctx.sdTokensVoorTotaal(2), 2);
});

test('Belgische weergave met twee decimalen', () => {
  assert.equal(ctx.sdTokensTekst(1.8), '1,80');
  assert.equal(ctx.sdTokensTekst(1.85), '1,85');
  assert.equal(ctx.sdTokensTekst(1.854), '1,85');
  assert.equal(ctx.sdTokensTekst(2), '2,00');
  assert.equal(ctx.sdTokensTekst(0.1 + 0.2), '0,30');
});

test('vergelijken op centen', () => {
  assert.equal(ctx.sdZelfdeTokens(1.85, 1.8499999999), true);
  assert.equal(ctx.sdZelfdeTokens(0.1 + 0.2, 0.3), true);
  assert.equal(ctx.sdZelfdeTokens(1.85, 1.86), false);
  assert.equal(ctx.sdZelfdeTokens(null, 1.85), false);
  assert.equal(ctx.sdZelfdeTokens(1.85, null), false);
});

test('bron rondt niet meer af op hele tokens', () => {
  assert.doesNotMatch(bron, /Math\.round\(\s*totaal\s*\)/);
  assert.doesNotMatch(bron, /sdQRTokens\s*===/);
});

test('ensureQR stuurt total als getal op de cent en hergebruikt QR', async () => {
  const { ctx, aanroepen } = maakContext([{ prijs: 0.95, aantal: 1 }, { prijs: 0.9, aantal: 1 }]);
  const qr = await ctx.ensureQR();
  assert.equal(aanroepen.length, 1);
  assert.match(aanroepen[0].url, /\/api\/generateQR$/);
  assert.equal(typeof aanroepen[0].body.total, 'number');
  assert.equal(aanroepen[0].body.total, 1.85);
  // zelfde bedrag met float-ruis: geen nieuwe QR
  assert.equal(await ctx.ensureQR(1.8499999999), qr);
  assert.equal(await ctx.ensureQR(), qr);
  assert.equal(aanroepen.length, 1);
  // ander bedrag: nieuwe QR
  await ctx.ensureQR(1.9);
  assert.equal(aanroepen.length, 2);
  assert.equal(aanroepen[1].body.total, 1.9);
});

test('openSwipedrinks toont 1,85 tokens', async () => {
  const { ctx, el, aanroepen } = maakContext([{ prijs: 1.85, aantal: 1 }]);
  await ctx.openSwipedrinks();
  assert.equal(el('sd-totaal-tokens').textContent, '1,85');
  assert.equal(el('sd-totaal-qr').textContent, '1,85');
  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].body.total, 1.85);
});

test('openSwipedrinks toont 1,80 (niet 2)', async () => {
  const { ctx, el, aanroepen } = maakContext([{ prijs: 0.6, aantal: 3 }]);
  await ctx.openSwipedrinks();
  assert.equal(el('sd-totaal-tokens').textContent, '1,80');
  assert.equal(aanroepen[0].body.total, 1.8);
});

(async () => {
  for (const [naam, fn] of wachtrij) {
    try {
      await fn();
      console.log('ok   ' + naam);
    } catch (err) {
      fouten++;
      console.log('FOUT ' + naam + '\n     ' + (err && err.message));
    }
  }
  if (fouten) { console.log(fouten + ' test(s) mislukt'); process.exit(1); }
  console.log('alle swipedrinks-tests geslaagd');
})();
