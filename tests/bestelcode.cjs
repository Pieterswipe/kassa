'use strict';
// Tests voor producten.js, bestelcode.js en de bestelling in het controlescherm (bonscan.js).
// Gebruik: node tests/bestelcode.cjs (Node 18+, geen npm).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
let fouten = 0;
function test(naam, fn) {
  try {
    fn();
    console.log('ok   ' + naam);
  } catch (err) {
    fouten++;
    console.log('FOUT ' + naam + '\n     ' + (err && err.message));
  }
}

const { KASSA_PRODUCTEN: producten, KASSA_CATEGORIEEN: categorieen } = require(path.join(root, 'producten.js'));
const bc = require(path.join(root, 'bestelcode.js'));
const bs = require(path.join(root, 'bonscan.js'));
global.window = global;
require(path.join(root, 'bonscanner', 'large-form.js'));
const F = global.LargeBonForm;

// --- producten.js ---

test('alle product-ids uniek (ook in korte vorm) en geldig', () => {
  const ids = producten.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const kort = ids.map(bc.kortId);
  assert.ok(kort.every(Boolean), 'ongeldige id');
  assert.equal(new Set(kort).size, kort.length);
  assert.ok(producten.every(p => !/[,*:]/.test(p.id)));
});

test('alle 50 bonartikelen aanwezig met hun bon-id', () => {
  assert.equal(F.products.length, 50);
  F.products.forEach((naam, i) => {
    const p = producten.find(x => x.id === F.ids[i]);
    assert.ok(p, F.ids[i] + ' ontbreekt');
    assert.equal(p.naam, naam);
  });
  assert.equal(producten.length, 52);
  assert.deepEqual(producten.filter(p => !p.id.startsWith('K50-')).map(p => [p.id, p.naam]),
    [['X01', 'Leffe Blond'], ['X02', 'Stella Artois']]);
});

test('elk product heeft een bestaande categorie en geldige prijs', () => {
  const cats = categorieen.map(c => c.id);
  for (const p of producten) {
    assert.ok(cats.includes(p.categorie), p.naam);
    assert.ok(p.prijs === null || (typeof p.prijs === 'number' && p.prijs > 0), p.naam);
  }
  // Precies de vaste prijzen die vroeger in index.html stonden; de rest is prijs: null
  const vast = Object.fromEntries(producten.filter(p => p.prijs != null).map(p => [p.naam, p.prijs]));
  assert.deepEqual(vast, { Cola: 2, Water: 1.5, Fanta: 2, Sprite: 2, Tonic: 3.2, Appelsap: 3.2, Sinaasappelsap: 3.2,
    Jupiler: 2.5, Duvel: 3.5, 'Leffe Blond': 3, 'Stella Artois': 2.5, 'Jupiler 0.0': 2.8, Loempia: 2.8 });
});

// --- bestelcode.js ---

test('kortId', () => {
  assert.equal(bc.kortId('K50-01'), '01');
  assert.equal(bc.kortId(' k50-7 '), '07');
  assert.equal(bc.kortId('x01'), 'X01');
  assert.equal(bc.kortId('13'), '13');
  assert.equal(bc.kortId(''), '');
  assert.equal(bc.kortId('a*b'), '');
  assert.equal(bc.kortId(null), '');
});

test('encode: compact formaat, K50- weg, nullen weg', () => {
  assert.equal(bc.encodeBestelling([{ id: 'K50-01', aantal: 2 }, { id: 'K50-13', aantal: 1 }, { id: 'X01', aantal: 3 }]),
    'KB1:01*2,13*1,X01*3');
  assert.equal(bc.encodeBestelling([{ id: 'K50-01', aantal: 0 }, { id: 'K50-02', aantal: -1 }, { id: 'K50-03', aantal: 1.5 }]), 'KB1:');
  assert.equal(bc.encodeBestelling([]), 'KB1:');
  assert.equal(bc.encodeBestelling([{ id: 'K50-01', aantal: 500 }]), 'KB1:01*99');
});

test('encode/decode round-trip voor alle producten', () => {
  const items = producten.map((p, i) => ({ id: p.id, aantal: (i % 99) + 1 }));
  const code = bc.encodeBestelling(items);
  assert.ok(code.length < 500, 'QR-tekst te lang: ' + code.length);
  const terug = bc.decodeBestelling(code);
  assert.deepEqual(terug, items.map(i => ({ id: bc.kortId(i.id), aantal: i.aantal })));
  assert.deepEqual(terug.map(i => bc.zoekProduct(i.id, producten).id), producten.map(p => p.id));
});

test('decode: spaties, hoofdletters, K50-voorvoegsel', () => {
  assert.deepEqual(bc.decodeBestelling('  kb1: 01 * 2 , k50-13*1,x01*3 '),
    [{ id: '01', aantal: 2 }, { id: '13', aantal: 1 }, { id: 'X01', aantal: 3 }]);
  assert.deepEqual(bc.decodeBestelling('KB1:'), []);
  assert.deepEqual(bc.decodeBestelling('KB1:1*4'), [{ id: '01', aantal: 4 }]);
});

