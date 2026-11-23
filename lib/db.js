// Shared MongoDB connection. Serverless functions reuse one connection between requests.
const { MongoClient } = require('mongodb');

function findUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  // Vercel can add a prefix to the name (e.g. STORAGE_MONGODB_URI), so look for any match.
  const k = Object.keys(process.env).find((n) => /MONGODB_URI$/.test(n) && process.env[n]);
  return k ? process.env[k] : '';
}

// One MongoDB collection (like a table) per kind of data.
const COLLECTIONS = [
  'profiles',      // user details (age, height, doctor ...)
  'settings',      // language, theme, family size, exercise goal
  'prices',        // price list and price comparisons
  'medications',   // medication list
  'health_tests',  // lab and health test results
  'exercise_logs', // one document per day: exercise + medicines taken
  'kitchen',       // pantry stock, meals prepared, shopping ticks
];

// Decides which collection a piece of app data belongs to.
function collectionFor(key) {
  if (key === 'profile') return 'profiles';
  if (['lang', 'theme', 'fam2', 'goal'].includes(key)) return 'settings';
  if (['prices', 'cmp', 'psel'].includes(key)) return 'prices';
  if (key === 'meds') return 'medications';
  if (key === 'labs') return 'health_tests';
  if (key.startsWith('log-')) return 'exercise_logs';
  return 'kitchen';
}

async function getDb() {
  if (!global._hpClient) {
    const uri = findUri();
    if (!uri) throw new Error('MONGODB_URI is not set');
    global._hpClient = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 }).connect();
    global._hpClient.catch(() => { global._hpClient = null; });
  }
  const client = await global._hpClient;
  const db = client.db(process.env.MONGODB_DB || 'healthyplate');
  if (!global._hpIndexed) {
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await Promise.all(
      COLLECTIONS.map((c) => db.collection(c).createIndex({ userId: 1, key: 1 }, { unique: true }))
    );
    global._hpIndexed = true;
  }
  return db;
}

module.exports = { getDb, findUri, collectionFor, COLLECTIONS };
