// POST /api/auth  { action: "register" | "login", username, password, name, invite }
const { getDb } = require('../lib/db');
const { sign, hashPassword, checkPassword, readBody, fail } = require('../lib/auth');

const DUMMY = hashPassword('not-a-real-password'); // keeps timing similar for unknown users

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try {
    const b = readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!/^[a-z0-9._@-]{3,40}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3 to 40 characters: letters, numbers, . _ - @' });
    }
    if (password.length < 1 || password.length > 200) {
      return res.status(400).json({ error: 'Please enter your password.' });
    }
    const db = await getDb();
    const users = db.collection('users');
    const token = (u) => sign({ uid: String(u._id), exp: Date.now() + 30 * 864e5 });
    const out = (u) => ({ token: token(u), user: { id: String(u._id), username: u.username, name: u.name || '' } });

    if (b.action === 'register') {
      if (process.env.ALLOW_REGISTRATION === 'false') {
        return res.status(403).json({ error: 'New accounts are switched off.' });
      }
      const code = process.env.REGISTRATION_CODE;
      if (code && String(b.invite || '').trim() !== code) {
        return res.status(403).json({ error: 'Invite code is missing or wrong.' });
      }
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      const doc = {
        username,
        name: String(b.name || '').trim().slice(0, 60),
        hash: hashPassword(password),
        createdAt: Date.now(),
        failed: 0,
        lockUntil: 0,
      };
      try {
        const r = await users.insertOne(doc);
        doc._id = r.insertedId;
      } catch (e) {
        if (e && e.code === 11000) return res.status(409).json({ error: 'That username is taken. Try another.' });
        throw e;
      }
      return res.status(200).json(out(doc));
    }

    if (b.action === 'login') {
      const user = await users.findOne({ username });
      if (!user) {
        checkPassword(password, DUMMY);
        return res.status(401).json({ error: 'Wrong username or password.' });
      }
      if (user.lockUntil && user.lockUntil > Date.now()) {
        return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
      }
      if (!checkPassword(password, user.hash)) {
        let failed = (user.failed || 0) + 1;
        const set = { failed };
        if (failed >= 5) { set.failed = 0; set.lockUntil = Date.now() + 15 * 60000; }
        await users.updateOne({ _id: user._id }, { $set: set });
        return res.status(401).json({ error: 'Wrong username or password.' });
      }
      if (user.failed || user.lockUntil) {
        await users.updateOne({ _id: user._id }, { $set: { failed: 0, lockUntil: 0 } });
      }
      return res.status(200).json(out(user));
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return fail(res, e);
  }
};
