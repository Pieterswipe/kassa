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
function toonCategorie(categorie) {
  // Verberg alle categorieën
  document.querySelectorAll('.categorie').forEach(el => el.classList.add('verborgen'));
  // Toon de gekozen categorie
  document.getElementById(categorie).classList.remove('verborgen');

  // Pas de actieve tab aan
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('actief'));
  event.target.classList.add('actief');
}
