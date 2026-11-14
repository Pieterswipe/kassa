const UPSTREAM = 'https://europe-west3-swipedrinks-app.cloudfunctions.net';

function authHeader(event) {
  if (process.env.SD_TOKEN) {
    return 'Bearer ' + process.env.SD_TOKEN;
  }
  const headers = event.headers || {};
  return headers.authorization || headers.Authorization || '';
}

async function proxy(event, endpoint) {
  try {
    const response = await fetch(UPSTREAM + '/' + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader(event)
      },
      body: event.body
    });

    const text = await response.text();
    return {
      statusCode: response.status,
      body: text
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}

module.exports = { proxy };
