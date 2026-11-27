// Shared MongoDB connection. Serverless functions reuse one connection between requests.
const { MongoClient } = require('mongodb');

function findUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  // Vercel can add a prefix to the name (e.g. STORAGE_MONGODB_URI), so look for any match.
  const k = Object.keys(process.env).find((n) => /MONGODB_URI$/.test(n) && process.env[n]);
  return k ? process.env[k] : '';
}

// Collections that hold the app's saved data: one document per (user, key).
const COLLECTIONS = [
  'profiles',      // user details (age, height, ...) and body measurements (weight history)
  'settings',      // language, theme, family size, exercise goal, meal calories, notification choices
  'prices',        // price list and price comparisons
  'medications',   // medication list
  'health_tests',  // health test results (master checklist records)
  'exercise_logs', // one document per day: exercise + medicines taken
  'kitchen',       // pantry stock, meals prepared, shopping ticks
];

// Collections used by reminders and push notifications (not key/value documents).
const PUSH_COLLECTIONS = ['reminders', 'push_subscriptions', 'notification_log', 'notify_state', 'cron_state'];

// Decides which collection a piece of app data belongs to.
function collectionFor(key) {
  if (key === 'profile' || key === 'body') return 'profiles';
  if (['lang', 'theme', 'fam2', 'goal', 'mealkcal', 'notifyprefs'].includes(key)) return 'settings';
  if (['prices', 'cmp', 'psel'].includes(key)) return 'prices';
  if (key === 'meds') return 'medications';
  if (key === 'labs' || key === 'hlabs') return 'health_tests';
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
    await Promise.all([
      db.collection('reminders').createIndex({ userId: 1 }),
      db.collection('reminders').createIndex({ enabled: 1, nextRunAt: 1 }),
      db.collection('push_subscriptions').createIndex({ endpoint: 1 }, { unique: true }),
      db.collection('push_subscriptions').createIndex({ userId: 1 }),
      db.collection('notification_log').createIndex({ userId: 1, createdAt: -1 }),
      // blocks the same notification being recorded (and so sent) twice
      db.collection('notification_log').createIndex(
        { dedupeKey: 1 },
        { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
      ),
      // delivery history is kept for 60 days
      db.collection('notification_log').createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 86400 }),
      db.collection('notify_state').createIndex({ userId: 1 }, { unique: true }),
      db.collection('cron_state').createIndex({ key: 1 }, { unique: true }),
    ]);
    global._hpIndexed = true;
  }
  return db;
}

module.exports = { getDb, findUri, collectionFor, COLLECTIONS, PUSH_COLLECTIONS };
