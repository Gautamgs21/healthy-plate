/* Healthy Plate: calculations used by the Dashboard (calories, BMI, weight progress).
 * Pure functions, no screen code, so they can be tested on their own.
 * Browser: window.HP_CALC.  Node: require("./calc.js").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HP_CALC = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var r1 = function (n) { return Math.round(n * 10) / 10; };
  var isNum = function (n) { return typeof n === "number" && isFinite(n); };

  function bmi(weightKg, heightCm) {
    if (!(weightKg > 0) || !(heightCm > 0)) return null;
    var m = heightCm / 100;
    return r1(weightKg / (m * m));
  }
  function weightForBmi(b, heightCm) {
    if (!(b > 0) || !(heightCm > 0)) return null;
    var m = heightCm / 100;
    return r1(b * m * m);
  }

  // Standard MET values (Compendium of Physical Activities). Calories = MET x weight (kg) x hours.
  // These are estimates. A calorie figure typed in by the user (for example from a watch) always wins.
  var MET = { Walking: 3.5, Yoga: 2.5, Cycling: 6, Strength: 4, Other: 4 };

  // -> { kcal, est } or null when it cannot be worked out (no calories typed and no weight known)
  function exerciseKcal(entry, weightKg) {
    if (!entry) return null;
    if (isNum(entry.kcal) && entry.kcal >= 0) return { kcal: Math.round(entry.kcal), est: false };
    if (weightKg > 0 && entry.m > 0) {
      var met = MET[entry.a] || MET.Other;
      return { kcal: Math.round(met * weightKg * entry.m / 60), est: true };
    }
    return null;
  }
  function burned(entries, weightKg) {
    var kcal = 0, unknown = 0, est = false;
    (entries || []).forEach(function (e) {
      var k = exerciseKcal(e, weightKg);
      if (k) { kcal += k.kcal; if (k.est) est = true; } else unknown++;
    });
    return { kcal: kcal, unknown: unknown, est: est };
  }

  // Calories for one meal slot: the value set for that day, else the usual value for that meal time.
  function mealKcal(mk, dateKey, i) {
    mk = mk || {};
    var d = mk.days && mk.days[dateKey];
    if (d && isNum(d[i])) return d[i];
    if (mk.slots && isNum(mk.slots[i])) return mk.slots[i];
    return null;
  }

  // done: { slotIndex: {s: 1 prepared | 0 skipped} } for the day.
  function intake(done, mk, dateKey, slots) {
    done = done || {};
    var kcal = 0, counted = 0, missing = 0, pending = 0, pendingMissing = 0;
    for (var i = 0; i < slots; i++) {
      var k = mealKcal(mk, dateKey, i), s = done[i] && done[i].s;
      if (s === 1) {
        if (k == null) missing++; else { kcal += k; counted++; }
      } else if (s !== 0) {
        if (k == null) pendingMissing++; else pending += k;
      }
    }
    var d = mk && mk.days && mk.days[dateKey];
    var extra = d && isNum(d.extra) ? d.extra : 0;
    return { kcal: kcal + extra, extra: extra, counted: counted, missing: missing, pending: pending, pendingMissing: pendingMissing };
  }

  // Everything the Calorie Statistics card shows. target: daily calorie target.
  function calorieSummary(o) {
    var b = burned(o.exercise, o.weight);
    var inn = o.intake;
    var hasIntake = inn.counted > 0 || inn.extra > 0;
    var net = hasIntake ? inn.kcal - b.kcal : null;
    return {
      burned: b.kcal, burnedUnknown: b.unknown, burnedEst: b.est,
      intake: hasIntake ? inn.kcal : null, mealsMissing: inn.missing,
      net: net, target: o.target,
      remaining: net == null ? null : o.target - net,
      pending: inn.pending, pendingMissing: inn.pendingMissing,
      weight: o.weight || null
    };
  }

  // Walking minutes needed to burn `kcal` at this weight (null if weight unknown)
  function walkMinutes(kcal, weightKg) {
    if (!(weightKg > 0) || !(kcal > 0)) return null;
    return Math.ceil(kcal / (MET.Walking * weightKg / 60));
  }

  // Dynamic advice from the real numbers. Returns { tone: "ok"|"warn"|"info", text }
  function recommend(s) {
    if (s.intake == null) {
      var t = "Mark your meals as prepared on the Meals tab and set their calories to see your calorie balance.";
      if (s.burned > 0) t = "You have burned about " + s.burned + " kcal so far. " + t;
      return { tone: "info", text: t };
    }
    var proj = s.net + s.pending;
    var over = s.net - s.target;
    var walk;
    if (over > 0) {
      walk = walkMinutes(over, s.weight);
      return {
        tone: "warn",
        text: "You are " + over + " kcal over your target of " + s.target + " kcal. Burn another " + over + " kcal" +
          (walk ? " (about " + walk + " minutes of walking)" : "") + " or reduce your calorie intake by " + over + " kcal to stay within your daily target."
      };
    }
    var left = s.target - s.net;
    if (s.pending > 0 && proj > s.target) {
      var ex = proj - s.target;
      walk = walkMinutes(ex, s.weight);
      return {
        tone: "warn",
        text: "You have " + left + " kcal left today, but your remaining planned meals add about " + s.pending + " kcal. To stay within your target, burn another " + ex + " kcal" +
          (walk ? " (about " + walk + " minutes of walking)" : "") + " or trim " + ex + " kcal from those meals."
      };
    }
    var txt = "You are within your target. You have " + left + " kcal remaining today";
    if (s.pending > 0) txt += ", and your remaining planned meals use about " + s.pending + " kcal, which still fits";
    txt += ".";
    if (s.pendingMissing > 0) txt += " Some remaining meals have no calories set, so this may change.";
    return { tone: "ok", text: txt };
  }

  // Weight progress toward a target. Works for losing or gaining.
  // -> { start, current, target, change, toGo, pct, reached } or null if it cannot be worked out
  function progress(start, current, target) {
    if (!(start > 0) || !(current > 0) || !(target > 0)) return null;
    var total = start - target, done = start - current;
    var pct = total === 0 ? (current === target ? 100 : 0) : Math.round(done / total * 100);
    var reached = total === 0 ? current === target : (total > 0 ? current <= target : current >= target);
    return {
      start: start, current: current, target: target,
      change: r1(current - start), toGo: r1(Math.abs(current - target)),
      pct: Math.max(0, Math.min(100, pct)), reached: reached,
      direction: total > 0 ? "lose" : total < 0 ? "gain" : "hold"
    };
  }

  return {
    bmi: bmi, weightForBmi: weightForBmi, MET: MET, exerciseKcal: exerciseKcal, burned: burned, mealKcal: mealKcal,
    intake: intake, calorieSummary: calorieSummary, recommend: recommend, progress: progress, walkMinutes: walkMinutes
  };
});
