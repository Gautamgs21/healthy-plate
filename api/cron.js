// The scheduler. Something must call this URL every minute (see README, "Scheduler").
//   GET /api/cron   with header  Authorization: Bearer <CRON_SECRET>   (or  ?key=<CRON_SECRET>)
//
// Each run:
//   1. finds reminders that are due and sends them (each one is "claimed" first, so two overlapping
//      runs can never send the same notification twice)
//   2. skips reminders that are far too late (for example, the scheduler was down) and records them as missed
//   3. about every 10 minutes: runs the daily event checks (medicine supply, check-ups due)
//   4. about once a day: removes devices that have stopped working
const crypto = require('crypto');
const { getDb } = require('../lib/db');
const R = require('../lib/recur');
const { vapidConfigured, notifyUser, conditionEvents, getPrefs } = require('../lib/push');

const LATE_LIMIT = 6 * 3600 * 1000;   // a one-off or daily reminder later than this is skipped, not sent
const BUDGET_MS = 25000;              // stop starting new work after this long
const COND_EVERY = 10 * 60 * 1000;

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const h = String(req.headers.authorization || '');
  const given = h.startsWith('Bearer ') ? h.slice(7) : String((req.query && req.query.key) || '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// true if this caller won the right to run `key` (at most once per `everyMs`)
async function claimEvery(db, key, everyMs, now) {
  try {
    await db.collection('cron_state').findOneAndUpdate(
      { key, last: { $lt: now - everyMs } },
      { $set: { last: now } },
      { upsert: true }
    );
    return true;
  } catch (e) {
    if (e && e.code === 11000) return false; // someone else holds it
    throw e;
  }
}

async function sendDue(db, r, now) {
  const col = db.collection('reminders');
  const dueAt = r.nextRunAt;
  const chain = r.repeat && r.repeat.on;
  const grace = chain ? Math.max(15 * 60000, (r.repeat.everyMin || 30) * 60000) : LATE_LIMIT;
  const next = R.nextRun(r, now);
  // Claim: only one caller can move this reminder past `dueAt`.
  const claimed = await col.findOneAndUpdate(
    { _id: r._id, enabled: true, nextRunAt: dueAt },
    { $set: { nextRunAt: next, done: next === null, lastRunAt: now, lastDueAt: dueAt }, $inc: { runCount: 1 } },
    { returnDocument: 'before' }
  );
  if (!claimed) return { skipped: true };

  if (now - dueAt > grace) {
    try {
      await db.collection('notification_log').insertOne({
        userId: r.userId, type: 'reminder', title: r.title, body: r.body || '', reminderId: String(r._id), dueAt, createdAt: new Date(),
        status: 'missed', sent: 0, failed: 0, removed: 0, devices: [], dedupeKey: 'r:' + r._id + ':' + dueAt,
      });
    } catch (e) { if (!(e && e.code === 11000)) throw e; }
    return { missed: true };
  }
  const out = await notifyUser(db, r.userId, {
    type: 'reminder', title: r.title, body: r.body || '', url: r.url || '/?go=remind', icon: r.icon || '', tag: 'rem-' + r._id,
    reminderId: r._id, dueAt, dedupeKey: 'r:' + r._id + ':' + dueAt,
  }, { ttl: chain ? Math.max(600, (r.repeat.everyMin || 30) * 60) : 3600 });
  return out.duplicate ? { skipped: true } : { sent: out.sent > 0, result: out };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Use GET' });
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorised' });
  const started = Date.now();
  const summary = { ok: true, due: 0, sent: 0, failed: 0, missed: 0, skipped: 0, events: 0, cleaned: 0 };
  try {
    if (!vapidConfigured()) return res.status(503).json({ ok: false, error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is not set' });
    const db = await getDb();
    const now = Date.now();

    // 1. due reminders (oldest first, a few at a time)
    const due = await db.collection('reminders').find({ enabled: true, nextRunAt: { $lte: now } }).sort({ nextRunAt: 1 }).limit(300).toArray();
    summary.due = due.length;
    let i = 0;
    const worker = async () => {
      while (i < due.length && Date.now() - started < BUDGET_MS) {
        const r = due[i++];
        try {
          const o = await sendDue(db, r, now);
          if (o.skipped) summary.skipped++;
          else if (o.missed) summary.missed++;
          else if (o.sent) summary.sent++;
          else summary.failed++;
        } catch (e) {
          summary.failed++;
          console.error('reminder failed', String(r._id), e && e.message);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    // 3. event checks, about every 10 minutes
    if (Date.now() - started < BUDGET_MS && (await claimEvery(db, 'conditions', COND_EVERY, now))) {
      const users = await db.collection('push_subscriptions').distinct('userId');
      for (const userId of users) {
        if (Date.now() - started > BUDGET_MS) break;
        try {
          const prefs = await getPrefs(db, userId);
          const local = R.localParts(now, prefs.tz);
          if (local.h < 8) continue; // not before 8 am their time
          // once per local day per user
          try {
            await db.collection('notify_state').findOneAndUpdate(
              { userId, lastCond: { $ne: local.date } }, { $set: { lastCond: local.date } }, { upsert: true }
            );
          } catch (e) { if (e && e.code === 11000) continue; throw e; }
          const r = await conditionEvents(db, userId, now);
          summary.events += r.filter((x) => x && x.sent > 0).length;
        } catch (e) { console.error('conditions failed', e && e.message); }
      }
    }

    // 4. daily housekeeping: drop devices not seen or successfully reached for 120 days
    if (Date.now() - started < BUDGET_MS && (await claimEvery(db, 'cleanup', 24 * 3600 * 1000, now))) {
      const cutoff = now - 120 * 86400000;
      const r = await db.collection('push_subscriptions').deleteMany({
        $and: [{ lastSeen: { $lt: cutoff } }, { $or: [{ lastOk: { $lt: cutoff } }, { lastOk: { $exists: false } }] }],
      });
      summary.cleaned = r.deletedCount || 0;
    }

    summary.ms = Date.now() - started;
    return res.status(200).json(summary);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
