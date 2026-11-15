// Gedeelde helpers voor de pay.nl-functies. Logt nooit secrets.
const BASE = process.env.PAYNL_CONNECT_BASE || 'https://connect.pay.nl/v1';
// REST API (Transaction:Info), zelfde Basic auth
const REST_BASE = process.env.PAYNL_REST_BASE || 'https://rest.pay.nl/v2';

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

function authHeader() {
  const raw = process.env.PAYNL_TOKEN_CODE + ':' + process.env.PAYNL_API_TOKEN;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

function heeftAuth() {
  return Boolean(process.env.PAYNL_TOKEN_CODE && process.env.PAYNL_API_TOKEN);
}

const NIET_INGESTELD = json(503, { error: 'Bancontact is nog niet ingesteld' });

// Korte foutboodschap uit een pay.nl-antwoord
function korteFout(data, status) {
  let msg = '';
  if (data) {
    if (Array.isArray(data.violations) && data.violations[0]) msg = data.violations[0].message || '';
    msg = msg || data.detail || data.title || data.message || data.error || '';
  }
  return ('pay.nl fout ' + status + (msg ? ': ' + String(msg) : '')).slice(0, 200);
}

async function paynl(path, options) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Authorization': authHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}

async function paynlRest(path, options) {
  const res = await fetch(REST_BASE + path, {
    ...options,
    headers: {
      'Authorization': authHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}

module.exports = { json, heeftAuth, NIET_INGESTELD, korteFout, paynl, paynlRest };
