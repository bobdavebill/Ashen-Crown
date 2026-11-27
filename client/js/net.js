/* Networking: WebSocket client to the authoritative server (auto-reconnect), plus an in-browser LocalMatch for fully offline play. */
(function () {
  const H = {}; let ws = null, retry = 0, wantOpen = true, rtt = 0, pingT = null;
  const Net = {
    connected: false, rtt: 0, online: 0, offlineMode: false,
    on(t, fn) { (H[t] = H[t] || []).push(fn); return fn; },
    off(t, fn) { if (H[t]) H[t] = H[t].filter(f => f !== fn); },
    emit(t, msg) { const a = H[t]; if (a) for (const f of a.slice()) { try { f(msg); } catch (e) { console.error('[net handler]', t, e); } } },
    send(o) {
      if (Local.active && (o.t === 'in' || o.t === 'act' || o.t === 'quit')) return Local.handle(o);
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    },
    connect() {
      if (location.protocol === 'file:') { Net.emit('closed', {}); return; }
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      try { ws = new WebSocket(url); } catch (e) { return scheduleRetry(); }
      ws.onopen = () => { Net.connected = true; retry = 0; Net.emit('open', {}); clearInterval(pingT); pingT = setInterval(() => Net.send({ t: 'ping', c: Date.now() }), 2500); };
      ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.t === 'pong') { Net.rtt = Date.now() - m.c; } Net.emit(m.t, m); };
      ws.onclose = () => { const was = Net.connected; Net.connected = false; clearInterval(pingT); if (was) Net.emit('closed', {}); scheduleRetry(); };
      ws.onerror = () => {};
    },
    close() { wantOpen = false; if (ws) ws.close(); },
  };
  function scheduleRetry() { if (!wantOpen) return; retry++; setTimeout(() => { if (!Net.connected) Net.connect(); }, Math.min(8000, 700 * retry)); if (retry === 2) Net.emit('unreachable', {}); }

  /* ------------------------------------------------------------ offline match (same Sim code the server runs) */
  const Local = {
    active: false, m: null, pid: 0, timer: null,
    start(o) {
      const C = HG.C, E = HG.E;
      Local.stop();
      const m = new HG.Sim.Match({ seed: (Math.random() * 2e9) | 0, mode: 'practice', tier: 'free', difficulty: o.difficulty || 'normal',
        send: (pid, ev, d) => { if (pid === Local.pid) Net.emit(ev, { t: ev, d }); },
        hooks: { onTeamOut: (mm, team) => { const p = mm.players.get(Local.pid); if (p && p.team === team) Local.result(p); }, onEnd: mm => { const p = mm.players.get(Local.pid); if (p) Local.result(p); } } });
      const hero = m.addPlayer({ name: o.name || 'You', appearance: E.cleanAppearance(o.appearance), level: 1 });
      const pers = Object.keys(C.PERSONALITIES).sort(() => Math.random() - 0.5), names = C.BOT_NAMES.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < (o.bots || 7); i++) {
        const ap = {}; for (const s of E.SLOTS) { const pool = E.COSMETICS.filter(x => x.slot === s && ['common', 'uncommon', 'rare'].includes(x.rarity) && !['ach', 'camp', 'event'].includes(x.unlock.t)); ap[s] = pool.length ? pool[(Math.random() * pool.length) | 0].id : E.DEFAULT_APPEARANCE[s]; }
        m.addPlayer({ isBot: true, name: names[i % names.length], appearance: ap, personality: pers[i % pers.length], difficulty: o.difficulty || 'normal', level: 1 + ((Math.random() * 20) | 0) });
      }
      Local.m = m; Local.pid = hero.id; Local.active = true; m.start();
      let last = performance.now(), acc = 0;
      Local.timer = setInterval(() => { const t = performance.now(); acc += t - last; last = t; let n = 0; while (acc >= 1000 / C.TICK && n < 4) { acc -= 1000 / C.TICK; n++; m.tickOnce(); } if (acc > 250) acc = 0; }, 8);
      Net.emit('welcome', { t: 'welcome', w: m.welcome(hero.id), entry: { stake: 0, perks: 0 }, perks: { adv: [], dis: [] }, local: true });
    },
    handle(o) {
      const m = Local.m; if (!m) return;
      if (o.t === 'in') m.input(Local.pid, { s: o.s | 0, mx: +o.mx || 0, mz: +o.mz || 0, y: +o.y || 0, p: +o.p || 0, f: o.f | 0 });
      else if (o.t === 'act') { const d = o.d || {}; m.action(Local.pid, String(o.a), { i: d.i | 0, n: d.n | 0, a: d.a | 0, b: d.b | 0, id: d.id, to: d.to | 0, k: d.k, e: d.e }); }
      else if (o.t === 'quit') { m.leave(Local.pid, false); Local.stop(); Net.emit('left', { t: 'left', local: true }); }
    },
    result(p) {
      if (p.reported) return; p.reported = true; const m = Local.m;
      setTimeout(() => Net.emit('result', { t: 'result', local: true, kills: p.stats.kills, survive: Math.round(p.alive ? m.t : p.diedAt), matchEnded: m.phase === 'ended',
        r: { placement: p.placement || 1, total: m.order.length, stake: 0, refund: 0, earned: { total: 0 }, xp: 0, net: 0, notes: ['Offline match — no credits or XP are awarded. Sign in and play online to earn rewards.'], challenges: [], achievements: [] } }), 300);
    },
    stop() { clearInterval(Local.timer); Local.timer = null; Local.active = false; Local.m = null; },
  };
  HG.Net = Net; HG.Local = Local;
})();
