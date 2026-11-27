// GET  /api/sync                       -> everything saved for the logged-in user
// POST /api/sync { items: [{key, value, t}] } -> save one or more pieces of data
const { getDb, collectionFor, COLLECTIONS } = require('../lib/db');
const { userFromReq, readBody, fail } = require('../lib/auth');
const { vapidConfigured, labEvents } = require('../lib/push');

const KEY_OK = /^[A-Za-z0-9_-]{1,60}$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const me = userFromReq(req);
  if (!me) return res.status(401).json({ error: 'Please log in again.' });
  try {
    const db = await getDb();

    if (req.method === 'GET') {
      const lists = await Promise.all(
        COLLECTIONS.map((c) =>
          db.collection(c).find({ userId: me.uid }).project({ _id: 0, key: 1, value: 1, updatedAt: 1 }).toArray()
        )
      );
      return res.status(200).json({ items: [].concat(...lists) });
    }

    if (req.method === 'POST') {
      const b = readBody(req);
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length || items.length > 60) return res.status(400).json({ error: 'Send 1 to 60 items.' });
      const now = Date.now();
      const ops = {};
      let size = 0;
      for (const it of items) {
        const key = String((it && it.key) || '');
        if (!KEY_OK.test(key)) return res.status(400).json({ error: 'Bad key: ' + key.slice(0, 30) });
        const value = it.value === undefined ? null : it.value;
        const len = JSON.stringify(value).length;
        size += len;
        if (len > 2e6 || size > 4e6) return res.status(413).json({ error: 'Data too large.' });
        let t = Number(it.t);
        if (!isFinite(t) || t <= 0 || t > now + 60000) t = now;
        const c = collectionFor(key);
        (ops[c] = ops[c] || []).push({
          updateOne: {
            filter: { userId: me.uid, key },
            update: { $set: { value, updatedAt: t } },
            upsert: true,
          },
        });
      }
      // For health-test results, remember what was there before so new out-of-range results can raise an alert.
      const labItem = items.find((it) => it && it.key === 'hlabs');
      let prevLabs = null;
      if (labItem && vapidConfigured()) {
        const d = await db.collection('health_tests').findOne({ userId: me.uid, key: 'hlabs' });
        prevLabs = d ? d.value : null;
      }
      await Promise.all(Object.entries(ops).map(([c, o]) => db.collection(c).bulkWrite(o, { ordered: false })));
      if (labItem && vapidConfigured()) {
        // Event-based notification. Never allowed to make the save fail or hang.
        try {
          await Promise.race([
            labEvents(db, me.uid, prevLabs, labItem.value),
            new Promise((resolve) => setTimeout(resolve, 6000)),
          ]);
        } catch (e) {
          console.error('lab event failed', e && e.message);
        }
      }
      return res.status(200).json({ ok: true, saved: items.length });
    }

    return res.status(405).json({ error: 'Use GET or POST' });
  } catch (e) {
    return fail(res, e);
  }
};
