/* In-match runtime: input, client-side prediction + server reconciliation, snapshot interpolation, third-person camera,
   event handling (combat/audio/FX), HUD, minimap, compass, spectating. Works against the online server and the in-browser LocalMatch. */
(function () {
  const T = THREE, C = HG.C, E = HG.E, Move = HG.Move, F = Move.F, Net = HG.Net, DT = C.DT;
  const $ = id => document.getElementById(id), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const lerpAng = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };
  const itemIcon = id => (C.ITEMS[id] && C.ITEMS[id].icon) || '?';
  const G = HG.Game = {
    active: false, R: null, settings: { sens: 1, vol: 0.8, quality: 'high' }, keys: {}, mouse: { l: false, r: false }, locked: false, invOpen: false,
    players: new Map(), loot: new Map(), inv: { s: [], arm: 0, sel: 0, cap: 12 }, yaw: 0, pitch: 0, seq: 0, pending: [], acc: 0, crouch: false,
  };
  let R = null, world = null, me = 0, snapBuf = [], lastSnap = null, ps = null, viewOff = { x: 0, y: 0, z: 0 }, hudT = 0, mapT = 0, camPos = new T.Vector3(), shake = 0, killsMe = 0, welcome = null;
  let phase = 'lobby', serverT = 0, announceT = 0, toastT = [], nearWater = 0, waterT = 0, useBar = { t: 0, max: 0, label: '' }, specId = 0, offerFrom = null, pings = [], myHp = 100, lastAlive = true, fpsAcc = 0, fpsN = 0, fps = 60, menuAng = 0, backdropWorld = null;
  const roster = new Map(), teamOf = new Map(), seenEvents = 0;

  /* ---------------------------------------------------------------- setup */
  G.init = function (renderer) {
    R = G.R = renderer; bindInput(); R.setTime(0.42, 0);
    $('p-resume').onclick = () => G.capture(); $('p-quit').onclick = () => { if (HG.UI) HG.UI.confirmLeave(); };
    $('p-sens').oninput = e => { G.settings.sens = +e.target.value; G.saveSettings(); }; $('p-vol').oninput = e => { G.settings.vol = +e.target.value; HG.Audio.setVolumes({ master: G.settings.vol }); G.saveSettings(); };
    $('inv-close').onclick = () => G.toggleInv(false);
  };
  G.loadSettings = function () { if (G.touch) { try { if (!localStorage.getItem('hg_settings')) G.settings.quality = 'low'; } catch (e) { G.settings.quality = 'low'; } } try { Object.assign(G.settings, JSON.parse(localStorage.getItem('hg_settings') || '{}')); } catch (e) { /* */ } $('p-sens').value = G.settings.sens; $('p-vol').value = G.settings.vol; HG.Audio.setVolumes({ master: G.settings.vol }); if (R) R.setQuality(G.settings.quality); };
  G.saveSettings = function () { try { localStorage.setItem('hg_settings', JSON.stringify(G.settings)); } catch (e) { /* */ } };

  /* menu backdrop: slow orbit above a procedurally generated arena */
  G.backdrop = function (on) {
    if (on) { if (!backdropWorld) { backdropWorld = HG.Terrain.createWorld(20260101); } if (R.world !== backdropWorld) { R.load(backdropWorld); R.setTime(0.7, 0); } }
  };

  G.start = function (msg) {
    G.stop(true); welcome = msg.w; const w = welcome; me = w.id; G.me = me; G.active = true; G.dead = false; G.ended = false; killsMe = 0; phase = w.ph || 'countdown'; specId = 0; G.seq = 0; G.pending = []; G.acc = 0; G.crouch = false; snapBuf = []; lastSnap = null; offerFrom = null; pings = [];
    G.local = !!msg.local; G.mode = w.mode; G.objectives = w.objectives || [];
    world = HG.Terrain.worldFromPayload(w.world); G.world = world; R.load(world);
    ps = Move.newState(0, 0, world); G.players.clear(); roster.clear(); teamOf.clear(); G.loot.clear();
    for (const r of w.roster) { roster.set(r.i, r); teamOf.set(r.i, r.tm); }
    const myTeam = teamOf.get(me);
    for (const r of w.roster) {
      const ally = r.tm === myTeam, col = r.i === me ? '#f2d27a' : ally ? '#7fd68a' : r.b ? '#d8d2c4' : '#ffffff';
      const av = HG.Avatar.create(r.a, { name: r.i === me ? '' : r.n, color: col }); av.root.visible = false; R.scene.add(av.root);
      G.players.set(r.i, { id: r.i, name: r.n, team: r.tm, bot: !!r.b, av, buf: [], alive: true, hp: 100, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, f: 0, w: '', sw: 0, v: 0, col, ally, per: r.per, title: r.t, level: r.l });
    }
    G.yaw = 0; G.pitch = 0.1; myHp = 100; lastAlive = true; $('crosshair').classList.remove('hidden');
    $('hud').classList.remove('hidden'); $('spectate').classList.add('hidden'); $('countdown').textContent = ''; $('killfeed').innerHTML = ''; $('toasts').innerHTML = ''; $('announce').classList.remove('show');
    $('p-hint').textContent = 'Match in progress. The arena does not pause.'; document.querySelector('#pause h2').textContent = 'PAUSED';
    G.setObjectives(G.objectives); HG.UI && HG.UI.onMatchStart(msg);
    HG.Audio.init(); HG.Audio.resume(); HG.Audio.startAmbience(); HG.Audio.startMusic('tense'); R.setTime(w.tod != null ? w.tod : 0.4, 0);
    $('h-k').textContent = '0'; G.showPause(true, G.touch ? 'TAP TO ENTER THE ARENA' : 'CLICK TO ENTER THE ARENA');
  };
  G.stop = function (keepWorld) {
    G.active = false; for (const p of G.players.values()) { R.scene.remove(p.av.root); p.av.dispose && p.av.dispose(); } G.players.clear(); G.loot.clear();
    if (!keepWorld && R) { R.clear(); } if (document.pointerLockElement) document.exitPointerLock();
    $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('inv').classList.add('hidden'); G.invOpen = false; HG.Audio.stopAmbience(); HG.Audio.stopMusic();
    welcome = null; world = null; G.world = null; lastSnap = null;
  };

  /* ---------------------------------------------------------------- input */
  function bindInput() {
    const cv = $('gl'); addEventListener('contextmenu', e => { if (G.active) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => { G.locked = document.pointerLockElement === cv; if (!G.locked && G.active && !G.invOpen && !G.dead && !G.ended && !G.suppressPause) G.showPause(true); if (G.locked) G.showPause(false); });
    cv.addEventListener('mousedown', e => { if (!G.active) return; if (!G.locked && !G.invOpen) { G.capture(); return; } if (e.button === 0) G.mouse.l = true; if (e.button === 2) G.mouse.r = true; if (G.dead && e.button === 0) cycleSpectate(1); });
    addEventListener('mouseup', e => { if (e.button === 0) G.mouse.l = false; if (e.button === 2) G.mouse.r = false; });
    addEventListener('mousemove', e => { if (!G.active || !G.locked) return; const k = 0.0022 * G.settings.sens * (G.mouse.r ? 0.7 : 1); G.yaw -= e.movementX * k; G.pitch = clamp(G.pitch - e.movementY * k, -1.35, 1.35); });
    addEventListener('wheel', e => { if (!G.active || !G.locked || G.dead) return; const n = G.inv.s.length || 1; act('sel', { i: (G.inv.sel + (e.deltaY > 0 ? 1 : -1) + n) % n }); }, { passive: true });
    addEventListener('blur', () => { G.keys = {}; G.mouse.l = G.mouse.r = false; });
    addEventListener('keydown', e => {
      if (!G.active || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const c = e.code; if (e.repeat && c !== 'KeyE') { if (c === 'Tab') e.preventDefault(); return; }
      G.keys[c] = true;
      if (c === 'Tab') { e.preventDefault(); G.toggleInv(); return; }
      if (G.dead) { if (c === 'ArrowRight' || c === 'KeyD') cycleSpectate(1); if (c === 'ArrowLeft' || c === 'KeyA') cycleSpectate(-1); return; }
      if (c === 'KeyC') G.crouch = !G.crouch; else if (c === 'KeyE') act('pick'); else if (c === 'KeyR') act('reload');
      else if (c === 'KeyQ') act('drop', { i: G.inv.sel, n: 0 });
      else if (c === 'KeyG') { const eid = (G.players.get(me) || {}).av && E.BY_ID[(G.players.get(me).av.app || {}).emote]; act('emote', { e: eid ? eid.key : 'wave' }); }
      else if (c === 'KeyT') { const t = allyTarget(); if (t) act('ally', { to: t.id, k: 'offer' }); }
      else if (c === 'KeyY') { if (offerFrom) { act('ally', { to: offerFrom.id, k: 'offer' }); offerFrom = null; $('ally-prompt').classList.add('hidden'); } }
      else if (c === 'KeyN') { offerFrom = null; $('ally-prompt').classList.add('hidden'); }
      else if (c === 'KeyB') { const al = lastSnap && lastSnap.al; if (al && al.length) act('ally', { to: nearestAlly(al), k: 'break' }); }
      else if (/^Digit[1-9]$/.test(c)) act('sel', { i: +c.slice(5) - 1 }); else if (c === 'Digit0') act('sel', { i: 9 });
      else if (c === 'KeyM') G.bigMap = !G.bigMap;
    });
    addEventListener('keyup', e => { G.keys[e.code] = false; });
  }
  function act(a, d) { if (!G.active) return; Net.send({ t: 'act', a, d: d || {} }); }
  G.act = act;
  G.capture = function () { if (!G.active) return; if (G.touch) { G.locked = true; G.showPause(false); HG.Audio.resume(); if (!G.fsTried && G.goFullscreen) { G.fsTried = true; G.goFullscreen(); } return; } const cv = $('gl'); try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* */ } G.showPause(false); HG.Audio.resume(); };
  G.showPause = function (on, title) {
    const el = $('pause'); if (G.invOpen || G.dead && !on) { el.classList.add('hidden'); return; } el.classList.toggle('hidden', !on);
    if (on) { document.querySelector('#pause h2').textContent = title ? 'READY' : 'PAUSED'; $('p-resume').textContent = title || 'RESUME'; }
  };
  G.toggleInv = function (force) {
    const on = force != null ? force : !G.invOpen; if (G.dead && on) return; G.invOpen = on; $('inv').classList.toggle('hidden', !on); if (G.touch && on) G.locked = false;
    if (on) { G.suppressPause = true; if (document.pointerLockElement) document.exitPointerLock(); G.showPause(false); HG.UI && (HG.UI._invSig = null, HG.UI.renderInventory()); setTimeout(() => { G.suppressPause = false; }, 100); }
    else G.capture();
  };
  function allyTarget() {
    const m = G.players.get(me); if (!m) return null; let best = null, bd = 22 * 22;
    for (const p of G.players.values()) { if (p.id === me || !p.alive || p.team === m.team || (lastSnap && lastSnap.al && lastSnap.al.includes(p.id))) continue; const dx = p.x - ps.x, dz = p.z - ps.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function nearestAlly(ids) { let b = ids[0], bd = 1e9; for (const id of ids) { const p = G.players.get(id); if (p) { const d = (p.x - ps.x) ** 2 + (p.z - ps.z) ** 2; if (d < bd) { bd = d; b = id; } } } return b; }
  G.cycleSpectate = d => cycleSpectate(d);
  function cycleSpectate(dir) { const alive = [...G.players.values()].filter(p => p.alive && p.id !== me); if (!alive.length) { specId = 0; return; } let i = alive.findIndex(p => p.id === specId); i = (i + dir + alive.length) % alive.length; specId = alive[i].id; $('spec-name').textContent = alive[i].name; }

  /* ---------------------------------------------------------------- network → state */
  Net.on('snap', m => { if (G.active) onSnap(m.d); });
  function onSnap(d) {
    const now = performance.now(); lastSnap = d; serverT = d.t; phase = d.ph;
    for (const q of d.p) { const p = G.players.get(q.i); if (!p) continue; p.buf.push({ at: now, x: q.x, y: q.y, z: q.z, r: q.r, p: q.p, f: q.f, h: q.h, w: q.w, sw: q.sw, v: q.v }); if (p.buf.length > 8) p.buf.shift(); }
    if (d.y) {
      const y = d.y, before = { x: ps.x, y: ps.y, z: ps.z };
      ps.x = y.x; ps.y = y.yy; ps.z = y.z; ps.vx = y.vx; ps.vy = y.vy; ps.vz = y.vz; ps.onGround = !!y.og; ps.stamina = y.st; ps.exhausted = y.ex; ps.rootT = y.rt; ps.maxStamina = y.ms;
      ps.speedMul = 1 - (y.us > 0 ? 0.35 : 0) - (G.inv.arm && G.inv.arm[0] === 'armor_heavy' ? 0.05 : 0);
      while (G.pending.length && G.pending[0].s <= d.a) G.pending.shift();
      if (phase !== 'countdown') for (const inp of G.pending) Move.step(ps, inp, world, DT);
      const dx = before.x - ps.x, dy = before.y - ps.y, dz = before.z - ps.z;
      if (Math.hypot(dx, dz) > 4 || Math.abs(dy) > 4) { viewOff.x = viewOff.y = viewOff.z = 0; } else { viewOff.x += dx; viewOff.y += dy; viewOff.z += dz; }
      myHp = y.hp; G.stats = y; if (!y.al && !G.dead) onDeath(0);
    }
    if (d.inv) { G.inv = { s: d.inv.s, arm: d.inv.arm, sel: d.inv.sel, cap: d.inv.cap }; HG.UI && G.invOpen && HG.UI.renderInventory(); G.hotDirty = true; }
    if (d.lt) { G.loot.clear(); for (const l of d.lt) G.loot.set(l[0], { key: l[0], id: l[1], n: l[2], x: l[3], z: l[4] }); }
    if (d.tr) R.updateTraps(d.tr);
    R.setTime(d.tod, d.wt); HG.Audio.setWeather(d.wt); HG.Audio.setNight(1 - (R.dayF || 0));
    for (const e of d.e) onEvent(e);
  }

  function onEvent(e) {
    const A = HG.Audio, P = (id) => G.players.get(id), pos = e.x != null ? { x: e.x, z: e.z } : {};
    switch (e.t) {
      case 'phase': if (e.p === 'countdown') phase = 'countdown'; break;
      case 'announce': banner(e.m); A.play(e.k === 'gong' ? 'gong' : e.k === 'zone' ? 'zone' : 'announce'); if (e.k === 'gong') { A.startMusic('battle'); setTimeout(() => $('countdown').textContent = '', 50); } if (e.k !== 'gong') A.speak(e.m); else A.speak('Let the games begin'); break;
      case 'step': if (e.i !== me || true) A.play('step', { x: e.x, z: e.z, water: e.w, v: e.i === me ? 0.5 : 1 }); break;
      case 'shot': { const w = C.WEAPONS[e.w]; A.play(e.th ? 'swing' : e.w === 'crossbow' ? 'crossbow' : 'bow', { x: e.x, z: e.z }); break; }
      case 'hit': { R.spark(e.x, e.y, e.z, e.h ? 0xff5a3c : 0x9b1c14, e.h ? 14 : 8, 3.2, 0.5, 0.07); A.play(e.h ? 'headshot' : 'hit', { x: e.x, z: e.z }); const p = P(e.i); if (p && p.av && p.id !== me) p.flash = 0.15; break; }
      case 'hitm': { const u = $('crosshair').querySelector('u'); u.className = 'show' + (e.h ? ' head' : ''); setTimeout(() => u.className = '', 160); dmgNum(e.d, e.h); break; }
      case 'hurt': { $('fx-vignette').classList.add('hurt'); setTimeout(() => $('fx-vignette').classList.remove('hurt'), 220); shake = Math.min(1, shake + e.d / 40); A.play('hurt'); if (e.a) { const dir = Math.atan2(-(e.a.x - ps.x), -(e.a.z - ps.z)) - G.yaw; const i = document.createElement('i'); i.style.transform = 'rotate(' + (-dir) + 'rad)'; $('dmg-dirs').appendChild(i); setTimeout(() => i.remove(), 1200); } break; }
      case 'crit': toast('BACKSTAB!', true); break;
      case 'kill': onKill(e); break;
      case 'died': onDeath(e.by, e.w); break;
      case 'cannon': A.play('cannon'); break;
      case 'drink': A.play('drink'); break;
      case 'use': useBar = { t: e.d, max: e.d, label: 'USING' }; break;
      case 'used': { const t = C.ITEMS[e.id] && C.ITEMS[e.id].type; A.play(t === 'med' ? 'heal' : t === 'water' ? 'drink' : 'eat'); useBar.t = 0; break; }
      case 'reload': useBar = { t: e.d, max: e.d, label: 'RELOADING' }; A.play('reload'); break;
      case 'pickup': A.play('pickup'); toast('+' + e.n + ' ' + (C.ITEMS[e.id] ? C.ITEMS[e.id].name : e.id)); break;
      case 'msg': toast(e.m, true); break;
      case 'crafted': A.play('craft'); toast('Crafted'); break;
      case 'broke': A.play('break'); toast((e.id === 'armor' ? 'Your armour' : (C.ITEMS[e.id] || {}).name || 'Item') + ' broke!', true); break;
      case 'lr': G.loot.delete(e.id); break;
      case 'weather': A.setWeather(e.w); break;
      case 'bolt': R.bolt(e.x, e.z); A.play('bolt', { x: e.x, z: e.z, d: Math.hypot(e.x - ps.x, e.z - ps.z) }); break;
      case 'warnbolt': R.spark(e.x, (world ? world.height(e.x, e.z) : 0) + 0.3, e.z, 0xcfe0ff, 6, 2, 1.2, 0.12); break;
      case 'impact': R.spark(e.x, e.y, e.z, 0xb59a6a, 6, 2.5, 0.45, 0.06); A.play('thud', { x: e.x, z: e.z }); break;
      case 'sfx': A.play(e.k === 'dropland' ? 'thud' : e.k, { x: e.x, z: e.z }); if (e.k === 'dropland') banner('SUPPLY DROP HAS LANDED'); break;
      case 'emote': { const p = P(e.i); if (p) { const it = E.BY_ID['emote:' + e.e]; p.av.playEmote((it && it.v.a) || e.e); A.play('emote', { x: p.x, z: p.z }); } break; }
      case 'ally': onAlly(e); break;
      case 'hidden': { const h = E.HIDDEN_TYPES.find(x => x.id === e.id); A.play('discover'); toast('Hidden location found: ' + (h ? h.name : e.id) + (h ? ' (+' + h.credits + ' credits)' : ''), false); break; }
      case 'mark': pings.push({ x: e.x, z: e.z, t: e.d }); if (e.i !== me) toast('A marked tribute has been revealed!', true); break;
      case 'obj': { const o = G.objectives.find(x => x.id === e.id); if (o) { o.p = e.p; o.done = e.done; o.failed = e.failed; G.setObjectives(G.objectives); if (e.done) A.play('discover'); } break; }
      case 'end': onEnd(e); break;
      case 'muttdead': break;
    }
  }
  function onKill(e) {
    const v = roster.get(e.v), k = e.k ? roster.get(e.k) : null, wname = (C.ITEMS[e.w] && C.ITEMS[e.w].name) || ({ zone: 'the closing arena', starve: 'starvation', lightning: 'lightning', fog: 'poison fog', fire: 'wildfire', flood: 'the flood', mutt: 'a mutt', quit: 'abandoning the arena', trap_snare: 'a snare', trap_spike: 'a spike trap' }[e.w] || e.w || 'the arena');
    const d = document.createElement('div'); if (e.k === me) { d.className = 'me'; killsMe++; $('h-k').textContent = killsMe; }
    d.textContent = k && e.k !== e.v ? k.n + '  ✦ ' + wname + (e.h ? ' (headshot)' : '') + '  ' + (v ? v.n : '?') : (v ? v.n : '?') + ' was claimed by ' + wname; $('killfeed').appendChild(d); setTimeout(() => d.remove(), 7000); while ($('killfeed').children.length > 6) $('killfeed').firstChild.remove();
    const p = G.players.get(e.v); if (p) p.alive = false; if (e.v !== me) HG.Audio.play('cannon');
  }
  function onDeath(by, w) {
    if (G.dead) return; G.dead = true; G.mouse.l = G.mouse.r = false; HG.Audio.play('defeat'); $('crosshair').classList.add('hidden'); $('spectate').classList.remove('hidden'); G.toggleInv(false); G.showPause(false);
    const k = by && roster.get(by); toast(k ? 'You were eliminated by ' + k.n : 'You were eliminated', true); banner('ELIMINATED'); cycleSpectate(1);
    $('spec-name').textContent = (G.players.get(specId) || {}).name || '—'; HG.UI && HG.UI.onDead && HG.UI.onDead();
  }
  function onEnd(e) {
    G.ended = true; phase = 'ended'; const win = e.st && e.st.find(s => s.pl === 1); const mine = e.st && e.st.find(s => s.i === me);
    banner(win ? (win.i === me ? 'VICTORY' : win.n.toUpperCase() + ' IS THE VICTOR') : 'THE GAMES ARE OVER'); HG.Audio.stopMusic();
    if (mine && mine.pl === 1) { HG.Audio.play('victory'); const p = G.players.get(me); if (p) p.victory = true; }
    HG.UI && HG.UI.onMatchEnd && HG.UI.onMatchEnd(e);
  }
  function onAlly(e) {
    const A = HG.Audio, n = (roster.get(e.i) || {}).n || 'A tribute';
    if (e.k === 'offer') { offerFrom = { id: e.i, name: e.n || n, until: performance.now() + 15000 }; const el = $('ally-prompt'); el.innerHTML = '<b>' + offerFrom.name + '</b> offers an alliance<br><small>' + (G.touch ? 'Tap ACCEPT or NO' : '[Y] Accept &nbsp; [N] Decline') + '</small>'; el.classList.remove('hidden'); A.play('ally'); setTimeout(() => { if (offerFrom && offerFrom.id === e.i) { offerFrom = null; el.classList.add('hidden'); } }, 15000); }
    else if (e.k === 'formed') { toast('Alliance formed with ' + n); A.play('ally'); const p = G.players.get(e.i); if (p) p.av.setName(p.name, '#8ab4ff'); }
    else if (e.k === 'broken') { toast('Alliance with ' + n + ' was broken!', true); A.play('betray'); const p = G.players.get(e.i); if (p) p.av.setName(p.name, '#ffffff'); }
  }
  G.setObjectives = function (list) {
    const el = $('objectives'); el.innerHTML = ''; for (const o of list || []) { const d = document.createElement('div'); d.className = 'o' + (o.done ? ' done' : '') + (o.failed ? ' failed' : '') + (o.optional ? ' opt' : ''); d.textContent = (o.optional ? '◦ ' : '▸ ') + o.text + (o.type === 'dummies' ? ' (' + (o.p || 0) + '/' + (o.n || 5) + ')' : o.n > 1 && o.p != null ? ' (' + o.p + '/' + o.n + ')' : ''); el.appendChild(d); }
  };
  function banner(t) { const el = $('announce'); el.textContent = t; el.classList.add('show'); clearTimeout(announceT); announceT = setTimeout(() => el.classList.remove('show'), 3800); }
  function toast(t, bad) { const d = document.createElement('div'); d.textContent = t; if (bad) d.style.borderColor = '#7a2a22'; $('toasts').appendChild(d); setTimeout(() => d.remove(), 3000); while ($('toasts').children.length > 4) $('toasts').firstChild.remove(); }
  G.toast = toast;
  function dmgNum(n, head) { const d = document.createElement('div'); d.className = 'dmgnum'; d.textContent = n; d.style.left = (innerWidth / 2 + 30 + Math.random() * 40) + 'px'; d.style.top = (innerHeight / 2 - 30 + Math.random() * 20) + 'px'; d.style.fontSize = head ? '30px' : '22px'; if (head) d.style.color = '#ff7a5c'; document.body.appendChild(d); setTimeout(() => d.remove(), 1000); }

  /* ---------------------------------------------------------------- per-frame */
  G.update = function (dt) {
    dt = Math.min(dt, 0.1); fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    if (!G.active) { menuAng += dt * 0.05; R.setTime(R.tod, 0); const r = 70; R.camera.position.set(Math.cos(menuAng) * r, 20 + (R.world ? R.world.height(0, 0) : 0), Math.sin(menuAng) * r); R.camera.lookAt(0, (R.world ? R.world.height(0, 0) : 0) + 9, 0); R.focus.set(R.camera.position.x, 0, R.camera.position.z); R.update(dt, R.camera.position.x, R.camera.position.z); return; }
    const A = HG.Audio, mp = G.players.get(me);
    // fixed-step input → server + local prediction
    if (!G.dead && lastSnap) {
      G.acc += dt; let n = 0;
      while (G.acc >= DT && n < 4) {
        G.acc -= DT; n++; const k = G.keys; let mx = 0, mz = 0; if (k.KeyW || k.ArrowUp) mz += 1; if (k.KeyS || k.ArrowDown) mz -= 1; if (k.KeyD || k.ArrowRight) mx += 1; if (k.KeyA || k.ArrowLeft) mx -= 1;
        if (G.touch && G.joy && G.joy.m > 0) { mx = G.joy.x; mz = G.joy.y; }
        let f = 0; if (k.Space) f |= F.JUMP; if (k.ShiftLeft || k.ShiftRight || (G.touch && G.joy && G.joy.m > 0.92 && mz > 0.2)) f |= F.SPRINT; if (G.crouch) f |= F.CROUCH; if (G.mouse.r && G.locked) f |= F.AIM; if (G.mouse.l && G.locked) f |= F.ATTACK;
        const inp = { s: ++G.seq, mx, mz, y: G.yaw, p: G.pitch, f }; Net.send({ t: 'in', s: inp.s, mx, mz, y: inp.y, p: inp.p, f }); G.pending.push(inp); if (G.pending.length > 90) G.pending.shift();
        if (phase !== 'countdown') { ps.crouch = !!(f & F.CROUCH); Move.step(ps, inp, world, DT); }
      }
      if (G.acc > 0.25) G.acc = 0;
    }
    const decay = Math.exp(-dt * 9); viewOff.x *= decay; viewOff.y *= decay; viewOff.z *= decay;

    // interpolate remote players (render ~110 ms in the past)
    const rt = performance.now() - 110;
    for (const p of G.players.values()) {
      const b = p.buf; if (b.length) { let i = b.length - 1; while (i > 0 && b[i - 1].at > rt) i--; const a = b[Math.max(0, i - 1)], c = b[i]; let s = c.at === a.at ? 1 : clamp((rt - a.at) / (c.at - a.at), 0, 1); if (rt > c.at) s = 1;
        p.x = a.x + (c.x - a.x) * s; p.y = a.y + (c.y - a.y) * s; p.z = a.z + (c.z - a.z) * s; p.yaw = lerpAng(a.r, c.r, s); p.pitch = c.p; p.f = c.f; p.hp = c.h; p.w = c.w; p.sw = c.sw; p.v = c.v; p.alive = !(c.f & 32); }
      if (p.id === me) { p.x = ps.x + viewOff.x; p.y = ps.y + viewOff.y; p.z = ps.z + viewOff.z; p.yaw = G.yaw; p.pitch = G.pitch; }
      if (!p.buf.length && p.id !== me) { p.av.root.visible = false; continue; }
      const av = p.av, f = p.f, mine = p.id === me, aimF = mine ? (G.mouse.r && G.locked) : !!(f & 8);
      av.root.visible = true; av.root.position.set(p.x, p.y, p.z); av.root.rotation.y = p.yaw;
      if (!mine) { const d2 = (p.x - ps.x) ** 2 + (p.z - ps.z) ** 2; const hide = !p.ally && world && world.inBush(p.x, p.z) && d2 > 36 && p.alive; av.root.visible = !hide; if (av.nameSprite) av.nameSprite.visible = p.alive && (p.ally ? d2 < 3600 : d2 < 400); }
      const w = C.WEAPONS[p.w] ? p.w : (C.ITEMS[p.w] && p.w) ? '' : ''; av.setWeapon(w);
      av.update(dt, { speed: mine ? Math.hypot(ps.vx, ps.vz) : p.v, sprint: mine ? ps.sprinting : !!(f & 2), crouch: mine ? ps.crouch : !!(f & 4), inWater: mine ? ps.inWater : !!(f & 128), pitch: p.pitch, aim: aimF, using: !!(f & 256), reload: !!(f & 512), rooted: !!(f & 64), alive: p.alive, swingN: p.sw, victory: p.victory ? av.victory : '' });
    }
    // time-of-day / weather smoothing + world sync
    if (lastSnap) { R.setTime(lastSnap.tod + (performance.now() % 1000) / 1000 * 0, lastSnap.wt); R.setZone(lastSnap.z); R.updateProj(lastSnap.pr, dt); R.updateMutts(lastSnap.m, dt); R.updateHaz(lastSnap.hz, dt); }
    R.updateLoot(G.loot, dt);

    // camera
    const target = G.dead ? (G.players.get(specId) || mp) : mp; const tp = target ? target : { x: ps.x, y: ps.y, z: ps.z, yaw: 0, pitch: 0 };
    const crouchK = tp === mp ? (ps.crouch ? 0.72 : 1) : 1, head = 1.55 * crouchK, aim = !G.dead && G.mouse.r && G.locked;
    const dist = aim ? 1.9 : 3.5, shoulder = aim ? 0.75 : 0.55, yaw = G.dead && tp !== mp ? tp.yaw + Math.PI * 0 : G.yaw, pit = G.dead && tp !== mp ? 0.22 : G.pitch;
    if (G.dead && tp !== mp) { G.yaw = lerpAng(G.yaw, tp.yaw, 0.02); }
    const cp = Math.cos(pit), bx = Math.sin(yaw) * cp, by = -Math.sin(pit), bz = Math.cos(yaw) * cp, rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const px = tp.x, py = tp.y + head, pz = tp.z; let dd = dist; const ox = rx * shoulder, oz = rz * shoulder;
    for (let s = 0.4; s <= dist; s += 0.3) { const x = px + bx * s + ox * Math.min(1, s / 1.2), y = py + by * s + 0.0, z = pz + bz * s + oz * Math.min(1, s / 1.2); if (hitCam(x, y, z)) { dd = Math.max(0.5, s - 0.4); break; } }
    const tx = px + bx * dd + ox * Math.min(1, dd / 1.2), ty = py + by * dd, tz = pz + bz * dd + oz * Math.min(1, dd / 1.2);
    camPos.lerp(new T.Vector3(tx, ty, tz), 1 - Math.exp(-dt * 22)); if (!isFinite(camPos.x) || camPos.distanceTo(new T.Vector3(tx, ty, tz)) > 8) camPos.set(tx, ty, tz);
    shake = Math.max(0, shake - dt * 3); const sh = shake * 0.12; const cam = R.camera; cam.position.set(camPos.x + (Math.random() - 0.5) * sh, Math.max(camPos.y, (world ? world.height(camPos.x, camPos.z) : 0) + 0.3) + (Math.random() - 0.5) * sh, camPos.z + (Math.random() - 0.5) * sh);
    cam.rotation.set(pit, yaw, 0, 'YXZ'); const fov = aim ? 52 : (ps.sprinting ? 76 : 70); if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
    R.focus.set(cam.position.x, 0, cam.position.z); A.listener(cam.position.x, cam.position.z, yaw);
    if (world) { waterT -= dt; if (waterT < 0) { waterT = 0.6; let n = 0; for (let i = 0; i < 8; i++) { const a = i * 0.785; if (world.inWater(cam.position.x + Math.cos(a) * 9, cam.position.z + Math.sin(a) * 9)) n++; } A.setWater(n / 6 + (ps.inWater ? 0.5 : 0)); } }
    R.update(dt, cam.position.x, cam.position.z);
    updateCrosshair(dt, aim, cam);
    hudT -= dt; if (hudT <= 0) { hudT = 0.066; updateHud(); } mapT -= dt; if (mapT <= 0) { mapT = 0.05; drawMini(); drawCompass(); }
    if (useBar.t > 0) { useBar.t -= dt; const b = $('useBar'); b.style.display = 'block'; b.firstChild.style.width = (100 - useBar.t / useBar.max * 100) + '%'; b.querySelector('span').textContent = useBar.label; } else $('useBar').style.display = 'none';
    for (const p of pings) p.t -= dt; pings = pings.filter(p => p.t > 0);
  };
  /* crosshair: mirrors the server's spread rules so the reticle size is honest */
  let xhGap = 10;
  function updateCrosshair(dt, aim, cam) {
    const el = $('crosshair'); el.style.display = G.dead || !G.locked ? 'none' : ''; if (G.dead || !G.locked) return;
    const held = G.inv && G.inv.s[G.inv.sel], wd = held && C.WEAPONS[held[0]]; let mode = 'mel', empty = false, target = 10;
    if (wd && wd.type === 'ranged') {
      mode = 'rng'; const moving = Math.hypot(ps.vx || 0, ps.vz || 0) > 1;
      const deg = (aim ? wd.aimSpread : wd.spread) * (moving ? 1.6 : 1) * (ps.sprinting ? 1.6 : 1) * (G.crouch ? 0.75 : 1);
      const px = Math.tan(deg * 0.6 * Math.PI / 180) * (innerHeight / 2) / Math.tan(cam.fov * Math.PI / 360);
      target = Math.min(70, Math.max(4, px)); empty = !held[3];
    } else if (wd && wd.throw && aim) { mode = 'thr'; }
    xhGap += (target - xhGap) * Math.min(1, dt * 14); el.style.setProperty('--g', xhGap.toFixed(1) + 'px');
    if (el.dataset.mode !== mode) el.dataset.mode = mode; el.classList.toggle('aim', aim); el.classList.toggle('empty', empty && mode === 'rng');
  }
  function hitCam(x, y, z) {
    if (!world) return false; if (y < world.height(x, z) + 0.25) return true;
    for (const o of world.query(x, z, 0.4)) { if (y > (o.top != null ? o.top : 99) || (o.base != null && y < o.base - 1)) continue; if (o.k === 0) { const dx = x - o.x, dz = z - o.z, rr = o.r + 0.15; if (dx * dx + dz * dz < rr * rr) return true; } else if (x > o.minx - 0.15 && x < o.maxx + 0.15 && z > o.minz - 0.15 && z < o.maxz + 0.15) return true; }
    return false;
  }

  /* ---------------------------------------------------------------- HUD */
  function updateHud() {
    const d = lastSnap; if (!d) return; const y = d.y || {}, A = HG.Audio;
    $('h-alive').textContent = d.c; $('h-time').textContent = fmt(d.t); $('b-hp').style.width = clamp(myHp, 0, 100) + '%'; $('t-hp').textContent = Math.ceil(myHp);
    $('b-st').style.width = clamp(ps.stamina / (ps.maxStamina || 100) * 100, 0, 100) + '%'; $('b-hu').style.width = clamp(y.hu || 0, 0, 100) + '%'; $('b-th').style.width = clamp(y.th || 0, 0, 100) + '%';
    const z = d.z, zp = $('h-zone'); const outside = y.out;
    if (z.s === 'o') { $('h-zone-t').textContent = '—'; $('h-zone-l').textContent = 'NO ZONE'; } else { $('h-zone-t').textContent = fmt(z.tl); $('h-zone-l').textContent = z.s === 's' ? 'SHRINKING' : 'ZONE CLOSES'; }
    zp.classList.toggle('warn', !!outside); if (outside) { $('prompt').textContent = ''; }
    if (phase === 'countdown') { const c = Math.ceil(d.cd); $('countdown').textContent = c > 0 ? c : ''; if (c !== G.lastCd && c > 0 && c <= 5) A.play('click'); G.lastCd = c; } else if ($('countdown').textContent) $('countdown').textContent = '';
    // hotbar
    const inv = G.inv; if (G.hotDirty || G.hotSel !== inv.sel) { G.hotDirty = false; G.hotSel = inv.sel; const hb = $('hotbar'); hb.innerHTML = ''; for (let i = 0; i < Math.min(9, inv.s.length); i++) { const s = inv.s[i], el = document.createElement('div'); el.className = 'slot' + (i === inv.sel ? ' sel' : ''); el.innerHTML = '<small>' + (i + 1) + '</small>' + (s ? itemIcon(s[0]) + (s[1] > 1 ? '<em>' + s[1] + '</em>' : '') + (C.ITEMS[s[0]].dur ? '<i style="width:' + clamp(s[2] / C.ITEMS[s[0]].dur * 100, 0, 100) + '%"></i>' : '') : ''); el.onclick = () => act('sel', { i }); hb.appendChild(el); } }
    const held = inv.s[inv.sel], def = held && C.ITEMS[held[0]], wd = held && C.WEAPONS[held[0]];
    $('ammo-w').textContent = held ? def.name.toUpperCase() : 'FISTS';
    if (wd && wd.type === 'ranged') { const res = inv.s.reduce((n, s) => n + (s && s[0] === wd.ammo ? s[1] : 0), 0); $('ammo-n').textContent = (held[3] || 0) + ' / ' + res; $('ammo-d').textContent = 'Durability ' + held[2] + '  ·  R to reload'; }
    else if (wd) { $('ammo-n').textContent = '∞'; $('ammo-d').textContent = 'Durability ' + held[2] + (wd.throw ? '  ·  RMB+LMB to throw' : ''); } else if (held) { $('ammo-n').textContent = held[1]; $('ammo-d').textContent = def.type === 'trap' ? 'Click to place' : 'Click to use'; } else { $('ammo-n').textContent = ''; $('ammo-d').textContent = ''; }
    // prompt
    if (!G.dead && G.locked) { let best = null, bd = C.PLAYER.pickupRange ** 2; for (const L of G.loot.values()) { const dd = (L.x - ps.x) ** 2 + (L.z - ps.z) ** 2; if (dd < bd) { bd = dd; best = L; } }
      let txt = ''; if (best) txt = '<b>E</b> Pick up ' + (best.n > 1 ? best.n + '× ' : '') + C.ITEMS[best.id].name; else if (world && world.inWater(ps.x - Math.sin(G.yaw) * 1.2, ps.z - Math.cos(G.yaw) * 1.2)) txt = '<b>E</b> Drink'; else { const t = allyTarget(); if (t && !(d.al && d.al.includes(t.id)) && Math.hypot(t.x - ps.x, t.z - ps.z) < 12) txt = '<b>T</b> Propose alliance with ' + t.name; }
      if (G.touch) txt = txt.replace('<b>E</b> Pick up', '<b>PICK UP</b> →').replace('<b>E</b> Drink', '<b>PICK UP</b> to drink').replace('<b>T</b> Propose alliance with', '<b>ALLY</b> → propose to'); if ($('prompt').innerHTML !== txt) $('prompt').innerHTML = txt; } else $('prompt').innerHTML = '';
    $('net-stat').textContent = (G.local ? 'OFFLINE' : 'ping ' + Net.rtt + 'ms') + ' · ' + fps + ' fps';
  }
  function drawCompass() {
    const cv = $('compass-c'), x = cv.getContext('2d'), W = cv.width, H = cv.height; x.clearRect(0, 0, W, H); const bear = ((-G.yaw * 180 / Math.PI) % 360 + 360) % 360, span = 120, pp = W / span;
    x.font = '600 14px Cinzel,serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let a = -span / 2 - 10; a <= span / 2 + 10; a += 5) { const b = ((Math.round(bear / 5) * 5 + a) % 360 + 360) % 360, px = W / 2 + (Math.round(bear / 5) * 5 + a - bear) * pp; const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[b]; if (card) { x.fillStyle = card === 'N' ? '#ff6a4a' : '#f2d27a'; x.fillText(card, px, 18); } else if (b % 15 === 0) { x.fillStyle = '#aaa'; x.fillText(b, px, 20); x.font = '600 14px Cinzel,serif'; } else { x.fillStyle = '#666'; x.fillRect(px, 26, 1, 6); } }
    if (lastSnap) { const z = lastSnap.z; let zb = (Math.atan2(z.nx - ps.x, -(z.nz - ps.z)) * 180 / Math.PI + 360) % 360; let dlt = ((zb - bear + 540) % 360) - 180; if (Math.abs(dlt) < span / 2) { x.fillStyle = '#4aa3ff'; x.fillText('◆', W / 2 + dlt * pp, 8); } }
  }
  function drawMini() {
    const cv = $('mm'), x = cv.getContext('2d'), S = cv.width, d = lastSnap; if (!d || !R.minimap) return; const win = 300 * (G.bigMap ? 2.4 : 1), sc = S / win, wk = R.minimap.width / world.size;
    x.save(); x.clearRect(0, 0, S, S); x.translate(S / 2, S / 2); x.rotate(G.yaw); x.translate(-ps.x * sc, -ps.z * sc);
    x.imageSmoothingEnabled = true; x.drawImage(R.minimap, -world.size / 2 * sc, -world.size / 2 * sc, world.size * sc, world.size * sc);
    const circ = (cx, cz, r, st, fill) => { x.beginPath(); x.arc(cx * sc, cz * sc, r * sc, 0, 6.283); if (fill) { x.fillStyle = fill; x.fill(); } if (st) { x.strokeStyle = st; x.lineWidth = 2 / 1; x.stroke(); } };
    // outside-zone tint
    x.save(); x.beginPath(); x.rect(-world.size * sc, -world.size * sc, world.size * 2 * sc, world.size * 2 * sc); x.arc(d.z.x * sc, d.z.z * sc, d.z.r * sc, 0, 6.283, true); x.fillStyle = 'rgba(60,110,200,.28)'; x.fill('evenodd'); x.restore();
    circ(d.z.x, d.z.z, d.z.r, '#4aa3ff'); circ(d.z.nx, d.z.nz, d.z.nr, '#ffffff');
    for (const h of d.hz) circ(h.x, h.z, h.r, null, (C.EVENTS[h.k] ? C.EVENTS[h.k].color : '#f00') + '55');
    x.fillStyle = '#6fe3ff'; for (const t of (d.tk || [])) { x.fillRect(t[0] * sc - 1, t[1] * sc - 1, 2.5, 2.5); }
    if (welcome && welcome.scout && (lastSnap.t < 180)) { x.fillStyle = '#f2d27a'; for (const L of G.loot.values()) if (C.ITEMS[L.id].type === 'weapon') x.fillRect(L.x * sc - 1.5, L.z * sc - 1.5, 3, 3); }
    for (const p of G.players.values()) { if (p.id === me || !p.alive) continue; const ally = p.ally || (d.al && d.al.includes(p.id)); const dist = Math.hypot(p.x - ps.x, p.z - ps.z); if (!ally && dist > 55) continue; x.fillStyle = ally ? '#7fd68a' : '#ff5a4a'; x.beginPath(); x.arc(p.x * sc, p.z * sc, 3.2, 0, 6.283); x.fill(); }
    for (const q of pings) { x.strokeStyle = '#ff3a2a'; x.lineWidth = 2; x.beginPath(); x.arc(q.x * sc, q.z * sc, (6 + (q.t * 6) % 6), 0, 6.283); x.stroke(); }
    x.restore(); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(S / 2, S / 2 - 7); x.lineTo(S / 2 - 5, S / 2 + 5); x.lineTo(S / 2 + 5, S / 2 + 5); x.closePath(); x.fill();
    $('minimap').style.width = $('minimap').style.height = (G.touch ? (G.bigMap ? 230 : 92) : (G.bigMap ? 380 : 200)) + 'px';
  }

  /* leave */
  G.leave = function () { Net.send({ t: 'quit' }); };
  G.state = () => ({ me, phase, dead: G.dead, ended: G.ended });
})();
