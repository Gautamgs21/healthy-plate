// Scheduled reminders.
//   GET  /api/reminders                                  -> all reminders for this user
//   POST /api/reminders {action:"create", reminder:{...}}
//   POST /api/reminders {action:"update", id, reminder:{...}}
//   POST /api/reminders {action:"toggle", id, enabled}
//   POST /api/reminders {action:"delete", id}
// Opening, dismissing or acknowledging a notification never changes a reminder.
// Only "toggle" (enabled=false) or "delete" stops it.
const { ObjectId } = require('mongodb');
const { getDb } = require('../lib/db');
const { userFromReq, readBody, fail } = require('../lib/auth');
const R = require('../lib/recur');

const MAX_REMINDERS = 100;

function view(d, now) {
  const status = !d.enabled ? 'off' : d.done ? 'done' : 'active';
  return {
    id: String(d._id), title: d.title, body: d.body || '', cat: d.cat, url: d.url || '', icon: d.icon || '', tz: d.tz,
    startDate: d.startDate, time: d.time, freq: d.freq, interval: d.interval, unit: d.unit || null, weekdays: d.weekdays || null,
    endDate: d.endDate || null, repeat: d.repeat, quiet: d.quiet || null, enabled: !!d.enabled, status,
    nextRunAt: d.enabled && !d.done ? d.nextRunAt : null, lastRunAt: d.lastRunAt || null, runCount: d.runCount || 0,
  };
}

function oid(id) {
  try { return new ObjectId(String(id)); } catch (e) { return null; }
}

// Work out the schedule state for a reminder that is (re)starting now.
function schedule(doc, now) {
  doc.chainStart = doc.repeat && doc.repeat.on ? R.chainStartFor(doc, now) : null;
  if (doc.repeat && doc.repeat.on && !doc.chainStart) return null;
  return R.nextRun(doc, now - 1);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const me = userFromReq(req);
  if (!me) return res.status(401).json({ error: 'Please log in again.' });
  try {
    const db = await getDb();
    const col = db.collection('reminders');
    const now = Date.now();

    if (req.method === 'GET') {
      const list = await col.find({ userId: me.uid }).toArray();
      return res.status(200).json({ now, reminders: list.map((d) => view(d, now)) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST' });
    const b = readBody(req);

    if (b.action === 'create' || b.action === 'update') {
      const n = R.normalize(b.reminder || {});
      if (n.error) return res.status(400).json({ error: n.error });
      const doc = n.value;
      let existing = null;
      if (b.action === 'update') {
        const id = oid(b.id);
        existing = id && (await col.findOne({ _id: id, userId: me.uid }));
        if (!existing) return res.status(404).json({ error: 'Reminder not found.' });
      } else if ((await col.countDocuments({ userId: me.uid })) >= MAX_REMINDERS) {
        return res.status(400).json({ error: 'You can have up to ' + MAX_REMINDERS + ' reminders.' });
      }
      const enabled = existing ? existing.enabled : true;
      doc.enabled = enabled;
      doc.done = false;
      doc.nextRunAt = null;
      if (enabled) {
        const next = schedule(doc, now);
        if (!next) {
          return res.status(400).json({ error: doc.freq === 'once' ? 'That time has already passed. Choose a time in the future.' : 'This schedule has no upcoming time. Check the end date.' });
        }
        doc.nextRunAt = next;
      }
      doc.updatedAt = now;
      if (existing) {
        await col.updateOne({ _id: existing._id }, { $set: doc });
        const saved = await col.findOne({ _id: existing._id });
        return res.status(200).json({ ok: true, reminder: view(saved, now) });
      }
      Object.assign(doc, { userId: me.uid, createdAt: now, runCount: 0, lastRunAt: null });
      const r = await col.insertOne(doc);
      doc._id = r.insertedId;
      return res.status(200).json({ ok: true, reminder: view(doc, now) });
    }

    if (b.action === 'toggle') {
      const id = oid(b.id);
      const d = id && (await col.findOne({ _id: id, userId: me.uid }));
      if (!d) return res.status(404).json({ error: 'Reminder not found.' });
      if (!b.enabled) {
        await col.updateOne({ _id: d._id }, { $set: { enabled: false, nextRunAt: null, updatedAt: now } });
      } else {
        d.done = false;
        const next = schedule(d, now);
        if (!next) {
          return res.status(400).json({ error: d.freq === 'once' ? 'That time has already passed. Edit the reminder and choose a new time.' : 'This schedule has finished. Edit the reminder to extend it.' });
        }
        await col.updateOne({ _id: d._id }, { $set: { enabled: true, done: false, nextRunAt: next, chainStart: d.chainStart || null, updatedAt: now } });
      }
      const saved = await col.findOne({ _id: d._id });
      return res.status(200).json({ ok: true, reminder: view(saved, now) });
    }

    if (b.action === 'delete') {
      const id = oid(b.id);
      if (id) await col.deleteOne({ _id: id, userId: me.uid });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return fail(res, e);
  }
};