test('decode: dubbele ids opgeteld (max 99)', () => {
  assert.deepEqual(bc.decodeBestelling('KB1:01*2,02*1,01*3'), [{ id: '01', aantal: 5 }, { id: '02', aantal: 1 }]);
  assert.deepEqual(bc.decodeBestelling('KB1:K50-01*60,01*60'), [{ id: '01', aantal: 99 }]);
});

test('decode: ongeldige aantallen en rommel worden overgeslagen en geteld', () => {
  assert.deepEqual(bc.leesBestelling('KB1:01*0,02*100,03*-1,04*x,05,*3,06*2.5,07*2'),
    { items: [{ id: '07', aantal: 2 }], ongeldig: 7 });
  assert.deepEqual(bc.leesBestelling('KB1:,,01*1,,'), { items: [{ id: '01', aantal: 1 }], ongeldig: 0 });
});

test('decode: geen bestelcode -> null', () => {
  for (const t of ['', null, undefined, 'hallo', 'KB2:01*1', 'https://example.com', '01*2', ' KB1', 'SD:12345']) {
    assert.equal(bc.decodeBestelling(t), null, String(t));
    assert.equal(bc.leesBestelling(t), null, String(t));
  }
});

test('zoekProduct: kort, volledig en onbekend', () => {
  assert.equal(bc.zoekProduct('01', producten).naam, 'Cola');
  assert.equal(bc.zoekProduct('K50-50', producten).naam, 'IJsje');
  assert.equal(bc.zoekProduct('x02', producten).naam, 'Stella Artois');
  assert.equal(bc.zoekProduct('77', producten), null);
  assert.equal(bc.zoekProduct('X99', producten), null);
  assert.equal(bc.zoekProduct('', producten), null);
});

