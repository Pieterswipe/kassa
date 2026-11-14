// Lijst van items op de bon
let bon = [];

// Geladen open rekening: { id, naam } of null
let rekening = null;

// Ongedaan-stapel: één eenheid per geslaagde voegToe, { id, naam }
let ongedaanStapel = [];
let ongedaanTeller = 0;

// Voeg een item toe aan de bon; geeft het id van de toevoeging terug (voor "Ongedaan")
function voegToe(naam, prijs) {
  // Kijk of het item al op de bon staat
  let bestaand = bon.find(item => item.naam === naam);
  if (bestaand) {
    bestaand.aantal += 1;
  } else {
    bon.push({ naam: naam, prijs: prijs, aantal: 1 });
  }
  const id = ++ongedaanTeller;
  ongedaanStapel.push({ id: id, naam: naam });
  tekenBon();
  return id;
}

// Aantal van regel `index` aanpassen (−1 / +1); bij 0 verdwijnt de regel
function veranderAantal(index, delta) {
  const item = bon[index];
  if (!item) return;
  item.aantal += delta;
  if (item.aantal <= 0) bon.splice(index, 1);
  tekenBon();
}

// Hele regel `index` van de bon halen
function verwijderRegel(index) {
  if (!bon[index]) return;
  bon.splice(index, 1);
  tekenBon();
}

function heeftOngedaan() {
  return ongedaanStapel.length > 0;
}

// Maak een toevoeging ongedaan: een bepaalde (id) of anders de laatste.
// Haalt één eenheid weg van dezelfde regel die voegToe verhoogde (eerste regel met die naam).
function laatsteOngedaan(id) {
  const pos = id == null ? ongedaanStapel.length - 1 : ongedaanStapel.findIndex(a => a.id === id);
  if (pos < 0) return false;
  const actie = ongedaanStapel.splice(pos, 1)[0];
  const index = bon.findIndex(item => item.naam === actie.naam);
  if (index < 0) { tekenBon(); return false; }
  veranderAantal(index, -1);
  return true;
}

// Stapel in lijn houden met de bon: leeg bij een lege bon, en nooit meer
// toevoegingen per naam dan er nog eenheden op die regel staan (oudste vallen eerst weg).
function snoeiOngedaan() {
  if (bon.length === 0) { ongedaanStapel = []; return; }
  const over = {};
  for (let i = ongedaanStapel.length - 1; i >= 0; i--) {
    const naam = ongedaanStapel[i].naam;
    if (!(naam in over)) {
      const regel = bon.find(item => item.naam === naam);
      over[naam] = regel ? regel.aantal : 0;
    }
    if (over[naam] > 0) over[naam]--;
    else ongedaanStapel.splice(i, 1);
  }
}

// Kleine knop voor een bonregel
function regelKnop(tekst, label, klasse, actie) {
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'regel-knop ' + klasse;
  knop.textContent = tekst;
  // (guard en onclick: de nep-DOM in tests/*.cjs kent geen setAttribute/addEventListener)
  if (typeof knop.setAttribute === 'function') knop.setAttribute('aria-label', label);
  knop.onclick = actie;
  return knop;
}

// Na het hertekenen de focus terugzetten op dezelfde knop (toetsenbord)
function herstelFocus(index, klasse) {
  const li = document.getElementById('bon-lijst').children[index];
  const knop = li && li.querySelector('.' + klasse);
  if (knop) knop.focus({ preventScroll: true });
}

// Teken de bon opnieuw op het scherm
function tekenBon() {
  let lijst = document.getElementById('bon-lijst');
  lijst.innerHTML = '';

  snoeiOngedaan();

  bon.forEach((item, index) => {
    let li = document.createElement('li');
    let naam = document.createElement('span');
    naam.className = 'regel-naam';
    naam.textContent = item.aantal + 'x ' + item.naam;
    let prijs = document.createElement('span');
    prijs.className = 'regel-prijs';
    prijs.textContent = euro(Math.round(item.prijs * 100) * item.aantal);

    let stap = document.createElement('span');
    stap.className = 'regel-stap';
    stap.append(
      regelKnop('\u2212', item.naam + ' verminderen', 'regel-min', () => {
        veranderAantal(index, -1);
        herstelFocus(index, 'regel-min');
      }),
      regelKnop('+', item.naam + ' verhogen', 'regel-plus', () => {
        veranderAantal(index, 1);
        herstelFocus(index, 'regel-plus');
      })
    );
    let weg = regelKnop('\u00d7', item.naam + ' verwijderen', 'regel-weg', () => {
      verwijderRegel(index);
      herstelFocus(Math.min(index, bon.length - 1), 'regel-weg');
    });

    li.append(naam, stap, prijs, weg);
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
  ongedaanStapel = [];
  tekenBon();
}

// Knop "Bon leegmaken": eerst bevestigen, dan wisAlles() (die zelf niets vraagt)
function bonLeegmaken() {
  if (bon.length === 0 && !rekening) return;
  if (bon.length) {
    let vraag = 'Alle items van de bon verwijderen?';
    if (rekening) {
      vraag += '\n\nDe open rekening van ' + rekening.naam + ' blijft in de database staan; ' +
        'ze wordt enkel van de kassa gehaald.';
    }
    if (!confirm(vraag)) return;
  }
  wisAlles();
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
