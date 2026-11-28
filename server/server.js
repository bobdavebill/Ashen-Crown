/* Authoritative game server: static files + WebSocket protocol, accounts, rooms, matchmaking, match runner, economy hooks.
   Run: node server/server.js   (PORT env var, default 3000) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const C = require('../shared/constants');
const E = require('../shared/catalog');
const K = require('../shared/campaign');
const Terrain = require('../shared/terrain');
const Sim = require('../shared/sim');
const Eco = require('./economy');
const { Store } = require('./db');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 3000;
const store = new Store(process.env.HG_DB || path.join(ROOT, 'data', 'db.json'));
const now = () => Date.now();
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const log = (...a) => { if (!process.env.HG_QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); };

/* ================================================================ static files */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
function serveStatic(req, res) {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(status())); }
  if (u === '/' || u === '') u = '/index.html';
  let base = path.join(ROOT, 'client'), rel = u;
  if (u.startsWith('/shared/')) { base = path.join(ROOT, 'shared'); rel = u.slice(7); }
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) && file !== base) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
  });
}
const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: false });

/* ================================================================== state */
const conns = new Set();                 // all sockets
const rooms = new Map();                 // code -> Room
const matches = new Set();               // active Sim.Match
const byUser = new Map();                // lower user -> conn (single session per account)
const active = new Map();                // lower user -> {m, pid}  (for reconnect)
let matchCounter = 0;
const status = () => ({ online: conns.size, inMatch: [...matches].reduce((n, m) => n + [...m.players.values()].filter(p => !p.isBot && !p.left).length, 0), rooms: rooms.size, matches: matches.size, version: 1 });

function send(c, obj) { if (c.ws.readyState === 1) { try { c.ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } } }
function pushMe(c) { if (c.profile) send(c, { t: 'me', p: Eco.publicProfile(c.profile, now()), guest: !!c.guest }); }
function save() { store.markDirty(); }
const err = (c, m, k) => send(c, { t: 'err', m, k });

/* ============================================================ accounts */
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }
function newToken(user) { const t = crypto.randomBytes(24).toString('hex'); store.sessions[t] = { user, exp: now() + 30 * 86400e3 }; save(); return t; }
const validUser = u => typeof u === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(u);
function authOk(c, acct, token) {
  const key = acct.user.toLowerCase();
  const old = byUser.get(key); if (old && old !== c) { send(old, { t: 'kicked', m: 'Signed in elsewhere' }); old.ws.close(); detach(old, true); }
  c.acct = acct; c.profile = acct.profile; c.guest = false; byUser.set(key, c); c.name = acct.user;
  Eco.grantUnlocks(c.profile); Eco.ensureChallenges(c.profile, now()); save();
  send(c, { t: 'authed', token, user: acct.user, p: Eco.publicProfile(c.profile, now()), online: status().online });
  const a = active.get(key);
  if (a && a.m.phase !== 'ended') resumeMatch(c, a);
}

/* ================================================================ rooms */
const code4 = () => { let s; do { s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[rnd(32)]; } while (rooms.has(s)); return s; };
function makeRoom(host, o) {
  const r = { code: code4(), host, members: new Set(), mode: o.mode || 'solo', tier: o.tier || 'free', ranked: !!o.ranked, difficulty: C.DIFFICULTY[o.difficulty] ? o.difficulty : 'normal',
    bots: clamp(o.bots | 0, 0, 23), max: clamp(o.max | 0 || 12, 2, C.MAX_PLAYERS), pub: !!o.pub, state: 'lobby', startAt: 0, created: now(), target: clamp(o.target | 0 || 12, 4, 24) };
  if (!C.MODES[r.mode] || r.mode === 'campaign') r.mode = 'solo';
  if (!E.TIERS[r.tier]) r.tier = 'free';
  rooms.set(r.code, r); return r;
}
function roomView(r) {
  return { code: r.code, mode: r.mode, tier: r.tier, ranked: r.ranked, difficulty: r.difficulty, bots: r.bots, max: r.max, pub: r.pub, state: r.state, host: r.host && r.host.name, startIn: r.pub && r.startAt ? Math.max(0, Math.ceil((r.startAt - now()) / 1000)) : 0,
    target: r.target, members: [...r.members].map(c => ({ name: c.name, level: c.profile.level, title: c.profile.title, host: c === r.host })) };
}
function pushRoom(r) { const v = roomView(r); for (const c of r.members) send(c, { t: 'room', r: v }); }
function joinRoom(c, r) {
  if (c.room) leaveRoom(c);
  if (r.state !== 'lobby') return err(c, 'That match has already started');
  if (r.members.size >= r.max) return err(c, 'Room is full');
  const ent = canEnterRoom(c, r); if (!ent.ok) return err(c, ent.error);
  r.members.add(c); c.room = r; if (!r.host) r.host = c; pushRoom(r);
  if (r.pub && r.members.size >= r.target) r.startAt = now();    // full → go
}
function canEnterRoom(c, r) {
  if (c.guest && (r.tier !== 'free' || r.ranked)) return { ok: false, error: 'Create a free account to play stake matches' };
  if (r.mode === 'practice' || r.mode === 'campaign') return { ok: true };
  return Eco.canEnter(c.profile, r.tier, now());
}
function leaveRoom(c) {
  const r = c.room; if (!r) return; c.room = null; r.members.delete(c);
  if (r.state === 'lobby') {
    if (!r.members.size) rooms.delete(r.code);
    else { if (r.host === c) r.host = [...r.members][0]; pushRoom(r); }
  }
}

