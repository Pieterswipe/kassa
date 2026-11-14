// Klein dashboard: verkopen per dag uit de Supabase-views.

function isoDatum(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function datumMin(iso, dagen) {
  const [j, m, d] = iso.split('-').map(Number);
  return isoDatum(new Date(j, m - 1, d - dagen));
}

// Tabel met koppen en rijen (arrays van tekst); laatste rij optioneel als totaalrij.
function tabel(doelId, koppen, rijen, totaalRij) {
  const doel = document.getElementById(doelId);
  doel.innerHTML = '';
  if (!rijen.length) {
    const p = document.createElement('p');
    p.className = 'leeg';
    p.textContent = 'Geen gegevens';
    doel.appendChild(p);
    return;
  }
  const t = document.createElement('table');
  const voegRij = (cellen, tag, klasse) => {
    const tr = document.createElement('tr');
    if (klasse) tr.className = klasse;
    cellen.forEach(c => {
      const cel = document.createElement(tag);
      cel.textContent = c;
      tr.appendChild(cel);
    });
    t.appendChild(tr);
  };
  voegRij(koppen, 'th');
  rijen.forEach(r => voegRij(r, 'td'));
  if (totaalRij) voegRij(totaalRij, 'td', 'totaalrij');
  doel.appendChild(t);
}

async function laadDashboard() {
  const dag = document.getElementById('dag').value;
  const fout = document.getElementById('fout');
  fout.textContent = '';
  if (!dag) return;

  try {
    const d = dbNodig();
    const [verkopen, producten, open, week] = await Promise.all([
      d.from('sales_per_day').select('*').eq('dag', dag),
      d.from('products_per_day').select('*').eq('dag', dag).order('totaal_cents', { ascending: false }),
      d.from('orders').select('total_cents, customers(name)').eq('status', 'open').order('created_at'),
      d.from('sales_per_day').select('dag, totaal_cents').gte('dag', datumMin(dag, 6)).lte('dag', dag)
    ]).then(resultaten => resultaten.map(dbCheck));

    const somAantal = verkopen.reduce((s, r) => s + r.aantal, 0);
    const somTotaal = verkopen.reduce((s, r) => s + r.totaal_cents, 0);
    tabel('per-betaalmiddel', ['Betaalmiddel', 'Aantal', 'Totaal'],
      verkopen.map(r => [BETAALMIDDELEN[r.payment_method] || r.payment_method, r.aantal, euro(r.totaal_cents)]),
      verkopen.length ? ['Totaal', somAantal, euro(somTotaal)] : null);

    tabel('per-product', ['Product', 'Aantal', 'Totaal'],
      producten.map(r => [r.product, r.aantal, euro(r.totaal_cents)]));

    const somOpen = open.reduce((s, r) => s + r.total_cents, 0);
    tabel('open-rekeningen', ['Naam', 'Totaal'],
      open.map(r => [(r.customers && r.customers.name) || '(zonder naam)', euro(r.total_cents)]),
      open.length ? ['Totaal', euro(somOpen)] : null);

    const perDag = {};
    for (let i = 6; i >= 0; i--) perDag[datumMin(dag, i)] = 0;
    week.forEach(r => { perDag[r.dag] = (perDag[r.dag] || 0) + r.totaal_cents; });
    const fmt = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
    tabel('per-dag', ['Dag', 'Totaal'],
      Object.keys(perDag).map(k => [fmt.format(new Date(k + 'T12:00:00')), euro(perDag[k])]));
  } catch (err) {
    fout.textContent = 'Laden mislukt: ' + err.message;
  }
}

document.getElementById('dag').value = isoDatum(new Date());
laadDashboard();
