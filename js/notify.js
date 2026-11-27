/* Healthy Plate: notifications screen (Home Screen install, turn on/off, alert choices, history).
 *
 * Loaded by index.html after js/dash.js. It uses the app's helpers (api, store, SYNC, toast, esc, trDom,
 * tab, render) and HPD.sheet from dash.js when its functions run.
 *
 * iPhone rules this follows:
 *  - Web Push only works for an app added to the Home Screen (iOS 16.4 or later).
 *  - Permission must be asked from a tap, so "Turn on" asks first, before any network call.
 *  - Every push must show a visible notification (sw.js always does).
 */
(function () {
  "use strict";
  var UA = navigator.userAgent;
  var IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var GO = ["dash", "shop", "meals", "cook", "inv", "health"];
  var TZS = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"];

  function standalone() {
    return navigator.standalone === true || !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  }
  function canPush() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function b64ToU8(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a;
  }
  function u8ToB64(buf) {
    var a = new Uint8Array(buf), s = ""; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function label() {
    var n = /iPhone/.test(UA) ? "iPhone" : /iPad/.test(UA) ? "iPad" : /Android/.test(UA) ? "Android" : /Windows/.test(UA) ? "Windows" : /Mac/.test(UA) ? "Mac" : "Device";
    return n + (standalone() ? " app" : " browser");
  }
  function when(t) {
    return t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
  }

  /* ---------------------------------------------------------------- service worker + subscription */
  var regP = null;
  function registration() {
    if (!("serviceWorker" in navigator)) return Promise.reject(new Error("no service worker"));
    if (!regP) regP = navigator.serviceWorker.register("/sw.js").then(function () { return navigator.serviceWorker.ready; });
    return regP;
  }
  function currentSub() {
    if (!canPush()) return Promise.resolve(null);
    return registration().then(function (r) { return r.pushManager.getSubscription(); }).catch(function () { return null; });
  }
  function sameKey(sub, key) {
    try { return !sub.options || !sub.options.applicationServerKey || u8ToB64(sub.options.applicationServerKey) === key; } catch (e) { return true; }
  }

  // Register this device with the server. Never asks for permission by itself.
  function subscribe(key) {
    return registration().then(function (r) {
      return r.pushManager.getSubscription().then(function (sub) {
        if (sub && !sameKey(sub, key)) return sub.unsubscribe().then(function () { return null; });
        return sub;
      }).then(function (sub) {
        return sub || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
      });
    }).then(function (sub) {
      return api("/push", { method: "POST", body: { action: "subscribe", subscription: sub.toJSON(), ua: UA.slice(0, 160), label: label() } }).then(function () { return sub; });
    });
  }

  // On every app start: if notifications are already allowed, keep this device registered (a few times a day at most).
  function refresh() {
    if (!SYNC.token || !canPush() || Notification.permission !== "granted") return;
    var last = +(raw.get("hp_pushseen") || 0);
    if (Date.now() - last < 6 * 3600 * 1000) return;
    api("/push?what=key").then(function (k) {
      if (!k.configured) return;
      return currentSub().then(function (s) { if (s) return subscribe(k.publicKey).then(function () { raw.set("hp_pushseen", String(Date.now())); }); });
    }).catch(function () {});
  }

  /* ---------------------------------------------------------------- opening pages from a notification */
  function nav(url) {
    var u; try { u = new URL(url, location.origin); } catch (e) { return; }
    var go = u.searchParams.get("go"), open = u.searchParams.get("open");
    if (GO.indexOf(go) < 0) return;
    if (open && window.HPD && HPD.expand) HPD.expand(open);
    tab = go; render(); window.scrollTo(0, 0);
  }

  function init() {
    if (!("serviceWorker" in navigator)) return;
    registration().catch(function () {});
    navigator.serviceWorker.addEventListener("message", function (e) {
      var d = e.data || {};
      if (d.type === "hp-nav") nav(d.url);
      else if (d.type === "hp-resubscribe") { raw.del("hp_pushseen"); refresh(); }
    });
    refresh();
  }

  /* ---------------------------------------------------------------- preferences */
  function prefs() {
    var p = store.get("notifyprefs");
    return { lab: p.lab !== false, med: p.med !== false, chk: p.chk !== false, tz: p.tz || "Asia/Kolkata" };
  }

  /* ---------------------------------------------------------------- notifications screen */
  var STATUS = { sent: ["Sent", "ok"], partial: ["Sent to some devices", "ok"], failed: ["Failed", "bad"], expired: ["Device expired", "bad"], no_devices: ["No device registered", ""], missed: ["Missed", "bad"], sending: ["Sending", ""] };

  function open() {
    var sh = HPD.sheet('<div class="hm-hd"><h3>Notifications</h3><button class="btn-del" id="nt-x" aria-label="Close">×</button></div><div id="nt-body"><p class="sheet-sub">Loading…</p></div>');
    var box = sh.el.querySelector("#nt-body"), busy = false;
    sh.el.querySelector("#nt-x").onclick = sh.close;

    function msg(t, bad) { var m = box.querySelector("#nt-msg"); if (m) { m.textContent = t; m.style.color = bad ? "var(--danger)" : "var(--ink-2)"; } }

    function paint() {
      var p = prefs(), here = null, k = { configured: false }, devs = [], log = [], loadErr = "";
      Promise.all([
        api("/push?what=key").then(function (x) { k = x; }).catch(function (e) { loadErr = e.message; }),
        currentSub().then(function (s) { here = s; }),
        api("/push?what=devices").then(function (x) { devs = x.devices || []; }).catch(function () {}),
        api("/push?what=log").then(function (x) { log = x.log || []; }).catch(function () {})
      ]).then(function () {
        var perm = canPush() ? Notification.permission : "unsupported", h = "";
        var on = !!(here && perm === "granted");
        h += '<p class="sheet-sub">Alerts about your health, sent to this phone even when the app is closed.</p>';

        // ---- this phone
        h += '<div class="nt-sec"><h4>This phone</h4>';
        if (loadErr) {
          h += '<div class="banner amber">' + SVG.info + "<div>" + esc(loadErr) + "</div></div>";
        } else if (IOS && !standalone()) {
          h += '<div class="banner amber">' + SVG.info + "<div><b>Add the app to your Home Screen first.</b> iPhone only allows notifications for apps on the Home Screen (iOS 16.4 or later).<ol class=\"nt-steps\"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open <b>Healthy Plate</b> from the new icon and come back to this screen.</li></ol></div></div>";
        } else if (!canPush()) {
          h += '<div class="banner amber">' + SVG.info + "<div>This browser cannot receive push notifications. Try Safari on iPhone (after adding the app to the Home Screen), or Chrome on Android or a computer.</div></div>";
        } else if (!k.configured) {
          h += '<div class="banner amber">' + SVG.info + "<div><b>Notifications are not switched on for this server yet.</b> The app owner needs to add the notification keys in Vercel (see the setup guide).</div></div>";
        } else if (perm === "denied") {
          h += '<div class="banner amber">' + SVG.info + "<div><b>Notifications are blocked.</b> On iPhone open <b>Settings &gt; Notifications &gt; Healthy Plate</b> and turn on <b>Allow Notifications</b>. In a browser, allow notifications for this site in the site settings. Then return here.</div></div>";
        } else {
          h += '<div class="row-item"><div class="row-info"><div class="row-title">' + (on ? "On for this phone" : "Off for this phone") + '</div><div class="row-sub">' + (on ? "Registered as " + esc(label()) : "Tap the button to allow notifications.") + '</div></div><span class="chip ' + (on ? "ok" : "") + '">' + (on ? "On" : "Off") + "</span></div>";
          h += '<div class="form-row">' + (on ? '<button class="btn-primary" id="nt-test" style="flex:1">Send a test</button><button class="btn-ghost" id="nt-off" style="flex:1">Turn off here</button>' : '<button class="btn-primary" id="nt-on" style="flex:1">Turn on notifications</button>') + "</div>";
        }
        h += '<p class="sheet-sub" id="nt-msg" role="status" style="margin:8px 0 0"></p></div>';

        // ---- which alerts
        h += '<div class="nt-sec"><h4>Which alerts do you want?</h4>' +
          '<label class="chk-row"><input type="checkbox" data-pref="lab"' + (p.lab ? " checked" : "") + '><span class="chk-lbl">A new test result is outside the reference range</span></label>' +
          '<label class="chk-row"><input type="checkbox" data-pref="med"' + (p.med ? " checked" : "") + '><span class="chk-lbl">Medicine supply is running low (3 days or less)</span></label>' +
          '<label class="chk-row"><input type="checkbox" data-pref="chk"' + (p.chk ? " checked" : "") + '><span class="chk-lbl">A health check-up is overdue (at most once a week)</span></label>' +
          '<label class="fld" style="margin-top:8px"><span>Your time zone</span><select id="nt-tz">' + tzOptions(p.tz) + "</select></label>" +
          '<p class="sheet-sub" style="margin:0">Medicine and check-up alerts are checked once a day in the morning (around 9 AM India time).</p></div>';

        // ---- devices
        h += '<div class="nt-sec"><h4>Your devices (' + devs.length + ")</h4>";
        if (!devs.length) h += '<p class="sheet-sub">No device is registered yet.</p>';
        devs.forEach(function (d) {
          var me = here && here.endpoint === d.endpoint;
          h += '<div class="row-item"><div class="row-info"><div class="row-title">' + esc(d.label || "Device") + (me ? ' <span class="chip ok">This phone</span>' : "") + '</div><div class="row-sub">Added ' + esc(when(d.createdAt)) + (d.lastOk ? " · last delivered " + esc(when(d.lastOk)) : "") + (d.failCount ? " · " + d.failCount + " recent failures" : "") + "</div></div>" +
            (me ? "" : '<button class="btn-mini" data-rm="' + esc(d.id) + '">Remove</button>') + "</div>";
        });
        h += "</div>";

        // ---- history
        h += '<div class="nt-sec"><h4>Recent notifications</h4>';
        if (!log.length) h += '<p class="sheet-sub">Nothing has been sent yet.</p>';
        log.slice(0, 10).forEach(function (l) {
          var st = STATUS[l.status] || [l.status, ""];
          h += '<div class="row-item"><div class="row-info"><div class="row-title">' + esc(l.title) + '</div><div class="row-sub">' + esc(when(l.at)) + (l.body ? " · " + esc(l.body.slice(0, 90)) : "") + '</div></div><span class="chip ' + st[1] + '">' + esc(st[0]) + "</span></div>";
        });
        h += "</div>";

        h += '<p class="sheet-sub" style="margin-top:14px"><b>Please note:</b> notifications are best effort. Focus modes, Low Power Mode, a weak signal or your iPhone’s notification settings can delay or silence them. They are not alarms and are not a replacement for the Clock app or for your doctor’s advice. “Sent” means the push service accepted the message.</p>';

        box.innerHTML = h;
        wire();
        trDom();
      });
    }

    function tzOptions(cur) {
      var list = TZS.slice(), dev; try { dev = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
      if (dev && list.indexOf(dev) < 0) list.push(dev);
      if (cur && list.indexOf(cur) < 0) list.push(cur);
      return list.map(function (z) { return '<option value="' + esc(z) + '"' + (z === cur ? " selected" : "") + ">" + esc(z.replace("_", " ")) + "</option>"; }).join("");
    }

    function wire() {
      box.querySelectorAll("[data-pref]").forEach(function (c) {
        c.onchange = function () { var p = prefs(); p[c.dataset.pref] = c.checked; store.set("notifyprefs", p); toast("Saved"); };
      });
      var tz = box.querySelector("#nt-tz"); if (tz) tz.onchange = function () { var p = prefs(); p.tz = tz.value; store.set("notifyprefs", p); toast("Saved"); };
      box.querySelectorAll("[data-rm]").forEach(function (b) {
        b.onclick = function () { api("/push", { method: "POST", body: { action: "remove", id: b.dataset.rm } }).then(paint).catch(function (e) { msg(e.message, true); }); };
      });
      var on = box.querySelector("#nt-on");
      if (on) on.onclick = function () {
        if (busy) return; busy = true; on.disabled = true; msg("Waiting for your permission…");
        // Ask first, straight from the tap. iPhone ignores the request if other work happens before it.
        Notification.requestPermission().then(function (perm) {
          if (perm !== "granted") { busy = false; paint(); return; }
          msg("Registering this phone…");
          return api("/push?what=key").then(function (k) {
            if (!k.configured) throw new Error("The server has no notification keys yet.");
            return subscribe(k.publicKey);
          }).then(function () { raw.set("hp_pushseen", String(Date.now())); busy = false; toast("Notifications are on"); paint(); });
        }).catch(function (e) { busy = false; paint(); setTimeout(function () { msg("Could not turn on notifications: " + e.message, true); }, 400); });
      };
      var test = box.querySelector("#nt-test");
      if (test) test.onclick = function () {
        if (busy) return; busy = true; test.disabled = true; msg("Sending…");
        api("/push", { method: "POST", body: { action: "test" } }).then(function (r) {
          busy = false; paint();
          setTimeout(function () { msg(r.ok ? "Test sent. It should appear in a few seconds. If it does not, check Focus mode and Settings > Notifications." : "The push service did not accept the message (it may have expired). Turn notifications off and on again.", !r.ok); }, 400);
        }).catch(function (e) { busy = false; msg(e.message, true); test.disabled = false; });
      };
      var off = box.querySelector("#nt-off");
      if (off) off.onclick = function () {
        if (busy) return; busy = true; off.disabled = true;
        currentSub().then(function (s) {
          if (!s) return;
          var ep = s.endpoint;
          return s.unsubscribe().then(function () { return api("/push", { method: "POST", body: { action: "unsubscribe", endpoint: ep } }); });
        }).then(function () { busy = false; raw.del("hp_pushseen"); toast("Notifications are off for this phone"); paint(); })
          .catch(function (e) { busy = false; msg(e.message, true); off.disabled = false; });
      };
    }
    paint();
  }

  window.HPN = { init: init, open: open, nav: nav, refresh: refresh, supported: canPush, standalone: standalone };
})();
