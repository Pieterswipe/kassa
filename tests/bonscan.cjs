'use strict';
// Tests voor de bonscanner in de kassa. Gebruik: node tests/bonscan.cjs (Node 18+, geen npm).
// (a) De gekopieerde bonscanner-bestanden lezen drie synthetische bonbeelden (zoals
//     tests/optics.cjs in Pieterswipe/bon-scanner). Elke fixture: breedte en hoogte
//     (uint32 big-endian) gevolgd door één grijswaarde per pixel, gzip.
// (b) De pure koppel-functies uit bonscan.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');

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

// --- (a) Beeldherkenning ---

global.window = global;
for (const name of ['form', 'large-form', 'zone-form', 'scanner', 'live']) {
  require(path.join(root, 'bonscanner', name + '.js'));
}

test('bonscanner-bestanden laden', () => {
  assert.equal(typeof global.scanForm, 'function');
  assert.equal(typeof global.createLiveBonScanner, 'function');
  assert.equal(global.ZoneBonForm.id, 'Z50');
  assert.equal(global.ZoneBonForm.products.length, 50);
  assert.equal(global.ZoneBonForm.zones.length, 4);
});

function scanFixture(name) {
  const pixels = gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.gray.gz')));
  const width = pixels.readUInt32BE(0);
  const height = pixels.readUInt32BE(4);
  assert.equal(pixels.length, 8 + width * height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.fill(pixels[i + 8], i * 4, i * 4 + 3);
    data[i * 4 + 3] = 255;
  }
  return global.scanForm({ data, width, height });
}

function quantities(zones) {
  return Object.fromEntries(zones.flatMap(zone =>
    zone.indices.map((index, row) => [index, zone.rows[row].quantity])));
}

test('fixture clear: volledige bon, 8 artikelen', () => {
  const clear = scanFixture('clear');
  assert.equal(clear.template, 'Z50');
  assert.equal(clear.zones.length, 4);
  const known = { 0: 2, 9: 1, 12: 3, 24: 1, 25: 4, 35: 2, 44: 5, 49: 6 };
  const expected = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i, known[i] || 0]));
  assert.deepEqual(quantities(clear.zones), expected);
});

for (const [name, beers] of [['pen-empty', [0, 0, 0]], ['pen-marked', [6, 2, 1]]]) {
  test('fixture ' + name + ': linksboven deels bedekt door pen', () => {
    const result = scanFixture(name);
    assert.equal(result.overviewEstablished, true);
    assert.deepEqual(result.zones.map(zone => zone.id).sort(), ['BL', 'BR', 'TR']);
    assert.deepEqual(result.partialZones.map(zone => zone.id), ['TL']);
    const rows = quantities(result.partialZones);
    for (let i = 0; i < 10; i++) assert.equal(rows[i], null, name + ' covered row ' + i);
    assert.deepEqual([rows[10], rows[11], rows[12]], beers);
  });
}

