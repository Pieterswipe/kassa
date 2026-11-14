// Eén bron voor alle kassaproducten: de kassa (index.html), de bonscanner (bonscan.js)
// en de klanten-bestelapp (bestel/) gebruiken deze lijst.
//
// - id: vaste korte code. Bonartikelen hun bon-id 'K50-01'..'K50-50' (volgorde van
//   bonscanner/large-form.js), extra kassaproducten 'X01', 'X02', ...
//   Een id NOOIT hergebruiken of wijzigen: klanten-QR's verwijzen ernaar.
// - categorie: id van de tab (zie KASSA_CATEGORIEEN).
// - prijs: in euro, of null = prijs wordt aan de kassa gevraagd en onthouden (prijzen.js).
// De volgorde hieronder is de volgorde van de knoppen in de kassa.
(function (global) {
  'use strict';

  // Tabs = de 6 categorieën van de papieren vierzonebon.
  const KASSA_CATEGORIEEN = [
    { id: 'fris', titel: 'Frisdrank & sap' },
    { id: 'bier', titel: 'Bieren' },
    { id: 'warm', titel: 'Warme dranken' },
    { id: 'snack', titel: 'Warme snacks' },
    { id: 'brood', titel: 'Broodjes' },
    { id: 'zoet', titel: 'Zoet & zout' }
  ];

  const p = (id, naam, categorie, prijs) => ({ id, naam, categorie, prijs });

  const KASSA_PRODUCTEN = [
    p('K50-01', 'Cola', 'fris', 2.00),
    p('K50-02', 'Cola Zero', 'fris', null),
    p('K50-03', 'Water', 'fris', 1.50),
    p('K50-04', 'Spuitwater', 'fris', null),
    p('K50-05', 'Fanta', 'fris', 2.00),
    p('K50-06', 'Sprite', 'fris', 2.00),
    p('K50-07', 'Ice Tea', 'fris', null),
    p('K50-08', 'Tonic', 'fris', 3.20),
    p('K50-09', 'Appelsap', 'fris', 3.20),
    p('K50-10', 'Sinaasappelsap', 'fris', 3.20),

    p('K50-11', 'Jupiler', 'bier', 2.50),
    p('K50-12', 'Duvel', 'bier', 3.50),
    p('X01', 'Leffe Blond', 'bier', 3.00),
    p('X02', 'Stella Artois', 'bier', 2.50),
    p('K50-13', 'Ename', 'bier', null),
    p('K50-14', 'Tripel Karmeliet', 'bier', null),
    p('K50-15', 'Westmalle Dubbel', 'bier', null),
    p('K50-16', 'Kriek', 'bier', null),
    p('K50-17', 'Hoegaarden', 'bier', null),
    p('K50-18', 'Jupiler 0.0', 'bier', 2.80),
    p('K50-19', 'Sportzot 0.0', 'bier', null),

    p('K50-20', 'Koffie', 'warm', null),
    p('K50-21', 'Deca', 'warm', null),
    p('K50-22', 'Espresso', 'warm', null),
    p('K50-23', 'Cappuccino', 'warm', null),
    p('K50-24', 'Thee', 'warm', null),
    p('K50-25', 'Warme chocomelk', 'warm', null),

    p('K50-26', 'Friet klein', 'snack', null),
    p('K50-27', 'Friet groot', 'snack', null),
    p('K50-28', 'Frikandel', 'snack', null),
    p('K50-29', 'Boulet', 'snack', null),
    p('K50-30', 'Mexicano', 'snack', null),
    p('K50-31', 'Kipcorn', 'snack', null),
    p('K50-32', 'Bitterballen', 'snack', null),
    p('K50-33', 'Kaaskroket', 'snack', null),
    p('K50-34', 'Loempia', 'snack', 2.80),
    p('K50-35', 'Kaasballetjes', 'snack', null),

    p('K50-36', 'Broodje kaas', 'brood', null),
    p('K50-37', 'Broodje hesp', 'brood', null),
    p('K50-38', 'Broodje hesp-kaas', 'brood', null),
    p('K50-39', 'Broodje gezond', 'brood', null),
    p('K50-40', 'Broodje kipcurry', 'brood', null),
    p('K50-41', 'Broodje préparé', 'brood', null),
    p('K50-42', 'Broodje tonijn', 'brood', null),
    p('K50-43', 'Hotdog', 'brood', null),
    p('K50-44', 'Croque monsieur', 'brood', null),

    p('K50-45', 'Chips zout', 'zoet', null),
    p('K50-46', 'Chips paprika', 'zoet', null),
    p('K50-47', 'Pindanootjes', 'zoet', null),
    p('K50-48', 'Suikerwafel', 'zoet', null),
    p('K50-49', 'Chocoladereep', 'zoet', null),
    p('K50-50', 'IJsje', 'zoet', null)
  ];

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KASSA_PRODUCTEN, KASSA_CATEGORIEEN };
  } else {
    global.KASSA_PRODUCTEN = KASSA_PRODUCTEN;
    global.KASSA_CATEGORIEEN = KASSA_CATEGORIEEN;
  }
})(typeof window === 'undefined' ? globalThis : window);
