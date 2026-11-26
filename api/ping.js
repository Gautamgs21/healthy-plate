// GET /api/ping  -> setup checker. Open it in the browser after deploying.
const { getDb, findUri } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const out = {
    ok: false,
    mongoUriSet: !!findUri(),
    authSecretSet: !!(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16),
    inviteCodeRequired: !!process.env.REGISTRATION_CODE,
    dbConnected: false,
  };
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    out.dbConnected = true;
    out.ok = out.authSecretSet;
  } catch (e) {
    console.error(e);
    out.error = out.mongoUriSet
      ? 'Could not connect to MongoDB. Check the connection string and that Atlas allows connections from Vercel.'
      : 'MONGODB_URI is not set. Connect MongoDB in the Vercel Storage tab.';
  }
  res.status(200).json(out);
};
