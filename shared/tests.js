/* Healthy Plate: master list of health investigations.
 *
 * ONE source of truth. The browser loads it with <script src="shared/tests.js"> (window.HP_TESTS)
 * and the server loads it with require("../shared/tests.js"). The Health tab, the Dashboard
 * and the push-notification checks all read this same list, so they can never disagree.
 *
 * Reference ranges are general adult laboratory references, shown for orientation only.
 * Your doctor's targets for you may be different.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HP_TESTS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var GROUPS = [
    { id: "blood", name: "Routine blood and urine investigations", short: "Blood and urine" },
    { id: "heart", name: "Heart and cardiovascular monitoring", short: "Heart" },
    { id: "eye", name: "Eye monitoring", short: "Eye" },
    { id: "lung", name: "Lung monitoring", short: "Lung" }
  ];

  // every: how often it is recommended, in {d: days} or {m: months}. null = "as advised" (no automatic due date).
  // kind "num": values are numbers (line graph). kind "report": findings text + status (timeline view).
  // p: numeric parameters. t: extra text fields. ref ranges: lo / hi (inclusive), optional sex-specific F / M.
  var TESTS = [
    // ---- 4.1 Routine blood and urine investigations
    { id: "fbs", g: "blood", name: "Fasting Blood Sugar (FBS)", short: "FBS", freq: "Daily / as advised", forText: "Diabetes", every: null, kind: "num",
      p: [{ k: "v", label: "FBS", unit: "mg/dL", lo: 70, hi: 99 }] },
    { id: "ppbs", g: "blood", name: "Post-Prandial Blood Sugar (PPBS)", short: "PPBS", freq: "As advised", forText: "Diabetes", every: null, kind: "num",
      p: [{ k: "v", label: "PPBS (2 h after meal)", unit: "mg/dL", lo: 70, hi: 139, refText: "70 to 139" }] },
    { id: "hba1c", g: "blood", name: "HbA1c", short: "HbA1c", freq: "Every 3 months", forText: "Diabetes", every: { m: 3 }, kind: "num",
      p: [{ k: "v", label: "HbA1c", unit: "%", lo: 4, hi: 5.6, dp: 1, refText: "4.0 to 5.6" }] },
    { id: "lipid", g: "blood", name: "Lipid Profile", short: "Lipid", freq: "Every 6–12 months", forText: "Cholesterol, Heart", every: { m: 12 }, kind: "num",
      p: [
        { k: "tc", label: "Total cholesterol", unit: "mg/dL", hi: 199, refText: "< 200" },
        { k: "ldl", label: "LDL", unit: "mg/dL", hi: 99, refText: "< 100" },
        { k: "hdl", label: "HDL", unit: "mg/dL", lo: 40, refText: "≥ 40" },
        { k: "tg", label: "Triglycerides", unit: "mg/dL", hi: 149, refText: "< 150" }
      ] },
    { id: "tsh", g: "blood", name: "TSH", short: "TSH", freq: "Every 6–12 months if stable", forText: "Thyroid", every: { m: 12 }, kind: "num",
      p: [{ k: "v", label: "TSH", unit: "mIU/L", lo: 0.4, hi: 4, dp: 2 }] },
    { id: "creat", g: "blood", name: "Serum Creatinine", short: "Creatinine", freq: "Every 6–12 months", forText: "Kidney, Diabetes", every: { m: 12 }, kind: "num",
      p: [{ k: "v", label: "Serum creatinine", unit: "mg/dL", lo: 0.6, hi: 1.3, dp: 2, F: [0.5, 1.1], M: [0.7, 1.3] }] },
    { id: "egfr", g: "blood", name: "eGFR", short: "eGFR", freq: "Every 6–12 months (with creatinine)", forText: "Kidney, Diabetes", every: { m: 12 }, kind: "num",
      p: [{ k: "v", label: "eGFR", unit: "mL/min/1.73 m²", lo: 90, refText: "≥ 90" }] },
    { id: "uacr", g: "blood", name: "Urine Albumin-Creatinine Ratio (UACR)", short: "UACR", freq: "Annually", forText: "Kidney, Diabetes", every: { m: 12 }, kind: "num",
      p: [{ k: "v", label: "UACR", unit: "mg/g", hi: 29.9, refText: "< 30" }] },
    { id: "lft", g: "blood", name: "Liver Function Test (LFT)", short: "LFT", freq: "Annually", forText: "Liver", every: { m: 12 }, kind: "num",
      p: [
        { k: "alt", label: "ALT (SGPT)", unit: "U/L", lo: 7, hi: 56 },
        { k: "ast", label: "AST (SGOT)", unit: "U/L", lo: 10, hi: 40 },
        { k: "alp", label: "ALP", unit: "U/L", lo: 44, hi: 147 },
        { k: "bil", label: "Total bilirubin", unit: "mg/dL", lo: 0.1, hi: 1.2, dp: 1 },
        { k: "alb", label: "Albumin", unit: "g/dL", lo: 3.5, hi: 5, dp: 1 }
      ] },
    { id: "vitd", g: "blood", name: "Vitamin D (25-OH)", short: "Vitamin D", freq: "As indicated / after treatment", forText: "Vitamin D deficiency", every: null, kind: "num",
      p: [{ k: "v", label: "Vitamin D (25-OH)", unit: "ng/mL", lo: 30, hi: 100 }] },
    { id: "b12", g: "blood", name: "Vitamin B12", short: "B12", freq: "Annually or as indicated", forText: "Vitamin B12 deficiency, Metformin use", every: { m: 12 }, kind: "num",
      p: [{ k: "v", label: "Vitamin B12", unit: "pg/mL", lo: 200, hi: 900 }] },
    { id: "cbc", g: "blood", name: "Complete Blood Count (CBC)", short: "CBC", freq: "Annually", forText: "General health", every: { m: 12 }, kind: "num",
      p: [
        { k: "hb", label: "Hemoglobin", unit: "g/dL", lo: 12, hi: 17.5, dp: 1, F: [12, 15.5], M: [13.5, 17.5] },
        { k: "wbc", label: "WBC count", unit: "×10³/µL", lo: 4, hi: 11, dp: 1 },
        { k: "plt", label: "Platelet count", unit: "×10³/µL", lo: 150, hi: 450 }
      ] },
    { id: "urine", g: "blood", name: "Urine Routine Examination", short: "Urine routine", freq: "Annually / as indicated", forText: "Kidney, Urinary health", every: { m: 12 }, kind: "report", p: [] },

    // ---- 4.2 Heart and cardiovascular monitoring
    { id: "bp", g: "heart", name: "Blood Pressure", short: "Blood pressure", freq: "Weekly / at clinic visits", forText: "Heart, Hypertension", every: { d: 7 }, kind: "num",
      p: [
        { k: "sys", label: "Systolic", unit: "mmHg", lo: 90, hi: 129, refText: "90 to 129" },
        { k: "dia", label: "Diastolic", unit: "mmHg", lo: 60, hi: 79, refText: "60 to 79" },
        { k: "pulse", label: "Pulse", unit: "bpm", lo: 60, hi: 100, opt: true }
      ] },
    { id: "ecg", g: "heart", name: "Resting ECG", short: "ECG", freq: "As clinically indicated", forText: "Heart conditions", every: null, kind: "report", p: [] },
    { id: "echo", g: "heart", name: "2D Echocardiogram", short: "Echo", freq: "As clinically indicated", forText: "Heart structure and function", every: null, kind: "report",
      p: [{ k: "ef", label: "LVEF (if reported)", unit: "%", lo: 52, hi: 72, opt: true }] },
    { id: "tmt", g: "heart", name: "Treadmill Test (TMT)", short: "TMT", freq: "Only if indicated", forText: "Cardiac assessment", every: null, kind: "report", p: [] },

    // ---- 4.3 Eye monitoring
    { id: "eyeexam", g: "eye", name: "Comprehensive Eye Examination", short: "Eye exam", freq: "Annually", forText: "General eye health", every: { m: 12 }, kind: "report", p: [] },
    { id: "retina", g: "eye", name: "Diabetic Retinal Examination", short: "Retinal exam", freq: "Annually", forText: "Diabetes", every: { m: 12 }, kind: "report", p: [] },
    { id: "iop", g: "eye", name: "Intraocular Pressure (IOP)", short: "IOP", freq: "As advised", forText: "Glaucoma", every: null, kind: "num",
      p: [
        { k: "r", label: "Right eye", unit: "mmHg", lo: 10, hi: 21 },
        { k: "l", label: "Left eye", unit: "mmHg", lo: 10, hi: 21 }
      ] },
    { id: "va", g: "eye", name: "Visual Acuity Test", short: "Visual acuity", freq: "Annually", forText: "Vision", every: { m: 12 }, kind: "report", p: [],
      t: [{ k: "r", label: "Right eye (e.g. 6/6)" }, { k: "l", label: "Left eye (e.g. 6/9)" }] },

    // ---- 4.4 Lung monitoring
    { id: "spiro", g: "lung", name: "Spirometry / Pulmonary Function Test", short: "Spirometry", freq: "If indicated", forText: "Lung function, Asthma, COPD", every: null, kind: "num",
      p: [
        { k: "fev1p", label: "FEV1 (% predicted)", unit: "%", lo: 80, refText: "≥ 80" },
        { k: "ratio", label: "FEV1/FVC ratio", unit: "%", lo: 70, refText: "≥ 70" },
        { k: "fev1", label: "FEV1", unit: "L", dp: 2, opt: true },
        { k: "fvc", label: "FVC", unit: "L", dp: 2, opt: true }
      ] },
    { id: "cxr", g: "lung", name: "Chest X-ray", short: "Chest X-ray", freq: "Only if indicated", forText: "Lung conditions", every: null, kind: "report", p: [] },
    { id: "spo2", g: "lung", name: "Oxygen Saturation (SpO₂)", short: "SpO₂", freq: "When symptomatic / as advised", forText: "Respiratory health", every: null, kind: "num",
      p: [{ k: "v", label: "SpO₂", unit: "%", lo: 95, hi: 100 }] }
  ];

  var STATUS = [
    { id: "normal", label: "Normal" },
    { id: "abnormal", label: "Abnormal" },
    { id: "followup", label: "Needs follow-up" }
  ];

  var byId = {};
  TESTS.forEach(function (t) { byId[t.id] = t; });

  function get(id) { return byId[id] || null; }
  function inGroup(g) { return TESTS.filter(function (t) { return t.g === g; }); }

  // [lo, hi] for a parameter, using the sex-specific range when sex is known.
  function range(p, sex) {
    var r = sex === "Female" && p.F ? p.F : sex === "Male" && p.M ? p.M : null;
    return r ? { lo: r[0], hi: r[1] } : { lo: p.lo == null ? null : p.lo, hi: p.hi == null ? null : p.hi };
  }

  function refText(p, sex) {
    var r = range(p, sex);
    if (r.lo == null && r.hi == null) return "";
    if ((p.F || p.M) && (sex === "Female" || sex === "Male")) return r.lo + " to " + r.hi;
    if (p.refText) return p.refText;
    if (r.lo != null && r.hi != null) return r.lo + " to " + r.hi;
    if (r.lo != null) return "≥ " + r.lo;
    return "≤ " + r.hi;
  }

  // "low" | "high" | null
  function flag(p, value, sex) {
    if (typeof value !== "number" || !isFinite(value)) return null;
    var r = range(p, sex);
    if (r.lo != null && value < r.lo) return "low";
    if (r.hi != null && value > r.hi) return "high";
    return null;
  }

  // All out-of-range numbers in one record: [{label, value, unit, flag, ref}]
  function flags(rec, sex) {
    var t = get(rec.tid), out = [];
    if (!t || !rec.v) return out;
    t.p.forEach(function (p) {
      var v = rec.v[p.k], f = flag(p, v, sex);
      if (f) out.push({ k: p.k, label: p.label, value: v, unit: p.unit, flag: f, ref: refText(p, sex) });
    });
    return out;
  }

  // True when a report-type record needs attention (abnormal / follow-up) or any number is out of range.
  function needsAttention(rec, sex) {
    if (rec.status === "abnormal" || rec.status === "followup") return true;
    return flags(rec, sex).length > 0;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10), x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
  }
  function addToDate(s, every) {
    var y = +s.slice(0, 4), m = +s.slice(5, 7) - 1, d = +s.slice(8, 10);
    if (every.m) {
      var tm = m + every.m, ny = y + Math.floor(tm / 12), nm = ((tm % 12) + 12) % 12;
      var last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
      return ny + "-" + pad(nm + 1) + "-" + pad(Math.min(d, last));
    }
    var x = new Date(Date.UTC(y, m, d + (every.d || 0)));
    return x.getUTCFullYear() + "-" + pad(x.getUTCMonth() + 1) + "-" + pad(x.getUTCDate());
  }

  // Next due date for a test, from its newest record. A doctor-set "next review date" wins.
  // Returns null for "as advised" tests and for tests that have never been recorded.
  function dueDate(test, records) {
    var mine = (records || []).filter(function (r) { return r.tid === test.id && isDate(r.date); });
    if (!mine.length) return null;
    mine.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var newest = mine[0];
    if (newest.next && isDate(newest.next)) return newest.next;
    return test.every ? addToDate(newest.date, test.every) : null;
  }

  // Validation shared by browser and server. today = "YYYY-MM-DD" of the user's day.
  function validate(rec, today) {
    var t = get(rec && rec.tid);
    if (!t) return "Choose a test.";
    if (!isDate(rec.date)) return "Enter a valid date.";
    if (today && rec.date > addToDate(today, { d: 1 })) return "The date cannot be in the future.";
    if (rec.next && !isDate(rec.next)) return "Enter a valid next review date.";
    var any = false;
    for (var i = 0; i < t.p.length; i++) {
      var p = t.p[i], v = rec.v && rec.v[p.k];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "number" || !isFinite(v) || v < 0 || v > 100000) return "Enter a valid number for " + p.label + ".";
      any = true;
    }
    if (t.kind === "num") {
      if (!any) return "Enter at least one result.";
      return null;
    }
    var findings = (rec.findings || "").trim();
    var texts = t.t ? t.t.some(function (f) { return rec.t && (rec.t[f.k] || "").trim(); }) : false;
    if (!any && !findings && !rec.status && !texts) return "Enter the findings or choose a result status.";
    return null;
  }

  // Two records are duplicates when they are for the same test on the same date.
  function duplicateOf(rec, list) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.id !== rec.id && o.tid === rec.tid && o.date === rec.date) return o;
    }
    return null;
  }

  return {
    GROUPS: GROUPS, TESTS: TESTS, STATUS: STATUS, get: get, inGroup: inGroup, range: range, refText: refText,
    flag: flag, flags: flags, needsAttention: needsAttention, isDate: isDate, addToDate: addToDate,
    dueDate: dueDate, validate: validate, duplicateOf: duplicateOf
  };
});
