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

// Kassaproducten zoals ze in index.html staan
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const kassa = [...html.matchAll(/onclick="([^"]*voegToe[^"]*)"/g)]
  .map(m => bs.leesKassaKnop(m[1])).filter(Boolean);

test('kassaproducten uit index.html', () => {
  assert.ok(kassa.length >= 8);
  assert.deepEqual(kassa.find(p => p.naam === 'Cola'), { naam: 'Cola', prijs: 2 });
  assert.deepEqual(kassa.find(p => p.naam === 'Leffe Blond'), { naam: 'Leffe Blond', prijs: 3 });
  assert.equal(bs.leesKassaKnop("voegToe(\"Duvel\", 3.50)").prijs, 3.5);
  assert.equal(bs.leesKassaKnop('openSwipedrinks()'), null);
});

test('naam-normalisatie', () => {
  assert.equal(bs.normNaam('  Leffe   BLOND '), 'leffe blond');
  assert.equal(bs.normNaam('Cola\tZero'), 'cola zero');
  assert.equal(bs.normNaam(null), '');
});

test('matching op naam en alias', () => {
  assert.equal(bs.zoekKassaProduct('cola', kassa, {}).naam, 'Cola');
  assert.equal(bs.zoekKassaProduct(' JUPILER ', kassa, {}).naam, 'Jupiler');
  assert.equal(bs.zoekKassaProduct('Cola Zero', kassa, {}), null);
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

test('koppel: kassa, geleerd, onbekend', () => {
  assert.deepEqual(bs.koppel('Duvel', kassa, {}, {}), { soort: 'kassa', naam: 'Duvel', cent: 350 });
  assert.deepEqual(bs.koppel('Koffie', kassa, { koffie: 180 }, {}), { soort: 'geleerd', naam: 'Koffie', cent: 180 });
  assert.deepEqual(bs.koppel('Kipcorn', kassa, {}, {}), { soort: 'onbekend', naam: 'Kipcorn', cent: null });
});

test('regels uit scanresultaat en verzamelen', () => {
  const namen = global.ZoneBonForm.products;
  const rows = namen.map(() => ({ quantity: 0 }));
  rows[0] = { quantity: 2 };                                              // Cola
  rows[10] = { quantity: null, inkCandidates: [2, 5], manualReason: 'unstable' }; // Jupiler, dubbel
  rows[19] = { quantity: null, inkCandidates: [], manualReason: 'unseen' };       // Koffie, ongelezen
  rows[30] = { quantity: 1 };                                             // onbekend in kassa
  const regels = bs.regelsUitResultaat({ rows }, namen).map(r => Object.assign(r, {
    koppeling: bs.koppel(r.bonNaam, kassa, {}, {}), invoer: { tekst: '', overslaan: false }
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
