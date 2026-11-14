// POST ?id=<uuid> -> pay.nl Order:Abort (PATCH /orders/{id}/abort)
const { json, heeftAuth, NIET_INGESTELD, korteFout, paynl } = require('./_paynl');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Alleen POST' });
  if (!heeftAuth()) return NIET_INGESTELD;

  const id = (event.queryStringParameters || {}).id || '';
  if (!UUID_RE.test(id)) return json(400, { error: 'Ongeldig id' });

  try {
    const { res, data } = await paynl('/orders/' + id + '/abort', { method: 'PATCH' });
    if (!res.ok) {
      console.error('paynl-abort: upstream status', res.status);
      return json(res.status, { error: korteFout(data, res.status) });
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('paynl-abort: netwerkfout', err.message);
    return json(502, { error: 'pay.nl niet bereikbaar' });
  }
};