// Extra: een eenvoudig getekende vierzonebon (zonder fixture), rechtstreeks uit de
// geometrie van ZoneBonForm: hoekblokjes, zonecodes, bolletjes en volle markeringen.
function tekenZoneBon(aantallen, schaal = 2) {
  const F = global.ZoneBonForm;
  const width = Math.round(F.width * schaal), height = Math.round(F.height * schaal);
  const gray = new Uint8Array(width * height).fill(255);
  function vul(x0, y0, x1, y1, waarde, binnen) {
    for (let py = Math.max(0, Math.floor(y0 * schaal)); py < Math.min(height, Math.ceil(y1 * schaal)); py++) {
      for (let px = Math.max(0, Math.floor(x0 * schaal)); px < Math.min(width, Math.ceil(x1 * schaal)); px++) {
        const x = (px + 0.5) / schaal, y = (py + 0.5) / schaal;
        if (!binnen || binnen(x, y)) gray[py * width + px] = waarde;
      }
    }
  }
  const blok = (cx, cy, w, h) => vul(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 0);
  for (const zone of F.zones) {
    zone.corners.forEach(([x, y]) => blok(x, y, zone.markerSize, zone.markerSize));
    zone.codeBlack.forEach(x => blok(x, zone.codeY, 6, 9));
    zone.bottomBlack.forEach(x => blok(x, zone.bottomY, 6, 9));
    zone.indices.forEach((index, i) => zone.centers[i].forEach(([cx, cy], j) => {
      const r = F.radius;
      vul(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, 60,
        (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= 0.45);
      if (aantallen[index] === j + 1) {
        vul(cx - 5, cy - 5, cx + 5, cy + 5, 21, (x, y) => Math.hypot(x - cx, y - cy) <= 4.8);
      }
    }));
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.fill(gray[i], i * 4, i * 4 + 3);
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

test('synthetische vierzonebon (zonder fixture)', () => {
  const sample = global.ZoneBonForm.sample;
  const result = global.scanForm(tekenZoneBon(sample));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.template, 'Z50');
  assert.equal(result.zones.length, 4);
  assert.deepEqual(result.rows.map(r => r.quantity), Array.from(sample));
});

// --- (b) Koppel-functies ---

const bs = require(path.join(root, 'bonscan.js'));

// Kassaproducten: één bron, producten.js (index.html bouwt er de knoppen mee op)
const { KASSA_PRODUCTEN: kassa, KASSA_CATEGORIEEN } = require(path.join(root, 'producten.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Elk artikel heeft nu een vaste prijs. Om de terugval ("Prijs nodig") te testen:
// een kopie van de lijst waarin enkele artikelen (zoals vroeger) geen prijs hebben.
const zonderPrijs = (lijst, namen) => lijst.map(p => (namen.includes(p.naam) ? Object.assign({}, p, { prijs: null }) : p));
const testKassa = zonderPrijs(kassa, ['Koffie', 'Kipcorn', 'Boulet']);

test('kassaproducten uit producten.js', () => {
  assert.equal(kassa.length, 52); // 50 bonartikelen + Leffe Blond + Stella Artois
  const kort = n => { const p = kassa.find(x => x.naam === n); return { naam: p.naam, prijs: p.prijs }; };
  assert.deepEqual(kort('Cola'), { naam: 'Cola', prijs: 2 });
  assert.deepEqual(kort('Leffe Blond'), { naam: 'Leffe Blond', prijs: 3 });
  assert.deepEqual(kort('Kipcorn'), { naam: 'Kipcorn', prijs: 2.8 });
  // index.html heeft geen eigen productlijst meer, wel de lege vakken en producten.js
  assert.equal(/onclick="voegToe/.test(html), false);
  assert.ok(html.includes('id="tabs"') && html.includes('id="knoppen-vak"'));
  assert.ok(html.indexOf('src="producten.js"') < html.indexOf('src="kassa.js"'));
});

test('geen dubbele knoppen en de 8 oude prijzen ongewijzigd', () => {
  const namen = kassa.map(p => bs.normNaam(p.naam));
  assert.equal(new Set(namen).size, namen.length);
  const oud = { Jupiler: 2.5, 'Leffe Blond': 3, Duvel: 3.5, 'Stella Artois': 2.5, Cola: 2, Fanta: 2, Sprite: 2, Water: 1.5 };
  for (const [naam, prijs] of Object.entries(oud)) {
    assert.equal(kassa.find(p => p.naam === naam).prijs, prijs, naam);
  }
  // Leffe Blond en Stella Artois staan bij Bieren
  assert.equal(kassa.find(p => p.naam === 'Leffe Blond').categorie, 'bier');
  assert.equal(kassa.find(p => p.naam === 'Stella Artois').categorie, 'bier');
});

test('alle 50 bonartikelen zijn een kassaknop (Z50 en K50)', () => {
  for (const vorm of [global.ZoneBonForm, global.LargeBonForm]) {
    assert.equal(vorm.products.length, 50);
    for (const naam of vorm.products) {
      const k = bs.koppel(naam, kassa, {}, bs.ALIASSEN);
      // elk bonartikel heeft nu een vaste prijs: nooit meer "Prijs nodig"
      assert.equal(k.soort, 'kassa', vorm.id + ' ' + naam + ' -> ' + k.soort);
      assert.ok(k.cent > 0, naam);
      assert.equal(k.naam, naam);
    }
  }
});

test('elke bon-categorie is een tab met precies haar artikelen', () => {
  const F = global.LargeBonForm;
  assert.deepEqual(KASSA_CATEGORIEEN.map(c => c.titel), F.groups.map(g => g.title));
  KASSA_CATEGORIEEN.forEach(({ id }, i) => {
    const inTab = kassa.filter(p => p.categorie === id).map(p => p.naam)
      .filter(n => n !== 'Leffe Blond' && n !== 'Stella Artois');
    const g = F.groups[i];
    assert.deepEqual(inTab, F.products.slice(g.start, g.start + g.count), id);
  });
});

test('bon-ids in producten.js volgen bonscanner/large-form.js', () => {
  const F = global.LargeBonForm;
  F.ids.forEach((id, i) => assert.equal(kassa.find(p => p.id === id).naam, F.products[i], id));
});

test('naam-normalisatie', () => {
  assert.equal(bs.normNaam('  Leffe   BLOND '), 'leffe blond');
  assert.equal(bs.normNaam('Cola\tZero'), 'cola zero');
  assert.equal(bs.normNaam(null), '');
});

test('matching op naam en alias', () => {
  assert.equal(bs.zoekKassaProduct('cola', kassa, {}).naam, 'Cola');
  assert.equal(bs.zoekKassaProduct(' JUPILER ', kassa, {}).naam, 'Jupiler');
  assert.equal(bs.zoekKassaProduct('Cola Zero', kassa, {}).naam, 'Cola Zero');
  assert.equal(bs.zoekKassaProduct('Gin-tonic', kassa, {}), null);
  assert.equal(bs.zoekKassaProduct('Stella', kassa, { 'STELLA': 'Stella Artois' }).naam, 'Stella Artois');
  // Alias naar een onbestaand product: val terug op de eigen naam
  assert.equal(bs.zoekKassaProduct('Water', kassa, { water: 'Plat water' }).naam, 'Water');
});

test('prijs parsen naar centen', () => {
  assert.equal(bs.prijsNaarCent('2,50'), 250);
  assert.equal(bs.prijsNaarCent('2.5'), 250);
  assert.equal(bs.prijsNaarCent('€ 3'), 300);
  assert.equal(bs.prijsNaarCent(' 1,05 '), 105);
  assert.equal(bs.prijsNaarCent('0'), null);
  assert.equal(bs.prijsNaarCent(''), null);
  assert.equal(bs.prijsNaarCent('abc'), null);
  assert.equal(bs.prijsNaarCent('-2'), null);
  assert.equal(bs.prijsNaarCent('2,505'), null);
});

test('koppel: kassa, prijs nodig, geleerd, onbekend', () => {
  assert.deepEqual(bs.koppel('Duvel', kassa, {}, {}), { soort: 'kassa', naam: 'Duvel', cent: 350 });
  // Knop zonder vaste prijs + onthouden prijs -> gewoon de prijs
  assert.deepEqual(bs.koppel('Koffie', testKassa, { koffie: 190 }, {}), { soort: 'kassa', naam: 'Koffie', cent: 190 });
  // Knop zonder vaste of onthouden prijs -> prijs vragen
  assert.deepEqual(bs.koppel('Kipcorn', testKassa, {}, {}), { soort: 'prijs-nodig', naam: 'Kipcorn', cent: null });
  // Geen knop
  assert.deepEqual(bs.koppel('Gin-tonic', kassa, { 'gin-tonic': 900 }, {}), { soort: 'geleerd', naam: 'Gin-tonic', cent: 900 });
  assert.deepEqual(bs.koppel('Gin-tonic', kassa, {}, {}), { soort: 'onbekend', naam: 'Gin-tonic', cent: null });
});

test('bestaande (vaste) prijs wint van een onthouden prijs', () => {
  assert.equal(bs.koppel('Duvel', kassa, { duvel: 999 }, {}).cent, 350);
  assert.equal(bs.koppel('Cola', kassa, { cola: 999 }, {}).cent, 200);
  // ook voor de nieuw geprijsde artikelen (vroeger prijsloos, toen onthouden)
  assert.deepEqual(bs.koppel('Koffie', kassa, { koffie: 999 }, {}), { soort: 'kassa', naam: 'Koffie', cent: 180 });
  assert.equal(bs.koppel('Kipcorn', kassa, { kipcorn: 320 }, {}).cent, 280);
  // en in de bestelling (bestelscan): vaste prijs, geen nieuwe prijs om te onthouden
  const r = bs.regelsUitBestelling([{ id: '31', aantal: 1 }], kassa, { kipcorn: 320 });
  r[0].invoer.tekst = '9,99';
  const v = bs.verzamel(r);
  assert.deepEqual(v.uit, [{ naam: 'Kipcorn', prijs: 2.8, aantal: 1 }]);
  assert.deepEqual(v.nieuwePrijzen, {});
});

test('ruimOp: onthouden prijzen van artikelen met vaste prijs verdwijnen', () => {
  const pr = require(path.join(root, 'prijzen.js'));
  const opslag = { 'kassa.bonscan.prijzen': JSON.stringify({ koffie: 190, kipcorn: 320, cola: 999, 'gin-tonic': 900 }) };
  global.localStorage = { getItem: k => (k in opslag ? opslag[k] : null), setItem: (k, w) => { opslag[k] = String(w); } };
  try {
    assert.equal(pr.ruimOp(testKassa), 1);              // alleen Cola heeft hier een vaste prijs
    assert.deepEqual(pr.leesGeleerd(), { koffie: 190, kipcorn: 320, 'gin-tonic': 900 });
    assert.equal(pr.ruimOp(kassa), 2);                  // echte lijst: Koffie en Kipcorn nu ook vast
    assert.deepEqual(pr.leesGeleerd(), { 'gin-tonic': 900 }); // geen kassaknop: blijft bewaard
    assert.equal(pr.ruimOp(kassa), 0);                  // niets meer te doen
  } finally {
    delete global.localStorage;
  }
});

test('prijsloos artikel: prijs vragen, onthouden, daarna gekend', () => {
  const regel = () => ({ bonNaam: 'Kipcorn', aantal: 2, onzeker: false,
    koppeling: bs.koppel('Kipcorn', testKassa, geleerd, {}), invoer: { tekst: '', overslaan: false } });
  let geleerd = {};
  let r = regel();
  assert.equal(r.koppeling.soort, 'prijs-nodig');
  let v = bs.verzamel([r]);
  assert.equal(v.klaar, false);
  assert.equal(v.zonderPrijs, 1);
  r.invoer.tekst = '3,20';
  v = bs.verzamel([r]);
  assert.equal(v.klaar, true);
  assert.deepEqual(v.uit, [{ naam: 'Kipcorn', prijs: 3.2, aantal: 2 }]);
  assert.deepEqual(v.nieuwePrijzen, { kipcorn: 320 });
  geleerd = v.nieuwePrijzen;                         // zoals bewaarGeleerd
  r = regel();
  assert.deepEqual(r.koppeling, { soort: 'kassa', naam: 'Kipcorn', cent: 320 });
  assert.equal(bs.verzamel([r]).klaar, true);
});

test('bonscan.js en prijzen.js delen dezelfde functies', () => {
  const pr = require(path.join(root, 'prijzen.js'));
  assert.equal(pr.PRIJZEN_SLEUTEL, 'kassa.bonscan.prijzen');
  for (const t of ['2,50', '2.5', '€ 3', 'abc', '0', '2,505']) assert.equal(bs.prijsNaarCent(t), pr.prijsNaarCent(t), t);
  assert.equal(bs.normNaam('  Leffe   BLOND '), pr.normNaam('  Leffe   BLOND '));
  assert.equal(pr.geleerdePrijs('Kip Corn', { 'kip corn': 300 }), 300);
  assert.equal(pr.geleerdePrijs('Kipcorn', { kipcorn: 0 }), null);
  assert.equal(pr.geleerdePrijs('Kipcorn', { kipcorn: '3' }), null);
});

// Kassaknop zonder prijs in kassa.js: met nep-DOM, nep-prompt en nep-localStorage.
test('kassaknop zonder prijs vraagt de prijs één keer (kassa.js)', () => {
  const vm = require('node:vm');
  const opslag = {};
  const antwoorden = ['abc', '2,80', null];
  const vragen = [], meldingen = [];
  const el = () => ({ innerHTML: '', textContent: '', appendChild() {}, append() {}, classList: { toggle() {} } });
  const knopPrijs = { textContent: 'prijs?' };
  const knop = {
    dataset: { naam: 'Kipcorn', vraagPrijs: '1' },
    querySelector: () => knopPrijs,
    classList: { aan: true, toggle(k, aan) { this.aan = aan; } }
  };
  const ctx = {
    console, Intl,
    localStorage: { getItem: k => (k in opslag ? opslag[k] : null), setItem: (k, w) => { opslag[k] = String(w); } },
    prompt: vraag => { vragen.push(vraag); return antwoorden.shift(); },
    alert: m => meldingen.push(m),
    document: { getElementById: el, createElement: el, querySelectorAll: () => [knop] },
    euro: c => '€' + (c / 100).toFixed(2).replace('.', ',')
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['prijzen.js', 'kassa.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
  const bon = () => JSON.parse(JSON.stringify(vm.runInContext('bon', ctx))); // gewone arrays (andere vm-context)

  ctx.voegToeVraagPrijs('Kipcorn');                 // 'abc' -> ongeldig, niets toegevoegd
  assert.equal(meldingen.length, 1);
  assert.deepEqual(bon(), []);
  ctx.voegToeVraagPrijs('Kipcorn');                 // '2,80' -> toegevoegd en onthouden
  assert.deepEqual(bon(), [{ naam: 'Kipcorn', prijs: 2.8, aantal: 1 }]);
  assert.deepEqual(JSON.parse(opslag['kassa.bonscan.prijzen']), { kipcorn: 280 });
  assert.equal(knopPrijs.textContent, '€2,80');
  assert.equal(knop.classList.aan, false);
  ctx.voegToeVraagPrijs('Kipcorn');                 // onthouden: geen vraag meer
  assert.equal(vragen.length, 2);
  assert.equal(bon()[0].aantal, 2);
  // Prijs uit de bonscanner (zelfde sleutel) geldt ook voor de knop
  opslag['kassa.bonscan.prijzen'] = JSON.stringify({ kipcorn: 280, boulet: 330 });
  ctx.voegToeVraagPrijs('Boulet');
  assert.equal(vragen.length, 2);
  assert.equal(bon()[1].prijs, 3.3);
});

test('regels uit scanresultaat en verzamelen', () => {
  const namen = global.ZoneBonForm.products;
  const rows = namen.map(() => ({ quantity: 0 }));
  rows[0] = { quantity: 2 };                                              // Cola
  rows[10] = { quantity: null, inkCandidates: [2, 5], manualReason: 'unstable' }; // Jupiler, dubbel
  rows[19] = { quantity: null, inkCandidates: [], manualReason: 'unseen' };       // Koffie, ongelezen
  rows[30] = { quantity: 1 };                                             // Kipcorn: knop zonder prijs (testKassa)
  const regels = bs.regelsUitResultaat({ rows }, namen).map(r => Object.assign(r, {
    koppeling: bs.koppel(r.bonNaam, testKassa, {}, {}), invoer: { tekst: '', overslaan: false }
  }));
  assert.deepEqual(regels.map(r => r.index), [0, 10, 19, 30]);
  assert.equal(regels[1].reden, 'Lijkt aangeduid bij 2 of 5.');
  assert.deepEqual(regels.filter(bs.isOngelezen).map(r => r.index), [19]);

  let v = bs.verzamel(regels);
  assert.equal(v.klaar, false);
  assert.equal(v.vragen, 2);
  assert.equal(v.zonderPrijs, 1);

  regels[1].onzeker = false; regels[1].aantal = 2;   // keuze 2
  regels[2].onzeker = false; regels[2].aantal = 0;   // alle ongelezen = geen
  v = bs.verzamel(regels);
  assert.equal(v.klaar, false);                      // prijs ontbreekt nog
  regels[3].invoer.tekst = '4,5';
  v = bs.verzamel(regels);
  assert.equal(v.klaar, true);
  assert.deepEqual(v.uit, [
    { naam: 'Cola', prijs: 2, aantal: 2 },
    { naam: 'Jupiler', prijs: 2.5, aantal: 2 },
    { naam: namen[30], prijs: 4.5, aantal: 1 }
  ]);
  assert.deepEqual(v.nieuwePrijzen, { [bs.normNaam(namen[30])]: 450 });

  regels[3].invoer.overslaan = true;                 // overslaan mag ook
  v = bs.verzamel(regels);
  assert.equal(v.klaar, true);
  assert.equal(v.uit.length, 2);
  assert.deepEqual(v.nieuwePrijzen, {});
});

test('niets om toe te voegen blokkeert', () => {
  assert.equal(bs.verzamel([]).klaar, false);
});

test('samenvoegen in bon zoals voegToe', () => {
  const bon = [{ naam: 'Cola', prijs: 2, aantal: 1 }];
  bs.voegRegelsToe(bon, [
    { naam: 'Cola', prijs: 2, aantal: 2 },
    { naam: 'Duvel', prijs: 3.5, aantal: 1 },
    { naam: 'Duvel', prijs: 3.5, aantal: 3 }
  ]);
  assert.deepEqual(bon, [
    { naam: 'Cola', prijs: 2, aantal: 3 },
    { naam: 'Duvel', prijs: 3.5, aantal: 4 }
  ]);
});

console.log(fouten ? fouten + ' test(s) mislukt' : 'Alle tests geslaagd');
process.exit(fouten ? 1 : 0);
