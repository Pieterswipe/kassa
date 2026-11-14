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

// Test-kopie waarin enkele artikelen (zoals vroeger) geen prijs hebben, om de terugval te testen.
const zonderPrijs = (lijst, namen) => lijst.map(p => (namen.includes(p.naam) ? Object.assign({}, p, { prijs: null }) : p));
const testProducten = zonderPrijs(producten, ['Koffie', 'Kipcorn']);

test('elk product heeft een bestaande categorie en een prijs > 0 (afgerond op 0,10)', () => {
  const cats = categorieen.map(c => c.id);
  for (const p of producten) {
    assert.ok(cats.includes(p.categorie), p.naam);
    assert.ok(typeof p.prijs === 'number' && p.prijs > 0, p.naam + ' heeft geen prijs');
    assert.equal(Math.round(p.prijs * 100) % 10, 0, p.naam + ' niet afgerond op 0,10');
  }
  // Redelijke grenzen per categorie (sportclubkantine)
  const grens = { fris: [1.5, 3.2], bier: [2.5, 4], warm: [1.8, 2.8], snack: [2.5, 4], brood: [3, 5], zoet: [1, 2.5] };
  for (const p of producten) {
    const [min, max] = grens[p.categorie];
    assert.ok(p.prijs >= min && p.prijs <= max, p.naam + ' ' + p.prijs);
  }
});

