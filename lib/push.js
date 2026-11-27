// Sending Web Push notifications, recording delivery history, and event-based alerts.
const crypto = require('crypto');
const HP = require('../shared/tests.js');
const { localParts, DEFAULT_TZ, validTz } = require('./recur.js');

const MAX_FAILS = 8; // consecutive failed sends before a device is dropped

function vapidConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let _wp = null;
function webpush() {
  if (_wp) return _wp;
  if (!vapidConfigured()) throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is not set');
  const wp = require('web-push');
  wp.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  _wp = wp;
  return wp;
}

function shortId(endpoint) {
  return crypto.createHash('sha1').update(endpoint).digest('hex').slice(0, 10);
}

function host(endpoint) {
  try { return new URL(endpoint).host; } catch (e) { return ''; }
}

// Send one payload to one subscription. Returns {ok, code, gone, error}
async function sendOne(sub, payloadStr, opts) {
  try {
    const res = await webpush().sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      payloadStr,
      { TTL: opts.ttl || 3600, urgency: opts.urgency || 'high', topic: opts.topic }
    );
    return { ok: true, code: res && res.statusCode };
  } catch (e) {
    const code = e && e.statusCode;
    return { ok: false, code: code || 0, gone: code === 404 || code === 410, error: String((e && (e.body || e.message)) || e).slice(0, 160) };
  }
}

// Deliver a notification to every device a user has registered.
// n: { title, body, url, icon, tag, type, reminderId, dueAt, dedupeKey }
// Records the attempt in notification_log. A repeated dedupeKey is ignored (no second send).
async function notifyUser(db, userId, n, opts) {
  opts = opts || {};
  const log = db.collection('notification_log');
  const doc = {
    userId, type: n.type || 'event', title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 300),
    url: n.url || '/', reminderId: n.reminderId ? String(n.reminderId) : null, dueAt: n.dueAt || null,
    createdAt: new Date(), status: 'sending', sent: 0, failed: 0, removed: 0, devices: [],
  };
  if (n.dedupeKey) doc.dedupeKey = n.dedupeKey;
  let logId = null;
  try {
    const r = await log.insertOne(doc);
    logId = r.insertedId;
  } catch (e) {
    if (e && e.code === 11000) return { duplicate: true, sent: 0 };
    throw e;
  }

  const subs = await db.collection('push_subscriptions').find({ userId }).toArray();
  if (!subs.length) {
    await log.updateOne({ _id: logId }, { $set: { status: 'no_devices' } });
    return { sent: 0, noDevices: true };
  }
  const payload = JSON.stringify({
    title: doc.title, body: doc.body, url: doc.url, icon: n.icon || '', tag: n.tag || '', type: doc.type, t: Date.now(),
  });
  const results = await Promise.all(subs.map((s) => sendOne(s, payload, opts)));
  const subCol = db.collection('push_subscriptions');
  let sent = 0, failed = 0, removed = 0;
  const devices = [];
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i], r = results[i];
    const dev = { id: shortId(s.endpoint), host: host(s.endpoint), ok: r.ok, code: r.code || 0 };
    if (r.ok) {
      sent++;
      await subCol.updateOne({ _id: s._id }, { $set: { failCount: 0, lastOk: Date.now() } });
    } else if (r.gone) {
      removed++;
      dev.removed = true;
      await subCol.deleteOne({ _id: s._id });
    } else {
      failed++;
      dev.error = r.error;
      const fails = (s.failCount || 0) + 1;
      if (fails >= MAX_FAILS) { removed++; dev.removed = true; await subCol.deleteOne({ _id: s._id }); }
      else await subCol.updateOne({ _id: s._id }, { $set: { failCount: fails, lastFail: Date.now() } });
    }
    devices.push(dev);
  }
  const status = sent > 0 ? (failed > 0 ? 'partial' : 'sent') : (removed > 0 && failed === 0 ? 'expired' : 'failed');
  await log.updateOne({ _id: logId }, { $set: { status, sent, failed, removed, devices } });
  return { sent, failed, removed, status, devices };
}

// ---------------------------------------------------------------- event-based alerts

async function getKey(db, collection, userId, key) {
  const d = await db.collection(collection).findOne({ userId, key });
  return d ? d.value : null;
}

async function getPrefs(db, userId) {
  const v = (await getKey(db, 'settings', userId, 'notifyprefs')) || {};
  return { lab: v.lab !== false, med: v.med !== false, chk: v.chk !== false, tz: validTz(v.tz) ? v.tz : DEFAULT_TZ };
}

