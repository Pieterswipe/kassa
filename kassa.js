// Lijst van items op de bon
let bon = [];

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

  let totaal = 0;

  bon.forEach(item => {
    let li = document.createElement('li');
    li.innerHTML = `
      <span>${item.aantal}x ${item.naam}</span>
      <span>€${(item.prijs * item.aantal).toFixed(2).replace('.', ',')}</span>
    `;
    lijst.appendChild(li);
    totaal += item.prijs * item.aantal;
  });

  document.getElementById('totaal').textContent = '€' + totaal.toFixed(2).replace('.', ',');
}

// Afrekenen
function afrekenen() {
  if (bon.length === 0) {
    alert('De bon is leeg!');
    return;
  }
  let totaal = bon.reduce((som, item) => som + item.prijs * item.aantal, 0);
  alert('Betaald! Totaal: €' + totaal.toFixed(2).replace('.', ',') + '\nBedankt!');
  wisAlles();
}

// Wis de volledige bon
function wisAlles() {
  bon = [];
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
