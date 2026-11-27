// Reminder schedule maths: timezone-aware, no external packages.
//
// A reminder has:
//   startDate "YYYY-MM-DD", time "HH:MM", tz (IANA name, default Asia/Kolkata)
//   freq: once | daily | weekly | monthly | custom
//   interval: every N units (default 1)
//   unit (custom only): hours | days | weeks | months
//   weekdays: [0..6] (0 = Sunday) for weekly schedules; default is the weekday of startDate
//   endDate: optional "YYYY-MM-DD" (local date, inclusive)
//   repeat: { on: boolean, everyMin: number }   "Repeat until manually disabled"
//   quiet: optional { from: "HH:MM", to: "HH:MM" } (repeats in this window are skipped, never disabled)
//
// All "next" values are UTC milliseconds.

const DEFAULT_TZ = 'Asia/Kolkata';
const MIN = 60000;
const DAY = 86400000;

function pad(n) { return (n < 10 ? '0' : '') + n; }

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

// Offset (ms) of a timezone from UTC at a given instant: local = utc + offset
function tzOffset(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const o = {};
  f.formatToParts(new Date(utcMs)).forEach((p) => { o[p.type] = +p.value; });
  const asUtc = Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute, o.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// Wall-clock time in a timezone -> UTC ms (handles daylight-saving changes)
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - tzOffset(guess, tz);
  const off2 = tzOffset(utc, tz);
  if (guess - off2 !== utc) utc = guess - off2;
  return utc;
}

// UTC ms -> {y, mo, d, h, mi, dow, date:"YYYY-MM-DD", hm:"HH:MM"} in tz
function localParts(utcMs, tz) {
  const t = utcMs + tzOffset(utcMs, tz);
  const x = new Date(t);
  const y = x.getUTCFullYear(), mo = x.getUTCMonth() + 1, d = x.getUTCDate(), h = x.getUTCHours(), mi = x.getUTCMinutes();
  return { y, mo, d, h, mi, dow: x.getUTCDay(), date: y + '-' + pad(mo) + '-' + pad(d), hm: pad(h) + ':' + pad(mi) };
}

function parseDate(s) { return { y: +s.slice(0, 4), mo: +s.slice(5, 7), d: +s.slice(8, 10) }; }
function parseTime(s) { return { h: +s.slice(0, 2), mi: +s.slice(3, 5) }; }
function dayNumber(y, mo, d) { return Math.floor(Date.UTC(y, mo - 1, d) / DAY); }
function daysInMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }

function effUnit(r) {
  if (r.freq === 'custom') return r.unit || 'days';
  return { daily: 'days', weekly: 'weeks', monthly: 'months', once: 'once' }[r.freq] || 'once';
}

function pastEnd(r, local) { return !!(r.endDate && local.date > r.endDate); }

// First scheduled (base) occurrence strictly AFTER `after` (UTC ms), or null when the schedule is over.
function nextBase(r, after) {
  const tz = r.tz || DEFAULT_TZ;
  const sd = parseDate(r.startDate), tm = parseTime(r.time);
  const unit = effUnit(r);
  const n = Math.max(1, Math.floor(r.interval || 1));
  const start = zonedToUtc(sd.y, sd.mo, sd.d, tm.h, tm.mi, tz);
  const ok = (utc) => {
    if (utc <= after) return false;
    return !pastEnd(r, localParts(utc, tz));
  };

  if (unit === 'once') return start > after && ok(start) ? start : null;

  if (unit === 'hours') {
    const step = n * 3600000;
    let k = after < start ? 0 : Math.floor((after - start) / step) + 1;
    const utc = start + k * step;
    return ok(utc) ? utc : null;
  }

  // Walk local calendar days from the later of startDate and the day of `after`.
  const startDay = dayNumber(sd.y, sd.mo, sd.d);
  const a = localParts(Math.max(after, start - DAY), tz);
  let day = Math.max(startDay, dayNumber(a.y, a.mo, a.d));
  const limit = unit === 'days' ? n + 2 : unit === 'weeks' ? 7 * n + 8 : 31 * n + 62;
  const wd = Array.isArray(r.weekdays) && r.weekdays.length
    ? r.weekdays.map(Number)
    : [new Date(Date.UTC(sd.y, sd.mo - 1, sd.d)).getUTCDay()];
  const startDow = new Date(Date.UTC(sd.y, sd.mo - 1, sd.d)).getUTCDay();
  const startWeek = startDay - startDow; // Sunday that begins the start week

  for (let i = 0; i <= limit; i++, day++) {
    const dt = new Date(day * DAY);
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate(), dow = dt.getUTCDay();
    let hit = false;
    if (unit === 'days') {
      hit = (day - startDay) % n === 0;
    } else if (unit === 'weeks') {
      const weekIdx = Math.floor((day - dow - startWeek) / 7);
      hit = weekIdx % n === 0 && wd.indexOf(dow) !== -1;
    } else if (unit === 'months') {
      const monthIdx = (y - sd.y) * 12 + (mo - sd.mo);
      hit = monthIdx >= 0 && monthIdx % n === 0 && d === Math.min(sd.d, daysInMonth(y, mo));
    }
    if (!hit) continue;
    const utc = zonedToUtc(y, mo, d, tm.h, tm.mi, tz);
    if (utc <= after) continue;
    if (pastEnd(r, { date: y + '-' + pad(mo) + '-' + pad(d) })) return null;
    return utc;
  }
  return null;
}

