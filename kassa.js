// Lijst van items op de bon
let bon = [];

// Geladen open rekening: { id, naam } of null
let rekening = null;

// Voeg een item toe aan de bon
function voegToe(naam, prijs) {
  // Kijk of het item al op de bon staat
  let bestaand = bon.find(item => item.naam === naam);
  if (bestaand) {
    bestaand.aantal += 1;
  } else {
    bon.push({ naam: naam, prijs: prijs, aantal: 1 });
  }
  tekenBon();
}

// Teken de bon opnieuw op het scherm
function tekenBon() {
  let lijst = document.getElementById('bon-lijst');
  lijst.innerHTML = '';

  bon.forEach(item => {
    let li = document.createElement('li');
    let naam = document.createElement('span');
    naam.textContent = item.aantal + 'x ' + item.naam;
    let prijs = document.createElement('span');
    prijs.textContent = euro(Math.round(item.prijs * 100) * item.aantal);
    li.append(naam, prijs);
    lijst.appendChild(li);
  });

  document.getElementById('totaal').textContent = euro(bonTotaalCents());

  let label = document.getElementById('rekening-label');
  label.textContent = rekening ? 'Rekening: ' + rekening.naam : '';
  label.classList.toggle('verborgen', !rekening);
  document.getElementById('rek-knop').textContent = rekening ? 'Rekening bijwerken' : 'Rekening';
}

// Bon-items zoals ze in de database komen (bedragen in centen)
function bonItems() {
  return bon.map(item => ({
    product: item.naam,
    price_cents: Math.round(item.prijs * 100),
    qty: item.aantal
  }));
}

function bonTotaalCents() {
  return bonItems().reduce((som, i) => som + i.price_cents * i.qty, 0);
}

// Afrekenen: opent de keuze van betaalmiddel (betalen.js)
function afrekenen() {
  if (bon.length === 0) {
    alert('De bon is leeg!');
    return;
  }
  openBetalen();
}

// Wis de volledige bon
// Bij een geladen rekening: rekening ontladen (blijft open in de database)
function wisAlles() {
  bon = [];
  rekening = null;
  tekenBon();
}

// Toon een categorie en verberg de andere
function toonCategorie(categorie, tab) {
  // Verberg alle categorieën
  document.querySelectorAll('.categorie').forEach(el => el.classList.add('verborgen'));
  // Toon de gekozen categorie
  document.getElementById(categorie).classList.remove('verborgen');

  // Pas de actieve tab aan
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('actief'));
  (tab || event.target).classList.add('actief');
}

// Knop zonder vaste prijs: gebruik de onthouden prijs, of vraag ze één keer.
// Prijzen staan in localStorage via prijzen.js (dezelfde als de bonscanner).
function voegToeVraagPrijs(naam) {
  const P = window.KassaPrijzen;
  let cent = P.geleerdePrijs(naam);
  if (cent == null) {
    const tekst = prompt('Prijs voor ' + naam + ' (bv. 2,50):');
    if (tekst === null) return; // geannuleerd
    cent = P.prijsNaarCent(tekst);
    if (cent == null) {
      alert('Ongeldige prijs. Typ bv. 2,50');
      return;
    }
    P.bewaarGeleerd({ [P.normNaam(naam)]: cent });
    toonOnthoudenPrijzen();
  }
  voegToe(naam, cent / 100);
}

// Zet de onthouden prijzen op de knoppen zonder vaste prijs ("prijs?" als er nog geen is).
function toonOnthoudenPrijzen() {
  const P = window.KassaPrijzen;
  if (!P) return;
  const geleerd = P.leesGeleerd();
  document.querySelectorAll('.item-knop[data-vraag-prijs]').forEach(knop => {
    const cent = P.geleerdePrijs(knop.dataset.naam, geleerd);
    knop.querySelector('.knop-prijs').textContent = cent ? euro(cent) : 'prijs?';
    knop.classList.toggle('zonder-prijs', !cent);
  });
}

// Bouwt de tabs en productknoppen uit producten.js (window.KASSA_PRODUCTEN / KASSA_CATEGORIEEN).
// Knop met vaste prijs -> voegToe(naam, prijs); zonder prijs -> voegToeVraagPrijs(naam).
function bouwProductKnoppen() {
  const tabs = document.getElementById('tabs');
  const vak = document.getElementById('knoppen-vak');
  const producten = window.KASSA_PRODUCTEN, categorieen = window.KASSA_CATEGORIEEN;
  if (!tabs || !vak || !producten || !categorieen) return;
  tabs.replaceChildren();
  vak.replaceChildren();
  categorieen.forEach((c, i) => {
    const tab = document.createElement('button');
    tab.className = 'tab' + (i === 0 ? ' actief' : '');
    tab.textContent = c.titel;
    tab.addEventListener('click', () => toonCategorie(c.id, tab));
    tabs.appendChild(tab);

    const cat = document.createElement('div');
    cat.id = c.id;
    cat.className = 'categorie' + (i === 0 ? '' : ' verborgen');
    producten.filter(p => p.categorie === c.id).forEach(p => {
      const knop = document.createElement('button');
      knop.className = 'item-knop';
      knop.dataset.naam = p.naam;
      knop.dataset.id = p.id;
      const prijs = document.createElement('span');
      prijs.className = 'knop-prijs';
      if (p.prijs != null) {
        prijs.textContent = '€' + p.prijs.toFixed(2).replace('.', ',');
        knop.addEventListener('click', () => voegToe(p.naam, p.prijs));
      } else {
        prijs.textContent = 'prijs?';
        knop.classList.add('zonder-prijs');
        knop.dataset.vraagPrijs = '1';
        knop.addEventListener('click', () => voegToeVraagPrijs(p.naam));
      }
      knop.append(p.naam, document.createElement('br'), prijs);
      cat.appendChild(knop);
    });
    vak.appendChild(cat);
  });
}
// Vaste prijs uit producten.js wint: oude onthouden prijzen voor die artikelen weg.
if (window.KassaPrijzen && window.KASSA_PRODUCTEN) window.KassaPrijzen.ruimOp(window.KASSA_PRODUCTEN);
bouwProductKnoppen();
toonOnthoudenPrijzen();
