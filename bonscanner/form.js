// Kopie uit Pieterswipe/bon-scanner commit 9453c04 (proto/form.js), verder ongewijzigd.
/* Papier en testbeelden gebruiken beide dit vaste formulier, versie K01. */
(() => {
  const products = Object.freeze(['Cola', 'Water', 'Fanta', 'Jupiler', 'Duvel', 'Ename']);
  const sample = Object.freeze([3, 0, 1, 4, 0, 2]);
  const columns = [212, 274, 336, 398, 460, 522];
  const corners = [[42, 42], [558, 42], [558, 798], [42, 798]];
  const versionBars = [88, 108, 138, 178, 198, 228];

  function markAt(x, y, style) {
    if (style === 'fill') {
      return `<ellipse cx="${x + 0.5}" cy="${y - 0.5}" rx="10.5" ry="11" fill="#151c29"/>`;
    }
    return `<path d="M ${x - 8} ${y - 9} l 16 18 M ${x + 8.5} ${y - 8.5} l -17 17"
        fill="none" stroke="#151c29" stroke-width="3.7" stroke-linecap="round"/>`;
  }

  // A row can contain a single quantity or an array to simulate a double mark.
  function svg(quantities = [], { markStyle = 'mixed' } = {}) {
    const rows = products.map((product, index) => {
      const y = 248 + 65 * index;
      const value = quantities[index];
      const marked = Array.isArray(value) ? value : [value];
      const style = markStyle === 'mixed' ? (index % 2 === 0 ? 'cross' : 'fill') : markStyle;
      const bubbles = columns.map((x, column) => {
        const mark = marked.includes(column + 1) ? markAt(x, y, style) : '';
        return `<circle cx="${x}" cy="${y}" r="13" fill="white" stroke="#34443d" stroke-width="1.8"/>${mark}`;
      }).join('');
      return `<text x="42" y="${y + 7}" font-size="22" font-weight="bold">${product}</text>${bubbles}`;
    }).join('');

    const markers = corners.map(([x, y]) =>
      `<rect x="${x - 14}" y="${y - 14}" width="28" height="28"/>`).join('');
    const code = versionBars.map(x =>
      `<rect x="${x - 5}" y="36" width="10" height="12"/>`).join('');
    const numberHeadings = (y, size) => columns.map((x, index) =>
      `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="bold">${index + 1}</text>`).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840"
        viewBox="0 0 600 840" role="img" aria-label="Bestelbon voor de voetbalkantine">
      <title>Bestelbon voor de voetbalkantine</title>
      <rect width="600" height="840" fill="white"/>
      <g fill="black">${markers}${code}</g>
      <g font-family="Arial, Helvetica, sans-serif" fill="#1e322a">
        <text x="42" y="92" font-size="13" font-weight="bold" letter-spacing="1.4">SWIPEDRINKS  /  CLUBKANTINE</text>
        <text x="41" y="139" font-size="44" font-weight="bold">Bestelbon</text>
        <text x="42" y="164" font-size="15">Duid per drank één aantal aan met een donker kruisje of een vol bolletje.</text>
        <path d="M42 179 H558" stroke="#75877e" fill="none"/>
        <text x="42" y="208" font-size="13" font-weight="bold" letter-spacing="1">FRISDRANKEN</text>
        ${numberHeadings(208, 18)}
        <path d="M42 280 H558 M42 345 H558 M42 475 H558 M42 540 H558" stroke="#d7dfda" fill="none"/>
        <path d="M42 402 H558" stroke="#75877e" fill="none"/>
        <text x="42" y="421" font-size="11" font-weight="bold" letter-spacing="1">BIEREN</text>
        ${numberHeadings(421, 13)}
        ${rows}
        <path d="M42 609 H558" stroke="#75877e" fill="none"/>
        <text x="42" y="652" font-size="21" font-weight="bold">Klaar? Geef je bon af aan de toog.</text>
        <text x="42" y="682" font-size="15">Meer dan zes van één drank? Zeg het aan de toog.</text>
        <text x="42" y="706" font-size="15">Vergist? Neem een nieuwe bon zodat je bestelling duidelijk is.</text>
        <text x="300" y="803" text-anchor="middle" font-size="11" fill="#50655a" letter-spacing="1">KANTINE  /  K01</text>
      </g>
    </svg>`;
  }

  window.BonForm = Object.freeze({ products, sample, svg });
})();
