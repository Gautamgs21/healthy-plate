// Password hashing and login tokens using only Node's built-in crypto (no extra packages).
const crypto = require('crypto');

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET is not set (use 32+ random characters)');
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  try {
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(good);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.uid || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (e) {
    return null;
  }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}

function checkPassword(pw, stored) {
  try {
    const [s, h] = String(stored).split(':');
    const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    const want = Buffer.from(h, 'hex');
    return calc.length === want.length && crypto.timingSafeEqual(calc, want);
  } catch (e) {
    return false;
  }
}

function userFromReq(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
  return m ? verify(m[1]) : null;
}

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  try { return JSON.parse(b || '{}'); } catch (e) { return {}; }
}

// Setup mistakes (missing variables) are shown to you; other errors stay generic.
function fail(res, e) {
  console.error(e);
  const msg = String((e && e.message) || '');
  if (/is not set/.test(msg)) return res.status(500).json({ error: 'Server setup incomplete: ' + msg });
  return res.status(500).json({ error: 'Server error. Please try again in a moment.' });
}

module.exports = { sign, verify, hashPassword, checkPassword, userFromReq, readBody, fail };