/* ============================================================== matchmaking */
function queue(c, o) {
  if (c.match) return err(c, 'Already in a match');
  const tier = E.TIERS[o.tier] ? o.tier : 'free', mode = ['solo', 'duos', 'teams'].includes(o.mode) ? o.mode : 'solo', ranked = !!o.ranked;
  const diff = C.DIFFICULTY[o.difficulty] ? o.difficulty : 'normal';
  let r = [...rooms.values()].find(x => x.pub && x.state === 'lobby' && x.mode === mode && x.tier === tier && x.ranked === ranked && x.difficulty === diff && x.members.size < x.target);
  if (!r) { r = makeRoom(null, { mode, tier, ranked, difficulty: diff, pub: true, target: mode === 'solo' ? 12 : mode === 'duos' ? 12 : 12 }); r.startAt = now() + 20000; }
  joinRoom(c, r);
}
function startRoom(r) {
  if (r.state !== 'lobby' || !r.members.size) return;
  launch(r);
}
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.state === 'lobby' && r.pub && r.startAt) { if (now() >= r.startAt) startRoom(r); else pushRoom(r); }
    if (r.state === 'lobby' && !r.members.size) rooms.delete(r.code);
  }
}, 1000);
setInterval(() => { const s = status(); for (const c of conns) if (c.profile) send(c, { t: 'online', n: s.online, m: s.inMatch }); }, 5000);

/* ================================================================== launch */
function botAppearance() {
  const ap = {};
  for (const s of E.SLOTS) {
    const pool = E.COSMETICS.filter(x => x.slot === s && !['ach', 'camp', 'event'].includes(x.unlock.t) && x.rarity !== 'legendary' && x.rarity !== 'epic');
    ap[s] = pool.length ? pool[rnd(pool.length)].id : E.DEFAULT_APPEARANCE[s];
  }
  return ap;
}
function findLand(world, x, z) {
  for (let r = 0; r < 120; r += 4) for (let a = 0; a < 12; a++) {
    const px = x + Math.cos(a * 0.5236) * r, pz = z + Math.sin(a * 0.5236) * r;
    if (world.height(px, pz) > C.WORLD.waterLevel + 0.4 && Math.hypot(px, pz) < C.WORLD.radius - 20) { let clear = true; for (const o of world.query(px, pz, 3)) { if (o.k === 0 ? Math.hypot(px - o.x, pz - o.z) < o.r + 1.5 : (px > o.minx - 1.5 && px < o.maxx + 1.5 && pz > o.minz - 1.5 && pz < o.maxz + 1.5)) { clear = false; break; } } if (clear) return { x: px, z: pz }; }
  }
  return { x, z };
}

function makeMatch(opts) {
  const m = new Sim.Match(Object.assign({ id: 'M' + (++matchCounter) + '-' + crypto.randomBytes(3).toString('hex') }, opts, {
    send: (pid, ev, d) => { const c = m.conns.get(pid); if (c && c.match === m) send(c, { t: ev, d }); },
  }));
  m.conns = new Map(); m.slots = new Map(); m.scripts = []; m.created = now(); m.cleanup = 0;
  return m;
}
function addHuman(m, c, team, perks, extra) {
  const p = m.addPlayer(Object.assign({ name: c.name, appearance: c.profile.appearance, acct: c.guest ? null : c.name.toLowerCase(), level: c.profile.level, title: c.profile.title, team, perks }, extra));
  m.conns.set(p.id, c); c.match = m; c.pid = p.id;
  return p;
}
function addBot(m, spec) {
  const used = new Set([...m.players.values()].map(p => p.name));
  const name = spec.name || (shuffle(C.BOT_NAMES.slice()).find(n => !used.has(n)) || 'Tribute ' + rnd(999));
  return m.addPlayer(Object.assign({ isBot: true, name, appearance: botAppearance(), personality: spec.per, difficulty: spec.diff || m.difficulty, team: spec.team, level: 1 + rnd(25), title: E.titleForLevel(1 + rnd(25)) }, spec.extra || {}));
}