test('kiosk en kassa laden dezelfde bestanden', () => {
  const kiosk = fs.readFileSync(path.join(root, 'bestel', 'index.html'), 'utf8');
  const kassa = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const volgorde = (html, a, b) => html.indexOf('src="' + a + '"') >= 0 && html.indexOf('src="' + a + '"') < html.indexOf('src="' + b + '"');
  assert.ok(volgorde(kiosk, 'producten.js', 'bestel.js') && volgorde(kiosk, 'bestelcode.js', 'bestel.js'));
  assert.ok(volgorde(kassa, 'bestelcode.js', 'bestelscan.js') && volgorde(kassa, 'bonscan.js', 'bestelscan.js'));
  const toml = fs.readFileSync(path.join(root, 'bestel', 'netlify.toml'), 'utf8');
  assert.ok(toml.includes('cp ../producten.js ../bestelcode.js ./'));
  const ignore = fs.readFileSync(path.join(root, 'bestel', '.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('producten.js') && ignore.includes('bestelcode.js'));
});

// --- Bestelling in het controlescherm (bonscan.js) ---

test('bestelling -> controleregels: kassa, prijs nodig, onbekend', () => {
  const items = bc.decodeBestelling('KB1:01*2,31*1,X01*3,77*4');
  const regels = bs.regelsUitBestelling(items, producten, {});
  assert.deepEqual(regels.map(r => [r.koppeling.naam, r.koppeling.soort, r.koppeling.cent, r.aantal, r.onzeker]), [
    ['Cola', 'kassa', 200, 2, false],
    ['Kipcorn', 'prijs-nodig', null, 1, false],
    ['Leffe Blond', 'kassa', 300, 3, false],
    ['Onbekend artikel (77)', 'onbekend', null, 4, false]
  ]);
  let v = bs.verzamel(regels);
  assert.equal(v.klaar, false);
  assert.equal(v.zonderPrijs, 2);

  regels[1].invoer.tekst = '3,20';           // Kipcorn: prijs ingeven
  regels[3].invoer.overslaan = true;         // onbekend: overslaan
  v = bs.verzamel(regels);
  assert.equal(v.klaar, true);
  assert.deepEqual(v.uit, [
    { naam: 'Cola', prijs: 2, aantal: 2 },
    { naam: 'Kipcorn', prijs: 3.2, aantal: 1 },
    { naam: 'Leffe Blond', prijs: 3, aantal: 3 }
  ]);
  assert.deepEqual(v.nieuwePrijzen, { kipcorn: 320 });
});

test('onbekend artikel met prijs: op de bon, maar prijs niet onthouden', () => {
  const regels = bs.regelsUitBestelling([{ id: '77', aantal: 1 }], producten, {});
  regels[0].invoer.tekst = '1,5';
  const v = bs.verzamel(regels);
  assert.equal(v.klaar, true);
  assert.deepEqual(v.uit, [{ naam: 'Onbekend artikel (77)', prijs: 1.5, aantal: 1 }]);
  assert.deepEqual(v.nieuwePrijzen, {});
});

test('onthouden prijs geldt ook voor de bestelling; ongeldige aantallen vallen weg', () => {
  const regels = bs.regelsUitBestelling([{ id: '20', aantal: 2 }, { id: '01', aantal: 0 }, { id: '02', aantal: 'x' }],
    producten, { koffie: 180 });
  assert.equal(regels.length, 1);
  assert.deepEqual(regels[0].koppeling, { soort: 'kassa', naam: 'Koffie', cent: 180 });
  assert.equal(bs.verzamel(regels).klaar, true);
  assert.deepEqual(bs.regelsUitBestelling([], producten, {}), []);
  assert.equal(bs.verzamel([]).klaar, false);
});

// --- Kassa bouwt tabs en knoppen uit producten.js (kassa.js, nep-DOM) ---

function nepElement(tag) {
  const e = {
    tagName: tag, children: [], text: '', className: '', id: '', dataset: {}, luisteraars: {},
    classList: {
      add(k) { e.className = (e.className + ' ' + k).trim(); },
      remove(k) { e.className = e.className.split(' ').filter(x => x !== k).join(' '); },
      toggle(k, aan) { aan ? this.add(k) : this.remove(k); },
      contains(k) { return e.className.split(' ').includes(k); }
    },
    set textContent(t) { e.text = String(t); e.children = []; },
    get textContent() { return e.text + e.children.map(c => (typeof c === 'string' ? c : c.textContent)).join(''); },
    append(...c) { e.children.push(...c); },
    appendChild(c) { e.children.push(c); },
    replaceChildren() { e.children = []; e.text = ''; },
    addEventListener(type, fn) { e.luisteraars[type] = fn; },
    click() { e.luisteraars.click(); },
    querySelector(sel) { return alle(e).find(x => x.className && x.className.split(' ').includes(sel.slice(1))) || null; }
  };
  return e;
}
function alle(e) {
  return (e.children || []).filter(c => typeof c !== 'string').flatMap(c => [c, ...alle(c)]);
}

test('kassa.js bouwt tabs en knoppen uit producten.js', () => {
  const vasteEls = { tabs: nepElement('div'), 'knoppen-vak': nepElement('div'), 'bon-lijst': nepElement('ul'),
    totaal: nepElement('span'), 'rekening-label': nepElement('div'), 'rek-knop': nepElement('button') };
  const opslag = { 'kassa.bonscan.prijzen': JSON.stringify({ koffie: 180 }) };
  const ctx = {
    console, Intl, JSON,
    localStorage: { getItem: k => (k in opslag ? opslag[k] : null), setItem: (k, w) => { opslag[k] = String(w); } },
    prompt: () => null, alert: () => {},
    euro: c => '€' + (c / 100).toFixed(2).replace('.', ',')
  };
  ctx.document = {
    getElementById: id => vasteEls[id] || alle(vasteEls['knoppen-vak']).find(x => x.id === id) ||
      vasteEls['knoppen-vak'].children.find(x => x.id === id) || nepElement('div'),
    createElement: nepElement,
    querySelectorAll: sel => {
      const knoppen = alle(vasteEls['knoppen-vak']);
      if (sel === '.item-knop[data-vraag-prijs]') return knoppen.filter(k => k.dataset.vraagPrijs);
      if (sel === '.categorie') return vasteEls['knoppen-vak'].children;
      if (sel === '.tab') return vasteEls.tabs.children;
      return [];
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['producten.js', 'prijzen.js', 'kassa.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);

  const tabs = vasteEls.tabs.children;
  assert.deepEqual(tabs.map(t => t.textContent), categorieen.map(c => c.titel));
  assert.ok(tabs[0].classList.contains('actief'));
  const cats = vasteEls['knoppen-vak'].children;
  assert.deepEqual(cats.map(c => c.id), categorieen.map(c => c.id));
  assert.deepEqual(cats.map(c => c.classList.contains('verborgen')), [false, true, true, true, true, true]);
  const knoppen = cats.flatMap(c => c.children);
  assert.deepEqual(knoppen.map(k => k.dataset.naam), producten.map(p => p.naam));

  const cola = knoppen.find(k => k.dataset.naam === 'Cola');
  assert.equal(cola.textContent, 'Cola€2,00');
  assert.equal(cola.classList.contains('zonder-prijs'), false);
  const kipcorn = knoppen.find(k => k.dataset.naam === 'Kipcorn');
  assert.equal(kipcorn.textContent, 'Kipcornprijs?');
  assert.ok(kipcorn.classList.contains('zonder-prijs'));
  const koffie = knoppen.find(k => k.dataset.naam === 'Koffie'); // onthouden prijs
  assert.equal(koffie.textContent, 'Koffie€1,80');
  assert.equal(koffie.classList.contains('zonder-prijs'), false);

  cola.click(); cola.click(); koffie.click();
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('bon', ctx))),
    [{ naam: 'Cola', prijs: 2, aantal: 2 }, { naam: 'Koffie', prijs: 1.8, aantal: 1 }]);

  tabs[1].click();                                    // tab Bieren
  assert.ok(tabs[1].classList.contains('actief') && !tabs[0].classList.contains('actief'));
  assert.equal(cats[1].classList.contains('verborgen'), false);
  assert.equal(cats[0].classList.contains('verborgen'), true);
});

console.log(fouten ? fouten + ' test(s) mislukt' : 'Alle tests geslaagd');
process.exit(fouten ? 1 : 0);
