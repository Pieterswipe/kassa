// POST {amountCents, mode: 'terminal'|'qr', reference?} -> pay.nl Order:Create
const { json, heeftAuth, NIET_INGESTELD, korteFout, paynl } = require('./_paynl');

function siteUrl(event) {
  if (process.env.URL) return process.env.URL;
  const h = event.headers || {};
  if (h.origin) return h.origin;
  try { return new URL(h.referer).origin; } catch (e) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Alleen POST' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Ongeldige JSON' }); }

  const mode = body.mode;
  if (mode !== 'terminal' && mode !== 'qr') return json(400, { error: 'mode moet terminal of qr zijn' });

  const env = process.env;
  if (!heeftAuth() || !env.PAYNL_SERVICE_ID || (mode === 'terminal' && !env.PAYNL_TERMINAL_CODE)) {
    return NIET_INGESTELD;
  }

  const amountCents = body.amountCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 10000000) {
    return json(400, { error: 'Ongeldig bedrag' });
  }

  const reference = String(body.reference || 'KASSA' + Date.now()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 32)
    || 'KASSA' + Date.now();

  const order = {
    serviceId: env.PAYNL_SERVICE_ID,
    amount: { value: amountCents, currency: 'EUR' },
    reference: reference,
    description: ('Kassa ' + reference).slice(0, 32)
  };

  if (mode === 'terminal') {
    order.paymentMethod = { id: 1927, input: { terminalCode: env.PAYNL_TERMINAL_CODE } };
  } else {
    const url = siteUrl(event);
    if (!url) return json(400, { error: 'Geen site-URL voor returnUrl' });
    order.returnUrl = url;
  }

  try {
    const { res, data } = await paynl('/orders', { method: 'POST', body: JSON.stringify(order) });
    if (!res.ok) {
      console.error('paynl-start: upstream status', res.status);
      return json(res.status, { error: korteFout(data, res.status) });
    }
    if (!data || !data.id) return json(502, { error: 'Onverwacht antwoord van pay.nl' });
    const status = data.status && typeof data.status === 'object' ? data.status.action : data.status;
    return json(200, {
      id: data.id,
      orderId: data.orderId,
      redirect: data.links ? data.links.redirect : null,
      status: status || null
    });
  } catch (err) {
    console.error('paynl-start: netwerkfout', err.message);
    return json(502, { error: 'pay.nl niet bereikbaar' });
  }
};