function launch(r) {
  r.state = 'starting';
  const tier = E.TIERS[r.tier], humans = [];
  const m = makeMatch({ seed: 0, mode: r.mode, tier: r.tier, ranked: r.ranked, difficulty: r.difficulty, hooks: hooks() });
  m.room = r; m.entries = new Map();
  const stake = r.mode === 'practice' ? 0 : tier.stake;
  for (const c of r.members) {
    const lo = Eco.validateLoadout(c.profile, c.guest || r.mode === 'practice' ? null : c.profile.loadout, r.ranked);
    const ent = c.guest ? { ok: true, info: { stake: 0, perks: 0 } } : Eco.chargeEntry(c.profile, m.id, stake, lo.cost, now());
    if (!ent.ok) { err(c, 'Could not pay the entry stake', 'stake'); c.room = null; r.members.delete(c); continue; }
    if (ent.info.perkFail) lo.adv = [];       // couldn't afford supplies → enter with none, not charged
    m.entries.set(c, { entry: ent.info, perks: lo }); humans.push(c);
  }
  if (!humans.length) { r.state = 'lobby'; rooms.delete(r.code); return; }
  const ts = r.mode === 'duos' ? 2 : r.mode === 'teams' ? 3 : 1;
  let nBots = r.pub ? Math.max(0, r.target - humans.length) : r.bots;
  if (r.mode === 'practice') nBots = Math.max(1, r.bots || 7);
  nBots = Math.min(nBots, C.MAX_PLAYERS - humans.length);
  if (ts > 1) nBots = Math.min(C.MAX_PLAYERS - humans.length, Math.ceil((humans.length + nBots) / ts) * ts - humans.length);
  if (humans.length + nBots < 2) nBots = 2 - humans.length;
  let idx = 0; const teamOf = i => ts > 1 ? 100 + Math.floor(i / ts) : undefined;
  for (const c of humans) { const e = m.entries.get(c); addHuman(m, c, teamOf(idx), { adv: e.perks.adv, dis: e.perks.dis, wclass: e.perks.wclass }); idx++; }
  const pers = shuffle(Object.keys(C.PERSONALITIES));
  for (let i = 0; i < nBots; i++) { addBot(m, { per: pers[i % pers.length], team: teamOf(idx) }); idx++; }
  r.state = 'playing'; r.match = m; m.start(); matches.add(m);
  for (const c of humans) { active.set(c.name.toLowerCase(), { m, pid: c.pid }); send(c, { t: 'welcome', w: m.welcome(c.pid), entry: m.entries.get(c).entry, perks: { adv: m.entries.get(c).perks.adv, dis: m.entries.get(c).perks.dis }, room: roomView(r) }); pushMe(c); }
  save(); log('match', m.id, r.mode, r.tier, humans.length + ' humans', nBots + ' bots');
}