test('de bestaande vaste prijzen bleven ongewijzigd', () => {
  const prijs = n => producten.find(p => p.naam === n).prijs;
  const oud = { Cola: 2, Water: 1.5, Fanta: 2, Sprite: 2, Tonic: 3.2, Appelsap: 3.2, Sinaasappelsap: 3.2,
    Jupiler: 2.5, Duvel: 3.5, 'Leffe Blond': 3, 'Stella Artois': 2.5, 'Jupiler 0.0': 2.8, Loempia: 2.8 };
  for (const [naam, p] of Object.entries(oud)) assert.equal(prijs(naam), p, naam);
  // logische verhoudingen
  assert.equal(prijs('Cola Zero'), prijs('Cola'));
  assert.equal(prijs('Spuitwater'), prijs('Water'));
  assert.ok(prijs('Friet klein') < prijs('Friet groot'));
  assert.ok(prijs('Koffie') < prijs('Cappuccino') && prijs('Thee') < prijs('Warme chocomelk'));
  assert.ok(prijs('Broodje kaas') < prijs('Broodje hesp-kaas') && prijs('Broodje hesp') < prijs('Broodje gezond'));
  assert.ok(prijs('Suikerwafel') <= prijs('Chips zout'));
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
  const regels = bs.regelsUitBestelling(items, testProducten, {}); // Kipcorn hier zonder prijs
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
    testProducten, { koffie: 190 });
  assert.equal(regels.length, 1);
  assert.deepEqual(regels[0].koppeling, { soort: 'kassa', naam: 'Koffie', cent: 190 });
  // met de echte lijst wint de vaste prijs
  assert.deepEqual(bs.regelsUitBestelling([{ id: '20', aantal: 2 }], producten, { koffie: 190 })[0].koppeling,
    { soort: 'kassa', naam: 'Koffie', cent: 180 });
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

// Laadt producten.js, prijzen.js en kassa.js in een nep-browser.
// zonder: namen die (voor de test) geen prijs krijgen, zoals vroeger.
function laadKassa(opslag, zonder) {
  const vasteEls = { tabs: nepElement('div'), 'knoppen-vak': nepElement('div'), 'bon-lijst': nepElement('ul'),
    totaal: nepElement('span'), 'rekening-label': nepElement('div'), 'rek-knop': nepElement('button') };
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
  vm.runInContext(fs.readFileSync(path.join(root, 'producten.js'), 'utf8'), ctx);
  ctx.zonder = zonder || [];
  vm.runInContext('KASSA_PRODUCTEN.forEach(p => { if (zonder.includes(p.naam)) p.prijs = null; })', ctx);
  for (const f of ['prijzen.js', 'kassa.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
  const cats = vasteEls['knoppen-vak'].children;
  return {
    ctx, tabs: vasteEls.tabs.children, cats, knoppen: cats.flatMap(c => c.children),
    knop: naam => cats.flatMap(c => c.children).find(k => k.dataset.naam === naam),
    bon: () => JSON.parse(JSON.stringify(vm.runInContext('bon', ctx))),
    geleerd: () => JSON.parse(opslag['kassa.bonscan.prijzen'] || '{}')
  };
}

test('kassa.js bouwt tabs en knoppen uit producten.js, elke knop met prijs', () => {
  const opslag = { 'kassa.bonscan.prijzen': JSON.stringify({ koffie: 190, cola: 999, 'gin-tonic': 900 }) };
  const k = laadKassa(opslag);

  assert.deepEqual(k.tabs.map(t => t.textContent), ['Fris', 'Bier', 'Warm', 'Snacks', 'Broodjes', 'Zoet']);
  assert.ok(k.tabs[0].classList.contains('actief'));
  assert.deepEqual(k.cats.map(c => c.id), categorieen.map(c => c.id));
  assert.deepEqual(k.cats.map(c => c.classList.contains('verborgen')), [false, true, true, true, true, true]);
  assert.deepEqual(k.knoppen.map(x => x.dataset.naam), producten.map(p => p.naam));

  // Overal een prijs: geen "prijs?", geen zonder-prijs, geen prijsvraag
  for (const p of producten) {
    const knop = k.knop(p.naam);
    assert.equal(knop.textContent, p.naam + '€' + p.prijs.toFixed(2).replace('.', ','), p.naam);
    assert.equal(knop.classList.contains('zonder-prijs'), false, p.naam);
    assert.equal(knop.dataset.vraagPrijs, undefined, p.naam);
  }
  // Vaste prijs wint: onthouden Koffie (1,90) en Cola (9,99) worden niet gebruikt en opgeruimd
  assert.equal(k.knop('Koffie').textContent, 'Koffie€1,80');
  assert.deepEqual(k.geleerd(), { 'gin-tonic': 900 });

  k.knop('Cola').click(); k.knop('Cola').click(); k.knop('Koffie').click();
  assert.deepEqual(k.bon(), [{ naam: 'Cola', prijs: 2, aantal: 2 }, { naam: 'Koffie', prijs: 1.8, aantal: 1 }]);

  k.tabs[1].click();                                    // tab Bieren
  assert.ok(k.tabs[1].classList.contains('actief') && !k.tabs[0].classList.contains('actief'));
  assert.equal(k.cats[1].classList.contains('verborgen'), false);
  assert.equal(k.cats[0].classList.contains('verborgen'), true);
});

test('kassa.js terugval voor een artikel zonder prijs blijft werken', () => {
  const opslag = { 'kassa.bonscan.prijzen': JSON.stringify({ koffie: 190, cola: 999 }) };
  const k = laadKassa(opslag, ['Koffie', 'Kipcorn']);   // in de test zonder vaste prijs
  assert.equal(k.knop('Kipcorn').textContent, 'Kipcornprijs?');
  assert.ok(k.knop('Kipcorn').classList.contains('zonder-prijs'));
  assert.equal(k.knop('Koffie').textContent, 'Koffie€1,90');      // onthouden prijs blijft
  assert.equal(k.knop('Koffie').classList.contains('zonder-prijs'), false);
  assert.equal(k.knop('Cola').textContent, 'Cola€2,00');          // vaste prijs wint
  assert.deepEqual(k.geleerd(), { koffie: 190 });                 // alleen cola opgeruimd
  k.knop('Koffie').click();
  assert.deepEqual(k.bon(), [{ naam: 'Koffie', prijs: 1.9, aantal: 1 }]);
});

// --- Kiosk (bestel/bestel.js, nep-DOM) ---

function laadKiosk(zonder) {
  const els = {};
  const lijst = () => els.lijst || (els.lijst = nepElement('main'));
  const ctx = {
    console, JSON,
    sessionStorage: { getItem: () => null, setItem() {} },
    innerWidth: 400, innerHeight: 800, scrollTo() {},
    document: {
      getElementById: id => els[id] || alle(lijst()).find(x => x.id === id) || (els[id] = nepElement('div')),
      createElement: tag => Object.assign(nepElement(tag), { setAttribute() {} }),
      querySelector: () => nepElement('div')
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['producten.js', 'bestelcode.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
  ctx.zonder = zonder || [];
  vm.runInContext('KASSA_PRODUCTEN.forEach(p => { if (zonder.includes(p.naam)) p.prijs = null; })', ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'bestel', 'bestel.js'), 'utf8'), ctx);
  const rijen = alle(lijst()).filter(x => x.className === 'rij');
  const prijsVan = id => rijen.find(r => r.dataset.id === id).querySelector('.prijs');
  return { rijen, prijsVan };
}

test('kiosk toont bij elk artikel een prijs', () => {
  const kiosk = laadKiosk();
  assert.deepEqual(kiosk.rijen.map(r => r.dataset.id), producten.map(p => p.id));
  for (const p of producten) {
    const el = kiosk.prijsVan(p.id);
    assert.equal(el.textContent, '€' + p.prijs.toFixed(2).replace('.', ','), p.naam);
    assert.equal(el.classList.contains('prijs-kassa'), false, p.naam);
  }
});

test('kiosk terugval "prijs aan de kassa" blijft werken', () => {
  const kiosk = laadKiosk(['Kipcorn']);
  assert.equal(kiosk.prijsVan('K50-31').textContent, 'prijs aan de kassa');
  assert.equal(kiosk.prijsVan('K50-01').textContent, '€2,00');
});

console.log(fouten ? fouten + ' test(s) mislukt' : 'Alle tests geslaagd');
process.exit(fouten ? 1 : 0);
