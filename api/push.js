// Push devices and delivery history.
//   GET  /api/push?what=key       -> public VAPID key (no login needed)
//   GET  /api/push?what=devices   -> this user's registered devices
//   GET  /api/push?what=log       -> recent notifications and their delivery result
//   POST /api/push {action:"subscribe", subscription}  -> register this device
//   POST /api/push {action:"unsubscribe", endpoint}    -> remove this device
//   POST /api/push {action:"remove", id}               -> remove a device by id
//   POST /api/push {action:"test"}                     -> send a test notification now
const { getDb } = require('../lib/db');
const { userFromReq, readBody, fail } = require('../lib/auth');
const { vapidConfigured, notifyUser, shortId } = require('../lib/push');

const B64URL = /^[A-Za-z0-9_-]{8,200}$/;
const MAX_DEVICES = 10;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const what = String((req.query && req.query.what) || '');
    if (req.method === 'GET' && what === 'key') {
      return res.status(200).json({ configured: vapidConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || '' });
    }
    const me = userFromReq(req);
    if (!me) return res.status(401).json({ error: 'Please log in again.' });
    const db = await getDb();
    const subs = db.collection('push_subscriptions');

    if (req.method === 'GET') {
      if (what === 'devices') {
        const list = await subs.find({ userId: me.uid }).sort({ createdAt: 1 }).toArray();
        return res.status(200).json({
          devices: list.map((s) => ({
            id: shortId(s.endpoint), label: s.label || '', ua: s.ua || '', createdAt: s.createdAt, lastOk: s.lastOk || null,
            failCount: s.failCount || 0, endpoint: s.endpoint,
          })),
        });
      }
      if (what === 'log') {
        const list = await db.collection('notification_log').find({ userId: me.uid }).sort({ createdAt: -1 }).limit(30).toArray();
        return res.status(200).json({
          log: list.map((l) => ({
            id: String(l._id), type: l.type, title: l.title, body: l.body, status: l.status, sent: l.sent, failed: l.failed,
            removed: l.removed, at: l.createdAt, dueAt: l.dueAt || null,
          })),
        });
      }
      return res.status(400).json({ error: 'Unknown request.' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST' });
    const b = readBody(req);

    if (b.action === 'subscribe') {
      const s = b.subscription || {};
      const ep = String(s.endpoint || '');
      const keys = s.keys || {};
      if (!/^https:\/\/[^\s]{10,980}$/.test(ep) || !B64URL.test(String(keys.p256dh || '')) || !B64URL.test(String(keys.auth || ''))) {
        return res.status(400).json({ error: 'That device registration is not valid.' });
      }
      const now = Date.now();
      await subs.updateOne(
        { endpoint: ep },
        {
          $set: { userId: me.uid, keys: { p256dh: keys.p256dh, auth: keys.auth }, ua: String(b.ua || '').slice(0, 160), label: String(b.label || '').slice(0, 40), failCount: 0, lastSeen: now },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
      // keep the newest devices only
      const all = await subs.find({ userId: me.uid }).sort({ createdAt: 1 }).toArray();
      if (all.length > MAX_DEVICES) {
        await subs.deleteMany({ _id: { $in: all.slice(0, all.length - MAX_DEVICES).map((x) => x._id) } });
      }
      return res.status(200).json({ ok: true, id: shortId(ep) });
    }

    if (b.action === 'unsubscribe') {
      await subs.deleteOne({ userId: me.uid, endpoint: String(b.endpoint || '') });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'remove') {
      const list = await subs.find({ userId: me.uid }).toArray();
      const hit = list.find((s) => shortId(s.endpoint) === String(b.id || ''));
      if (hit) await subs.deleteOne({ _id: hit._id });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'test') {
      if (!vapidConfigured()) return res.status(503).json({ error: 'Server setup incomplete: VAPID keys are not set.' });
      const r = await notifyUser(db, me.uid, {
        type: 'test', title: 'Healthy Plate test', body: 'Notifications are working on this device.', url: '/?go=dash', tag: 'test',
      }, { ttl: 300 });
      if (r.noDevices) return res.status(409).json({ error: 'No device is registered yet. Turn notifications on first.' });
      return res.status(200).json({ ok: r.sent > 0, sent: r.sent, failed: r.failed, removed: r.removed, status: r.status });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return fail(res, e);
  }
};