/* --------------------------------------------------------------- campaign */
function launchCampaign(c, mid) {
  if (c.match) return err(c, 'Already in a match');
  const mi = K.MISSIONS[mid], cp = c.profile.campaign;
  if (!mi || mi.type !== 'arena') return err(c, 'Unknown mission');
  if (c.guest) return err(c, 'Create an account to play the campaign');
  if (!K.available(mid, cp.done, cp.flags)) return err(c, 'Mission locked');
  const fl = cp.flags, env = mi.env || {}, diff = cp.diff || 'normal';
  const m = makeMatch({ seed: env.seed, mode: 'campaign', tier: 'free', difficulty: diff, noZone: !!env.noZone, noEvents: !!env.noEvents, noWildlife: !!env.noWildlife, noCountdown: !!env.noCountdown, timeLimit: env.timeLimit,
    objectives: [], hooks: hooks() });
  m.mission = mid; m.entries = new Map();
  if (env.zoneFast) for (const ph of m.zone.phases) { ph.wait *= 0.3; ph.shrink *= 0.6; }
  const spawn = env.spawn ? findLand(m.world, env.spawn.x, env.spawn.z) : null; if (spawn) m.opts.spawnAt = spawn;
  const hero = addHuman(m, c, undefined, { adv: [], dis: [], wclass: null }); m.entries.set(c, { entry: { stake: 0, perks: 0 }, perks: { adv: [], dis: [] } });
  hero.tag = 'hero';
  for (const g of (mi.give || [])) m.give(hero, m.makeItem(g.id, g.n));
  if (mi.ch >= 4) { const sp = fl.sponsors || 0; if (sp >= 1) m.give(hero, m.makeItem('water_bottle', 1)); if (sp >= 2) { m.give(hero, m.makeItem('bandage', 2)); m.give(hero, m.makeItem('bread', 1)); } }
  const ally = fl.ally && fl.ally !== 'none' ? fl.ally : null;
  const rival = (ally && fl.betrayer !== 'revenge') ? ally : 'cassian';
  const resolve = ch => ch === 'ally' ? ally : ch === 'rival' ? rival : ch;
  const botPlayers = [];
  for (const b of (mi.bots || [])) {
    if (b.ifNotAlly && ally === b.ifNotAlly) continue;
    if (b.ifFlagNot) { let skip = false; for (const k in b.ifFlagNot) if (fl[k] === b.ifFlagNot[k]) skip = true; if (skip) continue; }
    const n = b.n || 1;
    for (let i = 0; i < n; i++) {
      let ch = b.char ? resolve(b.char) : null; if (b.char && !ch) continue;
      const ci = ch ? K.CHARS[ch] : null;
      const p = addBot(m, { name: ci ? ci.name : (b.name ? b.name + (n > 1 ? ' ' + String.fromCharCode(65 + i) : '') : null), per: ci ? ci.per : b.per, diff: b.diffOverride || diff, extra: { tag: b.tag, level: 20 } });
      if (ci && ci.app) p.app = E.cleanAppearance(Object.assign({}, p.app, ci.app));
      for (const g of (b.give || [])) m.give(p, m.makeItem(g.id, g.n));
      p.spec = b; p.charId = ch; botPlayers.push(p);
    }
  }
  const mix = mi.mix || Object.keys(C.PERSONALITIES);
  for (let i = 0; i < (mi.fill || 0); i++) addBot(m, { per: mix[i % mix.length] });
  const dummies = [];
  for (const d of (mi.dummies || [])) { const p = addBot(m, { name: 'Practice Dummy', per: 'survivor', extra: { role: 'dummy' } }); p.spec = d; dummies.push(p); }
  // objectives
  m.objectives = [];
  for (const o of (mi.objectives || [])) {
    if (o.optionalIfNone && !ally) continue;
    const ob = Object.assign({ done: false, p: 0, failed: false }, o);
    if (o.type === 'dummies') ob.total = dummies.length;
    m.objectives.push(ob);
  }
  m.start();
  // placement of special bots / dummies / reach target
  const sp0 = spawn || { x: hero.x, z: hero.z };
  let reach = null;
  const ro = m.objectives.find(o => o.type === 'reach');
  if (ro) { const a = ((env.seed || 1) % 628) / 100, dist = (mi.reachFromSpawn && mi.reachFromSpawn.dist) || 130; const t = findLand(m.world, sp0.x + Math.cos(a) * dist, sp0.z + Math.sin(a) * dist); ro.x = t.x; ro.z = t.z; reach = { x: t.x, z: t.z, r: ro.r || 6 }; }
  const placeAt = (p, x, z) => { const q = findLand(m.world, x, z); p.x = q.x; p.z = q.z; p.y = m.world.height(q.x, q.z); p.lastPX = p.x; p.lastPZ = p.z; };
  for (const p of dummies) placeAt(p, sp0.x + p.spec.dx, sp0.z + p.spec.dz);
  for (const p of botPlayers) if (p.spec.near === 'spawn') placeAt(p, sp0.x + (p.spec.dx || 10), sp0.z + (p.spec.dz || 0)); else if (p.spec.near === 'reach' && reach) placeAt(p, reach.x + (rnd(30) - 15), reach.z + (rnd(30) - 15));
  // alliances & scripts
  const ap = botPlayers.find(p => p.spec.alliance);
  if (ap) m.setAlly(hero.id, ap.id, true);
  for (const s of (mi.script || [])) { const sc = Object.assign({}, s); if (sc.op === 'betray' && fl.shared === 'kept') sc.at = Math.max(40, sc.at - 80); m.scripts.push(sc); }
  m.mission = mid; m.campDiff = diff;
  matches.add(m); active.set(c.name.toLowerCase(), { m, pid: hero.id });
  const w = m.welcome(hero.id); w.camp = { mission: mid, title: mi.title, brief: mi.brief, reach, ally: ap ? { id: ap.id, name: ap.name } : null };
  send(c, { t: 'welcome', w, entry: { stake: 0, perks: 0 }, perks: { adv: [], dis: [] } });
  log('campaign', mid, c.name, diff);
}

