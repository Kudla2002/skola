/* Škola · push notifikace na termíny (prostředník zfp-push na Cloudflare, stejný jako u Pipeline – worker/push.js).
   Plán se počítá tady v zařízení z dat appky a pro toto zařízení se i zašifruje (pushcrypto.js, RFC 8291):
   prostředník vidí jen časy odeslání, ne názvy předmětů ani termínů.
   Přihlášení Googlem je potřeba jen jednou při zapnutí; další nahrávání plánu se prokazuje tajemstvím
   vlastního odběru (auth klíč PushSubscription), takže to funguje i po vypršení přihlášení. */
(function () {
  'use strict';
  var PUSH_URL = 'https://zfp-push.kudlicka-vojtech2002.workers.dev';
  var APP = 'skola', HORIZON = 44 * 864e5, MAX = 290;
  var DEF = { d7: true, d3: true, d1: '18:00', morn: '07:30', hBefore: 2, week: '19:00', lesson: 0 };
  var KIND = { odevzdani: 'Odevzdání', test: 'Test', kvis: 'KvIS', registrace: 'Registrace', zkouska: 'Zkouška', termin: 'Termín', obhajoba: 'Obhajoba', konzultace: 'Konzultace' };
  var BIG = { zkouska: 1, test: 1, obhajoba: 1, kvis: 1 };   // týden předem jen u věcí, na které se učí
  var DAYS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

  function lg(k, d) { try { var v = localStorage.getItem('skola.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function ls(k, v) { try { if (v == null) localStorage.removeItem('skola.' + k); else localStorage.setItem('skola.' + k, JSON.stringify(v)); } catch (e) {} }
  function cfg() { var c = lg('push.cfg', {}); var o = {}; for (var k in DEF) o[k] = c[k] === undefined ? DEF[k] : c[k]; return o; }
  function A() { return window.SkolaAuth || {}; }
  function toast(t, a, f) { if (A().toast) A().toast(t, a, f); }

  var can = function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; };
  var ios = function () { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); };
  var standalone = function () { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; };
  function ua() { var u = navigator.userAgent; return (/iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'zařízení'); }

  function lib() {
    return window.PushCrypto ? Promise.resolve() : new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'pushcrypto.js?v=1'; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function api(path, body, tok) {
    var h = { 'Content-Type': 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok;
    return fetch(PUSH_URL + path, { method: 'POST', headers: h, body: JSON.stringify(body || {}), cache: 'no-store' }).then(function (r) {
      if (!r.ok) { var e = new Error('push ' + r.status); e.code = r.status; throw e; } return r.json();
    });
  }
  function getSub() {
    if (!can()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration().then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }).catch(function () { return null; });
  }
  /* přihlašovací údaje zařízení: id od prostředníka + klíče z živého odběru (endpoint musí sedět, jinak je potřeba znovu zapnout) */
  function dev() {
    var d = lg('push.dev', null); if (!d) return Promise.resolve(null);
    return getSub().then(function (s) {
      if (!s || s.endpoint !== d.ep || Notification.permission !== 'granted') return null;
      var k = s.toJSON().keys; return { id: d.id, k: k.auth, keys: { p256dh: k.p256dh, auth: k.auth } };
    });
  }

  /* ---------- plán notifikací ---------- */
  function at(day, hm) { var p = String(hm).split(':'); var d = new Date(day + 'T00:00:00'); d.setHours(+p[0], +p[1] || 0, 0, 0); return d.getTime(); }
  function addDays(day, n) { var d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtD(day) { var d = new Date(day + 'T12:00:00'); return DAYS[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function n(k, a, b, c) { return k + ' ' + (k === 1 ? a : k >= 2 && k <= 4 ? b : c); }

  function items() {
    var D = window.DATA; if (!D || !D.courses) return [];
    var done = lg('done', {}), out = [];
    D.courses.forEach(function (c) {
      (c.deadlines || []).forEach(function (x, i) {
        out.push({ key: c.id + '#' + (x.id || i), c: c, kind: x.k || 'termin', d: x.d, tm: x.tm, t: x.t, done: !!done[c.id + '#' + (x.id || i)] });
      });
      (c.plan || []).forEach(function (x, i) { if (x.k === 'seminar' || x.k === 'block') out.push({ key: c.id + '~' + i, c: c, kind: 'vyuka', d: x.d, tm: x.tm, t: x.t }); });
    });
    return out.filter(function (x) { return x.d && /^\d{4}-\d{2}-\d{2}$/.test(x.d); });
  }
  function plan(now) {
    var C = cfg(), out = [], lim = now + HORIZON, all = items();
    function add(t, pl) { if (t > now + 30000 && t < lim) out.push({ at: t, pl: pl }); }
    all.forEach(function (x) {
      if (x.kind === 'vyuka' || x.done) return;
      var due = new Date(x.d + 'T' + (x.tm || '23:59') + ':00').getTime(); if (due < now) return;
      var tm = x.tm && x.tm !== '23:59' ? x.tm : null;   // 23:59 = „do konce dne“, ne konkrétní čas
      var who = (x.c.short || x.c.code || '') + ' · ' + (KIND[x.kind] || 'Termín'), when = fmtD(x.d) + (tm ? ' v ' + tm : ' do 23:59');
      var base = { u: './#deadlines', tag: 'dl-' + hash(x.key) };
      if (C.d7 && BIG[x.kind]) add(at(addDays(x.d, -7), C.d1 || '18:00'), { t: 'Za týden: ' + x.t, b: who + ' · ' + when + ' – je čas začít se učit', u: base.u, tag: base.tag });
      if (C.d3) add(at(addDays(x.d, -3), C.d1 || '18:00'), { t: 'Za 3 dny: ' + x.t, b: who + ' · ' + when, u: base.u, tag: base.tag });
      if (C.d1) add(at(addDays(x.d, -1), C.d1), { t: 'Zítra: ' + x.t, b: who + ' · ' + when, u: base.u, tag: base.tag });
      var mAt = C.morn && (!tm || tm >= '11:00') ? at(x.d, C.morn) : 0;
      if (mAt) add(mAt, { t: (tm ? 'Dnes v ' + tm + ': ' : 'Dnes do půlnoci: ') + x.t, b: who, u: base.u, tag: base.tag });
      /* pár hodin předem – jen když to nespadne skoro na ranní připomínku */
      if (+C.hBefore && x.tm && !(mAt && due - C.hBefore * 3600e3 - mAt < 90 * 60000)) add(due - C.hBefore * 3600e3, { t: 'Za ' + (C.hBefore === 1 ? 'hodinu' : C.hBefore + ' h') + ': ' + x.t, b: who + ' · ' + x.tm, u: base.u, tag: base.tag });
    });
    /* neděle večer: přehled termínů na příští týden (jen když nějaké jsou) */
    if (C.week) {
      for (var i = 0; i < 45; i++) {
        var day = ymd(new Date(now + i * 864e5)); if (new Date(day + 'T12:00:00').getDay() !== 0) continue;
        var from = addDays(day, 1), to = addDays(day, 7);
        var wk = all.filter(function (x) { return x.kind !== 'vyuka' && !x.done && x.d >= from && x.d <= to; }).sort(function (a, b) { return (a.d + (a.tm || '')).localeCompare(b.d + (b.tm || '')); });
        if (!wk.length) continue;
        add(at(day, C.week), { t: 'Příští týden ' + n(wk.length, 'termín', 'termíny', 'termínů'), b: wk.slice(0, 3).map(function (x) { return DAYS[new Date(x.d + 'T12:00:00').getDay()] + ' ' + (x.c.short || '') + ': ' + x.t; }).join(' · ') + (wk.length > 3 ? ' …' : ''), u: './#week', tag: 'week-' + day });
      }
    }
    /* volitelně: seminář / blok výuky X min předem */
    if (+C.lesson) all.forEach(function (x) {
      if (x.kind !== 'vyuka' || !x.tm) return;
      add(new Date(x.d + 'T' + x.tm + ':00').getTime() - C.lesson * 60000, { t: 'Za ' + C.lesson + ' min: ' + (x.c.short || x.c.name), b: x.t + ' · ' + x.tm, u: './#week', tag: 'les-' + hash(x.key) });
    });
    return out.sort(function (a, b) { return a.at - b.at; }).slice(0, MAX);
  }

  /* ---------- nahrání plánu (jen když se změnil, jinak nejvýš 1× za 12 h kvůli posunu horizontu) ---------- */
  var busy = null, again = false;
  function sync(force) {
    if (busy) { again = true; return busy; }
    busy = dev().then(function (d) {
      if (!d || !navigator.onLine) return null;
      var now = Date.now(), P = plan(now), sig = hash(JSON.stringify([d.id, P])), last = lg('push.sync', {});
      if (!force && last.sig === sig && now - (last.at || 0) < 12 * 3600e3) return null;
      return lib().then(function () {
        return Promise.all(P.map(function (p) { return PushCrypto.encrypt(d.keys, p.pl).then(function (b) { return { at: p.at, body: PushCrypto.b64u(b), tag: p.pl.tag }; }); }));
      }).then(function (its) { return api('/dev/plan', { id: d.id, k: d.k, items: its }); })
        .then(function (r) { ls('push.sync', { sig: sig, at: now, n: r.n }); return r; })
        .catch(function (e) {
          if (e && e.code === 401) { ls('push.dev', null); paint(); toast('Notifikace je potřeba znovu zapnout.', 'Zapnout', openCfg); }
          return null;
        });
    }).then(function (r) { busy = null; if (again) { again = false; sync(); } return r; }, function () { busy = null; });
    return busy;
  }

  /* ---------- zapnutí / vypnutí ---------- */
  function enable() {
    if (!can()) { toast(ios() && !standalone() ? 'Na iPhonu: Safari → Sdílet → Přidat na plochu, otevři Školu z ikony a zapni to tam.' : 'Tento prohlížeč push notifikace neumí.'); return Promise.resolve(); }
    var tok = A().token && A().token();
    if (!tok) {
      /* bez platného přihlášení: přihlásit a po návratu dokončit jedním klepnutím (iOS chce povolení z klepnutí) */
      ls('push.want', 1); toast('Pro zapnutí se jednou přihlas Googlem…'); setTimeout(function () { A().login && A().login(); }, 700); return Promise.resolve();
    }
    ls('push.want', null);
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Notifikace nejsou povolené – povol je pro Školu v nastavení telefonu.'); return; }
      return lib().then(function () { return fetch(PUSH_URL + '/vapid', { cache: 'no-store' }).then(function (r) { return r.json(); }); })
        .then(function (v) {
          return navigator.serviceWorker.ready.then(function (reg) {
            return reg.pushManager.getSubscription().then(function (s) {
              var k = s && s.options && s.options.applicationServerKey;
              if (s && k && PushCrypto.b64u(new Uint8Array(k)) !== v.pub) return s.unsubscribe().then(function () { return null; });
              return s;
            }).then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: PushCrypto.unb64u(v.pub) }); });
          });
        })
        .then(function (s) { return api('/dev/subscribe', { app: APP, sub: s.toJSON(), ua: ua() }, tok).then(function (r) { ls('push.dev', { id: r.id, ep: s.endpoint }); }); })
        .then(function () { ls('push.sync', null); return sync(true); })
        .then(function (r) { toast('Notifikace zapnuté' + (r ? ' · naplánováno ' + n(r.n, 'upozornění', 'upozornění', 'upozornění') : '')); });
    }).catch(function (e) {
      /* „Load failed“ / „Failed to fetch“ = spojení s prostředníkem se nepovedlo (offline, nebo prostředník ještě nezná web Školy) */
      var net = e && e.name === 'TypeError' && !e.code;
      toast(net ? 'Nepodařilo se spojit s prostředníkem notifikací – zkus to za chvíli znovu.' : 'Zapnutí se nepovedlo (' + ((e && (e.code || e.message)) || 'chyba') + ')');
    }).then(paint);
  }
  function disable() {
    return dev().then(function (d) {
      var p = d ? api('/dev/unsubscribe', { id: d.id, k: d.k }).catch(function () {}) : Promise.resolve();
      return p.then(getSub).then(function (s) { return s && s.unsubscribe(); });
    }).catch(function () {}).then(function () { ls('push.dev', null); ls('push.sync', null); paint(); });
  }
  function test() {
    return dev().then(function (d) {
      if (!d) return;
      var P = plan(Date.now()).filter(function (p) { return /^dl-/.test(p.pl.tag); }).slice(0, 1).map(function (p) { return p.pl; });
      var msgs = [{ t: 'Škola', b: 'Zkušební notifikace – funguje to.', u: './', tag: 'test' }].concat(P.map(function (p) { return Object.assign({}, p, { tag: 't-' + p.tag }); }));
      return lib().then(function () { return Promise.all(msgs.map(function (m) { return PushCrypto.encrypt(d.keys, m).then(function (b) { return { body: PushCrypto.b64u(b) }; }); })); })
        .then(function (its) { return api('/dev/send', { id: d.id, k: d.k, items: its }); })
        .then(function (r) { toast(r.sent ? 'Odesláno – přijde do pár vteřin' : 'Nepodařilo se doručit'); });
    }).catch(function (e) { toast('Nepovedlo se (' + ((e && (e.code || e.message)) || 'chyba') + ')'); });
  }

  /* ---------- nastavení (spodní panel) ---------- */
  (function css() {
    var s = document.createElement('style');
    s.textContent = '.pcfg{display:grid;gap:0;margin:0 0 14px;border-radius:12px;background:var(--fill2);overflow:hidden}' +
      '.pcfg label{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;font-size:15px;border-bottom:1px solid var(--sep)}.pcfg label:last-child{border-bottom:0}' +
      '.pcfg select{font:inherit;font-size:15px;color:var(--tint);background:none;border:0;text-align:right;max-width:52%}' +
      '.pcfg input[type=checkbox]{width:20px;height:20px;accent-color:var(--tint)}' +
      '.pnext{margin:0 0 14px;font-size:13px;color:var(--label2)}.pnext b{color:var(--label)}' +
      '#ntf{position:relative;margin-left:8px!important}#ntf.on::after{content:"";position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:var(--ok)}';
    document.head.appendChild(s);
  })();
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function openCfg() {
    if (document.querySelector('.gsheetbg')) return;
    dev().then(function (d) {
      var on = !!d, C = cfg(), bg = el('div', 'gsheetbg'), sh = el('div', 'gsheet');
      sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', 'Notifikace');
      function close() { bg.remove(); }
      function btn(label, cls, fn) { var b = el('button', 'gbtn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); sh.appendChild(b); return b; }
      sh.appendChild(el('h2', null, 'Notifikace'));
      var stt = !can() ? (ios() && !standalone() ? 'Na iPhonu fungují jen ve Škole přidané na plochu (Safari → Sdílet → Přidat na plochu) a otevřené z ikony.' : 'Tento prohlížeč push notifikace neumí.')
        : Notification.permission === 'denied' ? 'Notifikace jsou pro Školu zakázané – povol je v nastavení telefonu.'
        : on ? 'Na tomto zařízení zapnuto (' + ua() + '). Zapni na každém zařízení zvlášť.' : 'Na tomto zařízení vypnuto.';
      sh.appendChild(el('div', 'gmeta', stt));
      var box = el('div', 'pcfg');
      function save(k, v) { var c = lg('push.cfg', {}); c[k] = v; ls('push.cfg', c); sync(true).then(function () { paintNext(); }); paintNext(); }
      function sel(label, key, opts, num) {
        var l = el('label', null, label), s = el('select'); s.setAttribute('aria-label', label);
        opts.forEach(function (o) { var op = el('option', null, o[1]); op.value = String(o[0]); if (String(o[0]) === String(C[key])) op.selected = true; s.appendChild(op); });
        s.addEventListener('change', function () { save(key, num ? +s.value : s.value); });
        l.appendChild(s); box.appendChild(l);
      }
      function chk(label, key) { var l = el('label', null, label), c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!C[key]; c.addEventListener('change', function () { save(key, c.checked); }); l.appendChild(c); box.appendChild(l); }
      function hrs(a, b, off) { var o = off ? [['', 'Vypnuto']] : []; for (var h = a; h <= b; h++) { o.push([('0' + h).slice(-2) + ':00', h + ':00']); if (h < b) o.push([('0' + h).slice(-2) + ':30', h + ':30']); } return o; }
      chk('Týden předem (zkoušky, testy, KvIS)', 'd7');
      chk('3 dny předem', 'd3');
      sel('Den předem v', 'd1', hrs(16, 22, true));
      sel('Ráno v den termínu', 'morn', hrs(6, 9, true));
      sel('Před termínem s časem', 'hBefore', [[0, 'Vypnuto'], [1, '1 h'], [2, '2 h'], [3, '3 h'], [6, '6 h']], true);
      sel('Neděle: přehled týdne', 'week', hrs(17, 21, true));
      sel('Seminář předem', 'lesson', [[0, 'Vypnuto'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 h']], true);
      sh.appendChild(box);
      var nx = el('p', 'pnext'); sh.appendChild(nx);
      function paintNext() {
        var P = plan(Date.now()), f = P[0];
        nx.textContent = '';
        if (!f) { nx.textContent = 'V příštích 6 týdnech není co připomenout.'; return; }
        nx.appendChild(document.createTextNode('Další: '));
        var b = el('b', null, new Date(f.at).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' – ' + f.pl.t);
        nx.appendChild(b); nx.appendChild(document.createTextNode(' · celkem ' + n(P.length, 'upozornění', 'upozornění', 'upozornění') + ' na 6 týdnů. Hotové termíny (odškrtnuté) se nepřipomínají.'));
      }
      paintNext();
      if (on) { btn('Poslat zkušební', 'sec', test); btn('Vypnout na tomto zařízení', 'dng', function () { close(); disable().then(function () { toast('Na tomto zařízení vypnuto'); }); }); }
      else if (can() && Notification.permission !== 'denied') btn('Zapnout na tomto zařízení', '', function () { close(); enable(); });
      sh.appendChild(el('div', 'gmeta', 'Text upozornění se šifruje přímo v tomto zařízení – prostředník vidí jen čas odeslání. Plán se obnoví při každém otevření appky a odškrtnutí termínu, dopředu je naplánovaný na 6 týdnů.'));
      btn('Zavřít', 'sec', close);
      bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
      bg.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
      bg.appendChild(sh); document.body.appendChild(bg);
    });
  }

  /* zvoneček v liště vedle účtu (zelená tečka = zapnuto) */
  function paint() {
    var b = document.getElementById('ntf');
    if (!b) {
      var anchor = document.getElementById('acc') || document.getElementById('thm'); if (!anchor) return;
      b = document.createElement('button'); b.className = 'thm'; b.id = 'ntf'; b.type = 'button';
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>';
      b.addEventListener('click', openCfg); anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }
    dev().then(function (d) { b.classList.toggle('on', !!d); b.setAttribute('aria-label', 'Notifikace: ' + (d ? 'zapnuté' : 'vypnuté')); b.title = b.getAttribute('aria-label'); });
  }

  window.SkolaPush = { sync: sync, open: openCfg, off: disable, plan: plan };
  function init() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint, { once: true }); else paint();
    if (lg('push.want', 0) && A().token && A().token()) { ls('push.want', null); toast('Přihlášeno. Dokonči zapnutí notifikací.', 'Zapnout', enable); }
    setTimeout(function () { sync(); }, 1500);
    setInterval(function () { sync(); }, 6 * 3600e3);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync(); });
    /* klepnutí na notifikaci, když je appka otevřená */
    try { navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'push-open') { var h = (new URL(e.data.u, location.href)).hash; if (h && h !== location.hash) location.hash = h; } }); } catch (e) {}
  }
  if (window.DATA) init(); else document.addEventListener('skola:boot', init, { once: true });
})();
