// GET ?id=<uuid> -> pay.nl Order:Status, geeft {action, code} terug
const { json, heeftAuth, NIET_INGESTELD, korteFout, paynl } = require('./_paynl');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Alleen GET' });
  if (!heeftAuth()) return NIET_INGESTELD;

  const id = (event.queryStringParameters || {}).id || '';
  if (!UUID_RE.test(id)) return json(400, { error: 'Ongeldig id' });

  try {
    const { res, data } = await paynl('/orders/' + id + '/status', { method: 'GET' });
    if (!res.ok) {
      console.error('paynl-status: upstream status', res.status);
      return json(res.status, { error: korteFout(data, res.status) });
    }
    const status = (data && data.status) || {};
    return json(200, {
      action: String(status.action || '').toUpperCase(),
      code: status.code !== undefined ? status.code : null
    });
  } catch (err) {
    console.error('paynl-status: netwerkfout', err.message);
    return json(502, { error: 'pay.nl niet bereikbaar' });
  }
};