function runScripts(m) {
  if (!m.scripts.length || m.phase !== 'live') return;
  for (let i = m.scripts.length - 1; i >= 0; i--) {
    const s = m.scripts[i]; if (m.t < s.at) continue; m.scripts.splice(i, 1);
    if (s.op === 'announce') m.bcast({ t: 'announce', m: s.m, k: 'event' });
    else if (s.op === 'event') m.launchEvent(s.k);
    else if (s.op === 'betray') {
      const traitor = [...m.players.values()].find(p => p.tag === s.tag && p.alive), hero = [...m.players.values()].find(p => p.tag === 'hero');
      if (traitor && hero) { m.setAlly(hero.id, traitor.id, false); if (traitor.bot) { traitor.bot.hostile.add(hero.id); traitor.bot.thinkT = 0; traitor.bot.berserk = 20; } m.to(hero.id, { t: 'ally', k: 'broken', i: traitor.id }); m.bcast({ t: 'announce', m: traitor.name.toUpperCase() + ' HAS TURNED ON YOU', k: 'betray' }); }
    }
  }
}

/* ============================================================== match hooks */
function hooks() {
  return {
    onTeamOut: (m, team, placement) => { for (const p of m.players.values()) if (p.team === team && !p.isBot) settlePlayer(m, p, { placement }); },
    onEnd: m => finishMatch(m),
  };
}
function profileFor(m, p) { const c = m.conns.get(p.id); if (c && c.profile) return c; const a = p.acct && store.accounts[p.acct]; return a ? { profile: a.profile, guest: false, name: a.user, fake: true } : null; }

function settlePlayer(m, p, o) {
  o = o || {};
  if (p.settled || p.isBot) return; if (m.mode === 'campaign') return;
  p.settled = true;
  const holder = profileFor(m, p); if (!holder) return;
  const ent = [...m.entries.entries()].find(([cc]) => cc.name === p.name); const info = ent ? ent[1] : { entry: { stake: 0, perks: 0 }, perks: { adv: [], dis: [] } };
  const total = m.order.length, humans = [...m.players.values()].filter(q => !q.isBot).length, bots = total - humans;
  const quit = !!(o.quit || p.quit), early = !!(o.connFail || p.connFail);
  let placement = o.placement || p.placement || (p.alive ? 1 : m.aliveTeams().size + 1); if (quit) placement = total;
  const connFail = early && m.t < 45 && !p.stats.kills;
  const survive = p.alive ? m.t : p.diedAt;
  const res = Eco.settleMatch(holder.profile, { matchId: m.id, mode: m.mode, tier: m.tier, ranked: m.ranked, difficulty: m.difficulty, humans, bots, total, placement, survive, duration: m.t, quit,
    connFail, aborted: !!o.aborted, entry: info.entry, perks: info.perks, stats: p.stats }, now());
  if (res) {
    const c = m.conns.get(p.id);
    if (c && !holder.guest) { c.profile = holder.profile; }
    if (!holder.guest) save();
    if (c) { send(c, { t: 'result', r: res, kills: p.stats.kills, survive: Math.round(survive), mode: m.mode, tier: m.tier, matchEnded: m.phase === 'ended' }); pushMe(c); }
    p.result = res;
  }
}

function finishMatch(m) {
  if (m.finished) return; m.finished = true; m.cleanup = now() + 30000;
  if (m.mode === 'campaign') {
    const c = [...m.conns.values()][0], hero = [...m.players.values()].find(p => p.tag === 'hero');
    for (const o of m.objectives) { /* final state already stored */ }
    if (c && c.match === m && c.profile && !c.guest && !(hero && hero.quit)) {
      const out = Eco.campMission(c.profile, m.mission, m.result, m.campDiff, now(), m.id);
      save(); send(c, { t: 'camp_result', r: out, kills: hero ? hero.stats.kills : 0, survive: Math.round(hero ? (hero.alive ? m.t : hero.diedAt) : m.t), state: Eco.campState(c.profile), objectives: m.result.objectives });
      pushMe(c);
    }
    for (const [k, v] of active) if (v.m === m) active.delete(k);
    return;
  }
  for (const p of m.players.values()) if (!p.isBot) settlePlayer(m, p, p.left && !p.settled ? { connFail: true } : {});
  const top = [...m.players.values()].sort((a, b) => a.placement - b.placement)[0];
  store.addMatch({ id: m.id, t: now(), mode: m.mode, tier: m.tier, players: m.order.length, humans: [...m.players.values()].filter(p => !p.isBot).length, winner: top ? top.name : null, duration: Math.round(m.t) });
  for (const [k, v] of active) if (v.m === m) active.delete(k);
  save();
}

