// Supabase-client en kleine helpers, gedeeld door kassa en dashboard.
const SUPABASE_URL = 'https://ckqehcivihvvbbgqvlcu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kwMaObiBgaOjjVKe9jeGhw_gi_laddC'; // publieke sleutel

const db = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
function euro(cents) {
  return EURO.format((cents || 0) / 100);
}

// Geeft data terug of gooit een fout met een leesbare boodschap.
function dbCheck(res) {
  if (res.error) throw new Error(res.error.message || 'Databasefout');
  return res.data;
}

function dbNodig() {
  if (!db) throw new Error('Database niet bereikbaar (herlaad de pagina)');
  return db;
}

const BETAALMIDDELEN = {
  cash: 'Cash',
  bon: 'Bon',
  bancontact_terminal: 'Bancontact terminal',
  bancontact_qr: 'Bancontact QR',
  swipedrinks: 'Swipedrinks'
};