// Compare saved results before and after a sync. New results that are outside the reference range
// (or marked abnormal) trigger one notification. Never alerts for old backfilled results.
async function labEvents(db, userId, prevValue, nextValue) {
  const prefs = await getPrefs(db, userId);
  if (!prefs.lab) return null;
  const prev = new Set(((prevValue && prevValue.list) || []).map((r) => r.id));
  const list = (nextValue && nextValue.list) || [];
  const profile = (await getKey(db, 'profiles', userId, 'profile')) || {};
  const today = localParts(Date.now(), prefs.tz).date;
  const recent = HP.addToDate(today, { d: -10 });
  const hits = list.filter((r) => r && r.id && !prev.has(r.id) && HP.get(r.tid) && HP.isDate(r.date) && r.date >= recent && HP.needsAttention(r, profile.sex));
  if (!hits.length) return null;
  let title, body;
  if (hits.length === 1) {
    const r = hits[0], t = HP.get(r.tid), f = HP.flags(r, profile.sex);
    title = 'Result needs attention: ' + t.short;
    if (f.length) {
      const x = f[0];
      body = x.label + ' ' + x.value + ' ' + x.unit + ' is ' + (x.flag === 'high' ? 'above' : 'below') + ' the reference range (' + x.ref + '). Please review with your doctor.';
    } else {
      body = t.name + ' was recorded as ' + (r.status === 'followup' ? 'needing follow-up' : 'abnormal') + '. Please review with your doctor.';
    }
  } else {
    title = hits.length + ' new results need attention';
    body = hits.slice(0, 4).map((r) => HP.get(r.tid).short).join(', ') + (hits.length > 4 ? ' and more' : '') + '. Please review with your doctor.';
  }
  const key = 'lab:' + userId + ':' + crypto.createHash('sha1').update(hits.map((r) => r.id).sort().join(',')).digest('hex').slice(0, 12);
  return notifyUser(db, userId, { type: 'event', title, body, url: '/?go=health', tag: 'lab-alert', dedupeKey: key });
}

function isoWeekKey(date) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7) - 1, d = +date.slice(8, 10);
  const t = new Date(Date.UTC(y, m, d));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return t.getUTCFullYear() + '-W' + wk;
}

function dayDiff(a, b) { // b - a in days, both "YYYY-MM-DD"
  const f = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((f(b) - f(a)) / 86400000);
}

// Condition checks (run once a day per user, from 8 am in their timezone):
//  - medicine supply ending within 3 days
//  - health check-ups that have passed their due date (at most one reminder a week)
async function conditionEvents(db, userId, nowMs) {
  const prefs = await getPrefs(db, userId);
  const today = localParts(nowMs, prefs.tz).date;
  const out = [];

  if (prefs.med) {
    const meds = ((await getKey(db, 'medications', userId, 'meds')) || {}).list || [];
    const low = meds
      .filter((m) => m && m.supply && HP.isDate(m.supply) && m.status !== 'stopped')
      .map((m) => ({ n: m.n, left: dayDiff(today, m.supply) }))
      .filter((m) => m.left <= 3)
      .sort((a, b) => a.left - b.left);
    if (low.length) {
      const txt = low.slice(0, 4).map((m) => m.n + (m.left < 0 ? ' (ran out)' : m.left === 0 ? ' (ends today)' : ' (' + m.left + ' day' + (m.left === 1 ? '' : 's') + ' left)')).join(', ');
      out.push(await notifyUser(db, userId, {
        type: 'event', title: 'Medicine supply running low', body: txt + (low.length > 4 ? ' and more' : '') + '. Time to buy more.',
        url: '/?go=dash&open=meds', tag: 'med-supply', dedupeKey: 'med:' + userId + ':' + today,
      }));
    }
  }

  if (prefs.chk) {
    const recs = ((await getKey(db, 'health_tests', userId, 'hlabs')) || {}).list || [];
    const due = HP.TESTS
      .map((t) => ({ t, due: HP.dueDate(t, recs) }))
      .filter((x) => x.due && x.due <= today)
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    if (due.length) {
      const txt = due.slice(0, 4).map((x) => x.t.short).join(', ') + (due.length > 4 ? ' and ' + (due.length - 4) + ' more' : '');
      out.push(await notifyUser(db, userId, {
        type: 'event', title: due.length === 1 ? 'Health check-up due' : due.length + ' health check-ups due', body: txt + '. Book or record them in the Health tab.',
        url: '/?go=dash&open=checks', tag: 'chk-due', dedupeKey: 'chk:' + userId + ':' + isoWeekKey(today),
      }));
    }
  }
  return out;
}

module.exports = { vapidConfigured, webpush, notifyUser, labEvents, conditionEvents, getPrefs, shortId, MAX_FAILS };