/* ============================================================== tick loop */
let lastT = Date.now(), acc = 0;
setInterval(() => {
  const t = Date.now(); acc += t - lastT; lastT = t; const step = 1000 / C.TICK; let n = 0;
  while (acc >= step && n < 4) {
    acc -= step; n++;
    for (const m of matches) {
      if (m.phase === 'ended' && !m.finished) { finishMatch(m); }
      try { m.tickOnce(); runScripts(m); } catch (e) { console.error('[match crash]', m.id, e.stack); abortMatch(m); }
    }
  }
  if (acc > 250) acc = 0;
  for (const m of matches) if (m.cleanup && t > m.cleanup) endMatch(m);
}, 8);
function abortMatch(m) {
  if (m.phase === 'ended') m.finished = true; matches.delete(m);
  for (const p of m.players.values()) if (!p.isBot && !p.settled) settlePlayer(m, p, { aborted: true });
  for (const c of m.conns.values()) if (c.match === m) { send(c, { t: 'aborted', m: 'The match was interrupted by a server error. Your entry stake was refunded.' }); c.match = null; c.pid = 0; }
  for (const [k, v] of active) if (v.m === m) active.delete(k);
  if (m.room) { rooms.delete(m.room.code); }
}
function endMatch(m) {
  matches.delete(m);
  for (const c of m.conns.values()) if (c.match === m) { c.match = null; c.pid = 0; }
  if (m.room) { const r = m.room; r.state = 'lobby'; r.match = null; r.startAt = 0; if (r.pub || r.mode === 'practice') { for (const c of r.members) c.room = null; rooms.delete(r.code); } else { r.members = new Set([...r.members].filter(c => c.ws.readyState === 1)); for (const c of r.members) c.room = r; if (r.members.size) { if (!r.members.has(r.host)) r.host = [...r.members][0]; pushRoom(r); } else rooms.delete(r.code); } }
  for (const [k, v] of active) if (v.m === m) active.delete(k);
}

/* ============================================================ reconnect/leave */
function detach(c, replaced) {
  if (c.room) leaveRoom(c);
  if (c.match && c.pid) {
    const m = c.match, p = m.players.get(c.pid);
    if (p && m.phase !== 'ended' && !p.left) {
      p.connected = false; m.conns.delete(c.pid);
      const key = (c.name || '').toLowerCase();
      if (m.mode === 'campaign') { m.leave(p.id, false); }
      else setTimeout(() => {
        const a = active.get(key);
        if (a && a.m === m && !p.connected && !p.left && m.phase !== 'ended') { p.connFail = true; m.leave(p.id, false); settlePlayer(m, p, { connFail: true }); }
      }, C.GRACE * 1000);
    }
  }
  c.match = null; c.pid = 0;
}
function resumeMatch(c, a) {
  const m = a.m, p = m.players.get(a.pid); if (!p || p.left) return;
  p.connected = true; m.conns.set(p.id, c); c.match = m; c.pid = p.id; c.room = m.room && m.room.members.has(c) ? m.room : null;
  const w = m.welcome(p.id); if (m.mode === 'campaign') w.camp = { mission: m.mission, resumed: true };
  send(c, { t: 'welcome', w, resumed: true, entry: { stake: 0, perks: 0 }, perks: { adv: [...p.advs], dis: [...p.diss] } });
  p.invDirty = true;
}

/* ================================================================ protocol */
wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0];
  let same = 0; for (const x of conns) if (x.ip === ip) same++;
  if (same >= 12) { ws.close(1013, 'too many connections'); return; }
  const c = { ws, ip, acct: null, profile: null, guest: false, name: '', room: null, match: null, pid: 0, tokens: 60, last: now(), pingAt: 0 };
  conns.add(c);
  send(c, { t: 'hello', online: conns.size, v: 1 });
  ws.on('message', buf => {
    const t = now(); c.tokens = Math.min(120, c.tokens + (t - c.last) / 1000 * 90); c.last = t;
    if (c.tokens < 1) return; c.tokens -= 1;
    let msg; try { msg = JSON.parse(buf.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(c, msg); } catch (e) { console.error('[handler]', msg.t, e.stack); err(c, 'Server error'); }
  });
  ws.on('close', () => { conns.delete(c); if (c.acct && byUser.get(c.acct.user.toLowerCase()) === c) byUser.delete(c.acct.user.toLowerCase()); detach(c); });
  ws.on('error', () => {});
});