function inQuiet(r, utc) {
  if (!r.quiet || !r.quiet.from || !r.quiet.to) return false;
  const l = localParts(utc, r.tz || DEFAULT_TZ);
  const m = l.h * 60 + l.mi;
  const f = parseTime(r.quiet.from), t = parseTime(r.quiet.to);
  const a = f.h * 60 + f.mi, b = t.h * 60 + t.mi;
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

// The next time this reminder should fire strictly after `after` (UTC ms), or null if it is finished.
// `chainStart` (UTC ms) is where a "repeat until disabled" chain began.
function nextRun(r, after) {
  if (r.repeat && r.repeat.on) {
    const e = Math.max(1, Math.floor(r.repeat.everyMin || 30)) * MIN;
    const tz = r.tz || DEFAULT_TZ;
    let cs = r.chainStart;
    if (!cs) {
      cs = nextBase(r, after - 1);
      if (!cs) return null;
    }
    let k = after < cs ? 0 : Math.floor((after - cs) / e) + 1;
    for (let g = 0; g < 2000; g++, k++) {
      const utc = cs + k * e;
      if (r.endDate && localParts(utc, tz).date > r.endDate) return null;
      if (!inQuiet(r, utc)) return utc;
    }
    return null;
  }
  return nextBase(r, after);
}

// Where a repeat chain begins when a reminder is created / enabled / edited: the first base occurrence at or after `from`.
function chainStartFor(r, from) {
  return nextBase(r, from - 1);
}

// Clean, validated reminder fields from untrusted input. Returns {error} or {value}.
function normalize(input, today) {
  const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const out = {};
  out.title = s(input.title, 80);
  if (!out.title) return { error: 'Please enter a title.' };
  out.body = s(input.body, 240);
  out.cat = ['general', 'medicine', 'meal', 'exercise', 'grocery', 'health'].includes(input.cat) ? input.cat : 'general';
  out.tz = validTz(input.tz) ? input.tz : DEFAULT_TZ;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s(input.startDate, 10))) return { error: 'Choose a valid date.' };
  out.startDate = s(input.startDate, 10);
  const sd = parseDate(out.startDate);
  const chk = new Date(Date.UTC(sd.y, sd.mo - 1, sd.d));
  if (chk.getUTCFullYear() !== sd.y || chk.getUTCMonth() !== sd.mo - 1 || chk.getUTCDate() !== sd.d || sd.y < 2020 || sd.y > 2100) {
    return { error: 'Choose a valid date.' };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s(input.time, 5))) return { error: 'Choose a valid time.' };
  out.time = s(input.time, 5);
  out.freq = ['once', 'daily', 'weekly', 'monthly', 'custom'].includes(input.freq) ? input.freq : 'once';
  out.interval = Math.min(365, Math.max(1, Math.floor(Number(input.interval) || 1)));
  if (out.freq === 'custom') {
    out.unit = ['hours', 'days', 'weeks', 'months'].includes(input.unit) ? input.unit : 'days';
    if (out.unit === 'hours') out.interval = Math.min(out.interval, 168);
  }
  if (out.freq === 'weekly' || (out.freq === 'custom' && out.unit === 'weeks')) {
    const wd = Array.isArray(input.weekdays) ? [...new Set(input.weekdays.map(Number).filter((x) => x >= 0 && x <= 6))].sort() : [];
    if (wd.length) out.weekdays = wd;
    out.interval = Math.min(out.interval, 52);
  }
  if (input.endDate) {
    const ed = s(input.endDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ed)) return { error: 'Choose a valid end date.' };
    if (ed < out.startDate) return { error: 'The end date must be on or after the start date.' };
    out.endDate = ed;
  }
  const rep = input.repeat || {};
  out.repeat = { on: !!rep.on, everyMin: Math.min(1440, Math.max(5, Math.floor(Number(rep.everyMin) || 30))) };
  if (input.quiet && input.quiet.from && input.quiet.to) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quiet.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quiet.to)) {
      return { error: 'Quiet hours need valid times.' };
    }
    out.quiet = { from: input.quiet.from, to: input.quiet.to };
  }
  // Destination and icon: same-site paths or https links only
  let url = s(input.url, 300);
  if (url && !/^\/[^/\\]/.test(url) && url !== '/') url = '';
  out.url = url;
  let icon = s(input.icon, 300);
  if (icon && !/^(https:\/\/|\/[^/\\])/.test(icon)) icon = '';
  out.icon = icon;
  return { value: out };
}

module.exports = {
  DEFAULT_TZ, MIN, DAY, validTz, tzOffset, zonedToUtc, localParts, nextBase, nextRun, chainStartFor, inQuiet, normalize, effUnit,
};
