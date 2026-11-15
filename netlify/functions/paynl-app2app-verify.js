// POST {orderId, reference?, amountCents?} of GET ?orderId=... -> pay.nl Transaction:Info.
// Enige bron van waarheid voor een App2App-betaling: de return uit PAY.POS is maar een hint.
const { json, heeftAuth, NIET_INGESTELD, korteFout, paynlRest } = require('./_paynl');

// Pay.nl-transactie-id: EX-xxxx-xxxx-xxxx, UUID of het oude 123456789X1a2b3c-formaat
const ID_RES = [
  /^EX-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,4}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9]{5,12}X[0-9a-f]{3,16}$/i
];

function geldigId(id) {
  return typeof id === 'string' && id.length <= 64 && ID_RES.some(re => re.test(id));
}

exports.handler = async (event) => {
  let input;
  if (event.httpMethod === 'GET') {
    input = event.queryStringParameters || {};
  } else if (event.httpMethod === 'POST') {
    try { input = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Ongeldige JSON' }); }
    if (!input || typeof input !== 'object') return json(400, { error: 'Ongeldige JSON' });
  } else {
    return json(405, { error: 'Alleen GET of POST' });
  }

  if (!heeftAuth()) return NIET_INGESTELD;

  const id = String(input.orderId || input.id || '');
  if (!geldigId(id)) return json(400, { error: 'Ongeldig id' });

  // Optionele controles (bij GET komen ze als tekst binnen)
  let verwachtBedrag = null;
  if (input.amountCents !== undefined && input.amountCents !== null && input.amountCents !== '') {
    verwachtBedrag = Number(input.amountCents);
    if (!Number.isInteger(verwachtBedrag) || verwachtBedrag <= 0) return json(400, { error: 'Ongeldig bedrag' });
  }
  const verwachtRef = input.reference ? String(input.reference) : null;

  try {
    const { res, data } = await paynlRest('/transactions/' + encodeURIComponent(id), { method: 'GET' });
    if (!res.ok) {
      console.error('paynl-app2app-verify: upstream status', res.status);
      return json(res.status >= 500 ? 502 : res.status, { error: korteFout(data, res.status) });
    }
    if (!data || typeof data !== 'object') return json(502, { error: 'Onverwacht antwoord van pay.nl' });

    // Sommige antwoorden zitten nog in een "data"-envelop
    const t = !data.status && data.data && typeof data.data === 'object' ? data.data : data;
    const status = t.status && typeof t.status === 'object' ? t.status : {};
    const action = String(status.action || t.action || (typeof t.status === 'string' ? t.status : '')).toUpperCase();
    const rawCode = status.code !== undefined ? status.code : t.code;
    const code = rawCode !== undefined && rawCode !== null && rawCode !== '' && !isNaN(Number(rawCode))
      ? Number(rawCode) : null;
    const amountCents = t.amount && Number.isInteger(Number(t.amount.value)) ? Number(t.amount.value) : null;
    const reference = t.reference ? String(t.reference) : null;

    // PAID of code 100 (zoals POS4ALL: NEW_PPT / 100 = betaald)
    let paid = action === 'PAID' || code === 100;
    let check = null;
    if (verwachtBedrag !== null && amountCents !== verwachtBedrag) check = 'amount';
    else if (verwachtRef !== null && reference !== verwachtRef) check = 'reference';
    if (check) paid = false;

    const antwoord = { paid, id, action, code, amountCents, reference };
    if (check) antwoord.check = check;
    return json(200, antwoord);
  } catch (err) {
    console.error('paynl-app2app-verify: netwerkfout', err.message);
    return json(502, { error: 'pay.nl niet bereikbaar' });
  }
};