function handle(c, msg) {
  switch (msg.t) {
    case 'ping': return send(c, { t: 'pong', c: msg.c, s: Date.now() });
    /* ---- auth */
    case 'register': {
      const u = msg.user, pw = msg.pass;
      if (!validUser(u)) return send(c, { t: 'autherr', m: 'Name must be 3–16 letters, numbers or _' });
      if (typeof pw !== 'string' || pw.length < 6 || pw.length > 64) return send(c, { t: 'autherr', m: 'Password must be 6–64 characters' });
      if (store.accounts[u.toLowerCase()]) return send(c, { t: 'autherr', m: 'That name is taken' });
      const salt = crypto.randomBytes(16).toString('hex');
      const acct = { user: u, salt, hash: hashPw(pw, salt), profile: Eco.newProfile(u) };
      store.accounts[u.toLowerCase()] = acct; save(); return authOk(c, acct, newToken(u));
    }
    case 'login': {
      const acct = validUser(msg.user) && store.accounts[msg.user.toLowerCase()];
      if (!acct || typeof msg.pass !== 'string') return send(c, { t: 'autherr', m: 'Wrong name or password' });
      const h = Buffer.from(hashPw(msg.pass, acct.salt), 'hex'), a = Buffer.from(acct.hash, 'hex');
      if (h.length !== a.length || !crypto.timingSafeEqual(h, a)) return send(c, { t: 'autherr', m: 'Wrong name or password' });
      return authOk(c, acct, newToken(acct.user));
    }
    case 'resume': {
      const s = typeof msg.token === 'string' && store.sessions[msg.token];
      if (!s || s.exp < now()) return send(c, { t: 'autherr', m: 'Session expired', silent: true });
      const acct = store.accounts[s.user.toLowerCase()]; if (!acct) return send(c, { t: 'autherr', m: 'Account missing', silent: true });
      return authOk(c, acct, msg.token);
    }
    case 'guest': {
      c.guest = true; c.name = 'Guest' + (1000 + rnd(9000)); c.profile = Eco.newProfile(c.name); c.profile.credits = 0; c.profile.txOrder = []; c.profile.txids = {}; c.profile.tx = [];
      c.profile.owned = E.freeIds();
      return send(c, { t: 'authed', token: null, user: c.name, guest: true, p: Eco.publicProfile(c.profile, now()), online: conns.size });
    }
  }
  if (!c.profile) return err(c, 'Sign in first');
  const P = c.profile;
  switch (msg.t) {
    case 'logout': { if (typeof msg.token === 'string') delete store.sessions[msg.token]; save(); return; }
    case 'me': return pushMe(c);
    /* ---- shop / cosmetics / loadout */
    case 'buy': {
      if (c.guest) return send(c, { t: 'shop', ok: false, error: 'Create an account to unlock cosmetics' });
      const r = Eco.buyCosmetic(P, String(msg.id), String(msg.txid || ''), now()); save();
      send(c, { t: 'shop', ok: r.ok, error: r.error, id: msg.id, ach: r.ach }); return pushMe(c);
    }
    case 'equip': { Eco.equip(P, msg.a || {}); if (!c.guest) save(); return pushMe(c); }
    case 'loadout': {
      const lo = msg.l || {}; P.loadout = { adv: (lo.adv || []).filter(x => E.PERKS[x] && E.PERKS[x].kind === 'adv').slice(0, E.MAX_ADV), dis: (lo.dis || []).filter(x => E.PERKS[x] && E.PERKS[x].kind === 'dis').slice(0, E.MAX_DIS), wclass: String(lo.wclass || 'blade') };
      if (!c.guest) save(); return pushMe(c);
    }
    case 'lb': {
      const rows = Object.values(store.accounts).map(a => ({ n: a.user, w: a.profile.stats.wins, k: a.profile.stats.kills, l: a.profile.level, m: a.profile.stats.matches })).sort((a, b) => b.w - a.w || b.k - a.k).slice(0, 15);
      return send(c, { t: 'lb', rows });
    }
    /* ---- rooms */
    case 'create': {
      if (c.match) return err(c, 'Already in a match'); const o = msg.o || {};
      const r = makeRoom(c, { mode: o.mode, tier: o.tier, ranked: o.ranked, difficulty: o.difficulty, bots: o.bots, max: o.max, pub: false });
      joinRoom(c, r); return;
    }
    case 'practice': {
      if (c.match) return err(c, 'Already in a match'); const o = msg.o || {};
      const r = makeRoom(c, { mode: 'practice', tier: 'free', difficulty: o.difficulty, bots: clamp(o.bots | 0 || 7, 1, 23), max: 1 });
      r.mode = 'practice'; joinRoom(c, r); return startRoom(r);
    }
    case 'join': {
      if (c.match) return err(c, 'Already in a match');
      const r = rooms.get(String(msg.code || '').toUpperCase().trim()); if (!r) return err(c, 'No room with that code');
      return joinRoom(c, r);
    }
    case 'queue': return queue(c, msg.o || {});
    case 'leave_room': return leaveRoom(c);
    case 'room_set': {
      const r = c.room; if (!r || r.host !== c || r.state !== 'lobby' || r.pub) return; const o = msg.o || {};
      if (['solo', 'duos', 'teams', 'private'].includes(o.mode)) r.mode = o.mode; if (E.TIERS[o.tier]) r.tier = o.tier; if (typeof o.ranked === 'boolean') r.ranked = o.ranked;
      if (C.DIFFICULTY[o.difficulty]) r.difficulty = o.difficulty; if (o.bots != null) r.bots = clamp(o.bots | 0, 0, 23); if (o.max != null) r.max = clamp(o.max | 0, 2, C.MAX_PLAYERS);
      for (const m of r.members) { const ok = canEnterRoom(m, r); if (!ok.ok && m !== c) { send(m, { t: 'err', m: ok.error }); } }
      return pushRoom(r);
    }
    case 'start': { const r = c.room; if (!r || r.host !== c || r.state !== 'lobby') return; if (r.members.size + r.bots < 2) return err(c, 'Add bots or wait for another player'); return startRoom(r); }
    case 'chat': { const r = c.room; if (!r) return; const text = String(msg.m || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 140); if (!text) return; for (const x of r.members) send(x, { t: 'chat', n: c.name, m: text }); return; }
    /* ---- in-match */
    case 'in': { if (c.match) c.match.input(c.pid, { s: msg.s | 0, mx: +msg.mx || 0, mz: +msg.mz || 0, y: +msg.y || 0, p: +msg.p || 0, f: msg.f | 0 }); return; }
    case 'act': {
      if (!c.match) return; const d = msg.d || {}, ty = String(msg.a);
      if (!['sel', 'pick', 'drop', 'move', 'armor', 'craft', 'reload', 'ally', 'emote'].includes(ty)) return;
      const clean = { i: d.i | 0, n: d.n | 0, a: d.a | 0, b: d.b | 0, id: typeof d.id === 'string' ? d.id.slice(0, 20) : undefined, to: d.to | 0, k: d.k === 'break' ? 'break' : 'offer', e: typeof d.e === 'string' ? d.e.slice(0, 20) : undefined };
      if (ty === 'emote') { const e = 'emote:' + clean.e; if (!P.owned.includes(e)) clean.e = 'wave'; }
      return c.match.action(c.pid, ty, clean);
    }
    case 'quit': {
      const m = c.match; if (!m) return; const p = m.players.get(c.pid); if (!p) return;
      const wasAlive = p.alive;
      if (m.phase === 'countdown') { m.leave(p.id, false); settlePlayer(m, p, { aborted: true }); }
      else { m.leave(p.id, true); if (m.mode !== 'campaign') settlePlayer(m, p, { quit: true }); }
      c.match = null; c.pid = 0; active.delete(c.name.toLowerCase());
      if (c.room) { c.room = null; }
      return send(c, { t: 'left', quit: true });
    }
    case 'to_menu': { if (c.match && c.match.phase === 'ended') { c.match = null; c.pid = 0; } if (c.room && c.room.state !== 'lobby') c.room = null; return; }
    /* ---- campaign */
    case 'camp_scene': {
      const r = Eco.campScene(P, String(msg.mission), Array.isArray(msg.picks) ? msg.picks.map(x => x | 0).slice(0, 20) : [], now()); if (r.ok) save();
      send(c, { t: 'camp_scene', mission: msg.mission, r, state: Eco.campState(P) }); return pushMe(c);
    }
    case 'camp_start': return launchCampaign(c, String(msg.mission));
    case 'camp_diff': { if (C.DIFFICULTY[msg.d]) { P.campaign.diff = msg.d; save(); } return pushMe(c); }
  }
}

/* ================================================================== boot */
const ready = store.init().then(() => {
  server.listen(PORT, () => log('Hunger Games server on http://localhost:' + PORT + ' · saving to ' + store.backend + ' · ' + Object.keys(store.accounts).length + ' accounts loaded'));
}).catch(e => { console.error('FATAL: could not reach the database — ' + e.message + '\nCheck UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.'); process.exit(1); });
const bye = () => { Promise.resolve(store.flush()).then(() => process.exit(0), () => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
module.exports = { server, store, matches, status, ready };
