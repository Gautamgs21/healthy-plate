/* Healthy Plate: Dashboard, health-test checklist, weight tracking and medicine details.
 *
 * Loaded by index.html before the main script. It uses the app's own helpers (store, $, esc, SVG, dkey,
 * toast, M, SHOP, buyData ...) when its functions run, and the shared lists in shared/tests.js and
 * shared/calc.js. Everything the Dashboard shows is read from the same saved data the other tabs use:
 *   hlabs  health test results      body    weight history       meds   medicines
 *   log-DATE exercise + medicines   done    meals prepared       mealkcal  calories per meal
 *   profile height, target, calorie target
 */
(function () {
  "use strict";
  var HP = window.HP_TESTS, C = window.HP_CALC;
  var SLOTS = 6;

  /* ------------------------------------------------------------------ small helpers */
  function todayKey() { return dkey(0); }
  function pd(s) { return new Date(s + "T00:00:00"); }
  function fd(s) { return HP.isDate(s) ? pd(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–"; }
  function fds(s) { return HP.isDate(s) ? pd(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "–"; }
  function dayDiff(a, b) { return Math.round((pd(b) - pd(a)) / 864e5); }
  function inWords(n) {
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n === -1) return "yesterday";
    return n > 0 ? "in " + n + " days" : Math.abs(n) + " days ago";
  }
  function num(v, dp) { return v == null || !isFinite(v) ? "–" : String(+Number(v).toFixed(dp == null ? 2 : dp)); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function rupee(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ------------------------------------------------------------------ data access */
  function profile() { return store.get("profile"); }
  function sex() { return profile().sex || ""; }
  function labs() { return store.get("hlabs").list || []; }
  function allMeds() { return store.get("meds").list || []; }
  function activeMeds() { return allMeds().filter(function (m) { return m.status !== "stopped"; }); }
  function bodyList() {
    return (store.get("body").list || [])
      .filter(function (r) { return HP.isDate(r.date) && typeof r.w === "number" && r.w > 0; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function currentWeight() {
    var b = bodyList();
    if (b.length) return b[b.length - 1].w;
    var w = +profile().weight;
    return w > 0 ? w : null;
  }
  // One weight per date. Entering a date again corrects that day's value.
  function setWeight(date, w) {
    if (!HP.isDate(date) || !(w > 0 && w < 500)) return false;
    var cur = store.get("body"), list = (cur.list || []).slice();
    var hit = list.filter(function (r) { return r.date === date; })[0];
    if (hit) hit.w = w; else list.push({ id: uid("w"), date: date, w: w });
    store.set("body", { list: list });
    var b = bodyList();
    if (b.length && b[b.length - 1].date === date) {
      var p = profile();
      if (p.weight !== w) { p.weight = w; store.set("profile", p); }
    }
    return true;
  }
  function deleteWeight(id) {
    store.set("body", { list: (store.get("body").list || []).filter(function (r) { return r.id !== id; }) });
  }
  function targetWeight() {
    var p = profile();
    if (+p.tw > 0) return +p.tw;
    if (+p.tb > 0 && +p.height > 0) return C.weightForBmi(+p.tb, +p.height);
    return null;
  }
  function targetBmi() {
    var p = profile();
    if (+p.tb > 0) return +p.tb;
    if (+p.tw > 0 && +p.height > 0) return C.bmi(+p.tw, +p.height);
    return null;
  }

  /* ------------------------------------------------------------------ dialogs */
  function sheet(html, opts) {
    opts = opts || {};
    var el = document.createElement("div");
    el.className = "dov" + (opts.big ? " big" : "");
    el.innerHTML = '<div class="sheet' + (opts.big ? " hm" : "") + '" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(el);
    function key(e) { if (e.key === "Escape" && el === document.body.lastElementChild) close(); }
    function close() {
      document.removeEventListener("keydown", key);
      if (el.parentNode) el.remove();
      if (opts.onClose) opts.onClose();
    }
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    document.addEventListener("keydown", key);
    trDom();
    return { el: el, close: close };
  }

  /* ------------------------------------------------------------------ line chart (no libraries) */
  function niceTicks(min, max, n) {
    var span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var out = [], t = Math.floor(min / step) * step;
    for (var i = 0; i < 20 && t <= max + step * 0.001; i++, t += step) out.push(+t.toFixed(6));
    return out;
  }

  // o: { series:[{name, cls, pts:[{d,y,bad,tip}]}], lo, hi, refLabel, target:{y,label}, unit, label }
  function drawChart(host, o) {
    var W = Math.max(300, Math.min(760, host.clientWidth || 640)), H = W < 500 ? 210 : 250, L = 42, R = 12, T = 14, B = 28;
    var pts = [];
    o.series.forEach(function (s) { s.pts.forEach(function (p) { pts.push(p); }); });
    if (!pts.length) { host.innerHTML = ""; return; }
    var xs = pts.map(function (p) { return pd(p.d).getTime(); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    if (x0 === x1) { x0 -= 864e5 * 3; x1 += 864e5 * 3; }
    var ys = pts.map(function (p) { return p.y; });
    [o.lo, o.hi, o.target && o.target.y].forEach(function (v) { if (v != null) ys.push(v); });
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var pad = (y1 - y0 || Math.abs(y1) * 0.1 || 1) * 0.12;
    y0 -= pad; y1 += pad;
    if (y0 < 0 && Math.min.apply(null, ys) >= 0) y0 = 0;
    var ticks = niceTicks(y0, y1, 4);
    y0 = Math.min(y0, ticks[0]); y1 = Math.max(y1, ticks[ticks.length - 1]);
    function X(t) { return L + (t - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" class="ch-svg" role="img" aria-label="' + esc(o.label || "Chart") + '">';
    ticks.forEach(function (t) {
      s += '<line class="ch-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/><text class="ch-txt" x="' + (L - 6) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + num(t, 2) + "</text>";
    });
    if (o.lo != null || o.hi != null) {
      var top = Y(o.hi != null ? o.hi : y1), bot = Y(o.lo != null ? o.lo : y0);
      s += '<rect class="ch-band" x="' + L + '" y="' + top + '" width="' + (W - L - R) + '" height="' + Math.max(0, bot - top) + '"/>';
      if (o.refLabel) s += '<text class="ch-txt ch-refl" x="' + (W - R - 4) + '" y="' + (top + 12) + '" text-anchor="end">' + esc(o.refLabel) + "</text>";
    }
    if (o.target && o.target.y != null) {
      s += '<line class="ch-target" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(o.target.y) + '" y2="' + Y(o.target.y) + '"/><text class="ch-txt ch-tl" x="' + (L + 4) + '" y="' + (Y(o.target.y) - 5) + '">' + esc(o.target.label) + "</text>";
    }
    var nx = Math.min(5, Math.max(2, Math.floor((W - L - R) / 110))), longSpan = x1 - x0 > 300 * 864e5;
    for (var i = 0; i < nx; i++) {
      var t = x0 + (x1 - x0) * i / (nx - 1), dt = new Date(t);
      var lab = dt.toLocaleDateString("en-GB", longSpan ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
      s += '<text class="ch-txt" x="' + X(t) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? "start" : i === nx - 1 ? "end" : "middle") + '">' + lab + "</text>";
    }
    var hit = [];
    o.series.forEach(function (se, si) {
      var line = se.pts.map(function (p) { return X(pd(p.d).getTime()).toFixed(1) + "," + Y(p.y).toFixed(1); }).join(" ");
      if (se.pts.length > 1) s += '<polyline class="ch-line s' + (si + 1) + '" points="' + line + '"/>';
      se.pts.forEach(function (p) {
        var cx = X(pd(p.d).getTime()), cy = Y(p.y);
        s += '<circle class="ch-pt s' + (si + 1) + (p.bad ? " bad" : "") + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (p.bad ? 5.5 : 4) + '"/>';
        hit.push({ x: cx, y: cy, tip: p.tip });
      });
    });
    s += "</svg>";
    host.innerHTML = '<div class="chart">' + s + '<div class="ch-tip" hidden></div></div>';
    var wrap = host.firstChild, tip = wrap.querySelector(".ch-tip"), svg = wrap.querySelector("svg");
    function show(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W, best = null, bd = 1e9;
      hit.forEach(function (h) { var d = Math.abs(h.x - px); if (d < bd) { bd = d; best = h; } });
      if (!best) return;
      tip.hidden = false; tip.textContent = best.tip;
      tip.style.left = Math.min(92, Math.max(8, best.x / W * 100)) + "%";
      tip.style.top = (best.y / H * 100) + "%";
    }
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") tip.hidden = true; });
  }

  /* ------------------------------------------------------------------ test results: helpers */
  function recsFor(tid) {
    return labs().filter(function (r) { return r.tid === tid && HP.isDate(r.date); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.id || "") < (a.id || "") ? -1 : 1; });
  }
  function statusLabel(id) { var s = HP.STATUS.filter(function (x) { return x.id === id; })[0]; return s ? s.label : ""; }
  function flagChip(f) { return '<span class="chip ' + (f === "high" || f === "low" ? "bad" : "") + '">' + (f === "high" ? "High" : "Low") + "</span>"; }

  // "HbA1c 6.8 %" or "LDL 130, HDL 45 mg/dL" for a result
  function summary(rec, max) {
    var t = HP.get(rec.tid); if (!t) return "";
    var parts = [], sx = sex();
    t.p.forEach(function (p) {
      var v = rec.v && rec.v[p.k];
      if (typeof v !== "number") return;
      var f = HP.flag(p, v, sx);
      parts.push({ txt: (t.p.length > 1 ? p.label + " " : "") + num(v) + " " + p.unit, f: f });
    });
    var shown = parts.slice(0, max || 4);
    var out = shown.map(function (x) { return x.f ? '<span class="bad-t">' + esc(x.txt) + "</span>" : esc(x.txt); }).join(", ");
    if (parts.length > shown.length) out += " +" + (parts.length - shown.length) + " more";
    if (t.t) t.t.forEach(function (f) { var v = rec.t && rec.t[f.k]; if (v) out += (out ? ", " : "") + esc(f.label.split(" (")[0] + ": " + v); });
    if (rec.status) out += (out ? " · " : "") + esc(statusLabel(rec.status));
    if (!out && rec.findings) out = esc(rec.findings.slice(0, 80));
    return out || "Recorded";
  }

  function testState(t) {
    var recs = recsFor(t.id), today = todayKey();
    if (!recs.length) return { k: "none", label: "Not recorded", rec: null };
    var latest = recs[0];
    if (HP.needsAttention(latest, sex())) return { k: "attn", label: "Needs attention", rec: latest };
    var due = HP.dueDate(t, labs());
    if (due && due < today) return { k: "over", label: "Overdue", rec: latest, due: due };
    if (due && dayDiff(today, due) <= 30) return { k: "soon", label: "Due " + inWords(dayDiff(today, due)), rec: latest, due: due };
    return { k: "ok", label: "Up to date", rec: latest, due: due };
  }

  /* ------------------------------------------------------------------ one-time move of older lab entries */
  var LEGACY = {
    "HbA1c": ["hba1c", "v"], "Fasting glucose": ["fbs", "v"], "Post-meal glucose": ["ppbs", "v"], "TSH": ["tsh", "v"],
    "Total cholesterol": ["lipid", "tc"], "LDL": ["lipid", "ldl"], "HDL": ["lipid", "hdl"], "Triglycerides": ["lipid", "tg"],
    "Creatinine": ["creat", "v"]
  };
  function migrateLegacy() {
    var cur = store.get("hlabs");
    if (cur.migrated) return;
    var old = (store.get("labs").list || []);
    if (!old.length) return;
    var list = (cur.list || []).slice(), mig = [], lipid = {}, weights = [];
    old.forEach(function (x) {
      if (!HP.isDate(x.date)) return;
      var v = parseFloat(String(x.value).replace(",", "."));
      if (x.test === "Blood pressure") {
        var m = String(x.value).match(/^\s*(\d{2,3})\s*[\/\\]\s*(\d{2,3})\s*$/);
        if (m) { list.push({ id: "mg" + x.id, tid: "bp", date: x.date, v: { sys: +m[1], dia: +m[2] }, note: x.note || "" }); mig.push(x.id); }
      } else if (x.test === "Weight" && isFinite(v) && v > 0) {
        weights.push({ date: x.date, w: v }); mig.push(x.id);
      } else if (LEGACY[x.test] && isFinite(v)) {
        var mp = LEGACY[x.test];
        if (mp[0] === "lipid") {
          var r = lipid[x.date] = lipid[x.date] || { id: "mgl" + x.date, tid: "lipid", date: x.date, v: {}, note: "" };
          r.v[mp[1]] = v; if (x.note) r.note = x.note;
        } else {
          var v2 = {}; v2[mp[1]] = v;
          list.push({ id: "mg" + x.id, tid: mp[0], date: x.date, v: v2, note: x.note || "" });
        }
        mig.push(x.id);
      }
    });
    Object.keys(lipid).forEach(function (d) { list.push(lipid[d]); });
    // never add a second result for the same test and date
    var seen = {}, clean = [];
    list.forEach(function (r) { var k = r.tid + "|" + r.date; if (seen[k]) return; seen[k] = 1; clean.push(r); });
    store.set("hlabs", { list: clean, mig: (cur.mig || []).concat(mig), migrated: true });
    weights.forEach(function (w) { setWeight(w.date, w.w); });
  }
  function legacyLeft() {
    var done = store.get("hlabs").mig || [];
    return (store.get("labs").list || []).filter(function (x) { return done.indexOf(x.id) < 0; });
  }

  /* ------------------------------------------------------------------ add / edit a test result */
  function saveLabs(list) {
    var cur = store.get("hlabs");
    store.set("hlabs", { list: list, mig: cur.mig || [], migrated: true });
  }

  function openLabForm(o) {
    o = o || {};
    var list = labs(), rec = o.id ? list.filter(function (r) { return r.id === o.id; })[0] : null;
    var tid = rec ? rec.tid : (o.tid || HP.TESTS[0].id);
    var sh = sheet("", { onClose: null }), box = sh.el.firstChild, editing = rec;

    function opts() {
      return HP.GROUPS.map(function (g) {
        return '<optgroup label="' + esc(g.name) + '">' + HP.inGroup(g.id).map(function (t) {
          return '<option value="' + t.id + '"' + (t.id === tid ? " selected" : "") + ">" + esc(t.name) + "</option>";
        }).join("") + "</optgroup>";
      }).join("");
    }
    function paint(keep) {
      var t = HP.get(tid), v = (keep && keep.v) || (editing && editing.tid === tid ? editing.v : {}) || {};
      var tx = (keep && keep.t) || (editing && editing.tid === tid ? editing.t : {}) || {};
      var date = (keep && keep.date) || (editing && editing.date) || todayKey();
      var h = '<h3>' + (editing ? "Edit result" : "Record a result") + '</h3><p class="sheet-sub">' + esc(t.freq) + " · for " + esc(t.forText) + ". Older results are kept in your history.</p>";
      h += '<label class="fld"><span>Test</span><select id="lf-t">' + opts() + "</select></label>";
      h += '<label class="fld"><span>Date of test</span><input id="lf-d" type="date" value="' + date + '" max="' + HP.addToDate(todayKey(), { d: 1 }) + '"></label>';
      t.p.forEach(function (p) {
        var rt = HP.refText(p, sex());
        h += '<label class="fld"><span>' + esc(p.label) + " (" + esc(p.unit) + ")" + (p.opt ? " · optional" : "") + (rt ? ' <small class="ref">reference ' + esc(rt) + "</small>" : "") +
          '</span><input data-p="' + p.k + '" type="number" inputmode="decimal" step="any" min="0" value="' + (typeof v[p.k] === "number" ? v[p.k] : "") + '"></label>';
      });
      if (t.t) t.t.forEach(function (f) {
        h += '<label class="fld"><span>' + esc(f.label) + '</span><input data-t="' + f.k + '" maxlength="40" value="' + esc(tx[f.k] || "") + '"></label>';
      });
      if (t.kind === "report") {
        h += '<label class="fld"><span>Result</span><select id="lf-s"><option value="">Not stated</option>' + HP.STATUS.map(function (s) {
          return '<option value="' + s.id + '"' + (((keep && keep.status) || (editing && editing.status)) === s.id ? " selected" : "") + ">" + s.label + "</option>";
        }).join("") + "</select></label>";
        h += '<label class="fld"><span>Findings / impression</span><textarea id="lf-f" rows="3" maxlength="600">' + esc((keep && keep.findings) || (editing && editing.findings) || "") + "</textarea></label>";
      }
      h += '<label class="fld"><span>Next review date <small class="ref">optional, from your doctor</small></span><input id="lf-n" type="date" value="' + ((keep && keep.next) || (editing && editing.next) || "") + '"></label>';
      h += '<label class="fld"><span>Note <small class="ref">optional</small></span><input id="lf-o" maxlength="160" value="' + esc((keep && keep.note) || (editing && editing.note) || "") + '"></label>';
      h += '<p class="auth-err" id="lf-e" role="alert"></p><div class="form-row"><button class="btn-primary" id="lf-save" style="flex:1">Save result</button><button class="btn-ghost" id="lf-x" style="flex:1">Cancel</button></div>';
      if (editing) h += '<div class="form-row"><button class="btn-danger-outline" id="lf-del" style="flex:1">Delete this result</button></div>';
      box.innerHTML = h;
      box.querySelector("#lf-t").onchange = function () { tid = this.value; paint(read(true)); };
      box.querySelector("#lf-x").onclick = sh.close;
      box.querySelector("#lf-save").onclick = save;
      if (editing) box.querySelector("#lf-del").onclick = function () {
        if (!confirm("Delete this result? This cannot be undone.")) return;
        saveLabs(labs().filter(function (r) { return r.id !== editing.id; }));
        sh.close(); toast("Deleted"); if (o.done) o.done();
      };
      trDom();
    }
    function read(loose) {
      var r = { v: {}, t: {} };
      r.date = box.querySelector("#lf-d").value;
      box.querySelectorAll("[data-p]").forEach(function (i) {
        var x = i.value.trim().replace(",", ".");
        if (x === "") return;
        r.v[i.dataset.p] = x === "" ? null : (isFinite(+x) ? +x : NaN);
      });
      box.querySelectorAll("[data-t]").forEach(function (i) { if (i.value.trim()) r.t[i.dataset.t] = i.value.trim(); });
      var s = box.querySelector("#lf-s"), f = box.querySelector("#lf-f");
      r.status = s ? s.value : ""; r.findings = f ? f.value.trim() : "";
      r.next = box.querySelector("#lf-n").value; r.note = box.querySelector("#lf-o").value.trim();
      return r;
    }
    function save() {
      var r = read(), err = box.querySelector("#lf-e");
      var rec2 = { id: editing ? editing.id : uid("r"), tid: tid, date: r.date, v: r.v };
      if (Object.keys(r.t).length) rec2.t = r.t;
      if (r.status) rec2.status = r.status;
      if (r.findings) rec2.findings = r.findings;
      if (r.next) rec2.next = r.next;
      if (r.note) rec2.note = r.note;
      var bad = HP.validate(rec2, todayKey());
      if (bad) { err.textContent = bad; return; }
      var dup = HP.duplicateOf(rec2, labs());
      if (dup) {
        err.innerHTML = "A result for this test on " + esc(fd(rec2.date)) + ' already exists. <a href="#" id="lf-ed">Edit that one</a> or choose another date.';
        box.querySelector("#lf-ed").onclick = function (e) { e.preventDefault(); sh.close(); openLabForm({ id: dup.id, done: o.done }); };
        return;
      }
      var next = labs().slice();
      if (editing) next = next.map(function (x) { return x.id === editing.id ? rec2 : x; }); else next.push(rec2);
      saveLabs(next);
      sh.close(); toast("Saved"); if (o.done) o.done();
    }
    paint();
  }

  /* ------------------------------------------------------------------ Health tab: master checklist */
  var histOpen = {}, groupClosed = {};
  function recLine(r, done) {
    var t = HP.get(r.tid);
    return '<div class="row-item"><div class="row-info"><div class="row-title">' + esc(fd(r.date)) + '</div><div class="row-sub">' + summary(r, 6) +
      (r.findings ? "<br>" + esc(r.findings) : "") + (r.note ? "<br><i>" + esc(r.note) + "</i>" : "") + (r.next ? "<br>Next review " + esc(fd(r.next)) : "") +
      '</div></div><button class="btn-mini" data-act="edit" data-id="' + esc(r.id) + '" aria-label="Edit result">Edit</button></div>';
  }
  function testsCard() {
    migrateLegacy();
    var recorded = 0, h = "";
    HP.TESTS.forEach(function (t) { if (recsFor(t.id).length) recorded++; });
    h += '<div class="card health-full" id="tests"><div class="card-hd"><h3>' + SVG.chart + ' Health tests</h3><span class="meta">' + recorded + "/" + HP.TESTS.length + " recorded</span></div>";
    h += '<p class="sheet-sub">Your complete monitoring checklist. Each new result is added to the history and old results are kept. Reference ranges are general adult values, and your doctor’s targets may differ.</p>';
    HP.GROUPS.forEach(function (g) {
      var tests = HP.inGroup(g.id), attn = 0, due = 0, rec = 0;
      var rows = tests.map(function (t) {
        var st = testState(t); if (st.rec) rec++; if (st.k === "attn") attn++; if (st.k === "over") due++;
        var open = histOpen[t.id];
        var r = '<div class="tst"><div class="tst-top"><div class="row-info"><div class="row-title">' + esc(t.name) + '</div><div class="row-sub">' + esc(t.freq) + " · " + esc(t.forText) + "</div>" +
          '<div class="row-sub">' + (st.rec ? "Last " + esc(fd(st.rec.date)) + ": " + summary(st.rec, 3) : "No result recorded yet") + "</div></div>" +
          '<span class="chip st-' + st.k + '">' + esc(st.label) + "</span></div>" +
          '<div class="tst-btns"><button class="btn-mini pri" data-act="add" data-tid="' + t.id + '">Add result</button>' +
          (st.rec ? '<button class="btn-mini" data-act="hist" data-tid="' + t.id + '" aria-expanded="' + !!open + '">History (' + recsFor(t.id).length + ")</button>" : "") + "</div>";
        if (open) r += '<div class="tst-hist">' + recsFor(t.id).map(function (x) { return recLine(x); }).join("") + "</div>";
        return r + "</div>";
      }).join("");
      h += '<details class="tg" data-g="' + g.id + '"' + (groupClosed[g.id] ? "" : " open") + "><summary><span>" + esc(g.name) + '</span><span class="meta">' + rec + "/" + tests.length + (attn ? " · " + attn + " need attention" : "") + (due ? " · " + due + " overdue" : "") + "</span>" + SVG.chev + "</summary>" + rows + "</details>";
    });
    var left = legacyLeft();
    if (left.length) {
      h += '<details class="tg"><summary><span>Older entries</span><span class="meta">' + left.length + "</span>" + SVG.chev + '</summary><p class="sheet-sub" style="margin-top:8px">Saved before the checklist was added. They did not fit a checklist test, so they are kept here as they were.</p>' +
        left.map(function (x) { return '<div class="row-item"><div class="row-info"><div class="row-title">' + esc(x.test) + ": " + esc(x.value) + " " + esc(x.unit || "") + '</div><div class="row-sub">' + esc(fd(x.date)) + (x.note ? " · " + esc(x.note) : "") + "</div></div></div>"; }).join("") + "</details>";
    }
    return h + "</div>";
  }
  function wireTests(rerender) {
    var card = document.getElementById("tests"); if (!card) return;
    card.addEventListener("toggle", function (e) { var d = e.target; if (d.dataset && d.dataset.g) groupClosed[d.dataset.g] = !d.open; }, true);
    card.onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      if (b.dataset.act === "add") openLabForm({ tid: b.dataset.tid, done: rerender });
      else if (b.dataset.act === "edit") openLabForm({ id: b.dataset.id, done: rerender });
      else if (b.dataset.act === "hist") { histOpen[b.dataset.tid] = !histOpen[b.dataset.tid]; rerender(); }
    };
  }

  /* ------------------------------------------------------------------ Health Check Statistics modal */
  var hcSel = { blood: "fbs", heart: "bp", eye: "eyeexam", lung: "spiro" }, hcParam = {};
  var GROUP_TITLE = { blood: "Routine Blood and Urine Investigations", heart: "Heart and Cardiovascular Monitoring", eye: "Eye Monitoring", lung: "Lung Monitoring" };

  function valBox(label, rec, t) {
    if (!rec) return '<div class="vb"><div class="vb-l">' + label + '</div><div class="vb-v muted">No earlier result</div></div>';
    var sx = sex(), lines = "";
    t.p.forEach(function (p) {
      var v = rec.v && rec.v[p.k]; if (typeof v !== "number") return;
      var f = HP.flag(p, v, sx);
      lines += '<div class="vb-r' + (f ? " bad-t" : "") + '">' + (t.p.length > 1 ? esc(p.label) + ": " : "") + "<b>" + num(v) + "</b> " + esc(p.unit) + (f ? " " + flagChip(f) : "") + "</div>";
    });
    if (t.t) t.t.forEach(function (f) { var v = rec.t && rec.t[f.k]; if (v) lines += '<div class="vb-r">' + esc(f.label.split(" (")[0]) + ": <b>" + esc(v) + "</b></div>"; });
    if (rec.status) lines += '<div class="vb-r"><span class="chip ' + (rec.status === "normal" ? "" : "bad") + '">' + esc(statusLabel(rec.status)) + "</span></div>";
    if (!lines) lines = '<div class="vb-r">Recorded</div>';
    return '<div class="vb"><div class="vb-l">' + label + " · " + esc(fd(rec.date)) + "</div>" + lines + "</div>";
  }

  function hcHtml(g) {
    var t = HP.get(hcSel[g]), recs = recsFor(t.id), sx = sex();
    var h = '<div class="hc" data-g="' + g + '"><h4>' + esc(GROUP_TITLE[g]) + "</h4>";
    h += '<label class="fld"><span class="sr">Investigation</span><select class="hc-sel" data-g="' + g + '" aria-label="' + esc(GROUP_TITLE[g]) + ' investigation">' +
      HP.inGroup(g).map(function (x) { return '<option value="' + x.id + '"' + (x.id === t.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></label>";
    h += '<div class="hc-meta">' + esc(t.freq) + " · for " + esc(t.forText) + "</div>";
    if (!recs.length) {
      h += '<div class="empty"><b>No results recorded yet</b><span>Nothing is shown here until you record a result for ' + esc(t.short) + ".</span></div>";
    } else {
      if (t.kind === "num") {
        var pk = hcParam[t.id] && t.p.some(function (p) { return p.k === hcParam[t.id]; }) ? hcParam[t.id] : t.p[0].k;
        if (t.p.length > 1) h += '<div class="pchips" role="group" aria-label="Parameter">' + t.p.map(function (p) { return '<button class="chip-b' + (p.k === pk ? " on" : "") + '" data-g="' + g + '" data-pk="' + p.k + '">' + esc(p.label.replace(/ \(.*\)/, "")) + "</button>"; }).join("") + "</div>";
        h += '<div class="hc-chart" id="hcc-' + g + '"></div>';
        var p0 = t.p.filter(function (p) { return p.k === pk; })[0], rt = HP.refText(p0, sx);
        h += '<div class="hc-ref">' + (rt ? "Reference: " + esc(rt) + " " + esc(p0.unit) + ". " : "No standard reference range. ") + "Points outside the range are shown in red.</div>";
      } else {
        h += '<div class="tl">' + recs.map(function (r) {
          var bad = HP.needsAttention(r, sx);
          return '<div class="tl-i' + (bad ? " bad" : "") + '"><div class="tl-d">' + esc(fd(r.date)) + '</div><div class="tl-b">' + summary(r, 5) + (r.findings ? "<div>" + esc(r.findings) + "</div>" : "") + (r.next ? '<div class="muted">Next review ' + esc(fd(r.next)) + "</div>" : "") + "</div></div>";
        }).join("") + "</div>";
      }
      h += '<div class="vbs">' + valBox("Latest", recs[0], t) + valBox("Previous", recs[1] || null, t) + "</div>";
    }
    h += '<div class="form-row"><button class="btn-primary hc-add" data-tid="' + t.id + '">Record result</button></div></div>';
    return h;
  }
  function hcDraw(g) {
    var host = document.getElementById("hcc-" + g); if (!host) return;
    var t = HP.get(hcSel[g]), pk = hcParam[t.id] && t.p.some(function (p) { return p.k === hcParam[t.id]; }) ? hcParam[t.id] : t.p[0].k;
    var p = t.p.filter(function (x) { return x.k === pk; })[0], sx = sex(), r = HP.range(p, sx);
    var pts = recsFor(t.id).filter(function (x) { return x.v && typeof x.v[pk] === "number"; }).reverse().map(function (x) {
      var f = HP.flag(p, x.v[pk], sx);
      return { d: x.date, y: x.v[pk], bad: !!f, tip: fd(x.date) + ": " + num(x.v[pk]) + " " + p.unit + (f ? " (" + (f === "high" ? "high" : "low") + ")" : "") };
    });
    if (!pts.length) { host.innerHTML = '<div class="empty"><span>No values recorded for ' + esc(p.label) + ".</span></div>"; return; }
    drawChart(host, { series: [{ pts: pts }], lo: r.lo, hi: r.hi, refLabel: HP.refText(p, sx) ? "Ref " + HP.refText(p, sx) : "", unit: p.unit, label: t.name + " history, " + p.label });
  }
  function hcRefresh(g) {
    var el = document.querySelector('.hc[data-g="' + g + '"]'); if (!el) return;
    el.outerHTML = hcHtml(g); hcDraw(g); trDom();
  }
  function openHealthModal() {
    migrateLegacy();
    var body = '<div class="hm-hd"><h3>Health Check Statistics</h3><button class="btn-del" id="hm-x" aria-label="Close">×</button></div>' +
      '<p class="sheet-sub">Choose an investigation in each box. Results come from the Health tab checklist.</p><div class="hm-grid">' +
      ["blood", "heart", "eye", "lung"].map(hcHtml).join("") + "</div>";
    var sh = sheet(body, { big: true, onClose: function () { if (tab === "dash") renderDash(); } });
    var root = sh.el;
    ["blood", "heart", "eye", "lung"].forEach(hcDraw);
    root.querySelector("#hm-x").onclick = sh.close;
    root.addEventListener("change", function (e) {
      var s = e.target.closest(".hc-sel"); if (!s) return;
      hcSel[s.dataset.g] = s.value; hcRefresh(s.dataset.g);
      var again = root.querySelector('.hc-sel[data-g="' + s.dataset.g + '"]'); if (again) again.focus();
    });
    root.addEventListener("click", function (e) {
      var c = e.target.closest("[data-pk]");
      if (c) { hcParam[hcSel[c.dataset.g]] = c.dataset.pk; hcRefresh(c.dataset.g); return; }
      var a = e.target.closest(".hc-add");
      if (a) { var g = HP.get(a.dataset.tid).g; openLabForm({ tid: a.dataset.tid, done: function () { hcRefresh(g); } }); }
    });
  }

  /* ------------------------------------------------------------------ medicines */
  var TIMINGS = ["", "Before meals", "After meals", "With meals", "Empty stomach", "At bedtime", "Any time"];
  var FREQS = ["", "Once daily", "Twice daily", "Three times daily", "Weekly", "As needed"];
  function medFreq(m) { return m.freq || "Daily · " + (m.s || "Morning"); }
  function medCard(L, goal) {
    var meds = allMeds(), act = meds.filter(function (m) { return m.status !== "stopped"; }), off = meds.filter(function (m) { return m.status === "stopped"; });
    var h = '<div class="card"><div class="card-hd"><h3>' + SVG.pill + ' Medication today</h3><span class="meta">' + act.length + " active</span></div>";
    if (!meds.length) h += '<p style="color:var(--mute);font-size:.85rem;margin:0 0 8px">No medicines added yet. Add the ones your doctor prescribed below.</p>';
    ["Morning", "Afternoon", "Night"].forEach(function (s) {
      var l = act.filter(function (m) { return m.s === s; }); if (!l.length) return;
      h += '<div class="slot-lbl">' + s + "</div>";
      l.forEach(function (m) {
        var sub = [m.purpose, m.timing].filter(Boolean).join(" · ");
        h += '<div class="med-row"><label><input type="checkbox" data-m="' + m.id + '"' + (L.taken[m.id] ? " checked" : "") + "><span>" + esc(m.n) + (m.d ? ' <span style="color:var(--mute);font-weight:400">(' + esc(m.d) + ")</span>" : "") + (sub ? '<small class="msub">' + esc(sub) + "</small>" : "") +
          '</span></label><button class="btn-mini" data-stop="' + m.id + '" aria-label="Stop ' + esc(m.n) + '">Stop</button><button class="btn-del" data-del="' + m.id + '" aria-label="Remove ' + esc(m.n) + '">×</button></div>';
      });
    });
    if (off.length) {
      h += '<div class="slot-lbl">Discontinued</div>';
      off.forEach(function (m) {
        h += '<div class="med-row off"><span style="flex:1;font-size:.85rem;color:var(--mute)">' + esc(m.n) + (m.d ? " (" + esc(m.d) + ")" : "") + '</span><button class="btn-mini" data-resume="' + m.id + '">Resume</button><button class="btn-del" data-del="' + m.id + '" aria-label="Remove ' + esc(m.n) + '">×</button></div>';
      });
    }
    h += '<details class="addmed"' + (meds.length ? "" : " open") + '><summary>Add a medicine</summary><div class="fld-grid">' +
      '<label class="fld wide"><span>Medicine name</span><input id="mn" maxlength="60"></label>' +
      '<label class="fld"><span>Dose</span><input id="md" placeholder="e.g. 500 mg" maxlength="30"></label>' +
      '<label class="fld"><span>When (daily checklist)</span><select id="ms"><option value="Morning">Morning</option><option value="Afternoon">Afternoon</option><option value="Night">Night</option></select></label>' +
      '<label class="fld wide"><span>Purpose</span><input id="mp" placeholder="e.g. Diabetes" maxlength="60"></label>' +
      '<label class="fld"><span>Frequency</span><select id="mf">' + FREQS.map(function (x) { return "<option>" + x + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>Timing</span><select id="mt">' + TIMINGS.map(function (x) { return "<option>" + x + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld wide"><span>Supply lasts until <small class="ref">optional, used for buy reminders</small></span><input id="mu" type="date"></label></div>' +
      '<button class="btn-primary" id="madd" style="width:100%">Add medicine</button></details></div>';
    return h;
  }
  function wireMeds(rerender) {
    var addBtn = document.getElementById("madd");
    if (addBtn) addBtn.onclick = function () {
      var n = document.getElementById("mn").value.trim(); if (!n) { toast("Enter the medicine name"); return; }
      var meds = allMeds().slice(), m = { id: "m" + Date.now(), n: n, d: document.getElementById("md").value.trim(), s: document.getElementById("ms").value, status: "active" };
      var p = document.getElementById("mp").value.trim(), f = document.getElementById("mf").value, t = document.getElementById("mt").value, u = document.getElementById("mu").value;
      if (p) m.purpose = p; if (f) m.freq = f; if (t) m.timing = t; if (HP.isDate(u)) m.supply = u;
      meds.push(m); store.set("meds", { list: meds }); rerender();
    };
    function patch(id, fn) { store.set("meds", { list: allMeds().map(function (m) { if (m.id === id) fn(m); return m; }) }); rerender(); }
    document.querySelectorAll("[data-stop]").forEach(function (b) { b.onclick = function () { if (confirm("Mark this medicine as discontinued? Your history is kept.")) patch(b.dataset.stop, function (m) { m.status = "stopped"; }); }; });
    document.querySelectorAll("[data-resume]").forEach(function (b) { b.onclick = function () { patch(b.dataset.resume, function (m) { m.status = "active"; }); }; });
    document.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { if (confirm("Remove this medicine from the list?")) store.set("meds", { list: allMeds().filter(function (m) { return m.id !== b.dataset.del; }) }), rerender(); }; });
  }

  function medStatsCard() {
    var meds = allMeds(), act = meds.filter(function (m) { return m.status !== "stopped"; });
    var h = '<div class="card dash-card"><div class="card-hd"><h3>' + SVG.pill + ' Medicine Statistics</h3><span class="meta">' + plural(act.length, "active medicine") + "</span></div>";
    if (!meds.length) return h + '<div class="empty"><b>No medicines added yet</b><span>Add them in the Health tab and they will appear here.</span></div><button class="btn-ghost" data-go="health">Open Health tab</button></div>';
    function row(m) {
      return '<div class="mrow"><div class="mrow-n"><b>' + esc(m.n) + '</b><span class="chip ' + (m.status === "stopped" ? "" : "ok") + '">' + (m.status === "stopped" ? "Discontinued" : "Active") + "</span></div><dl>" +
        "<div><dt>Purpose</dt><dd>" + esc(m.purpose || "–") + "</dd></div><div><dt>Dosage</dt><dd>" + esc(m.d || "–") + "</dd></div>" +
        "<div><dt>Frequency</dt><dd>" + esc(medFreq(m)) + "</dd></div><div><dt>Timing</dt><dd>" + esc(m.timing || "Not specified") + "</dd></div></dl></div>";
    }
    h += (act.length ? act.slice(0, 3).map(row).join("") : '<p class="sheet-sub">All medicines are marked discontinued.</p>');
    h += '<button class="btn-ghost" id="medall" style="width:100%;margin-top:8px">View complete medication list (' + meds.length + ")</button></div>";
    return h;
  }
  function openMedList() {
    var meds = allMeds().slice().sort(function (a, b) { return (a.status === "stopped") - (b.status === "stopped"); });
    function row(m) {
      return '<div class="mrow"><div class="mrow-n"><b>' + esc(m.n) + '</b><span class="chip ' + (m.status === "stopped" ? "" : "ok") + '">' + (m.status === "stopped" ? "Discontinued" : "Active") + "</span></div><dl>" +
        "<div><dt>Purpose</dt><dd>" + esc(m.purpose || "–") + "</dd></div><div><dt>Dosage</dt><dd>" + esc(m.d || "–") + "</dd></div>" +
        "<div><dt>Frequency</dt><dd>" + esc(medFreq(m)) + "</dd></div><div><dt>Timing</dt><dd>" + esc(m.timing || "Not specified") + "</dd></div>" +
        (m.supply ? "<div><dt>Supply until</dt><dd>" + esc(fd(m.supply)) + "</dd></div>" : "") + "</dl></div>";
    }
    var sh = sheet('<div class="hm-hd"><h3>Medication list</h3><button class="btn-del" id="ml-x" aria-label="Close">×</button></div><p class="sheet-sub">' + plural(meds.filter(function (m) { return m.status !== "stopped"; }).length, "active medicine") + ", " + meds.filter(function (m) { return m.status === "stopped"; }).length + ' discontinued. Edit medicines in the Health tab.</p>' + meds.map(row).join("") +
      '<div class="form-row"><button class="btn-primary" id="ml-go" style="flex:1">Manage in Health tab</button></div>');
    sh.el.querySelector("#ml-x").onclick = sh.close;
    sh.el.querySelector("#ml-go").onclick = function () { sh.close(); go("health"); };
  }

  /* ------------------------------------------------------------------ meal calories editor */
  function openMealKcal() {
    var dk = todayKey(), w = new Date().getDay(), mk = store.get("mealkcal"), meals = M[w].m;
    var h = '<h3>Calories for today’s meals</h3><p class="sheet-sub">Your meal chart has no calorie figures, so enter them from your dietitian’s chart or a label. Only meals marked as prepared count as eaten.</p>';
    meals.forEach(function (m, i) {
      var v = C.mealKcal(mk, dk, i);
      h += '<label class="fld"><span>' + esc(SLOT_LABELS[i]) + " · " + esc(m[0]) + ' <small class="ref">' + esc(m[1].slice(0, 70)) + '</small></span><input data-i="' + i + '" type="number" inputmode="numeric" min="0" max="3000" value="' + (v == null ? "" : v) + '" placeholder="kcal"></label>';
    });
    var d = mk.days && mk.days[dk], ex = d && typeof d.extra === "number" ? d.extra : "";
    h += '<label class="fld"><span>Extra food or drinks today <small class="ref">snacks, tea with sugar, etc.</small></span><input id="mk-x" type="number" inputmode="numeric" min="0" max="5000" value="' + ex + '" placeholder="kcal"></label>';
    h += '<label class="chk-row"><input type="checkbox" id="mk-u" checked><span class="chk-lbl">Use these as my usual calories for each meal time</span></label>';
    h += '<div class="form-row"><button class="btn-primary" id="mk-s" style="flex:1">Save</button><button class="btn-ghost" id="mk-c" style="flex:1">Cancel</button></div>';
    var sh = sheet(h);
    sh.el.querySelector("#mk-c").onclick = sh.close;
    sh.el.querySelector("#mk-s").onclick = function () {
      var cur = store.get("mealkcal"), slots = Object.assign({}, cur.slots), days = Object.assign({}, cur.days), day = {};
      var useDefault = sh.el.querySelector("#mk-u").checked;
      sh.el.querySelectorAll("[data-i]").forEach(function (i) {
        if (i.value === "") return;
        var n = Math.round(+i.value); if (!(n >= 0 && n <= 3000)) return;
        day[i.dataset.i] = n; if (useDefault || slots[i.dataset.i] == null) slots[i.dataset.i] = n;
      });
      var x = sh.el.querySelector("#mk-x").value; if (x !== "" && +x >= 0 && +x <= 5000) day.extra = Math.round(+x);
      days[dk] = day;
      // keep only the last 60 days of per-day values
      Object.keys(days).sort().slice(0, Math.max(0, Object.keys(days).length - 60)).forEach(function (k) { delete days[k]; });
      store.set("mealkcal", { slots: slots, days: days });
      sh.close(); toast("Saved"); renderDash();
    };
  }

  /* ------------------------------------------------------------------ Dashboard: upcoming events */
  function go(t) { setTab(t); }
  function setTab(t) { tab = t; render(); window.scrollTo(0, 0); }
  function extra(cat) { return (window.HP_EVENTS && window.HP_EVENTS(cat)) || []; }

  function shopDays() {
    var out = [];
    for (var i = 0; i < 14 && out.length < 2; i++) {
      var d = new Date(); d.setDate(d.getDate() + i);
      if (d.getDay() === 1 || d.getDay() === 4) out.push({ key: d.toLocaleDateString("en-CA"), w: d.getDay(), n: i });
    }
    return out;
  }
  function groupCount(gs) { return gs.reduce(function (a, g) { return a + g[1].length; }, 0); }

  function evGrocery() {
    var items = [], days = shopDays(), low = [];
    try { low = buyData(); } catch (e) { low = []; }
    days.forEach(function (d) {
      var src = d.w === 1 ? SHOP.mon : SHOP.thu, gs = d.w === 1 ? src[1].filter(function (g) { return g[0] !== "Occasional"; }) : src[1];
      items.push({ t: fds(d.key) + " (" + inWords(d.n) + ")", s: String(src[0]).replace(/\.$/, "") + ". About " + plural(groupCount(gs), "item") + ".", tone: d.n === 0 ? "warn" : "" });
    });
    var cost = 0;
    if (low.length) {
      low.slice(0, 8).forEach(function (b) { items.push({ t: b.n + ": buy " + qtxt(b.b, b.u), s: "In stock " + qtxt(b.have, b.u) + (b.cost ? ", about " + rupee(b.cost) : ""), tone: "warn" }); });
      low.forEach(function (b) { cost += b.cost || 0; });
      if (low.length > 8) items.push({ t: "and " + (low.length - 8) + " more low items", s: "See the buy list in Groceries." });
    }
    extra("grocery").forEach(function (e) { items.push(e); });
    var first = days[0];
    return {
      id: "grocery", title: "Grocery Purchase", icon: SVG.bag, go: "shop", cta: "Open Groceries",
      next: (first ? "Next shop " + fds(first.key) + " (" + inWords(first.n) + ")" : "No shop scheduled") + (low.length ? " · " + low.length + " low in stock" + (cost ? ", about " + rupee(cost) : "") : ""),
      items: items
    };
  }
  function evMeds() {
    var today = todayKey(), items = [];
    var list = activeMeds().filter(function (m) { return HP.isDate(m.supply); }).sort(function (a, b) { return a.supply < b.supply ? -1 : 1; });
    list.forEach(function (m) {
      var n = dayDiff(today, m.supply);
      items.push({ t: m.n + (m.d ? " (" + m.d + ")" : ""), s: n < 0 ? "Supply ran out " + fd(m.supply) : n === 0 ? "Supply ends today" : "Supply ends " + fd(m.supply) + " (" + inWords(n) + ")", tone: n <= 3 ? "bad" : n <= 10 ? "warn" : "" });
    });
    extra("medicine").forEach(function (e) { items.push(e); });
    var nxt;
    if (list.length) { var n0 = dayDiff(today, list[0].supply); nxt = list[0].n + ": " + (n0 < 0 ? "ran out " + fd(list[0].supply) : n0 === 0 ? "ends today" : "buy by " + fd(list[0].supply) + " (" + inWords(n0) + ")"); }
    var none = !activeMeds().length ? "No medicines added yet." : "No supply dates set. Add “Supply lasts until” to a medicine to get purchase alerts.";
    return { id: "meds", title: "Medicine Purchase", icon: SVG.pill, go: "health", cta: "Open Health tab", next: nxt || none, items: items, empty: !items.length };
  }
  function evMeals() {
    var dk = todayKey(), w = new Date().getDay(), dn = store.get("done")[dk] || {}, nm = new Date().getHours() * 60 + new Date().getMinutes();
    var meals = M[w].m, items = [], nextIdx = -1;
    meals.forEach(function (m, i) {
      var s = dn[i] && dn[i].s, late = MT[i] + 60 <= nm;
      if (nextIdx < 0 && s == null && !late) nextIdx = i;
      items.push({ t: m[0] + " " + SLOT_LABELS[i], s: m[1], tag: s === 1 ? "Prepared" : s === 0 ? "Skipped" : late ? "Not marked" : "Pending", tone: s === 1 ? "ok" : late && s == null ? "warn" : "" });
    });
    var tw = (w + 1) % 7, tm = M[tw].m[0];
    items.push({ t: "Tomorrow, " + D[tw] + " · " + tm[0] + " " + SLOT_LABELS[0], s: tm[1], tag: "Tomorrow" });
    extra("meal").forEach(function (e) { items.push(e); });
    var nxt = nextIdx >= 0 ? meals[nextIdx][0] + " " + SLOT_LABELS[nextIdx] + ": " + meals[nextIdx][1] : "Today’s meals are done. Tomorrow " + tm[0] + ": " + tm[1];
    return { id: "meals", title: "Meal Preparation", icon: SVG.fruit, go: "meals", cta: "Open Meals", next: nxt, items: items };
  }
  function evEx() {
    var L = store.get("log-" + todayKey()), ex = L.ex || [], goal = store.get("goal").m || 30, mins = ex.reduce(function (a, e) { return a + e.m; }, 0), items = [];
    var left = Math.max(0, goal - mins), w = currentWeight();
    items.push({ t: "Today’s goal: " + goal + " min", s: mins + " min done" + (left ? ", " + left + " min to go" : ", goal reached"), tone: left ? "warn" : "ok" });
    ex.forEach(function (e) { var k = C.exerciseKcal(e, w); items.push({ t: e.a + " · " + e.m + " min", s: k ? (k.est ? "about " : "") + k.kcal + " kcal" + (k.est ? " (estimate)" : "") : "Add your weight to estimate calories" }); });
    var met = 0;
    for (var o = 0; o < 7; o++) { var l = store.get("log-" + dkey(o)), m = (l.ex || []).reduce(function (a, e) { return a + e.m; }, 0); if (m >= goal) met++; }
    items.push({ t: "Last 7 days", s: "Goal met on " + met + " of 7 days" });
    extra("exercise").forEach(function (e) { items.push(e); });
    return { id: "ex", title: "Exercises", icon: SVG.run, go: "health", cta: "Log exercise", next: left ? left + " min of exercise left to reach today’s " + goal + " min goal" : "Today’s goal reached (" + mins + " min). Next goal starts tomorrow", items: items };
  }
  function evChecks() {
    var today = todayKey(), items = [], missing = [], all = labs();
    HP.TESTS.forEach(function (t) {
      var due = HP.dueDate(t, all);
      if (due) {
        var n = dayDiff(today, due);
        if (n <= 60) items.push({ t: t.name, s: n < 0 ? "Was due " + fd(due) + " (" + inWords(n) + ")" : "Due " + fd(due) + " (" + inWords(n) + ")", n: n, tone: n < 0 ? "bad" : n <= 14 ? "warn" : "" });
      } else if (t.every && !recsFor(t.id).length) missing.push(t.short);
    });
    items.sort(function (a, b) { return a.n - b.n; });
    if (missing.length) items.push({ t: "Not recorded yet", s: missing.slice(0, 8).join(", ") + (missing.length > 8 ? " and " + (missing.length - 8) + " more" : "") + ". Add results to start tracking when they are next due." });
    extra("health").forEach(function (e) { items.push(e); });
    var first = items.filter(function (x) { return x.n != null; })[0];
    var nxt = first ? first.t + ": " + first.s.charAt(0).toLowerCase() + first.s.slice(1) : all.length ? "No check-ups due in the next 60 days" : "No test results recorded yet";
    return { id: "checks", title: "Health Check-ups", icon: SVG.chart, go: "health", cta: "Open Health tests", next: nxt, items: items };
  }

  var openEv = {};
  function evCard(e) {
    var h = '<details class="ev" data-ev="' + e.id + '"' + (openEv[e.id] ? " open" : "") + "><summary><span class=\"ev-ic\">" + e.icon + '</span><span class="ev-main"><b>' + esc(e.title) + '</b><span class="ev-next">' + esc(e.next) + "</span></span>" + SVG.chev + '</summary><div class="ev-body">';
    if (!e.items.length) h += '<div class="empty"><b>Nothing coming up</b><span>' + esc(e.next) + "</span></div>";
    else h += '<ul class="ev-list">' + e.items.map(function (i) {
      return '<li class="' + (i.tone || "") + '"><div><b>' + esc(i.t) + "</b>" + (i.s ? "<span>" + esc(i.s) + "</span>" : "") + "</div>" + (i.tag ? '<em class="tag ' + (i.tone || "") + '">' + esc(i.tag) + "</em>" : "") + "</li>";
    }).join("") + "</ul>";
    return h + '<button class="btn-ghost" data-go="' + e.go + '">' + esc(e.cta) + "</button></div></details>";
  }

  /* ------------------------------------------------------------------ Dashboard: statistics cards */
  function calorieCard() {
    var dk = todayKey(), w = new Date().getDay(), p = profile(), target = +p.kcal || 1600, weight = currentWeight();
    var L = store.get("log-" + dk), mk = store.get("mealkcal");
    var inn = C.intake(store.get("done")[dk], mk, dk, SLOTS);
    var s = C.calorieSummary({ exercise: L.ex || [], weight: weight, intake: inn, target: target });
    var rec = C.recommend(s);
    function stat(label, val, sub, cls) { return '<div class="stat ' + (cls || "") + '"><div class="stat-l">' + label + '</div><div class="stat-v">' + val + '</div><div class="stat-s">' + (sub || "") + "</div></div>"; }
    var h = '<div class="card dash-card"><div class="card-hd"><h3>' + SVG.fruit + ' Calorie Statistics</h3><span class="meta">Today</span></div><div class="stats">';
    h += stat("Calories burned", s.burned ? s.burned + " kcal" : (s.burnedUnknown ? "–" : "0 kcal"), s.burnedUnknown ? "Add your weight to estimate" : s.burnedEst ? "Estimated from activity" : "From your entries");
    h += stat("Calories intake", s.intake == null ? "–" : s.intake + " kcal", s.intake == null ? "No prepared meals with calories" : plural(inn.counted, "meal") + " prepared" + (inn.extra ? " + extra" : "") + (s.mealsMissing ? ", " + s.mealsMissing + " without calories" : ""));
    h += stat("Net calories", s.net == null ? "–" : s.net + " kcal", "Intake − burned");
    h += stat("Daily target", target + " kcal", s.remaining == null ? "Remaining: –" : s.remaining >= 0 ? "Remaining: " + s.remaining + " kcal" : "Over by " + Math.abs(s.remaining) + " kcal", s.remaining != null && s.remaining < 0 ? "bad" : "");
    h += '</div><div class="banner ' + (rec.tone === "warn" ? "amber" : "") + '" id="calrec" role="status">' + SVG.info + "<div>" + esc(rec.text) + "</div></div>";
    h += '<button class="btn-ghost" id="mealk" style="width:100%">Set meal calories</button></div>';
    return h;
  }

  var physRange = "all", physMetric = "w";
  function physCard() {
    var p = profile(), hgt = +p.height || 0, list = bodyList(), cur = currentWeight(), tw = targetWeight(), tb = targetBmi();
    var curB = cur && hgt ? C.bmi(cur, hgt) : null;
    var start = list.length ? list[0].w : cur, pr = C.progress(start, cur, tw);
    function stat(label, val, sub) { return '<div class="stat"><div class="stat-l">' + label + '</div><div class="stat-v">' + val + '</div><div class="stat-s">' + (sub || "") + "</div></div>"; }
    var h = '<div class="card dash-card phys"><div class="card-hd"><h3>' + SVG.chart + ' Physical Statistics</h3><span class="meta">' + plural(list.length, "weight record") + "</span></div><div class=\"stats\">";
    h += stat("Current weight", cur ? num(cur, 1) + " kg" : "–", list.length ? "As of " + fd(list[list.length - 1].date) : cur ? "From your profile" : "Log your weight below");
    h += stat("Current BMI", curB ? num(curB, 1) : "–", curB ? "" : hgt ? "Needs a weight" : "Add height in profile");
    h += stat("Target weight", tw ? num(tw, 1) + " kg" : "–", tw ? "" : "Set in your profile");
    h += stat("Target BMI", tb ? num(tb, 1) : "–", tb ? "" : "Set in your profile");
    h += "</div>";
    if (pr) {
      var txt = pr.reached ? "Target reached" : pr.direction === "lose" ? num(Math.abs(pr.change), 1) + " kg " + (pr.change <= 0 ? "lost" : "gained") + " so far, " + num(pr.toGo, 1) + " kg to go" : num(Math.abs(pr.change), 1) + " kg " + (pr.change >= 0 ? "gained" : "lost") + " so far, " + num(pr.toGo, 1) + " kg to go";
      h += '<div class="prog"><div class="prog-hd"><b>Weight progress</b><span>' + pr.pct + '%</span></div><div class="prog-track"><div class="prog-fill" style="width:' + pr.pct + '%"></div></div><div class="stat-s">' + esc(txt) + " (started at " + num(pr.start, 1) + " kg)</div></div>";
    } else {
      h += '<div class="stat-s" style="margin:6px 0 10px">Weight progress appears once you have a weight record and a target.</div>';
    }
    h += '<div class="form-row phys-add"><input class="ctrl" id="pw-d" type="date" value="' + todayKey() + '" max="' + todayKey() + '" aria-label="Date"><input class="ctrl" id="pw-w" type="number" inputmode="decimal" step="0.1" min="10" max="400" placeholder="Weight (kg)" aria-label="Weight in kg" style="max-width:130px"><button class="btn-primary" id="pw-a">Log weight</button></div>';
    if (!list.length) {
      h += '<div class="empty"><b>No weight history yet</b><span>Log your weight to start the graph. Nothing is estimated or filled in for you.</span></div>';
    } else {
      h += '<div class="seg-row"><div class="pchips" role="group" aria-label="Metric"><button class="chip-b' + (physMetric === "w" ? " on" : "") + '" data-pm="w">Weight (kg)</button><button class="chip-b' + (physMetric === "b" ? " on" : "") + '" data-pm="b"' + (hgt ? "" : " disabled title=\"Add your height in the profile\"") + ">BMI</button></div>" +
        '<div class="pchips" role="group" aria-label="Range">' + [["1m", "1M"], ["3m", "3M"], ["6m", "6M"], ["1y", "1Y"], ["all", "All"]].map(function (r) { return '<button class="chip-b' + (physRange === r[0] ? " on" : "") + '" data-pr="' + r[0] + '">' + r[1] + "</button>"; }).join("") + "</div></div>";
      h += '<div id="physchart"></div><div class="hc-ref" id="physnote"></div>';
      h += '<details class="addmed"><summary>Weight history (' + list.length + ")</summary>" + list.slice().reverse().map(function (r) {
        return '<div class="row-item"><div class="row-info"><div class="row-title">' + esc(fd(r.date)) + " · " + num(r.w, 1) + " kg</div>" + (hgt ? '<div class="row-sub">BMI ' + num(C.bmi(r.w, hgt), 1) + "</div>" : "") + '</div><button class="btn-del" data-wdel="' + r.id + '" aria-label="Delete record">×</button></div>';
      }).join("") + "</details>";
    }
    return h + "</div>";
  }
  function physDraw() {
    var host = document.getElementById("physchart"); if (!host) return;
    var p = profile(), hgt = +p.height || 0, list = bodyList(), cut = null;
    if (physRange !== "all") { var d = new Date(); d.setDate(d.getDate() - ({ "1m": 31, "3m": 92, "6m": 183, "1y": 366 }[physRange])); cut = d.toLocaleDateString("en-CA"); }
    var shown = list.filter(function (r) { return !cut || r.date >= cut; });
    var note = document.getElementById("physnote");
    if (!shown.length) { host.innerHTML = '<div class="empty"><span>No records in this period. Choose a longer range.</span></div>'; if (note) note.textContent = ""; return; }
    var isB = physMetric === "b" && hgt, unit = isB ? "BMI" : "kg";
    var pts = shown.map(function (r) { var y = isB ? C.bmi(r.w, hgt) : r.w; return { d: r.date, y: y, tip: fd(r.date) + ": " + num(y, 1) + " " + unit }; });
    var tgt = isB ? targetBmi() : targetWeight();
    drawChart(host, { series: [{ pts: pts }], target: tgt ? { y: tgt, label: "Target " + num(tgt, 1) + " " + unit } : null, lo: isB ? 18.5 : null, hi: isB ? 24.9 : null, refLabel: isB ? "Standard adult BMI 18.5 to 24.9" : "", unit: unit, label: (isB ? "BMI" : "Weight") + " over time" });
    if (note) note.textContent = tgt ? "The dashed line is your target." : "Set a target weight or BMI in your profile to see it on the graph.";
  }

  function healthCard() {
    var recorded = 0, attn = 0, over = 0;
    HP.TESTS.forEach(function (t) { var st = testState(t); if (st.rec) recorded++; if (st.k === "attn") attn++; if (st.k === "over") over++; });
    var h = '<div class="card dash-card hcard" id="hcard" role="button" tabindex="0" aria-label="Open Health Check Statistics"><div class="card-hd"><h3>' + SVG.chart + ' Health Check Statistics</h3><span class="meta">Open</span></div>';
    if (!recorded) return h + '<div class="empty"><b>No test results yet</b><span>Record results in the Health tab, then explore them here.</span></div><span class="hc-open">View statistics ›</span></div>';
    h += '<div class="stats">' +
      '<div class="stat"><div class="stat-l">Tests recorded</div><div class="stat-v">' + recorded + "/" + HP.TESTS.length + "</div></div>" +
      '<div class="stat ' + (attn ? "bad" : "") + '"><div class="stat-l">Need attention</div><div class="stat-v">' + attn + "</div></div>" +
      '<div class="stat ' + (over ? "warn" : "") + '"><div class="stat-l">Overdue</div><div class="stat-v">' + over + "</div></div></div>";
    return h + '<span class="hc-open">View graphs and history ›</span></div>';
  }

  /* ------------------------------------------------------------------ Dashboard */
  function renderDash() {
    migrateLegacy();
    var p = profile(), nm = (p.name || (SYNC.user && SYNC.user.name) || "").split(" ")[0];
    var hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    var h = '<div class="dash"><div class="dash-hi"><div><h2>' + greet + (nm ? ", " + esc(nm) : "") + '</h2><p>' + esc(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })) + "</p></div>" +
      '<span class="syncpill" id="dsync">' + (SYNC.token ? (SYNC.st === "saving" ? "Syncing…" : SYNC.st === "error" ? "Offline: showing saved data" : "") : "") + "</span></div>";
    h += '<section aria-labelledby="h-ev"><h3 class="sec" id="h-ev">Upcoming events</h3><div class="evs">' + [evGrocery(), evMeds(), evMeals(), evEx(), evChecks()].map(evCard).join("") + "</div></section>";
    h += '<section aria-labelledby="h-st"><h3 class="sec" id="h-st">Statistics</h3><div class="stat-grid">' + calorieCard() + physCard() + healthCard() + medStatsCard() + "</div></section></div>";
    $("#view").innerHTML = h;

    var v = $("#view");
    v.querySelectorAll("details.ev").forEach(function (d) { d.addEventListener("toggle", function () { openEv[d.dataset.ev] = d.open; }); });
    v.querySelectorAll("[data-go]").forEach(function (b) { b.onclick = function () { setTab(b.dataset.go); }; });
    var mk = document.getElementById("mealk"); if (mk) mk.onclick = openMealKcal;
    var hc = document.getElementById("hcard");
    if (hc) { hc.onclick = openHealthModal; hc.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openHealthModal(); } }; }
    var ma = document.getElementById("medall"); if (ma) ma.onclick = openMedList;
    var pa = document.getElementById("pw-a");
    if (pa) pa.onclick = function () {
      var w = parseFloat(document.getElementById("pw-w").value), d = document.getElementById("pw-d").value;
      if (!(w >= 10 && w <= 400)) { toast("Enter a weight between 10 and 400 kg"); return; }
      if (!HP.isDate(d) || d > todayKey()) { toast("Choose a valid date, not in the future"); return; }
      setWeight(d, w); renderDash(); toast("Saved");
    };
    v.querySelectorAll("[data-pm]").forEach(function (b) { b.onclick = function () { physMetric = b.dataset.pm; renderDash(); }; });
    v.querySelectorAll("[data-pr]").forEach(function (b) { b.onclick = function () { physRange = b.dataset.pr; renderDash(); }; });
    v.querySelectorAll("[data-wdel]").forEach(function (b) { b.onclick = function () { if (confirm("Delete this weight record?")) { deleteWeight(b.dataset.wdel); renderDash(); } }; });
    physDraw();
    trDom();
  }

  window.HPD = {
    renderDash: renderDash, testsCard: testsCard, wireTests: wireTests, openLabForm: openLabForm, openHealthModal: openHealthModal,
    medCard: medCard, wireMeds: wireMeds, setWeight: setWeight, currentWeight: currentWeight, migrateLegacy: migrateLegacy, setTab: setTab,
    bodyList: bodyList, targetWeight: targetWeight, targetBmi: targetBmi
  };
})();
