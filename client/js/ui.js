/* UI core: session/auth, main menu, matchmaking + lobby, pre-match supplies shop, settings, in-match inventory & crafting, results.
   (Customisation, campaign and profile screens live in screens.js.) */
(function () {
  const C = HG.C, E = HG.E, Net = HG.Net, G = HG.Game;
  const $ = id => document.getElementById(id), esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const qa = (sel, root) => [...(root || $('ui')).querySelectorAll(sel)], q = (sel, root) => (root || $('ui')).querySelector(sel);
  const S = { profile: null, user: '', guest: false, offline: false, room: null, online: 0, screen: '', opts: { mode: 'solo', tier: 'free', ranked: false, difficulty: 'normal', bots: 7, max: 12 }, practice: { difficulty: 'normal', bots: 7 }, lo: { adv: [], dis: [], wclass: 'blade' }, last: null, endInfo: null, resultShown: false, inMatch: false };
  const UI = HG.UI = { S, $, q, qa, esc };
  const sfx = n => HG.Audio.play(n);
  const num = n => Number(n || 0).toLocaleString();

  UI.screen = function (html, cls, name) { S.screen = name || ''; const u = $('ui'); u.innerHTML = '<section class="screen ' + (cls || '') + '">' + html + '</section>'; u.firstChild.scrollTop = 0; return u.firstChild; };
  UI.click = function (sel, fn, root) { qa(sel, root).forEach(b => { b.onclick = ev => { sfx('click'); fn(b, ev); }; }); };
  UI.toast = function (t, bad) { const d = document.createElement('div'); d.textContent = t; if (bad) d.className = 'bad'; $('toast-global').appendChild(d); setTimeout(() => d.remove(), 3800); };
  UI.modal = function (html, wide) { $('modal-box').innerHTML = html; $('modal-box').style.maxWidth = wide ? 'min(1100px,96vw)' : '520px'; $('modal').classList.remove('hidden'); };
  UI.closeModal = function () { $('modal').classList.add('hidden'); };
  const top = (back) => '<div class="topbar">' + (back ? '<button class="btn small" id="back">← BACK</button>' : '') + '<span class="grow"></span>' + userCard() + '</div>';
  function userCard() {
    const p = S.profile; if (!p) return '';
    return '<div class="card"><div><b>' + esc(S.user) + '</b>' + (S.guest ? ' <span class="tag">GUEST</span>' : '') + '<br><small style="color:var(--dim)">' + esc(p.title || 'Tribute') + ' · Lv ' + (p.level || 1) + '</small>' + (p.need ? '<div class="lvbar"><div style="width:' + Math.round(p.into / p.need * 100) + '%"></div></div>' : '') + '</div><div class="cred">' + num(p.credits) + '</div></div>';
  }
  UI.top = top; UI.userCard = userCard;
  UI.refreshTop = () => { const t = q('.topbar .card'); if (t) t.outerHTML = userCard(); };

  /* ------------------------------------------------------------ session */
  Net.on('open', () => { S.connected = true; let tok = null; try { tok = localStorage.getItem('hg_token'); } catch (e) { /* */ } if (S.user && S.profile && !S.offline) { return; } if (tok) Net.send({ t: 'resume', token: tok }); else UI.authScreen(); });
  Net.on('closed', () => { S.connected = false; if (!S.inMatch) UI.toast('Disconnected from server — reconnecting…', true); });
  Net.on('unreachable', () => { if (!S.profile && S.screen === 'auth') { const e = q('#auth-err'); if (e) e.textContent = 'Cannot reach the game server. You can still play offline.'; const b = q('#offline-btn'); if (b) b.classList.remove('hidden'); } });
  Net.on('hello', m => { S.online = m.online; });
  Net.on('online', m => { S.online = m.n; const el = q('#online-n'); if (el) el.textContent = m.n + ' online · ' + m.m + ' in matches'; });
  Net.on('authed', m => {
    S.profile = m.p; S.user = m.user; S.guest = !!m.guest; S.offline = false; S.online = m.online || S.online; try { if (m.token) localStorage.setItem('hg_token', m.token); } catch (e) { /* */ }
    S.lo = Object.assign({ adv: [], dis: [], wclass: 'blade' }, m.p.loadout || {}); if (!S.inMatch) UI.menu();
  });
  Net.on('autherr', m => { if (m.silent) { try { localStorage.removeItem('hg_token'); } catch (e) { /* */ } if (!S.profile) UI.authScreen(); return; } const e = q('#auth-err'); if (e) e.textContent = m.m; else UI.toast(m.m, true); });
  Net.on('me', m => { S.profile = m.p; S.guest = !!m.guest; if (m.p.loadout) S.lo = Object.assign({ adv: [], dis: [], wclass: 'blade' }, m.p.loadout); UI.refreshTop(); if (UI.onProfile) UI.onProfile(); });
  Net.on('err', m => UI.toast(m.m, true));
  Net.on('kicked', m => { UI.toast(m.m, true); S.profile = null; try { localStorage.removeItem('hg_token'); } catch (e) { /* */ } });
  Net.on('aborted', m => { UI.toast(m.m, true); toMenu(); });
  Net.on('left', () => toMenu());
  Net.on('welcome', m => { S.inMatch = true; S.endInfo = null; S.resultShown = false; UI.closeModal(); G.start(m); });
  Net.on('room', m => { S.room = m.r; if (!S.inMatch) UI.lobby(); });
  Net.on('chat', m => { const c = q('#chat'); if (c) { c.insertAdjacentHTML('beforeend', '<div><b>' + esc(m.n) + ':</b> ' + esc(m.m) + '</div>'); c.scrollTop = 1e6; } });
  Net.on('result', m => UI.showResult(m));
  Net.on('shop', m => { if (m.ok) { sfx('pickup'); UI.toast('Unlocked!'); } else UI.toast(m.error || 'Purchase failed', true); if (UI.onShop) UI.onShop(m); });

  function toMenu() {
    S.inMatch = false; S.room = null; G.stop(); G.backdrop(true); UI.closeModal(); $('cine').classList.add('hidden'); HG.Audio.startMusic('menu'); Net.send({ t: 'to_menu' }); if (S.offline) UI.offlineMenu(); else UI.menu();
  }
  UI.toMenu = toMenu;

  UI.authScreen = function (mode) {
    mode = mode || 'login'; S.profile = null;
    UI.screen('<h1 class="logo">THE ASHEN CROWN</h1><div class="sub">A TRIBUTE BATTLE ROYALE</div><div class="panel narrow"><div class="tabs"><button class="btn small ' + (mode === 'login' ? 'on' : '') + '" id="t-login">SIGN IN</button><button class="btn small ' + (mode === 'register' ? 'on' : '') + '" id="t-reg">CREATE ACCOUNT</button></div>' +
      '<input type="text" id="a-user" placeholder="Tribute name (3–16 letters, numbers, _)" maxlength="16" autocomplete="username"><input type="password" id="a-pass" placeholder="Password (6+ characters)" autocomplete="' + (mode === 'login' ? 'current-password' : 'new-password') + '">' +
      '<button class="btn primary" id="a-go">' + (mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT') + '</button><button class="btn" id="a-guest">PLAY AS GUEST</button><button class="btn hidden" id="offline-btn">PLAY OFFLINE (NO SERVER)</button><p class="err" id="auth-err" style="min-height:20px"></p>' +
      '<p class="hint" style="color:var(--dim);font-size:12px">Accounts save your credits, cosmetics, campaign and stats on the server. Guests can play but progress is not saved. Credits cannot be bought — they are only earned in play.</p></div>', 'center', 'auth');
    q('#t-login').onclick = () => UI.authScreen('login'); q('#t-reg').onclick = () => UI.authScreen('register');
    const go = () => { HG.Audio.init(); Net.send({ t: mode === 'login' ? 'login' : 'register', user: q('#a-user').value.trim(), pass: q('#a-pass').value }); };
    q('#a-go').onclick = go; q('#a-pass').onkeydown = e => { if (e.key === 'Enter') go(); }; q('#a-guest').onclick = () => { HG.Audio.init(); Net.send({ t: 'guest' }); };
    q('#offline-btn').onclick = () => { S.offline = true; S.user = 'You'; S.profile = { credits: 0, level: 1, appearance: E.DEFAULT_APPEARANCE, title: 'Tribute' }; UI.offlineMenu(); };
    if (!Net.connected) { q('#auth-err').textContent = 'Connecting to server…'; if (location.protocol === 'file:') { q('#auth-err').textContent = 'Open the game through the server (npm start) for online play. Offline play is available.'; q('#offline-btn').classList.remove('hidden'); } }
    G.backdrop(true);
  };
  Net.on('open', () => { const e = q('#auth-err'); if (e && S.screen === 'auth') e.textContent = ''; });

  /* ------------------------------------------------------------ main menu */
  UI.menu = function () {
    const p = S.profile, ch = p && p.challenges; const open = ch ? ch.daily.filter(c => !c.done).slice(0, 3) : [];
    UI.screen(top() + '<div class="menu-col"><h1 class="logo" style="font-size:30px;letter-spacing:.25em">THE ASHEN CROWN</h1><div class="sub" style="font-size:10px;margin-bottom:16px">TRIBUTE BATTLE ROYALE</div>' +
      '<button class="btn primary" data-go="play">PLAY</button><button class="btn" data-go="multi">MULTIPLAYER</button><button class="btn" data-go="create">CREATE GAME</button><button class="btn" data-go="join">JOIN GAME</button>' +
      '<button class="btn" data-go="campaign">CAMPAIGN</button><button class="btn" data-go="prepare">SUPPLIES &amp; LOADOUT</button><button class="btn" data-go="custom">CHARACTER</button><button class="btn" data-go="profile">PROFILE &amp; CHALLENGES</button>' +
      '<button class="btn" data-go="settings">SETTINGS</button><button class="btn danger" data-go="logout">SIGN OUT</button></div>' +
      '<div class="news"><b>DAILY CHALLENGES</b>' + (open.length ? open.map(c => '<div style="margin-top:6px">' + esc(c.desc) + ' <span class="cred">' + c.credits + '</span><div class="prog"><div style="width:' + Math.round(c.progress / c.target * 100) + '%"></div></div></div>').join('') : '<div style="margin-top:6px;color:var(--dim)">' + (S.guest ? 'Create an account to track challenges.' : 'All daily challenges complete — come back tomorrow.') + '</div>') +
      '<div style="margin-top:10px;color:var(--dim);font-size:12px" id="online-n">' + S.online + ' online</div></div>', '', 'menu');
    UI.click('[data-go]', b => { const g = b.dataset.go; if (g === 'logout') { Net.send({ t: 'logout', token: (() => { try { return localStorage.getItem('hg_token'); } catch (e) { return null; } })() }); try { localStorage.removeItem('hg_token'); } catch (e) { /* */ } S.profile = null; UI.authScreen(); } else UI[g] && UI[g](); });
    G.backdrop(true); HG.Audio.startMusic('menu');
  };
  UI.offlineMenu = function () {
    UI.screen('<div class="menu-col"><h1 class="logo" style="font-size:30px;letter-spacing:.25em">THE ASHEN CROWN</h1><div class="sub" style="font-size:10px">OFFLINE MODE</div><button class="btn primary" data-go="play">PRACTICE VS AI</button><button class="btn" data-go="settings">SETTINGS</button><button class="btn" id="retry">RETRY SERVER CONNECTION</button></div>', '', 'menu');
    UI.click('[data-go]', b => UI[b.dataset.go]()); q('#retry').onclick = () => { S.offline = false; S.profile = null; if (Net.connected) { let tok = null; try { tok = localStorage.getItem('hg_token'); } catch (e) { /* */ } tok ? Net.send({ t: 'resume', token: tok }) : UI.authScreen(); } else UI.authScreen(); };
  };
  const back = () => { const b = q('#back'); if (b) b.onclick = () => { sfx('click'); S.offline ? UI.offlineMenu() : UI.menu(); }; };
  UI.back = back;

  /* ------------------------------------------------------------ PLAY (offline practice + shortcuts) */
  const diffOpts = sel => Object.values(C.DIFFICULTY).map(d => '<option value="' + d.id + '"' + (d.id === sel ? ' selected' : '') + '>' + d.name + ' — rewards ×' + d.rewardMul + '</option>').join('');
  UI.play = function () {
    const pr = S.practice;
    UI.screen((S.offline ? '' : top(true)) + '<div class="panel" style="margin:auto"><h2>PLAY</h2><div class="grid g2" style="gap:18px">' +
      '<div class="chap"><h3>PRACTICE vs AI <span class="tag">OFFLINE</span></h3><p>Learn the mechanics against AI tributes, fully in your browser. No stake, no risk. Practice pays no credits (only a little XP when signed in online).</p>' +
      '<label>AI difficulty</label><select id="pr-diff">' + diffOpts(pr.difficulty) + '</select><label style="display:block;margin-top:8px">AI tributes: <b id="pr-n">' + pr.bots + '</b></label><input type="range" id="pr-bots" min="3" max="23" value="' + pr.bots + '"><button class="btn primary" id="pr-go">START PRACTICE MATCH</button></div>' +
      (S.offline ? '' : '<div class="chap"><h3>QUICK MATCH <span class="tag">ONLINE</span></h3><p>Jump into a free Beginner match with other tributes. Empty slots are filled with AI so a match always starts.</p><label>AI fill difficulty</label><select id="qm-diff">' + diffOpts('normal') + '</select><button class="btn primary" id="qm-go">FIND FREE MATCH</button><button class="btn" id="qm-more">ALL MULTIPLAYER OPTIONS</button><button class="btn" id="qm-camp">CONTINUE CAMPAIGN</button></div>') + '</div></div>', '', 'play');
    back(); q('#pr-bots').oninput = e => { S.practice.bots = +e.target.value; q('#pr-n').textContent = e.target.value; }; q('#pr-diff').onchange = e => { S.practice.difficulty = e.target.value; };
    q('#pr-go').onclick = () => { sfx('click'); UI.startOffline(); };
    if (!S.offline) { q('#qm-go').onclick = () => { S.opts = Object.assign(S.opts, { mode: 'solo', tier: 'free', ranked: false, difficulty: q('#qm-diff').value }); UI.findMatch(); }; q('#qm-more').onclick = () => UI.multi(); q('#qm-camp').onclick = () => UI.campaign(); }
  };
  UI.startOffline = function () {
    HG.Audio.init(); S.last = { type: 'offline' }; S.inMatch = true; $('ui').innerHTML = '';
    HG.Local.start({ difficulty: S.practice.difficulty, bots: S.practice.bots, name: S.user || 'You', appearance: (S.profile && S.profile.appearance) || E.DEFAULT_APPEARANCE });
  };
  UI.onMatchStart = function (msg) { $('ui').innerHTML = ''; S.screen = 'match'; if (msg.entry && msg.entry.stake) UI.toast('Entry stake paid: ' + msg.entry.stake + ' credits', false); if (msg.perks && (msg.perks.adv.length || msg.perks.dis.length)) UI.toast('Supplies loaded: ' + msg.perks.adv.length + ' advantage(s), ' + msg.perks.dis.length + ' disadvantage(s)'); };

  /* ------------------------------------------------------------ multiplayer / create / join / lobby */
  function perkSummary() { const adv = S.lo.adv.reduce((n, id) => n + (E.PERKS[id] ? E.PERKS[id].price : 0), 0), dis = S.lo.dis.reduce((n, id) => n + (E.PERKS[id] ? E.PERKS[id].bonus : 0), 0); return { adv, dis }; }
  function tierCards(sel, ranked) {
    const ps = perkSummary(), cost = ranked ? 0 : ps.adv;
    return Object.values(E.TIERS).map(t => { const tm = t.rewardMul; const can = (S.profile.credits >= t.stake) || t.stake === 0;
      return '<div class="item r-' + (t.id === 'high' ? 'epic' : t.id === 'low' ? 'rare' : 'common') + (sel === t.id ? ' sel' : '') + (can ? '' : ' lock') + '" data-tier="' + t.id + '"><div class="nm">' + t.name + '</div><div class="ds">' + t.desc + '</div><div style="margin-top:6px;font-size:12px">Entry <b class="cred">' + t.stake + '</b><br>1st ≈ <b class="cred">' + Math.round(500 * tm) + '</b> · 2nd ≈ ' + Math.round(250 * tm) + ' · 3rd ≈ ' + Math.round(150 * tm) + '<br>+' + Math.round(25 * tm) + ' per elimination' + (can ? '' : '<br><span class="neg">Need ' + (t.stake - S.profile.credits) + ' more credits</span>') + '</div></div>'; }).join('') +
      (cost ? '<p style="grid-column:1/-1;font-size:12px;color:var(--dim)">Your loadout adds <b class="cred">' + cost + '</b> credits of supplies' + (ps.dis ? ' and grants <b class="cred">' + ps.dis + '</b> for accepted disadvantages' : '') + '.</p>' : '');
  }
  function modeBtns(sel) { return ['solo', 'duos', 'teams'].map(m => '<button class="btn small ' + (sel === m ? 'on' : '') + '" data-mode="' + m + '">' + C.MODES[m].name.toUpperCase() + '</button>').join(''); }
  function bindMatchOpts(rerender) {
    UI.click('[data-mode]', b => { S.opts.mode = b.dataset.mode; rerender(); }); UI.click('[data-tier]', b => { S.opts.tier = b.dataset.tier; rerender(); });
    const r = q('#o-ranked'); if (r) r.onchange = e => { S.opts.ranked = e.target.checked; rerender(); }; const d = q('#o-diff'); if (d) d.onchange = e => { S.opts.difficulty = e.target.value; };
  }
  UI.multi = function () {
    const o = S.opts; if (S.guest) o.tier = 'free';
    UI.screen(top(true) + '<div class="panel" style="margin:auto;width:min(900px,96vw)"><h2>MULTIPLAYER <small>public matchmaking · empty slots are filled with AI tributes</small></h2><div class="tabs">' + modeBtns(o.mode) + '</div>' +
      '<h3>ENTRY</h3><div class="grid g3">' + tierCards(o.tier, o.ranked) + '</div><div class="row" style="margin-top:12px"><label><input type="checkbox" id="o-ranked" ' + (o.ranked ? 'checked' : '') + '> Ranked <small style="color:var(--dim)">(standard equipment — supplies and disadvantages disabled)</small></label><span class="grow"></span><label>AI fill:</label><select id="o-diff" style="width:auto">' + diffOpts(o.difficulty) + '</select></div>' +
      '<button class="btn primary" id="go" style="margin-top:14px">FIND MATCH</button><p class="hint" style="color:var(--dim);font-size:12px">Beginner matches are always free. Credits are only charged when a match actually starts, and refunded if the server fails. Quitting forfeits your stake and adds a short matchmaking penalty. You can always earn credits in free matches.</p></div>', '', 'multi');
    back(); bindMatchOpts(UI.multi); q('#go').onclick = () => { sfx('click'); UI.findMatch(); };
  };
  UI.findMatch = function () { HG.Audio.init(); S.last = { type: 'queue', o: Object.assign({}, S.opts) }; Net.send({ t: 'queue', o: S.opts }); };
  UI.create = function () {
    const o = S.opts;
    UI.screen(top(true) + '<div class="panel" style="margin:auto;width:min(900px,96vw)"><h2>CREATE PRIVATE GAME <small>invite friends with a room code</small></h2><div class="tabs">' + ['solo', 'duos', 'teams', 'private'].map(m => '<button class="btn small ' + (o.mode === m ? 'on' : '') + '" data-mode="' + m + '">' + C.MODES[m].name.toUpperCase() + '</button>').join('') + '</div>' +
      '<h3>ENTRY</h3><div class="grid g3">' + tierCards(o.tier, o.ranked) + '</div><div class="grid g3" style="margin-top:12px"><div><label>AI tributes: <b id="b-n">' + o.bots + '</b></label><input type="range" id="o-bots" min="0" max="23" value="' + o.bots + '"></div><div><label>Max players: <b id="m-n">' + o.max + '</b></label><input type="range" id="o-max" min="2" max="24" value="' + o.max + '"></div><div><label>AI difficulty</label><select id="o-diff">' + diffOpts(o.difficulty) + '</select></div></div>' +
      '<label style="display:block;margin-top:8px"><input type="checkbox" id="o-ranked" ' + (o.ranked ? 'checked' : '') + '> Ranked (standard equipment)</label><button class="btn primary" id="go" style="margin-top:14px">CREATE ROOM</button></div>', '', 'create');
    back(); bindMatchOpts(UI.create); q('#o-bots').oninput = e => { S.opts.bots = +e.target.value; q('#b-n').textContent = e.target.value; }; q('#o-max').oninput = e => { S.opts.max = +e.target.value; q('#m-n').textContent = e.target.value; };
    q('#go').onclick = () => { sfx('click'); HG.Audio.init(); S.last = { type: 'room' }; Net.send({ t: 'create', o: S.opts }); };
  };
  UI.join = function () {
    UI.screen(top(true) + '<div class="panel narrow" style="margin:auto"><h2>JOIN GAME</h2><p style="color:var(--dim);margin-bottom:8px">Enter the room code from your friend.</p><input type="text" id="code" maxlength="8" placeholder="ROOM CODE" style="text-align:center;font-size:26px;letter-spacing:.3em;text-transform:uppercase"><button class="btn primary" id="go">JOIN</button></div>', '', 'join');
    back(); const go = () => { HG.Audio.init(); S.last = { type: 'room' }; Net.send({ t: 'join', code: q('#code').value.trim().toUpperCase() }); }; q('#go').onclick = go; q('#code').onkeydown = e => { if (e.key === 'Enter') go(); }; q('#code').focus();
  };
  UI.lobby = function () {
    const r = S.room; if (!r) return; const host = r.host === S.user, t = E.TIERS[r.tier] || E.TIERS.free, mode = C.MODES[r.mode] || C.MODES.solo, hasChat = !r.pub;
    UI.screen(top() + '<div class="panel" style="margin:auto;width:min(760px,96vw)"><h2>' + (r.pub ? 'MATCHMAKING' : 'PRIVATE LOBBY') + ' <small>' + mode.name + ' · ' + t.name + (r.ranked ? ' · Ranked' : '') + ' · AI ' + (C.DIFFICULTY[r.difficulty] || {}).name + '</small></h2>' +
      (r.pub ? '<div class="res-big" style="font-size:44px">' + (r.startIn ? r.startIn : '…') + '</div><p style="text-align:center;color:var(--dim)">seconds until start · ' + r.members.length + ' tribute(s) waiting · AI fills the remaining slots</p>' : '<div class="lobby-code">' + esc(r.code) + '</div><p style="text-align:center;color:var(--dim)">Share this code. Friends use JOIN GAME.</p>') +
      '<div style="margin:10px 0">' + r.members.map(m => '<div class="member"><span>' + esc(m.name) + (m.host ? ' <span class="tag">HOST</span>' : '') + '</span><span style="color:var(--dim)">' + esc(m.title) + ' · Lv ' + m.level + '</span></div>').join('') + (r.bots ? '<div class="member"><span style="color:var(--dim)">+ ' + r.bots + ' AI tribute(s)</span></div>' : '') + '</div>' +
      (host && !r.pub ? '<div class="row"><select id="l-mode" style="width:auto">' + ['solo', 'duos', 'teams', 'private'].map(m => '<option value="' + m + '"' + (r.mode === m ? ' selected' : '') + '>' + C.MODES[m].name + '</option>').join('') + '</select><select id="l-tier" style="width:auto">' + Object.values(E.TIERS).map(x => '<option value="' + x.id + '"' + (r.tier === x.id ? ' selected' : '') + '>' + x.name + ' (' + x.stake + ')</option>').join('') + '</select><select id="l-diff" style="width:auto">' + diffOpts(r.difficulty) + '</select><label>AI <input type="number" id="l-bots" min="0" max="23" value="' + r.bots + '" style="width:64px"></label><label>Max <input type="number" id="l-max" min="2" max="24" value="' + r.max + '" style="width:64px"></label></div>' : '') +
      (hasChat ? '<div class="chat" id="chat"></div><div class="row"><input type="text" id="chat-in" placeholder="Message…" maxlength="140" class="grow"><button class="btn small" id="chat-go">SEND</button></div>' : '') +
      (t.stake ? '<p style="color:var(--dim);font-size:12px">Entry stake <b class="cred">' + t.stake + '</b> is charged when the match starts. ' + (S.lo.adv.length && !r.ranked ? 'Supplies from your loadout will also be charged.' : '') + '</p>' : '') +
      '<div class="row">' + (host && !r.pub ? '<button class="btn primary grow" id="start">START MATCH</button>' : '') + '<button class="btn danger grow" id="leave">LEAVE</button></div></div>', '', 'lobby');
    q('#leave').onclick = () => { sfx('click'); Net.send({ t: 'leave_room' }); S.room = null; UI.menu(); };
    if (q('#start')) q('#start').onclick = () => { sfx('click'); HG.Audio.init(); Net.send({ t: 'start' }); };
    const setO = () => Net.send({ t: 'room_set', o: { mode: q('#l-mode').value, tier: q('#l-tier').value, difficulty: q('#l-diff').value, bots: +q('#l-bots').value, max: +q('#l-max').value } });
    ['#l-mode', '#l-tier', '#l-diff', '#l-bots', '#l-max'].forEach(s => { const e = q(s); if (e) e.onchange = setO; });
    if (hasChat) { const send = () => { const i = q('#chat-in'); if (i.value.trim()) Net.send({ t: 'chat', m: i.value }); i.value = ''; }; q('#chat-go').onclick = send; q('#chat-in').onkeydown = e => { if (e.key === 'Enter') send(); }; }
  };

  /* ------------------------------------------------------------ supplies (pre-game shop) */
  UI.prepare = function () {
    const lo = S.lo, ps = perkSummary(), classes = [...new Set(Object.values(C.WEAPON_CLASS))].filter(x => x !== 'melee');
    const card = pk => { const on = (pk.kind === 'adv' ? lo.adv : lo.dis).includes(pk.id); return '<div class="item ' + (on ? 'sel r-rare' : '') + '" data-perk="' + pk.id + '"><div class="nm">' + pk.name + '</div><div class="ds">' + pk.desc + '</div><div style="margin-top:6px">' + (pk.kind === 'adv' ? 'Cost <b class="cred">' + pk.price + '</b>' : 'Reward <b class="cred">+' + pk.bonus + '</b>') + '</div></div>'; };
    UI.screen(top(true) + '<div class="panel" style="margin:auto;width:min(1000px,96vw)"><h2>SUPPLIES &amp; LOADOUT <small>match-specific · never permanent · not available in ranked</small></h2><p style="color:var(--dim);font-size:13px;margin-bottom:8px">Everyone gets basic survival gear. Advantages cost credits and last one match; none add raw damage. Disadvantages pay a credit reward if you accept them (the bonus shrinks if you die early). Charged only when a match starts.</p>' +
      '<h3>ADVANTAGES (max ' + E.MAX_ADV + ') — <span class="cred">' + ps.adv + '</span></h3><div class="grid g4">' + Object.values(E.PERKS).filter(p => p.kind === 'adv').map(card).join('') + '</div>' +
      (lo.adv.includes('weapon_training') ? '<div class="row" style="margin-top:8px"><label>Weapon Training class:</label><select id="wclass" style="width:auto">' + classes.map(c => '<option' + (lo.wclass === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' : '') +
      '<h3>DISADVANTAGES (max ' + E.MAX_DIS + ') — reward <span class="cred">+' + ps.dis + '</span></h3><div class="grid g3">' + Object.values(E.PERKS).filter(p => p.kind === 'dis').map(card).join('') + '</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn small" id="clear">CLEAR ALL</button><span class="grow"></span><span>Total per match: <b class="cred">' + ps.adv + '</b> cost · <b class="cred">+' + ps.dis + '</b> bonus</span></div></div>', '', 'prepare');
    back(); UI.click('[data-perk]', b => { const pk = E.PERKS[b.dataset.perk], list = pk.kind === 'adv' ? lo.adv : lo.dis, max = pk.kind === 'adv' ? E.MAX_ADV : E.MAX_DIS, i = list.indexOf(pk.id); if (i >= 0) list.splice(i, 1); else if (list.length < max) list.push(pk.id); else UI.toast('Limit reached (' + max + ')', true); saveLo(); UI.prepare(); });
    q('#clear').onclick = () => { lo.adv = []; lo.dis = []; saveLo(); UI.prepare(); }; if (q('#wclass')) q('#wclass').onchange = e => { lo.wclass = e.target.value; saveLo(); };
  };
  function saveLo() { Net.send({ t: 'loadout', l: S.lo }); }

  /* ------------------------------------------------------------ settings */
  UI.settings = function () {
    const s = G.settings;
    UI.screen((S.offline ? '' : top(true)) + '<div class="panel" style="margin:auto;width:min(760px,96vw)"><h2>SETTINGS</h2><div class="set-row"><label>Mouse sensitivity (' + s.sens.toFixed(2) + ')</label><input type="range" id="s-sens" min="0.2" max="3" step="0.05" value="' + s.sens + '"></div><div class="set-row"><label>Master volume</label><input type="range" id="s-vol" min="0" max="1" step="0.05" value="' + s.vol + '"></div>' +
      '<div class="set-row"><label>Graphics quality</label><select id="s-q"><option value="low"' + (s.quality === 'low' ? ' selected' : '') + '>Low (no shadows, shorter grass)</option><option value="medium"' + (s.quality === 'medium' ? ' selected' : '') + '>Medium</option><option value="high"' + (s.quality === 'high' ? ' selected' : '') + '>High</option></select></div>' +
      (S.offline ? '' : '<div class="set-row"><button class="btn small" id="s-logout-all">Sign out</button></div>') +
      '<h3>CONTROLS</h3><div class="grid g3" style="font-size:13px;color:var(--dim)"><div><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>C</b> crouch</div><div><b>LMB</b> attack/use · <b>RMB</b> aim (+LMB throws a held blade/axe/spear) · <b>R</b> reload</div><div><b>E</b> pick up / drink · <b>Tab</b> inventory · <b>1-9</b>/wheel select · <b>Q</b> drop</div><div><b>T</b> propose alliance · <b>Y/N</b> accept/decline · <b>B</b> break alliance</div><div><b>G</b> emote · <b>M</b> bigger minimap · <b>Esc</b> menu</div></div></div>', '', 'settings');
    back(); q('#s-sens').oninput = e => { s.sens = +e.target.value; G.saveSettings(); }; q('#s-vol').oninput = e => { s.vol = +e.target.value; HG.Audio.setVolumes({ master: s.vol }); G.saveSettings(); }; q('#s-q').onchange = e => { s.quality = e.target.value; G.R.setQuality(s.quality); G.saveSettings(); };
    const lg = q('#s-logout-all'); if (lg) lg.onclick = () => { try { localStorage.removeItem('hg_token'); } catch (e) { /* */ } Net.send({ t: 'logout' }); S.profile = null; UI.authScreen(); };
  };

  /* ------------------------------------------------------------ leave confirmation */
  UI.confirmLeave = function () {
    const st = G.state(); const warn = !G.local && !st.dead && !st.ended && st.phase === 'live' && G.mode !== 'campaign' && G.mode !== 'practice';
    UI.modal('<h2>LEAVE MATCH?</h2><p>' + (warn ? 'Leaving a live match forfeits your entry stake and adds a short matchmaking penalty.' : 'You will return to the main menu.') + '</p><div class="row"><button class="btn danger grow" id="m-yes">LEAVE</button><button class="btn grow" id="m-no">STAY</button></div>');
    $('m-yes').onclick = () => { UI.closeModal(); G.leave(); setTimeout(() => { if (S.inMatch && !G.local) toMenu(); }, 1500); }; $('m-no').onclick = () => { UI.closeModal(); G.capture(); };
  };

  /* ------------------------------------------------------------ inventory & crafting */
  UI.renderInventory = function () {
    const inv = G.inv, grid = $('inv-grid'); grid.innerHTML = ''; let dragFrom = -1;
    for (let i = 0; i < inv.cap; i++) {
      const s = inv.s[i], el = document.createElement('div'), d = s && C.ITEMS[s[0]]; el.className = 'slot' + (i === inv.sel ? ' sel' : ''); el.draggable = !!s; el.dataset.i = i;
      el.innerHTML = '<small>' + (i < 9 ? i + 1 : '') + '</small>' + (s ? (d.icon || '?') + (s[1] > 1 ? '<em>' + s[1] + '</em>' : '') + (d.dur ? '<i style="width:' + Math.min(100, s[2] / d.dur * 100) + '%"></i>' : '') + '<span class="nm">' + d.name + '</span>' : '');
      if (s) el.title = d.name + (C.WEAPONS[s[0]] ? ' — dmg ' + C.WEAPONS[s[0]].dmg + ', range ' + (C.WEAPONS[s[0]].range || 'ranged') + ', durability ' + s[2] : d.hunger || d.thirst || d.heal ? ' — ' + [d.hunger && '+' + d.hunger + ' food', d.thirst && '+' + d.thirst + ' water', d.heal && '+' + d.heal + ' HP'].filter(Boolean).join(', ') : d.red ? ' — ' + Math.round(d.red * 100) + '% damage reduction' : '');
      el.ondragstart = e => { dragFrom = i; e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; }; el.ondragover = e => { e.preventDefault(); el.classList.add('over'); }; el.ondragleave = () => el.classList.remove('over');
      el.ondrop = e => { e.preventDefault(); el.classList.remove('over'); const a = dragFrom >= 0 ? dragFrom : +e.dataTransfer.getData('text/plain'); if (a !== i) G.act('move', { a, b: i }); dragFrom = -1; };
      el.onclick = () => G.act('sel', { i }); el.oncontextmenu = e => { e.preventDefault(); if (s) G.act('drop', { i, n: 0 }); };
      el.ondblclick = () => { if (!s) return; if (d.type === 'armor') G.act('armor', { i }); else { G.act('sel', { i }); if (['food', 'water', 'med', 'trap'].includes(d.type)) { G.useUntil = performance.now() + 3500; sfx('click'); } } };
      grid.appendChild(el);
    }
    $('inv').ondragover = e => e.preventDefault(); $('inv').ondrop = e => { if (e.target === $('inv') && dragFrom >= 0) { G.act('drop', { i: dragFrom, n: 0 }); dragFrom = -1; } };
    const ar = $('inv-armor'), a = inv.arm, ad = a && C.ITEMS[a[0]]; ar.innerHTML = '<div class="slot" id="arm-slot" title="Equipped armour — click to unequip">' + (a ? ad.icon + '<em>' + a[1] + '</em><span class="nm">' + ad.name + '</span>' : '<small>ARMOUR</small>') + '</div><span style="color:var(--dim);font-size:12px">' + (a ? '-' + Math.round(ad.red * 100) + '% damage taken. Double-click armour in your pack to equip.' : 'Double-click armour in your pack to equip it.') + '</span>';
    $('arm-slot').onclick = () => { if (a) G.act('armor', { i: -1 }); };
    const used = inv.s.filter(Boolean).length; $('inv-info').textContent = used + ' / ' + inv.cap + ' slots · drag to rearrange · drop outside the grid or right-click to discard';
    const cnt = id => inv.s.reduce((n, s) => n + (s && s[0] === id ? s[1] : 0), 0), cl = $('craft-list'); cl.innerHTML = '';
    for (const r of C.RECIPES) { const ok = Object.keys(r.needs).every(k => cnt(k) >= r.needs[k]), el = document.createElement('div'); el.className = 'recipe' + (ok ? '' : ' no'); el.innerHTML = '<div><b>' + r.name + '</b><small>' + Object.keys(r.needs).map(k => (C.ITEMS[k].icon || '') + ' ' + C.ITEMS[k].name + ' ' + Math.min(cnt(k), r.needs[k]) + '/' + r.needs[k]).join(' · ') + '</small></div><button class="btn small" ' + (ok ? '' : 'disabled') + '>CRAFT</button>'; el.querySelector('button').onclick = () => { sfx('click'); G.act('craft', { id: r.id }); }; cl.appendChild(el); }
  };

  /* ------------------------------------------------------------ results */
  UI.onDead = function () { };
  UI.onMatchEnd = function (e) { S.endInfo = e; if (S.resultShown) { UI.showStandings(e); } };
  UI.showStandings = function (e) {
    UI.modal('<h2>MATCH OVER</h2><div class="stat"><span>Victor</span><b>' + esc((e.st.find(s => s.pl === 1) || {}).n || '—') + '</b></div>' + standingsHtml(e) + '<div class="row"><button class="btn primary grow" id="m-menu">MAIN MENU</button></div>', false);
    $('m-menu').onclick = () => { UI.closeModal(); toMenu(); };
  };
  function standingsHtml(e) { return e && e.st ? '<div style="max-height:200px;overflow:auto;margin:8px 0">' + e.st.sort((a, b) => a.pl - b.pl).slice(0, 12).map(s => '<div class="stat"><span>#' + s.pl + ' ' + esc(s.n) + (s.b ? ' <span class="tag">AI</span>' : '') + '</span><b>' + s.k + ' elim</b></div>').join('') + '</div>' : ''; }
  UI.showResult = function (m) {
    S.resultShown = true; const r = m.r, win = r.placement === 1, e = S.endInfo, ended = m.matchEnded || (e && true);
    const lines = []; if (!m.local) { const er = r.earned || {}; if (er.placement) lines.push(['Placement reward', er.placement]); if (er.kills) lines.push(['Elimination bonus', er.kills]); if (er.hidden) lines.push(['Hidden locations', er.hidden]); if (er.bonus) lines.push(['Accepted disadvantages', er.bonus]); if (r.stake) lines.push(['Entry stake', -r.stake]); if (r.refund) lines.push(['Stake returned', r.refund]); }
    const fmt = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
    HG.Audio.stopMusic(); if (win) { HG.Audio.play('victory'); }
    UI.modal('<div class="res-big ' + (win ? 'win' : 'lose') + '">' + (win ? 'VICTORY' : 'ELIMINATED') + '</div><div class="stat"><span>Placement</span><b>#' + r.placement + ' of ' + r.total + '</b></div><div class="stat"><span>Eliminations</span><b>' + m.kills + '</b></div><div class="stat"><span>Survival time</span><b>' + fmt(m.survive) + '</b></div>' +
      lines.map(l => '<div class="stat"><span>' + l[0] + '</span><b class="' + (l[1] < 0 ? 'neg' : 'pos') + '">' + (l[1] > 0 ? '+' : '') + l[1] + '</b></div>').join('') +
      (!m.local ? '<div class="stat"><span>Net credits</span><b class="' + (r.net < 0 ? 'neg' : 'pos') + '">' + (r.net > 0 ? '+' : '') + r.net + '</b></div><div class="stat"><span>XP</span><b>+' + (r.xp || 0) + (r.levelUp ? ' · LEVEL UP → ' + r.level : '') + '</b></div>' : '') +
      (r.notes || []).map(n => '<p style="color:var(--dim);font-size:13px;margin:6px 0">' + esc(n) + '</p>').join('') +
      (r.challenges || []).map(c => '<div class="stat"><span>✔ Challenge: ' + esc(c.desc) + '</span><b class="pos">+' + c.credits + '</b></div>').join('') + (r.achievements || []).map(a => '<div class="stat"><span>🏆 Achievement: ' + esc(a.name || a) + '</span><b class="pos">+' + (a.credits || '') + '</b></div>').join('') +
      ((r.unlocked && r.unlocked.length) ? '<div class="stat"><span>New cosmetics unlocked</span><b>' + r.unlocked.map(id => esc((E.BY_ID[id] || {}).name || id)).join(', ') + '</b></div>' : '') + (e ? standingsHtml(e) : '') +
      '<div class="row" style="margin-top:12px">' + (ended ? '<button class="btn primary grow" id="m-again">PLAY AGAIN</button>' : '<button class="btn grow" id="m-spec">KEEP SPECTATING</button>') + '<button class="btn grow" id="m-menu">MAIN MENU</button></div>', false);
    $('m-menu').onclick = () => { UI.closeModal(); toMenu(); };
    if ($('m-spec')) $('m-spec').onclick = () => { UI.closeModal(); };
    if ($('m-again')) $('m-again').onclick = () => { UI.closeModal(); const l = S.last; toMenu(); setTimeout(() => { if (l && l.type === 'offline') UI.startOffline(); else if (l && l.type === 'queue') { S.opts = l.o; UI.findMatch(); } else if (!S.offline) UI.menu(); }, 250); };
  };
})();
