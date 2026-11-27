/* Mobile / touch support: floating joystick, drag-to-look, action buttons, tap-based inventory management.
   Active only on touch-first devices (or with ?touch=1 for testing). Works by feeding the same state the keyboard/mouse use. */
(function () {
  const G = HG.Game, UI = HG.UI, C = HG.C, $ = id => document.getElementById(id);
  const forced = /[?&]touch=1/.test(location.search);
  const isTouch = forced || (matchMedia('(pointer:coarse)').matches && matchMedia('(hover:none)').matches);
  G.touch = isTouch;
  if (!isTouch) return;
  document.body.classList.add('touch');
  G.joy = { x: 0, y: 0, m: 0 };

  const key = code => { const o = { code, bubbles: true }; window.dispatchEvent(new KeyboardEvent('keydown', o)); window.dispatchEvent(new KeyboardEvent('keyup', o)); };

  /* ---- DOM */
  const root = document.createElement('div'); root.id = 'touch'; root.className = 'hidden';
  root.innerHTML = '<div class="rot">Rotate your phone sideways to play</div>' +
    '<div id="t-look"></div><div id="t-joy"></div>' +
    '<div id="t-stick" class="hidden"><div id="t-knob"></div></div>' +
    '<button class="tb" id="t-fire">ATTACK</button><button class="tb tgl" id="t-aim">AIM</button><button class="tb" id="t-jump">JUMP</button>' +
    '<button class="tb sm tgl" id="t-crouch">CROUCH</button><button class="tb sm" id="t-pick">PICK UP</button><button class="tb sm" id="t-reload">RELOAD</button>' +
    '<button class="tb sm" id="t-ally">ALLY</button><button class="tb sm" id="t-no">NO</button>' +
    '<button class="tb sm top" id="t-inv">BAG</button><button class="tb sm top" id="t-menu">MENU</button>';
  document.body.appendChild(root);
  const btn = id => $(id);

  /* ---- joystick (floating: appears where the thumb lands on the left side) + look (right side) */
  let joyId = null, joyO = null, lookId = null, lookLast = null; const R = 56;
  const stick = $('t-stick'), knob = $('t-knob');
  function tById(e, id) { for (const t of e.changedTouches) if (t.identifier === id) return t; return null; }
  function overButton(t) { const el = document.elementFromPoint(t.clientX, t.clientY); return el && el.closest && el.closest('.tb'); }
  function joyMove(t) {
    let dx = t.clientX - joyO.x, dy = t.clientY - joyO.y; const l = Math.hypot(dx, dy), k = l > R ? R / l : 1; dx *= k; dy *= k;
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; const m = Math.min(1, l / R);
    if (m < 0.18) { G.joy.x = G.joy.y = G.joy.m = 0; } else { G.joy.x = dx / R; G.joy.y = -dy / R; G.joy.m = m; }
  }
  function joyEnd() { joyId = null; stick.classList.add('hidden'); G.joy.x = G.joy.y = G.joy.m = 0; }
  $('t-joy').addEventListener('touchstart', e => { e.preventDefault(); if (joyId != null) return; const t = e.changedTouches[0]; joyId = t.identifier; joyO = { x: t.clientX, y: t.clientY }; stick.style.left = joyO.x + 'px'; stick.style.top = joyO.y + 'px'; stick.classList.remove('hidden'); knob.style.transform = ''; }, { passive: false });
  $('t-look').addEventListener('touchstart', e => {
    e.preventDefault(); if (G.dead) { if (G.cycleSpectate) G.cycleSpectate(1); return; }
    if (lookId != null) return; const t = e.changedTouches[0]; lookId = t.identifier; lookLast = { x: t.clientX, y: t.clientY };
  }, { passive: false });
  addEventListener('touchmove', e => {
    let used = false;
    if (joyId != null) { const t = tById(e, joyId); if (t) { joyMove(t); used = true; } }
    if (lookId != null) { const t = tById(e, lookId); if (t) { const k = 0.0048 * G.settings.sens * (G.mouse.r ? 0.7 : 1); G.yaw -= (t.clientX - lookLast.x) * k; G.pitch = Math.max(-1.35, Math.min(1.35, G.pitch - (t.clientY - lookLast.y) * k)); lookLast = { x: t.clientX, y: t.clientY }; used = true; } }
    if (used && G.active && !G.invOpen) e.preventDefault();
  }, { passive: false });
  const endT = e => { if (joyId != null && tById(e, joyId)) joyEnd(); if (lookId != null && tById(e, lookId)) lookId = null; };
  addEventListener('touchend', endT); addEventListener('touchcancel', endT);

  /* ---- buttons (hold = attack, toggles for aim / crouch) */
  function press(id, down, up) {
    const b = btn(id); b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); down && down(); }, { passive: false });
    const end = e => { e.preventDefault(); b.classList.remove('on'); up && up(); }; b.addEventListener('touchend', end, { passive: false }); b.addEventListener('touchcancel', end, { passive: false });
  }
  const tap = (id, fn) => press(id, fn, null);
  press('t-fire', () => { G.mouse.l = true; }, () => { G.mouse.l = false; });
  press('t-jump', () => { G.keys.Space = true; }, () => { G.keys.Space = false; });
  tap('t-aim', () => { G.mouse.r = !G.mouse.r; btn('t-aim').classList.toggle('active', G.mouse.r); });
  tap('t-crouch', () => { G.crouch = !G.crouch; btn('t-crouch').classList.toggle('active', G.crouch); });
  tap('t-pick', () => key('KeyE')); tap('t-reload', () => key('KeyR'));
  tap('t-ally', () => key($('ally-prompt').classList.contains('hidden') ? 'KeyT' : 'KeyY')); tap('t-no', () => key('KeyN'));
  tap('t-inv', () => G.toggleInv());
  tap('t-menu', () => { G.mouse.l = G.mouse.r = false; G.locked = false; G.showPause(true); });

  /* the game reads G.joy / G.touch in its input loop; keep button state in sync with it */
  G.syncTouch = function () {
    btn('t-aim').classList.toggle('active', !!G.mouse.r); btn('t-crouch').classList.toggle('active', !!G.crouch);
    const prompt = !$('ally-prompt').classList.contains('hidden'); btn('t-no').style.display = prompt ? '' : 'none'; btn('t-ally').textContent = prompt ? 'ACCEPT' : 'ALLY';
    const held = G.inv && G.inv.s[G.inv.sel], wd = held && C.WEAPONS[held[0]]; btn('t-reload').style.display = wd && wd.type === 'ranged' ? '' : 'none';
    btn('t-fire').textContent = wd && wd.type === 'ranged' ? 'SHOOT' : wd && wd.throw && G.mouse.r ? 'THROW' : held && !wd ? 'USE' : 'ATTACK';
  };

  /* ---- keep overlay visibility in sync each frame */
  function loop() {
    root.classList.toggle('hidden', !(G.active && !G.ended)); root.classList.toggle('inv', !!G.invOpen);
    document.body.classList.toggle('in-match', !!G.active);
    if (G.active) { if (!G.dead) G.syncTouch(); root.classList.toggle('dead', !!G.dead); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---- inventory: tap to select; USE / MOVE / DROP bar replaces drag-and-drop and right-click */
  G.moveFrom = -1;
  const baseRender = UI.renderInventory;
  UI.renderInventory = function () {
    baseRender.apply(UI, arguments); const grid = $('inv-grid'); if (!grid) return;
    if (!$('inv-touchbar')) {
      const bar = document.createElement('div'); bar.id = 'inv-touchbar';
      bar.innerHTML = '<button class="btn small" id="it-use">USE / EQUIP</button><button class="btn small" id="it-move">MOVE…</button><button class="btn small danger" id="it-drop">DROP</button>';
      grid.parentNode.insertBefore(bar, grid.nextSibling);
      $('it-use').onclick = () => { const el = grid.children[G.inv.sel]; if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); };
      $('it-move').onclick = () => { G.moveFrom = G.inv.sel; $('it-move').classList.add('on'); $('it-move').textContent = 'TAP DESTINATION'; };
      $('it-drop').onclick = () => { if (G.inv.s[G.inv.sel]) G.act('drop', { i: G.inv.sel, n: 0 }); };
    }
    $('it-move').classList.toggle('on', G.moveFrom >= 0); $('it-move').textContent = G.moveFrom >= 0 ? 'TAP DESTINATION' : 'MOVE…';
    $('inv-info').textContent = 'Tap a slot to select it · USE equips or consumes · MOVE swaps slots · DROP discards';
    for (const el of grid.children) el.draggable = false;
  };
  document.addEventListener('click', e => {
    if (G.moveFrom < 0) return; const slot = e.target.closest && e.target.closest('#inv-grid .slot'); if (!slot) return;
    e.stopPropagation(); e.preventDefault(); const to = +slot.dataset.i; if (to !== G.moveFrom) G.act('move', { a: G.moveFrom, b: to }); G.moveFrom = -1;
  }, true);

  $('minimap').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); G.bigMap = !G.bigMap; }, { passive: false });

  /* ---- hotbar: tap a slot to equip it */
  $('hotbar').addEventListener('touchstart', e => { const s = e.target.closest('.slot'); if (!s) return; e.preventDefault(); e.stopPropagation(); const i = Array.prototype.indexOf.call($('hotbar').children, s); if (i >= 0) G.act('sel', { i }); }, { passive: false });

  /* ---- pause menu extras: emote, break alliance, fullscreen */
  const panel = document.querySelector('#pause .panel');
  const extra = document.createElement('div'); extra.className = 'row'; extra.style.cssText = 'margin:8px 0;gap:8px';
  extra.innerHTML = '<button class="btn small grow" id="tp-emote">EMOTE</button><button class="btn small grow" id="tp-break">BREAK ALLIANCE</button><button class="btn small grow" id="tp-fs">FULLSCREEN</button>';
  panel.insertBefore(extra, $('p-resume').nextSibling);
  $('tp-emote').onclick = () => { key('KeyG'); G.capture(); }; $('tp-break').onclick = () => { key('KeyB'); G.capture(); };
  const goFull = () => { try { const el = document.documentElement; const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen(); if (p && p.then) p.then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => { }); }).catch(() => { }); } catch (e) { /* */ } };
  $('tp-fs').onclick = () => { goFull(); G.capture(); };
  G.goFullscreen = goFull;
  addEventListener('contextmenu', e => { if (G.active) e.preventDefault(); });
  document.addEventListener('gesturestart', e => e.preventDefault());
})();
