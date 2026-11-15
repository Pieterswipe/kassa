// POST {amountCents, testMode?, description?} -> velden voor PAY.POS App2App.
// Maakt geen pay.nl-order aan: de native wrapper bouwt hiermee de transactie op.
const crypto = require('crypto');
const { json, heeftAuth, NIET_INGESTELD } = require('./_paynl');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Alleen POST' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Ongeldige JSON' }); }
  if (!body || typeof body !== 'object') return json(400, { error: 'Ongeldige JSON' });

  if (!heeftAuth()) return NIET_INGESTELD;

  const amountCents = body.amountCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 10000000) {
    return json(400, { error: 'Ongeldig bedrag' });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const reference = ('KASSA' + Date.now() + crypto.randomBytes(3).toString('hex')).slice(0, 32);
  const attemptId = crypto.randomUUID();

  // Omschrijving: enkel tekst, zonder stuurtekens
  const omschrijving = typeof body.description === 'string'
    ? body.description.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    : '';

  const payload = {
    description: (omschrijving || 'Kassa ' + reference).slice(0, 64),
    reference: reference,
    returnUrl: 'kassaswipe://paynl-return/' + nonce,
    amount: { value: amountCents, currency: 'EUR' },
    integration: { testMode: Boolean(body.testMode), tipMode: { enabled: false } }
  };

  return json(200, { attemptId, reference, nonce, payload });
};
