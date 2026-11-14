// Kopie uit Pieterswipe/bon-scanner commit 9453c04 (proto/zone-form.js), verder ongewijzigd.
/* Z50 · A4 order slip. All coordinates, including local registration marks,
   are in A4 design units shared between the camera, print view and PDFs. */
(function (global) {
  'use strict';
  const { products, groups, ids, sample } = global.LargeBonForm;
  const width = 600, height = width * 297 / 210;
  const radius = 6.25, markerSize = 14;
  const fieldWidth = 256, fieldHeight = 328;

  function strip(bits, start, direction) {
    const black = [], white = [start + direction * 13, start + direction * 143];
    [...bits].forEach((value, j) => {
      (value === '1' ? black : white).push(start + direction * (22 + 10 * j));
    });
    return { black, white };
  }

  function makeZone(id, label, left, top, first, count, bits) {
    const right = left + fieldWidth, bottom = top + fieldHeight;
    const corners = [[left, top], [right, top], [right, bottom], [left, bottom]];
    const topStrip = strip(bits, left, 1);
    // Complementing the second signature distinguishes an upside-down zone.
    const lowerBits = [...bits].map(bit => bit === '1' ? '0' : '1').join('');
    const bottomStrip = strip(lowerBits, right, -1);
    const indices = Array.from({ length: count }, (_, j) => first + j);
    const headings = [];
    let group, y = top + 25;
    const centers = indices.map(index => {
      const next = groups.find(g => g.start <= index && index < g.start + g.count);
      if (next !== group) {
        group = next;
        headings.push({ title: group.title, y });
        y += 20;
      }
      const row = Array.from({ length: 6 }, (_, j) => [left + 136 + 22.6 * j, y]);
      y += 20;
      return row;
    });
    return { id, label, indices, corners, radius, markerSize, centers, headings,
      codeY: top, codeBlack: topStrip.black, codeWhite: topStrip.white,
      bottomY: bottom, bottomBlack: bottomStrip.black, bottomWhite: bottomStrip.white };
  }

  const zones = [
    makeZone('TL', 'Linksboven',  27, 112,  0, 13, '110110010001'),
    makeZone('TR', 'Rechtsboven', 317, 112, 25, 13, '110001101001'),
    makeZone('BL', 'Linksonder',  27, 470, 13, 12, '101011000101'),
    makeZone('BR', 'Rechtsonder', 317, 470, 38, 12, '101100101001')
  ];
  const centers = Array(products.length);
  zones.forEach(zone => zone.indices.forEach((index, j) => { centers[index] = zone.centers[j]; }));
  function escapeText(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function mark(x, y, style) {
    if (style === 'fill') return `<circle cx="${x}" cy="${y}" r="4.8" fill="#152028"/>`;
    const path = style === 'tick'
      ? `M${x - 4} ${y - 1} l3 5 6 -9`
      : `M${x - 4} ${y - 4} l8 8 M${x + 4} ${y - 4} l-8 8`;
    return `<path d="${path}" fill="none" stroke="#152028" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  function drawZone(zone, quantities, markStyle) {
    const [[left, top], [right]] = zone.corners;
    const squares = zone.corners.map(([x, y]) =>
      `<rect x="${x - markerSize / 2}" y="${y - markerSize / 2}" width="${markerSize}" height="${markerSize}"/>`).join('');
    const bars = (xs, y) => xs.map(x => `<rect x="${x - 3}" y="${y - 4.5}" width="6" height="9"/>`).join('');
    const band = zone.headings.map(({ title, y }) => {
      const numbers = zone.centers[0].map(([x], j) => `<text x="${x}" y="${y + 3.4}" text-anchor="middle">${j + 1}</text>`).join('');
      return `<rect x="${left - 6}" y="${y - 8.4}" width="${fieldWidth + 12}" height="15.5" rx="1.8" fill="#e9eee8"/>
        <g fill="#213d30" font-weight="bold" font-size="10.3"><text x="${left - 2}" y="${y + 3.4}">${escapeText(title.toUpperCase())}</text>${numbers}</g>`;
    }).join('');
    const rows = zone.indices.map((index, i) => {
      const points = zone.centers[i], y = points[0][1];
      const value = quantities[index], selected = Array.isArray(value) ? value : [value];
      const style = markStyle === 'mixed' ? (index % 2 === 0 ? 'fill' : 'cross') : markStyle;
      const bubbles = points.map(([x, cy], j) =>
        `<circle cx="${x}" cy="${cy}" r="${radius}" fill="white" stroke="#36443d" stroke-width="0.9"/>${selected.includes(j + 1) ? mark(x, cy, style) : ''}`).join('');
      return `<text x="${left - 2}" y="${y + 3.6}" font-size="11.35">${escapeText(products[index])}</text>${bubbles}`;
    }).join('');
    return `<g fill="#000">${squares}${bars(zone.codeBlack, zone.codeY)}${bars(zone.bottomBlack, zone.bottomY)}</g>
      <text x="${right - 15}" y="${top + 3.4}" text-anchor="end" font-size="9.1" font-weight="bold" letter-spacing=".8" fill="#476252">${zone.label.toUpperCase()}</text>
      ${band}${rows}`;
  }

  function svg(quantities = [], { markStyle = 'mixed', example = false } = {}) {
    const title = example ? 'Ingevulde testbon' : 'Bestelbon';
    const tip = example ? 'Scan het volledige blad. Deze testbon bevat acht verschillende artikelen.'
      : 'Duid per artikel één aantal aan met een donker kruisje of een vol bolletje. Laat de andere rijen leeg.';
    const footer = example ? 'Controle na het scannen: 24 stuks, verdeeld over 8 artikelen.' :
      'Geef de ingevulde bon aan de toog. Meer dan zes van een artikel? Geef het aantal door.';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height * 2}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} met vier scanzones en vijftig artikelen">
      <title>${title} · Swipedrinks Clubkantine</title><rect width="${width}" height="${height}" fill="white"/>
      <g font-family="Arial, Helvetica, sans-serif" fill="#183326">
        <text x="21" y="34" font-size="10.5" letter-spacing="1.1" font-weight="bold">SWIPEDRINKS  /  CLUBKANTINE</text>
        <text x="580" y="34" text-anchor="end" font-size="9.8" letter-spacing=".4" fill="#486252">A4  /  Z50  ·  VIERZONENBON</text>
        <text x="20" y="68" font-size="31" font-weight="bold">${title}</text>
        <text x="21" y="87" font-size="10.9">${escapeText(tip)}</text>
        <path d="M300 104 V806 M20 455 H580" stroke="#bdcbbf" stroke-width=".7"/>
        ${zones.map(zone => drawZone(zone, quantities, markStyle)).join('')}
        <text x="300" y="826" text-anchor="middle" font-size="10.6" font-weight="bold">${escapeText(footer)}</text>
      </g></svg>`;
  }

  global.ZoneBonForm = Object.freeze({ id: 'Z50', products, groups, ids, sample, zones, centers, width, height, radius, svg });
})(typeof window === 'undefined' ? globalThis : window);
