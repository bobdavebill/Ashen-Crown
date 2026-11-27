/* Screens: character customisation (with live 3D preview), campaign (story scenes, cutscenes, mission results, endings), profile / challenges / achievements / ledger. */
(function () {
  const C = HG.C, E = HG.E, K = HG.Camp, Net = HG.Net, UI = HG.UI, S = UI.S, G = HG.Game;
  const { $, q, qa, esc } = UI, T = THREE;
  const sfx = n => HG.Audio.play(n), num = n => Number(n || 0).toLocaleString();
  const fmtT = s => { s = Math.round(s || 0); return Math.floor(s / 3600) ? Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
  const ago = t => { const d = Math.max(0, Date.now() - t) / 1000; return d < 90 ? 'just now' : d < 5400 ? Math.round(d / 60) + ' min ago' : d < 129600 ? Math.round(d / 3600) + ' h ago' : Math.round(d / 86400) + ' d ago'; };
  const back = () => UI.back();
  const needAccount = what => { UI.screen(UI.top(true) + '<div class="panel narrow" style="margin:auto"><h2>' + what + '</h2><p style="color:var(--dim);margin:8px 0 14px">Guests cannot save progress. Sign out and create a free account to use this — credits can never be bought, only earned.</p></div>', '', 'need-account'); back(); };

  /* ================================================================== CHARACTER CUSTOMISATION */
  const GROUPS = [
    ['APPEARANCE', ['skin', 'hair', 'hairColor', 'eyes', 'face']],
    ['CLOTHING', ['outfit', 'jacket', 'pants', 'boots', 'gloves', 'armorSkin', 'backpack', 'mask']],
    ['ACCESSORIES', ['hat', 'scarf', 'weaponSkin', 'victory', 'emote', 'pose']],
  ];
  const SLOT_NAME = { skin: 'Skin', hair: 'Hairstyle', hairColor: 'Hair colour', eyes: 'Eye colour', face: 'Facial features', outfit: 'District outfit', jacket: 'Jacket', pants: 'Trousers', boots: 'Boots', gloves: 'Gloves', armorSkin: 'Armour look', backpack: 'Backpack', mask: 'Mask', hat: 'Hat', scarf: 'Scarf', weaponSkin: 'Weapon skin', victory: 'Victory animation', emote: 'Emote', pose: 'Pose' };
  const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const cs = { slot: 'skin', work: null, sel: null, av: null };
  let prev = null;     // persistent preview renderer {r, scene, cam, el, av}

  function unlockText(it) {
    const u = it.unlock;
    if (u.t === 'free') return 'Free';
    if (u.t === 'buy') return null;
    if (u.t === 'level') return 'Reach level ' + u.v;
    if (u.t === 'ach') { const a = E.ACHIEVEMENTS.find(x => x.id === u.v); return 'Achievement: ' + (a ? a.name : u.v); }
    if (u.t === 'camp') return 'Campaign reward';
    if (u.t === 'event') return (E.EVENT_WINDOWS[u.v] ? E.EVENT_WINDOWS[u.v].name : 'Seasonal') + ' event';
    return '';
  }
  const swatch = it => it.v && it.v.c ? '<div class="sw" style="background:' + (it.v.c2 ? 'linear-gradient(90deg,' + it.v.c + ' 50%,' + it.v.c2 + ' 50%)' : it.v.c) + '"></div>' : '';

  function ensurePreview(host) {
    if (!prev) {
      const el = document.createElement('canvas'); el.id = 'cust-prev';
      const r = new T.WebGLRenderer({ canvas: el, antialias: true, alpha: true }); r.outputColorSpace = T.SRGBColorSpace; r.setClearColor(0x000000, 0);
      const scene = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, 0.1, 50);
      scene.add(new T.HemisphereLight(0xdde6f5, 0x3a3226, 1.1)); const key = new T.DirectionalLight(0xffe8c2, 2.1); key.position.set(2.5, 4, 3); scene.add(key);
      const rim = new T.DirectionalLight(0x8fb4ff, 1.0); rim.position.set(-3, 2, -2.5); scene.add(rim);
      const floor = new T.Mesh(new T.CircleGeometry(1.1, 40), new T.MeshStandardMaterial({ color: 0x1a1812, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; scene.add(floor);
      prev = { r, scene, cam, el, av: null, rot: 0.4, drag: false, t: 0 };
      el.addEventListener('pointerdown', e => { prev.drag = true; prev.lx = e.clientX; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', e => { if (prev.drag) { prev.rot += (e.clientX - prev.lx) * 0.012; prev.lx = e.clientX; } });
      el.addEventListener('pointerup', () => { prev.drag = false; });
    }
    host.replaceWith(prev.el); prev.el.style.cssText = ''; prev.el.id = 'cust-prev';
    return prev;
  }
  function setPreviewAvatar(ap) {
    if (!prev) return;
    if (!prev.av) { prev.av = HG.Avatar.create(ap, {}); prev.scene.add(prev.av.root); prev.av.setWeapon('sword'); } else prev.av.setAppearance(ap);
    prev.av.setWeapon('sword');
  }
  function previewLoop() {
    if (!prev || !prev.el.isConnected || S.screen !== 'custom') { if (prev && prev.raf) { cancelAnimationFrame(prev.raf); prev.raf = 0; } return; }
    const rc = prev.el.getBoundingClientRect(), w = Math.max(10, rc.width | 0), h = Math.max(10, rc.height | 0), pr = Math.min(devicePixelRatio || 1, 2);
    if (prev.w !== w || prev.h !== h) { prev.w = w; prev.h = h; prev.r.setPixelRatio(pr); prev.r.setSize(w, h, false); prev.cam.aspect = w / h; prev.cam.updateProjectionMatrix(); }
    const now = performance.now(), dt = Math.min(0.05, (now - (prev.t || now)) / 1000); prev.t = now;
    if (!prev.drag && !cs.emoteHold) prev.rot += dt * 0.5;
    if (prev.av) { prev.av.root.rotation.y = prev.rot; prev.av.update(dt, { alive: true, speed: 0 }); }
    prev.cam.position.set(0, 1.25, 4.6); prev.cam.lookAt(0, 0.98, 0); prev.r.render(prev.scene, prev.cam);
    prev.raf = requestAnimationFrame(previewLoop);
  }

  UI.custom = function () {
    const P = S.profile; if (!P || S.offline) return;
    if (!cs.work) cs.work = Object.assign({}, E.cleanAppearance(P.appearance)); cs.sel = cs.work[cs.slot];
    const tabs = GROUPS.map(([g, slots]) => '<h3 style="margin:8px 0 4px">' + g + '</h3><div class="slot-tabs">' + slots.map(s => '<button class="btn small ' + (cs.slot === s ? 'on' : '') + '" data-slot="' + s + '">' + SLOT_NAME[s] + '</button>').join('') + '</div>').join('');
    UI.screen(UI.top(true) + '<div class="panel" style="margin:auto;width:min(1180px,97vw);margin-top:64px"><h2>CHARACTER <small>cosmetics never affect gameplay · drag the preview to rotate</small></h2><div class="cust"><div><canvas id="cust-prev"></canvas>' +
      '<div class="row" style="margin-top:8px"><button class="btn small" id="c-emote">PLAY EMOTE</button><button class="btn small" id="c-reset">REVERT</button><span class="grow"></span><button class="btn small primary" id="c-save">EQUIP LOOK</button></div><p class="hint" id="c-info" style="min-height:40px"></p></div>' +
      '<div>' + tabs + '<div id="c-grid" class="grid g4" style="margin-top:8px"></div><div class="row" style="margin-top:10px" id="c-buy"></div></div></div></div>', '', 'custom');
    back(); const pv = ensurePreview(q('#cust-prev')); setPreviewAvatar(cs.work); if (!pv.raf) { pv.t = 0; pv.raf = requestAnimationFrame(previewLoop); }
    UI.click('[data-slot]', b => { cs.slot = b.dataset.slot; cs.sel = cs.work[cs.slot]; qa('[data-slot]').forEach(x => x.classList.toggle('on', x === b)); grid(); });
    q('#c-save').onclick = () => { sfx('click'); Net.send({ t: 'equip', a: cs.work }); UI.toast('Look equipped'); };
    q('#c-reset').onclick = () => { cs.work = Object.assign({}, E.cleanAppearance(S.profile.appearance)); cs.sel = cs.work[cs.slot]; setPreviewAvatar(cs.work); grid(); };
    q('#c-emote').onclick = () => { if (prev.av) { prev.av.playEmote(prev.av.emoteSet || 'wave'); } };
    grid();
  };
  function owned(id) { return (S.profile.owned || []).includes(id); }
  function grid() {
    const g = q('#c-grid'); if (!g) return;
    const items = E.COSMETICS.filter(c => c.slot === cs.slot).sort((a, b) => (owned(b.id) - owned(a.id)) || RANK[a.rarity] - RANK[b.rarity] || a.price - b.price);
    g.innerHTML = items.map(it => { const own = owned(it.id), ut = unlockText(it), eq = cs.work[cs.slot] === it.id, R = E.RARITY[it.rarity];
      return '<div class="item r-' + it.rarity + (own ? ' owned' : ' lock') + (cs.sel === it.id ? ' sel' : '') + '" data-it="' + it.id + '">' + swatch(it) + '<div class="nm">' + esc(it.name) + '</div><div class="ds"><span class="c-' + it.rarity + '">' + R.name + '</span>' + (eq ? ' · <b class="pos">EQUIPPED</b>' : '') + '</div>' +
        (own ? '' : '<div class="ds">' + (ut ? esc(ut) : '<span class="cred">' + it.price + '</span>') + '</div>') + '</div>'; }).join('');
    UI.click('[data-it]', b => { selectItem(b.dataset.it); });
    buyBar();
  }
  function selectItem(id) {
    const it = E.BY_ID[id]; cs.sel = id; cs.work[it.slot] = id; setPreviewAvatar(cs.work); if (it.slot === 'emote' && prev.av) prev.av.playEmote(it.v.a); if (it.slot === 'victory' && prev.av) prev.av.playEmote('dance');
    qa('[data-it]').forEach(x => x.classList.toggle('sel', x.dataset.it === id)); buyBar();
    const info = q('#c-info'); if (info) info.textContent = owned(id) ? '' : 'Previewing — not owned yet, so it will not be equipped until unlocked.';
  }
  function buyBar() {
    const bar = q('#c-buy'); if (!bar) return; const it = E.BY_ID[cs.sel]; if (!it) { bar.innerHTML = ''; return; }
    if (owned(it.id)) { bar.innerHTML = '<span style="color:var(--dim)">' + esc(it.name) + ' — owned</span>'; return; }
    const ut = unlockText(it);
    if (ut) { bar.innerHTML = '<span style="color:var(--dim)">' + esc(it.name) + ' — unlocked by: <b style="color:var(--gold2)">' + esc(ut) + '</b></span>'; return; }
    const can = S.profile.credits >= it.price && !S.guest;
    bar.innerHTML = '<button class="btn small primary" id="c-buyb" ' + (can ? '' : 'disabled') + '>UNLOCK ' + esc(it.name.toUpperCase()) + ' — ' + it.price + ' CREDITS</button>' + (S.guest ? '<span style="color:var(--dim)">Create an account to unlock items.</span>' : can ? '' : '<span class="neg">Need ' + (it.price - S.profile.credits) + ' more credits</span>');
    const b = q('#c-buyb'); if (b) b.onclick = () => { sfx('click'); b.disabled = true; Net.send({ t: 'buy', id: it.id, txid: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }); };
  }
  /* after a purchase the server pushes the new profile → refresh the grid only (keep preview + selection) */
  const prevOnProfile = UI.onProfile;
  UI.onProfile = function () {
    if (prevOnProfile) prevOnProfile();
    if (S.screen === 'custom') grid();
    else if (S.screen === 'profile' && UI._profileTab !== 'lb') UI.profile(UI._profileTab, true);
    else if (S.screen === 'campaign') UI.campaign(true);
  };

  /* ================================================================== CAMPAIGN */
  const BGS = {
    district: 'linear-gradient(180deg,#3a3d40 0%,#1b1d20 60%,#0a0a0b 100%)', capital: 'linear-gradient(180deg,#3b2a5a 0%,#c9983a 55%,#2a1a30 100%)', training: 'linear-gradient(180deg,#2b3340 0%,#4a5a48 60%,#14181a 100%)',
    arena: 'linear-gradient(180deg,#d98c3f 0%,#7a5a2a 40%,#1d2a1d 100%)', forest: 'linear-gradient(180deg,#26402e 0%,#13241a 70%,#070d09 100%)', night: 'linear-gradient(180deg,#0a0f24 0%,#141a30 55%,#05060c 100%)', ending: 'linear-gradient(180deg,#1c1424 0%,#4a2a1f 60%,#0a0808 100%)',
  };
  const whoName = id => id === 'narr' ? '' : id === 'hero' ? (S.user || 'You').toUpperCase() : ((K.CHARS[id] && K.CHARS[id].name) || id).toUpperCase();
  const cp = () => (S.profile && S.profile.campaign) || { missions: {}, flags: {}, rel: {}, endings: [], diff: 'normal', unlocks: [] };
  const allyRelNow = () => { const c = cp(), a = c.flags.ally; return a && a !== 'none' ? (c.rel[a] || 0) : 0; };

  UI.campaign = function (soft) {
    if (S.guest) return needAccount('CAMPAIGN');
    const st = cp(), diffs = Object.values(C.DIFFICULTY);
    const sc = $('ui').firstChild && $('ui').firstChild.scrollTop;
    const bonds = Object.keys(st.rel).filter(k => K.CHARS[k]).map(k => '<span class="tag" title="Relationship">' + esc(K.CHARS[k].name.split(' ')[0]) + ' ' + (st.rel[k] > 0 ? '+' : '') + st.rel[k] + '</span>').join('');
    const chapters = K.CHAPTERS.map(ch => {
      const ms = Object.entries(K.MISSIONS).filter(([, m]) => m.ch === ch.n).filter(([id, m]) => !m.onlyIf || Object.keys(m.onlyIf).every(k => st.flags[k] === m.onlyIf[k]) || (st.missions[id] && st.missions[id].done));
      const any = ms.some(([id]) => st.missions[id] && (st.missions[id].avail || st.missions[id].done));
      return '<div class="chap' + (any ? '' : ' locked') + '" style="' + (any ? '' : 'opacity:.5') + '"><h3>CHAPTER ' + ch.n + ' — ' + esc(ch.title.toUpperCase()) + '</h3><p>' + esc(ch.blurb) + '</p>' + (any ? ms.map(([id, m]) => {
        const s = st.missions[id] || {}, cls = s.done ? 'done' : s.avail ? 'avail' : 'locked', replay = s.done && (m.type === 'scene' || m.replay);
        const star = s.done && m.type === 'arena' ? '<span class="stars">' + '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars) + '</span>' : s.done ? '<span class="pos">✔</span>' : '';
        const rew = '<span class="cred">' + K.missionReward(m, st.diff, !s.done) + '</span>';
        return '<div class="mis ' + cls + '"><div class="grow"><b>' + esc(m.title) + '</b> <span class="tag">' + (m.type === 'scene' ? 'STORY' : 'MISSION') + '</span><br><small style="color:var(--dim)">' + esc(m.brief) + '</small></div>' + star + rew +
          (s.avail ? '<button class="btn small ' + (s.done ? '' : 'primary') + '" data-mis="' + id + '">' + (replay ? 'REPLAY' : 'PLAY') + '</button>' : '<button class="btn small" disabled>LOCKED</button>') + '</div>'; }).join('') : '<p>Locked — complete earlier chapters.</p>') + '</div>'; }).join('');
    const ends = Object.values(K.ENDINGS).filter(e => e.unlock || e.id === 'fallen').map(e => '<span class="tag" style="' + (st.endings.includes(e.id) ? 'color:var(--gold2);border-color:var(--gold)' : 'opacity:.4') + '">' + (st.endings.includes(e.id) ? esc(e.title) : '???') + '</span>').join('');
    UI.screen(UI.top(true) + '<div class="panel" style="margin:64px auto 20px;width:min(980px,96vw)"><h2>CAMPAIGN — THE ASHEN CROWN <small>an original story of the Vael Dominion</small></h2>' +
      '<div class="row" style="margin-bottom:8px"><label>Mission difficulty</label><select id="camp-diff" style="width:auto">' + diffs.map(d => '<option value="' + d.id + '"' + (d.id === st.diff ? ' selected' : '') + '>' + d.name + ' — rewards ×' + (K.DIFF_REWARD[d.id] || 1) + '</option>').join('') + '</select><span class="grow"></span>' + bonds + '</div>' +
      '<div style="margin:6px 0 10px;font-size:13px;color:var(--dim)">Endings found: ' + ends + '</div>' + chapters + '</div>', '', 'campaign');
    back(); if (soft && sc) $('ui').firstChild.scrollTop = sc;
    q('#camp-diff').onchange = e => Net.send({ t: 'camp_diff', d: e.target.value });
    UI.click('[data-mis]', b => startMission(b.dataset.mis));
  };

  function startMission(id) {
    const m = K.MISSIONS[id]; if (!m) return; HG.Audio.init();
    if (m.type === 'scene') return playScene(id);
    S.last = { type: 'camp', id }; briefing(id);
  }
  function briefing(id) {
    const m = K.MISSIONS[id], st = cp();
    UI.modal('<h2>' + esc(m.title) + '</h2><p style="margin:6px 0 10px">' + esc(m.brief) + '</p><h3>OBJECTIVES</h3>' + (m.objectives || []).map(o => '<div class="stat"><span>' + esc(o.text) + '</span><b>' + (o.optional ? 'optional' : 'required') + '</b></div>').join('') +
      '<div class="stat"><span>Difficulty</span><b>' + esc((C.DIFFICULTY[st.diff] || {}).name) + '</b></div><div class="stat"><span>Reward</span><b class="cred">' + K.missionReward(m, st.diff, !(st.missions[id] && st.missions[id].done)) + '</b></div>' +
      '<p class="hint">Campaign missions never cost credits. Failing costs nothing and can be retried.</p><div class="row"><button class="btn primary grow" id="cm-go">BEGIN</button><button class="btn grow" id="cm-x">CANCEL</button></div>', false);
    $('cm-go').onclick = () => { UI.closeModal(); S.last = { type: 'camp', id }; Net.send({ t: 'camp_start', mission: id }); };
    $('cm-x').onclick = () => UI.closeModal();
  }

  /* ---- cinematic scene player (pure DOM/CSS — cheap on the GPU) */
  let sceneState = null;
  function cine() { return $('cine'); }
  function playScene(id) {
    const m = K.MISSIONS[id], sc = K.SCENES[m.scene]; if (!sc) return;
    sceneState = { id, sc, node: 'start', picks: [], typing: 0, full: '', done: false };
    const c = cine(); c.classList.remove('hidden'); c.className = ''; c.innerHTML = '<div class="bg" style="background:' + (BGS[sc.bg] || BGS.night) + '"></div><div class="ash"></div><div class="title" id="cn-title"></div><div class="dlg hidden" id="cn-dlg"><div class="who" id="cn-who"></div><div class="txt" id="cn-txt"></div><div class="ch" id="cn-ch"></div><div class="next" id="cn-next">click / space to continue</div></div><button class="btn small" id="cn-skip" style="position:absolute;top:14px;right:14px;z-index:3;width:auto">SKIP TEXT ▸</button>';
    c.classList.add('letterbox'); HG.Audio.startMusic('menu');
    const t = $('cn-title'); t.textContent = sc.title.toUpperCase(); t.style.opacity = 0; t.style.transition = 'opacity 1.4s'; setTimeout(() => { t.style.opacity = 1; }, 60);
    setTimeout(() => { t.style.opacity = 0; $('cn-dlg').classList.remove('hidden'); showNode(); }, 2300);
    c.onclick = adv; $('cn-skip').onclick = ev => { ev.stopPropagation(); if (sceneState && sceneState.typing) finishTyping(); };
  }
  function showNode() {
    const s = sceneState; if (!s) return; const n = s.sc.nodes[s.node];
    if (!n || n.end) return finishScene();
    $('cn-who').textContent = whoName(n.who); $('cn-who').style.color = n.who === 'narr' ? 'var(--dim)' : ''; $('cn-ch').innerHTML = ''; $('cn-next').style.display = 'none';
    const txt = $('cn-txt'); txt.textContent = ''; txt.style.fontStyle = n.who === 'narr' ? 'italic' : ''; s.full = n.text; s.i = 0; clearInterval(s.typing);
    s.typing = setInterval(() => { s.i += 2; txt.textContent = s.full.slice(0, s.i); if (s.i >= s.full.length) finishTyping(); }, 18);
  }
  function finishTyping() {
    const s = sceneState; if (!s) return; clearInterval(s.typing); s.typing = 0; $('cn-txt').textContent = s.full; const n = s.sc.nodes[s.node];
    if (n.choices) {
      const ch = $('cn-ch'); ch.innerHTML = '';
      n.choices.forEach((c, i) => { const locked = c.req && c.req.relAlly && allyRelNow() < c.req.relAlly; const b = document.createElement('button'); b.className = 'btn'; b.disabled = !!locked; b.textContent = c.t + (locked ? '  [needs a stronger bond with your ally]' : '');
        b.onclick = ev => { ev.stopPropagation(); sfx('click'); sceneState.picks.push(i); sceneState.node = c.next; showNode(); }; ch.appendChild(b); });
    } else $('cn-next').style.display = '';
  }
  function adv() {
    const s = sceneState; if (!s) return; const n = s.sc.nodes[s.node]; if (!n || s.done) return;
    if (s.typing) return finishTyping(); if (n.choices) return; s.node = n.next; showNode();
  }
  addEventListener('keydown', e => { if (sceneState && !cine().classList.contains('hidden') && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); adv(); } });
  function endCine() { clearInterval(sceneState && sceneState.typing); sceneState = null; const c = cine(); c.classList.add('hidden'); c.onclick = null; c.innerHTML = ''; }
  function finishScene() {
    const s = sceneState; s.done = true; clearInterval(s.typing);
    $('cn-dlg').classList.add('hidden'); $('cn-skip').remove(); const t = $('cn-title'); t.textContent = 'Saving your story…'; t.style.opacity = 1; t.style.fontSize = '20px';
    Net.send({ t: 'camp_scene', mission: s.id, picks: s.picks });
  }
  Net.on('camp_scene', m => {
    const wasPlaying = !!sceneState; if (wasPlaying) endCine();
    if (!m.r || !m.r.ok) { UI.toast((m.r && m.r.error) || 'Could not save story', true); return UI.campaign(); }
    const r = m.r, mi = K.MISSIONS[m.mission];
    const after = () => {
      UI.campaign();
      if (r.replay) return UI.toast('Replayed — consequences were already recorded.');
      UI.toast('Story complete: +' + r.reward + ' credits', false); (r.ach || []).forEach(a => UI.toast('Achievement: ' + (a.name || a)));
      if (mi && mi.customize) setTimeout(() => UI.modal('<h2>THE TRIBUTE SUITE</h2><p style="margin:8px 0">Your stylists are waiting. Customise your tribute before the cameras find you.</p><div class="row"><button class="btn primary grow" id="mc-go">CUSTOMISE NOW</button><button class="btn grow" id="mc-x">LATER</button></div>', false) || ($('mc-go').onclick = () => { UI.closeModal(); UI.custom(); }, $('mc-x').onclick = () => UI.closeModal()), 500);
    };
    if (r.ending) showEnding(r.ending.ending, after); else after();
  });

  function showEnding(eid, done) {
    const en = K.ENDINGS[eid]; if (!en) return done && done();
    const c = cine(); c.classList.remove('hidden'); c.className = 'letterbox'; c.innerHTML = '<div class="bg" style="background:' + BGS.ending + '"></div><div class="ash"></div><div class="title" style="top:22%;font-size:clamp(22px,4vw,46px)">' + esc(en.title) + '</div><div class="dlg" style="margin-bottom:12vh"><div class="txt" style="font-style:italic">' + esc(en.text) + '</div>' + (en.credits ? '<p style="margin-top:12px;color:var(--gold2)">Ending reward: ◈ ' + en.credits + ' credits (first time)</p>' : '') + '<button class="btn primary" id="end-ok" style="margin-top:12px">CONTINUE</button></div>';
    HG.Audio.play('victory'); $('end-ok').onclick = () => { c.classList.add('hidden'); c.innerHTML = ''; done && done(); };
  }

  /* ---- arena mission result (server → client after a campaign match ends) */
  Net.on('camp_result', m => {
    const r = m.r || {}, mi = K.MISSIONS[r.mission] || {}, ok = !!r.success;
    const after = () => {
      const objs = (m.objectives || []).map(o => '<div class="stat"><span>' + (o.done ? '✔ ' : o.failed ? '✘ ' : '• ') + esc(o.text) + (o.optional ? ' <small style="color:var(--dim)">(optional)</small>' : '') + '</span><b class="' + (o.done ? 'pos' : 'neg') + '">' + (o.done ? 'done' : o.failed ? 'failed' : 'incomplete') + '</b></div>').join('');
      HG.Audio.stopMusic(); if (ok) HG.Audio.play('victory');
      UI.modal('<div class="res-big ' + (ok ? 'win' : 'lose') + '" style="font-size:clamp(28px,5vw,54px)">' + (ok ? 'MISSION COMPLETE' : 'MISSION FAILED') + '</div><p style="text-align:center;color:var(--dim)">' + esc(mi.title || '') + '</p>' +
        (ok ? '<div style="text-align:center;font-size:26px;margin:6px 0" class="stars">' + '★'.repeat(r.stars || 1) + '☆'.repeat(3 - (r.stars || 1)) + '</div>' : '') + objs +
        '<div class="stat"><span>Eliminations</span><b>' + (m.kills || 0) + '</b></div><div class="stat"><span>Survival time</span><b>' + fmtT(m.survive) + '</b></div>' +
        (ok ? '<div class="stat"><span>Mission reward</span><b class="pos">+' + (r.reward || 0) + '</b></div>' + (r.bonus ? '<div class="stat"><span>Optional objectives</span><b class="pos">+' + r.bonus + '</b></div>' : '') : '<p class="hint">No credits lost. Try a different approach — or lower the difficulty from the campaign screen.</p>') +
        (r.unlocked && r.unlocked.length ? '<div class="stat"><span>Unlocked</span><b>' + r.unlocked.map(id => esc((E.BY_ID[id] || {}).name || id)).join(', ') + '</b></div>' : '') + (r.ach || []).map(a => '<div class="stat"><span>🏆 ' + esc(a.name || a) + '</span><b class="pos">+' + (a.credits || '') + '</b></div>').join('') +
        '<div class="row" style="margin-top:12px">' + (!ok ? '<button class="btn primary grow" id="cr-retry">RETRY</button>' : '') + '<button class="btn grow ' + (ok ? 'primary' : '') + '" id="cr-camp">' + (ok ? 'CONTINUE STORY' : 'CAMPAIGN') + '</button></div>', false);
      const leave = fn => () => { UI.closeModal(); UI.toMenu(); setTimeout(fn, 200); };
      $('cr-camp').onclick = leave(() => UI.campaign()); if ($('cr-retry')) $('cr-retry').onclick = leave(() => { UI.campaign(); startMission(r.mission); });
    };
    if (r.ending) showEnding(r.ending.ending, after); else after();
  });
  Net.on('camp_state', () => { });

  /* briefing toast when a campaign match starts */
  const origStart = UI.onMatchStart;
  UI.onMatchStart = function (msg) { origStart(msg); const c = msg.w && msg.w.camp; if (c && c.title && !c.resumed) UI.toast(c.title + ' — ' + c.brief); };

  /* ================================================================== PROFILE */
  UI.profile = function (tab, soft) {
    if (S.guest) return needAccount('PROFILE'); tab = tab || UI._profileTab || 'overview'; UI._profileTab = tab; const p = S.profile, st = p.stats || {};
    const tabs = [['overview', 'OVERVIEW'], ['challenges', 'CHALLENGES'], ['achievements', 'ACHIEVEMENTS'], ['history', 'MATCH HISTORY'], ['ledger', 'CREDIT LEDGER'], ['lb', 'LEADERBOARD']];
    let body = '';
    if (tab === 'overview') {
      const row = (a, b) => '<div class="stat"><span>' + a + '</span><b>' + b + '</b></div>';
      body = '<div class="grid g2" style="gap:24px"><div><h3>' + esc(p.user) + ' — ' + esc(p.title) + '</h3><div class="stat"><span>Level ' + p.level + '</span><b>' + (p.need ? p.into + ' / ' + p.need + ' XP' : 'MAX') + '</b></div><div class="prog"><div style="width:' + (p.need ? Math.round(p.into / p.need * 100) : 100) + '%"></div></div><br>' +
        row('Credits', '<span class="cred">' + num(p.credits) + '</span>') + row('Lifetime credits earned', num(p.lifetime)) + row('Cosmetics owned', (p.owned || []).length + ' / ' + E.COSMETICS.length) + row('Campaign endings found', ((p.campaign || {}).endings || []).length) +
        (p.penalty > 0 ? row('Matchmaking penalty', Math.ceil(p.penalty / 1000) + 's remaining') : '') + row('Bot-match credits today', num(p.botDay) + ' / ' + E.BOT_DAILY_CAP) + '</div><div><h3>STATISTICS</h3>' +
        row('Matches played', st.matches || 0) + row('Wins', st.wins || 0) + row('Losses', st.losses || 0) + row('Eliminations', st.kills || 0) + row('Deaths', st.deaths || 0) + row('Highest placement', st.bestPlacement ? '#' + st.bestPlacement : '—') + row('Top-three finishes', st.top3 || 0) +
        row('Total survival time', fmtT(st.surviveTotal)) + row('Longest survival', fmtT(st.longestSurvival)) + row('Hidden places found', st.hiddenFound || 0) + row('Items crafted', st.craft || 0) + '</div></div>';
    } else if (tab === 'challenges') {
      const ch = p.challenges || { daily: [], weekly: [] };
      const list = (a, t) => '<h3>' + t + '</h3>' + a.map(c => '<div class="chap" style="margin:6px 0"><div class="row"><span class="grow">' + (c.done ? '<span class="pos">✔ </span>' : '') + esc(c.desc) + '</span><span class="cred">' + c.credits + '</span><small style="color:var(--dim)">+' + c.xp + ' XP</small>' + (c.cosmetic ? '<span class="tag">' + esc((E.BY_ID[c.cosmetic] || {}).name || 'cosmetic') + '</span>' : '') + '</div><div class="prog ' + (c.done ? 'done' : '') + '"><div style="width:' + Math.round(c.progress / c.target * 100) + '%"></div></div><small style="color:var(--dim)">' + c.progress + ' / ' + c.target + '</small></div>').join('');
      body = list(ch.daily, 'DAILY') + list(ch.weekly, 'WEEKLY') + '<p class="hint">Progress is validated by the server from real match results — it cannot be claimed or edited by the client. Daily challenges reset at 00:00 UTC.</p>';
    } else if (tab === 'achievements') {
      const have = p.achievements || {};
      const stat = a => { const s = p.stats || {}; return a.stat === 'owned' ? (p.owned || []).length : a.stat === 'level' ? p.level : a.stat === 'lifetime' ? p.lifetime : a.stat === 'hiddenCount' ? s.hiddenFound : s[a.stat] || 0; };
      body = '<div class="grid g2">' + E.ACHIEVEMENTS.map(a => { const done = !!have[a.id], v = Math.min(a.target, stat(a)); return '<div class="chap" style="margin:0;' + (done ? 'border-color:var(--gold)' : '') + '"><b style="' + (done ? 'color:var(--gold2)' : '') + '">' + (done ? '🏆 ' : '') + esc(a.name) + '</b> <span class="cred">' + (a.credits || 0) + '</span><br><small style="color:var(--dim)">' + esc(a.desc) + '</small><div class="prog ' + (done ? 'done' : '') + '"><div style="width:' + Math.round(v / a.target * 100) + '%"></div></div></div>'; }).join('') + '</div>';
    } else if (tab === 'history') {
      const h = p.history || [];
      body = h.length ? '<table class="tx"><tr><th>When</th><th>Mode</th><th>Entry</th><th>Placed</th><th>Elims</th><th>Survived</th><th>Credits</th></tr>' + h.map(x => '<tr><td>' + ago(x.t) + '</td><td>' + esc(x.mode) + (x.diff ? ' · ' + esc(x.diff) : '') + '</td><td>' + esc((E.TIERS[x.tier] || {}).name || x.tier) + '</td><td>#' + x.placement + ' / ' + x.total + '</td><td>' + x.kills + '</td><td>' + fmtT(x.survive) + '</td><td class="' + (x.net < 0 ? 'neg' : 'pos') + '">' + (x.net > 0 ? '+' : '') + x.net + '</td></tr>').join('') + '</table>' : '<p style="color:var(--dim)">No matches yet — jump into a free Beginner match.</p>';
    } else if (tab === 'ledger') {
      const t = p.tx || [];
      body = '<p class="hint" style="margin:0 0 8px">Every credit movement is recorded server-side with a unique transaction ID. Duplicate claims are rejected and your balance can never go below zero.</p><table class="tx"><tr><th>When</th><th>Type</th><th>Reason</th><th>Amount</th><th>Balance</th></tr>' + t.map(x => '<tr><td>' + ago(x.t) + '</td><td>' + esc(x.type) + '</td><td>' + esc(x.reason) + '</td><td class="' + (x.amount < 0 ? 'neg' : 'pos') + '">' + (x.amount > 0 ? '+' : '') + x.amount + '</td><td>' + x.bal + '</td></tr>').join('') + '</table>';
    } else if (tab === 'lb') {
      body = '<div id="lb-body"><p style="color:var(--dim)">Loading…</p></div>'; Net.send({ t: 'lb' });
    }
    const sc = soft && $('ui').firstChild ? $('ui').firstChild.scrollTop : 0;
    UI.screen(UI.top(true) + '<div class="panel" style="margin:64px auto 20px;width:min(1000px,96vw)"><h2>PROFILE &amp; PROGRESSION</h2><div class="tabs">' + tabs.map(([k, n]) => '<button class="btn small ' + (tab === k ? 'on' : '') + '" data-tab="' + k + '">' + n + '</button>').join('') + '</div>' + body + '</div>', '', 'profile');
    back(); UI.click('[data-tab]', b => UI.profile(b.dataset.tab)); if (sc) $('ui').firstChild.scrollTop = sc;
  };
  Net.on('lb', m => {
    const el = $('lb-body'); if (!el) return;
    el.innerHTML = '<table class="tx"><tr><th>#</th><th>Tribute</th><th>Wins</th><th>Eliminations</th><th>Matches</th><th>Level</th></tr>' + m.rows.map((r, i) => '<tr' + (r.n === S.user ? ' style="color:var(--gold2)"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(r.n) + '</td><td>' + r.w + '</td><td>' + r.k + '</td><td>' + r.m + '</td><td>' + r.l + '</td></tr>').join('') + '</table>';
  });
})();
