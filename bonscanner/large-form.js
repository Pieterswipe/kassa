// Kopie uit Pieterswipe/bon-scanner commit 9453c04 (proto/large-form.js), verder ongewijzigd.
/* The K50 printed menu and the camera use this one catalogue and layout. */
(function (global) {
  'use strict';
  const menu = [
    ['Frisdrank & sap', ['Cola', 'Cola Zero', 'Water', 'Spuitwater', 'Fanta', 'Sprite', 'Ice Tea', 'Tonic', 'Appelsap', 'Sinaasappelsap']],
    ['Bieren', ['Jupiler', 'Duvel', 'Ename', 'Tripel Karmeliet', 'Westmalle Dubbel', 'Kriek', 'Hoegaarden', 'Jupiler 0.0', 'Sportzot 0.0']],
    ['Warme dranken', ['Koffie', 'Deca', 'Espresso', 'Cappuccino', 'Thee', 'Warme chocomelk']],
    ['Warme snacks', ['Friet klein', 'Friet groot', 'Frikandel', 'Boulet', 'Mexicano', 'Kipcorn', 'Bitterballen', 'Kaaskroket', 'Loempia', 'Kaasballetjes']],
    ['Broodjes', ['Broodje kaas', 'Broodje hesp', 'Broodje hesp-kaas', 'Broodje gezond', 'Broodje kipcurry', 'Broodje préparé', 'Broodje tonijn', 'Hotdog', 'Croque monsieur']],
    ['Zoet & zout', ['Chips zout', 'Chips paprika', 'Pindanootjes', 'Suikerwafel', 'Chocoladereep', 'IJsje']]
  ];
  const products = Object.freeze(menu.flatMap(([, names]) => names));
  let firstIndex = 0;
  const groups = Object.freeze(menu.map(([title, names]) => {
    const group = Object.freeze({ title, start: firstIndex, count: names.length });
    firstIndex += names.length;
    return group;
  }));
  const ids = Object.freeze(products.map((_, i) => 'K50-' + String(i + 1).padStart(2, '0')));
  const sample = Array(products.length).fill(0);
  for (const [index, quantity] of [[0, 2], [9, 1], [12, 3], [24, 1], [25, 4], [35, 2], [44, 5], [49, 6]]) {
    sample[index] = quantity;
  }
  Object.freeze(sample);

  const width = 600;
  const height = width * 297 / 210;
  const markerSize = 28;
  const radius = 6.25;
  const corners = [[42, 42], [558, 42], [558, 798], [42, 798]];
  const codeBlack = [88, 118, 148, 168, 208, 228];
  const codeWhite = [73, 78, 98, 108, 128, 138, 158, 178, 188, 198, 218, 238, 243];
  const centers = products.map((_, index) => {
    const panel = Math.floor(index / 25);
    const row = index % 25;
    const y = 166 + 22.4 * row + (row >= 10 ? 20 : 0) + (row >= 19 ? 20 : 0);
    return Array.from({ length: 6 }, (_, j) => [164 + panel * 280 + 22.5 * j, y]);
  });
  const layout = Object.freeze({
    id: 'K50', width, height, markerSize, radius, corners, codeBlack, codeWhite, centers,
    center: (productIndex, quantityIndex) => centers[productIndex][quantityIndex]
  });

  function text(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function mark(x, y, style) {
    if (style === 'fill') return `<circle cx="${x}" cy="${y}" r="4.8" fill="#151821"/>`;
    if (style === 'tick') {
      return `<path d="M${x - 4} ${y - 1} l3 5 6 -9" fill="none" stroke="#151821" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return `<path d="M${x - 4} ${y - 4} l8 8 M${x + 4} ${y - 4} l-8 8" fill="none" stroke="#151821" stroke-width="1.8" stroke-linecap="round"/>`;
  }

  function svg(quantities = [], { markStyle = 'mixed', example = false } = {}) {
    const title = example ? 'Ingevulde testbon' : 'Bestelbon';
    const instructions = example ? 'Richt de scanner op de hele pagina. Vergelijk de bestelling met de controle onderaan.'
      : 'Duid per artikel één aantal aan met een donker kruisje of een vol bolletje. Laat de andere rijen leeg.';
    const markers = corners.map(([x, y]) =>
      `<rect x="${x - markerSize / 2}" y="${y - markerSize / 2}" width="${markerSize}" height="${markerSize}"/>`).join('');
    const barcode = codeBlack.map(x => `<rect x="${x - 5}" y="36" width="10" height="12"/>`).join('');

    const tables = groups.map(group => {
      const left = group.start < 25 ? 28 : 308;
      const groupY = centers[group.start][0][1];
      const headings = centers[group.start].map(([x], j) =>
        `<text x="${x}" y="${groupY - 17.8}" text-anchor="middle" font-size="10.5" font-weight="bold">${j + 1}</text>`).join('');
      const articles = products.slice(group.start, group.start + group.count).map((product, row) => {
        const index = group.start + row;
        const y = centers[index][0][1];
        const value = quantities[index];
        const selections = Array.isArray(value) ? value : [value];
        const rowStyle = markStyle === 'mixed' ? (index % 2 === 0 ? 'fill' : 'cross') : markStyle;
        const cells = centers[index].map(([x], q) =>
          `<circle cx="${x}" cy="${y}" r="${radius}" fill="white" stroke="#3b4c44" stroke-width="0.85"/>${selections.includes(q + 1) ? mark(x, y, rowStyle) : ''}`).join('');
        const rule = row + 1 < group.count
          ? `<path d="M${left} ${y + 11.2} h259" stroke="#e0e8e3" stroke-width="0.6"/>` : '';
        return `<text x="${left + 3}" y="${y + 3.5}" font-size="11.3">${text(product)}</text>${cells}${rule}`;
      }).join('');
      return `<rect x="${left}" y="${groupY - 30}" width="259" height="17" rx="1.8" fill="#e2ece4"/>
        <text x="${left + 4}" y="${groupY - 17.8}" font-size="10" font-weight="bold" letter-spacing="0.55">${text(group.title.toUpperCase())}</text>
        ${headings}${articles}`;
    }).join('');
    const footer = example
      ? '<text x="300" y="782" text-anchor="middle" font-size="12.8" font-weight="bold">Deze bestelling telt 24 stuks, verdeeld over 8 artikelen.</text>'
      : '<text x="300" y="782" text-anchor="middle" font-size="12.8" font-weight="bold">Geef je ingevulde bon af aan de toog.</text>';
    const footerNote = example ? 'Bovenaan staan 2 cola’s, rechtsonder 6 ijsjes.' : 'Meer dan zes van één artikel? Geef het aantal door aan de toog.';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${2 * height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} met vijftig kantineartikelen">
      <title>${title} voor de clubkantine</title>
      <rect width="${width}" height="${height}" fill="white"/>
      <g fill="black">${markers}${barcode}</g>
      <g font-family="Arial, Helvetica, sans-serif" fill="#1a3026">
        <text x="532" y="45.5" text-anchor="end" font-size="10.5" font-weight="bold" letter-spacing="0.8">SWIPEDRINKS   /   CLUBKANTINE</text>
        <text x="28" y="99" font-size="34" font-weight="bold">${title}</text>
        <text x="570" y="96" text-anchor="end" font-size="11" fill="#4d6455">50 artikelen  /  K50</text>
        <text x="29" y="119" font-size="10.8">${instructions}</text>
        <path d="M298 136 V752" stroke="#bdcdbf" stroke-width="0.7"/>
        ${tables}
        <path d="M28 763 H568" stroke="#728879" stroke-width="0.8"/>
        ${footer}
        <text x="300" y="801" text-anchor="middle" font-size="9.5" fill="#3c5445">${footerNote}</text>
      </g>
    </svg>`;
  }
  global.LargeBonForm = Object.freeze({ id: 'K50', products, ids, groups, sample, layout, svg });
})(typeof window === 'undefined' ? globalThis : window);
