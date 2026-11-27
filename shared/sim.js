/* Authoritative match simulation. Runs on the server for online games and inside the browser for offline practice. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'), require('./catalog'), require('./terrain'), require('./movement'), require('./bots'));
  else { root.HG = root.HG || {}; root.HG.Sim = factory(root.HG.C, root.HG.E, root.HG.Terrain, root.HG.Move, root.HG.Bots); }
})(typeof self !== 'undefined' ? self : globalThis, function (C, E, Terrain, Move, Bots) {
  const P = C.PLAYER, W = C.WORLD, DT = C.DT, F = Move.F;
  const R2 = v => Math.round(v * 100) / 100;
  const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Match {
    /* opts: {id, seed, mode, tier, ranked, difficulty, noZone, noEvents, noWildlife, objectives, timeLimit, send(pid,event,data), hooks:{onTeamOut,onEnd}} */
    constructor(opts) {
      this.id = opts.id || 'm' + Math.random().toString(36).slice(2, 8);
      this.opts = opts;
      this.seed = opts.seed || ((Math.random() * 2 ** 31) | 0) || 1;
      this.rng = Terrain.mulberry(this.seed ^ 0x51ed270b);
      this.world = Terrain.createWorld(this.seed);
      this.mode = opts.mode || 'solo'; this.tier = opts.tier || 'free'; this.ranked = !!opts.ranked;
      this.difficulty = opts.difficulty || 'normal';
      this.send = opts.send || (() => {}); this.hooks = opts.hooks || {};
      this.phase = 'lobby'; this.t = 0; this.tick = 0; this.countdown = C.COUNTDOWN;
      this.players = new Map(); this.order = []; this.nextPid = 1;
      this.loot = new Map(); this.nextLoot = 1;
      this.proj = []; this.nextProj = 1; this.traps = []; this.nextTrap = 1; this.tracks = []; this.mutts = []; this.nextMutt = 1;
      this.hazards = []; this.nextHaz = 1; this.strikes = [];
      this.evAll = []; this.evTo = new Map();
      this.allies = new Map(); this.offers = new Map();
      this.aliveCount = 0; this.teamsOut = 0; this.deathOrder = [];
      this.weather = { type: 0, until: 90 }; this.eventClock = 95 + this.rng() * 25; this.stormUntil = 0; this.nextStrike = 0;
      this.noise_ = [];
      this.objectives = (opts.objectives || []).map(o => Object.assign({ done: false, p: 0, failed: false }, o));
      this.result = null; this.endT = 0;
      this.zone = this.makeZone();
      this.spawnWorldLoot();
      if (!opts.noWildlife) this.spawnMutts(8, true);
    }

    /* --------------------------------------------------------------- setup */
    makeZone() {
      const phases = [], r = this.rng; let cx = 0, cz = 0, cr = W.zoneStart;
      for (const ph of C.ZONE_PHASES) {
        const maxOff = Math.max(0, (cr - ph.r) * 0.8), a = r() * Math.PI * 2, d = Math.sqrt(r()) * maxOff;
        const nx = cx + Math.cos(a) * d, nz = cz + Math.sin(a) * d;
        phases.push({ wait: ph.wait, shrink: ph.shrink, r: ph.r, dps: ph.dps, x: nx, z: nz });
        cx = nx; cz = nz; cr = ph.r;
      }
      return { x: 0, z: 0, r: W.zoneStart, phases, idx: 0, state: this.opts.noZone ? 'off' : 'wait', timer: phases[0].wait, fromX: 0, fromZ: 0, fromR: W.zoneStart, dps: 0, final: 0 };
    }
    spawnWorldLoot() {
      const w = this.world;
      for (const s of w.lootSpots) {
        const n = s.tier === 1 ? 1 + (this.rng() < 0.4 ? 1 : 0) : s.tier === 3 ? 1 + (this.rng() < 0.5 ? 1 : 0) : 2;
        for (let i = 0; i < n; i++) this.rollLoot(s.tier, s.x + (this.rng() - 0.5) * 2, s.z + (this.rng() - 0.5) * 2);
      }
    }
    rollLoot(tier, x, z) {
      const tbl = C.LOOT[tier]; let tot = 0; for (const e of tbl) tot += e[1];
      let r = this.rng() * tot, pick = tbl[0]; for (const e of tbl) { r -= e[1]; if (r <= 0) { pick = e; break; } }
      const n = pick[2] + Math.floor(this.rng() * (pick[3] - pick[2] + 1));
      return this.addLoot(this.makeItem(pick[0], n), x, z);
    }
    makeItem(id, n, wear) {
      const def = C.ITEMS[id], it = { id, n: n || 1 };
      if (def.type === 'weapon') { const w = C.WEAPONS[id]; it.n = 1; it.d = Math.max(1, Math.round(w.dur * (wear || 1))); if (w.type === 'ranged') it.l = w.mag; }
      if (def.type === 'armor') { it.n = 1; it.d = Math.max(1, Math.round(def.dur * (wear || 1))); }
      return it;
    }
    addLoot(item, x, z) {
      const L = { id: this.nextLoot++, it: item, x, z, y: this.world.height(x, z) };
      this.loot.set(L.id, L); return L;
    }
    spawnMutts(n, initial) {
      for (let i = 0; i < n; i++) {
        let x, z, k = 0;
        do { const a = this.rng() * 6.28, rr = initial ? 110 + this.rng() * 300 : Math.min(this.zone.r, 200) * (0.6 + this.rng() * 0.5); x = this.zone.x + Math.cos(a) * rr; z = this.zone.z + Math.sin(a) * rr; k++; } while ((this.world.inWater(x, z) || Math.hypot(x, z) > W.radius - 15) && k < 20);
        this.mutts.push({ id: this.nextMutt++, x, z, y: this.world.height(x, z), yaw: 0, hp: C.WILDLIFE.mutt.hp, cd: 0, hx: x, hz: z, vx: 0, vz: 0, target: 0, state: 0, hunting: !initial });
      }
    }

    addPlayer(d) {
      const id = this.nextPid++, perks = d.perks || { adv: [], dis: [] };
      const advs = new Set(perks.adv || []), diss = new Set(perks.dis || []);
      const p = {
        id, name: d.name || 'Tribute ' + id, app: d.appearance || E.DEFAULT_APPEARANCE, isBot: !!d.isBot, acct: d.acct || null, team: d.team != null ? d.team : id,
        title: d.title || '', level: d.level || 1,
        personality: d.personality || null, bot: null, botDiff: d.difficulty || this.difficulty, tag: d.tag || null, role: d.role || 'normal',
        connected: !d.isBot, alive: true, placement: 0, quit: false, left: false,
        ...Move.newState(0, 0, this.world),
        pitch: 0, hp: P.maxHp, hunger: 100, thirst: 100, inv: [], sel: 0, armor: null, cd: 0, reloading: null, using: null, swing: 0, swingN: 0,
        queue: [], budget: 2, lastSeq: 0, cmd: null, invDirty: true, lastHit: 0, lastHitBy: 0, lastDmgT: -99, noiseT: 0, footD: 0, lastPX: 0, lastPZ: 0,
        advs, diss, wclass: perks.wclass || null, redExtra: advs.has('reinforced') ? 0.06 : 0,
        scoutUntil: advs.has('scout_training') ? 180 : 0, tracker: advs.has('tracker'), knowledge: advs.has('knowledge'),
        marked: diss.has('marked'), markT: 40 + this.rng() * 20, stats: { kills: 0, botKills: 0, humanKills: 0, byClass: {}, dmg: 0, head: 0, resources: 0, heals: 0, crafts: 0, corn: false, hidden: [], placements: 0, victims: [], betrayals: 0 },
        diedAt: 0, killedBy: 0, spawnIdx: 0, ack: 0, tick: 0, dummyHp: 0,
      };
      p.maxStamina = diss.has('heavy_load') ? 70 : P.maxStamina; p.stamina = p.maxStamina;
      p.cap = 12 + (advs.has('extra_space') ? 4 : 0) - (diss.has('poor_prep') ? 2 : 0);
      for (let i = 0; i < p.cap; i++) p.inv.push(null);
      this.players.set(id, p); this.order.push(id);
      // starting kit — everyone gets basic survival gear
      const wear = diss.has('damaged_equip') ? 0.4 : 1;
      this.give(p, this.makeItem('knife_crude', 1, diss.has('damaged_equip') ? 0.4 : 1));
      if (!diss.has('limited_supplies')) { this.give(p, this.makeItem('water_bottle', 1)); this.give(p, this.makeItem('berries', 2)); }
      if (!diss.has('no_medical')) this.give(p, this.makeItem('bandage', 1));
      if (advs.has('survival_kit')) { this.give(p, this.makeItem('berries', 2)); this.give(p, this.makeItem('water_bottle', 2)); this.give(p, this.makeItem('bandage', 2)); }
      if (advs.has('medical_kit')) { this.give(p, this.makeItem('medkit', 1)); this.give(p, this.makeItem('bandage', 1)); }
      if (diss.has('poor_prep')) { p.hunger = 60; p.thirst = 60; }
      p.dmgWear = diss.has('damaged_equip') ? 0.75 : 1;
      if (p.isBot && Bots) p.bot = new Bots.Brain(this, p);
      return p;
    }

    /* ------------------------------------------------------------ inventory */
    give(p, item) {   // returns leftover count
      const def = C.ITEMS[item.id]; let left = item.n; p.invDirty = true;
      if (def.stack > 1) for (const s of p.inv) { if (s && s.id === item.id && s.n < def.stack) { const k = Math.min(def.stack - s.n, left); s.n += k; left -= k; if (!left) return 0; } }
      for (let i = 0; i < p.inv.length && left > 0; i++) {
        if (!p.inv[i]) { const k = Math.min(def.stack, left); p.inv[i] = Object.assign({}, item, { n: k }); left -= k; }
      }
      return left;
    }
    count(p, id) { let n = 0; for (const s of p.inv) if (s && s.id === id) n += s.n; return n; }
    take(p, id, n) {
      p.invDirty = true;
      for (let i = p.inv.length - 1; i >= 0 && n > 0; i--) { const s = p.inv[i]; if (s && s.id === id) { const k = Math.min(s.n, n); s.n -= k; n -= k; if (s.n <= 0) p.inv[i] = null; } }
      return n === 0;
    }
    held(p) { return p.inv[p.sel] || null; }
    weaponOf(p) { const s = this.held(p); return s && C.WEAPONS[s.id] ? C.WEAPONS[s.id] : C.WEAPONS.fists; }
    dropAt(p, item, x, z) { const a = this.rng() * 6.28, r = 0.6 + this.rng() * 1.0; return this.addLoot(item, x + Math.cos(a) * r, z + Math.sin(a) * r); }

    action(pid, type, d) {
      const p = this.players.get(pid); if (!p || !p.alive || this.phase === 'ended') return;
      d = d || {};
      switch (type) {
        case 'sel': { const i = d.i | 0; if (i >= 0 && i < p.inv.length && i !== p.sel) { p.sel = i; p.using = null; p.reloading = null; p.invDirty = true; } break; }
        case 'pick': this.pickup(p); break;
        case 'drop': {
          const i = d.i | 0, s = p.inv[i]; if (!s) break;
          const n = Math.min(s.n, Math.max(1, d.n | 0 || s.n));
          const it = Object.assign({}, s, { n }); s.n -= n; if (s.n <= 0) p.inv[i] = null;
          this.dropAt(p, it, p.x, p.z); p.invDirty = true; if (p.using && p.using.slot === i) p.using = null; break;
        }
        case 'move': { const a = d.a | 0, b = d.b | 0; if (a !== b && a >= 0 && b >= 0 && a < p.inv.length && b < p.inv.length) {
          const A = p.inv[a], B = p.inv[b];
          if (A && B && A.id === B.id && C.ITEMS[A.id].stack > 1) { const k = Math.min(C.ITEMS[A.id].stack - B.n, A.n); B.n += k; A.n -= k; if (A.n <= 0) p.inv[a] = null; }
          else { p.inv[a] = B; p.inv[b] = A; }
          if (p.sel === a) p.sel = b; else if (p.sel === b) p.sel = a;
          p.invDirty = true; p.using = null; p.reloading = null; } break; }
        case 'armor': {      // equip armour from slot i (swap with current), or unequip if i<0
          const i = d.i | 0;
          if (i < 0) { if (p.armor) { const it = p.armor; if (this.give(p, it) === 0) { p.armor = null; } } }
          else { const s = p.inv[i]; if (s && C.ITEMS[s.id].type === 'armor') { const old = p.armor; p.armor = s; p.inv[i] = old; } }
          p.invDirty = true; break;
        }
        case 'craft': this.craft(p, d.id); break;
        case 'reload': this.startReload(p); break;
        case 'ally': this.allyAction(p, d); break;
        case 'emote': this.bcast({ t: 'emote', i: p.id, e: String(d.e || 'wave').slice(0, 20) }); break;
      }
    }

    pickup(p) {
      let best = null, bd = P.pickupRange * P.pickupRange;
      for (const L of this.loot.values()) { const d = dist2(L.x, L.z, p.x, p.z); if (d < bd && Math.abs(L.y - p.y) < 3) { bd = d; best = L; } }
      if (!best) { // no loot — drink if standing at the water's edge
        if (p.noiseT > -9) { const fx = p.x - Math.sin(p.yaw) * 1.2, fz = p.z - Math.cos(p.yaw) * 1.2;
          if ((p.inWater || this.world.inWater(fx, fz)) && p.thirst < 100 && (p.drinkCd || 0) <= this.t) { p.thirst = Math.min(100, p.thirst + 14); p.drinkCd = this.t + 0.45; this.to(p.id, { t: 'drink' }); } }
        return;
      }
      const it = best.it, before = it.n, def = C.ITEMS[it.id];
      const left = this.give(p, it);
      if (left === before) { this.to(p.id, { t: 'msg', m: 'Inventory full' }); return; }
      if (def.type === 'mat' || def.type === 'food' || def.type === 'water' || def.type === 'med') p.stats.resources += before - left;
      if (left > 0) it.n = left; else { this.loot.delete(best.id); this.bcast({ t: 'lr', id: best.id }); }
      if (def.type === 'weapon' && !p.inv[p.sel]) { p.sel = p.inv.findIndex(s => s && s.id === it.id); }
      if (this.phase === 'live' && p.diss.has('damaged_equip') && (def.type === 'weapon' || def.type === 'armor')) { const s = p.inv.find(s => s && s.id === it.id); if (s && s.d && !s.worn) { s.d = Math.max(1, Math.round(s.d * 0.75)); s.worn = 1; } }
      this.to(p.id, { t: 'pickup', id: it.id, n: before - left });
      this.noise(p.x, p.z, 4, p.id);
    }

    craft(p, rid) {
      const r = C.RECIPES.find(x => x.id === rid); if (!r) return;
      for (const k in r.needs) if (this.count(p, k) < r.needs[k]) { this.to(p.id, { t: 'msg', m: 'Missing materials' }); return; }
      // make sure the result fits (free slot or stack room) before consuming
      const probe = this.makeItem(r.out.id, r.out.n, r.dur);
      const saved = p.inv.map(s => s && Object.assign({}, s));
      for (const k in r.needs) this.take(p, k, r.needs[k]);
      if (this.give(p, probe) > 0) { p.inv = saved; this.to(p.id, { t: 'msg', m: 'Inventory full' }); return; }
      p.stats.crafts++; p.invDirty = true; this.to(p.id, { t: 'crafted', id: r.id });
    }

    startReload(p) {
      const s = this.held(p), w = s && C.WEAPONS[s.id]; if (!w || w.type !== 'ranged' || p.reloading || s.l >= w.mag) return;
      if (this.count(p, w.ammo) <= 0) { this.to(p.id, { t: 'msg', m: 'No ammo' }); return; }
      p.reloading = { slot: p.sel, t: w.reload * this.cdMul(p, w) };
      this.to(p.id, { t: 'reload', d: p.reloading.t });
    }
    cdMul(p, w) { return p.wclass && C.WEAPON_CLASS[w.id] === p.wclass && p.advs.has('weapon_training') ? 0.92 : 1; }

    /* ---------------------------------------------------------------- alliances */
    isAllied(a, b) { const s = this.allies.get(a); return !!(s && s.has(b)); }
    friendly(a, b) { return a.id === b.id || a.team === b.team || this.isAllied(a.id, b.id); }
    allyAction(p, d) {
      const o = this.players.get(d.to | 0); if (!o || !o.alive || o.id === p.id || o.team === p.team) return;
      if (d.k === 'break') { if (this.isAllied(p.id, o.id)) { this.setAlly(p.id, o.id, false); p.stats.betrayals++; this.to(o.id, { t: 'ally', k: 'broken', i: p.id }); this.to(p.id, { t: 'ally', k: 'broken', i: o.id }); if (o.bot) o.bot.onBetrayed(p); } return; }
      if (dist2(p.x, p.z, o.x, o.z) > 20 * 20) return;
      const rev = this.offers.get(o.id + '>' + p.id);
      if (rev && rev > this.t) { this.offers.delete(o.id + '>' + p.id); this.setAlly(p.id, o.id, true); this.to(p.id, { t: 'ally', k: 'formed', i: o.id }); this.to(o.id, { t: 'ally', k: 'formed', i: p.id }); return; }
      this.offers.set(p.id + '>' + o.id, this.t + 15);
      this.to(o.id, { t: 'ally', k: 'offer', i: p.id, n: p.name });
      if (o.bot) o.bot.onOffer(p);
    }
    setAlly(a, b, on) {
      for (const [x, y] of [[a, b], [b, a]]) { let s = this.allies.get(x); if (!s) this.allies.set(x, s = new Set()); on ? s.add(y) : s.delete(y); }
    }

    /* ------------------------------------------------------------------ events */
    bcast(e) { this.evAll.push(e); }
    to(pid, e) { let a = this.evTo.get(pid); if (!a) this.evTo.set(pid, a = []); a.push(e); }
    noise(x, z, r, src) { this.noise_.push([x, z, r, src]); }

    /* ---------------------------------------------------------------- lifecycle */
    start() {
      // spawn on pedestals, team-mates adjacent
      const ids = this.order.slice().sort((a, b) => this.players.get(a).team - this.players.get(b).team || a - b);
      const n = ids.length, sp = this.world.spawns, spawnAt = this.opts.spawnAt;
      ids.forEach((id, i) => {
        const p = this.players.get(id), s = sp[Math.floor(i * sp.length / Math.max(1, n)) % sp.length];
        p.x = spawnAt ? spawnAt.x + (i % 4) * 2.2 : s.x; p.z = spawnAt ? spawnAt.z + Math.floor(i / 4) * 2.2 : s.z; p.y = this.world.height(p.x, p.z);
        p.yaw = spawnAt ? 0 : Math.atan2(p.x, p.z) + Math.PI;   // face the Cornucopia (forward = -sin,-cos)
        p.lastPX = p.x; p.lastPZ = p.z; p.spawnIdx = i;
      });
      this.aliveCount = this.order.length;
      this.phase = 'countdown'; this.countdown = this.opts.noCountdown ? 0.5 : C.COUNTDOWN;
      this.bcast({ t: 'phase', p: 'countdown', c: this.countdown });
    }

    welcome(pid) {
      const p = this.players.get(pid); if (!p) return null;
      return { id: pid, matchId: this.id, mode: this.mode, tier: this.tier, ranked: this.ranked, difficulty: this.difficulty, world: this.world.payload(), phases: this.zone.phases.map(x => ({ r: x.r, x: R2(x.x), z: R2(x.z), wait: x.wait, shrink: x.shrink })),
        roster: this.order.map(id => { const q = this.players.get(id); return { i: id, n: q.name, tm: q.team, a: q.app, b: q.isBot ? 1 : 0, t: q.title, l: q.level, per: q.isBot && q.personality ? q.personality : undefined }; }),
        t: this.t, ph: this.phase, cd: this.countdown, objectives: this.objectives.map(o => ({ id: o.id, type: o.type, text: o.text, optional: !!o.optional, n: o.n || o.seconds || 0, done: o.done })), noZone: !!this.opts.noZone,
        scout: p.scoutUntil > 0, tracker: p.tracker, knowledge: p.knowledge, marked: p.marked, recipes: C.RECIPES.map(r => r.id) };
    }

    /* human input: {s: seq, mx, mz, y: yaw, p: pitch, f: flags} */
    input(pid, m) {
      const p = this.players.get(pid); if (!p || !p.alive || p.isBot) return;
      if (p.queue.length > 8) p.queue.splice(0, p.queue.length - 8);
      p.queue.push(m);
    }

    tickOnce() {
      this.tick++;
      if (this.phase === 'ended') return;
      if (this.phase === 'countdown') {
        this.countdown -= DT; this.t += 0;
        if (this.countdown <= 0) { this.phase = 'live'; this.bcast({ t: 'phase', p: 'live' }); this.bcast({ t: 'announce', m: 'LET THE GAMES BEGIN', k: 'gong' }); }
        for (const p of this.players.values()) { if (p.queue.length) { const m = p.queue[p.queue.length - 1]; p.lastSeq = m.s | 0; p.queue.length = 0; p.yaw = +m.y || p.yaw; p.pitch = clamp(+m.p || 0, -1.4, 1.4); } }
        if (this.tick % C.SNAP_EVERY === 0) this.snapshots();
        return;
      }
      this.t += DT;
      // 1) inputs → movement/combat
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (p.isBot) {
          if (p.bot && p.role !== 'dummy') p.bot.update(DT);
          const c = p.cmd || { mx: 0, mz: 0, yaw: p.yaw, pitch: 0, f: 0 };
          this.applyInput(p, c, DT);
        } else {
          p.budget = Math.min(3, p.budget + 1);
          let n = 0;
          while (p.queue.length && p.budget >= 1 && n < 3) { const m = p.queue.shift(); p.budget -= 1; n++; this.applyInput(p, { mx: m.mx, mz: m.mz, yaw: m.y, pitch: m.p, f: m.f | 0 }, DT); p.lastSeq = m.s | 0; }
          if (!n && !p.connected) this.applyInput(p, { mx: 0, mz: 0, yaw: p.yaw, pitch: p.pitch, f: 0 }, DT);
        }
      }
      // 2) world systems
      this.updateSurvival(DT); this.updateProjectiles(DT); this.updateTraps(DT); this.updateMutts(DT);
      if (this.zone.state !== 'off') this.updateZone(DT);
      if (!this.opts.noEvents) this.updateEvents(DT);
      this.updateHazards(DT); this.updateWeather(DT); this.updateMisc(DT);
      this.dispatchNoise();
      if (this.tick % 15 === 0) this.updateObjectives();
      this.checkEnd();
      if (this.tick % C.SNAP_EVERY === 0) this.snapshots();
    }

    applyInput(p, c, dt) {
      p.pitch = clamp(+c.pitch || 0, -1.4, 1.4);
      p.speedMul = 1 - (p.using ? 0.35 : 0) - (p.armor && p.armor.id === 'armor_heavy' ? 0.05 : 0);
      if (this.phase === 'countdown') c = { mx: 0, mz: 0, yaw: c.yaw, f: 0 };
      Move.step(p, { mx: c.mx, mz: c.mz, yaw: c.yaw, f: c.f }, this.world, dt);
      // timers
      if (p.cd > 0) p.cd -= dt;
      if (p.swing > 0) p.swing -= dt;
      if (p.reloading) { p.reloading.t -= dt; if (p.reloading.t <= 0) this.finishReload(p); }
      if (p.using) this.tickUse(p, dt);
      if ((c.f & F.ATTACK) && p.cd <= 0 && this.phase === 'live') this.attack(p, !!(c.f & F.AIM));
      // footsteps → noise + tracks
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 1 && p.onGround) {
        p.footD += sp * dt; const stride = p.sprinting ? 2.4 : 1.8;
        if (p.footD > stride) { p.footD = 0; this.noise(p.x, p.z, p.sprinting ? 18 : p.crouch ? 2.5 : 9, p.id); this.bcast({ t: 'step', i: p.id, x: R2(p.x), z: R2(p.z), w: p.inWater ? 1 : 0 }); if (!p.crouch) this.tracks.push({ x: p.x, z: p.z, t: this.t, o: p.id, a: p.yaw }); }
      }
      if (this.world.inCorn(p.x, p.z)) p.stats.corn = true;
      if (this.phase === 'live') for (const h of this.world.hidden) if (!p.stats.hidden.includes(h.id) && dist2(h.x, h.z, p.x, p.z) < h.r * h.r) { p.stats.hidden.push(h.id); this.to(p.id, { t: 'hidden', id: h.id }); this.bcast({ t: 'sfx', k: 'discover', x: h.x, z: h.z }); }
    }

    /* ------------------------------------------------------------------ combat */
    attack(p, aiming) {
      const s = this.held(p), def = s && C.ITEMS[s.id];
      if (def && def.type !== 'weapon') {
        if (def.type === 'food' || def.type === 'water' || def.type === 'med') { if (!p.using) this.startUse(p); p.cd = 0.2; }
        else if (def.type === 'trap') { this.placeTrap(p, s); p.cd = 0.8; }
        else if (def.type === 'armor') { this.action(p.id, 'armor', { i: p.sel }); p.cd = 0.5; }
        return;
      }
      if (p.using || p.reloading && C.WEAPONS[s && s.id] && C.WEAPONS[s.id].type === 'ranged') return;
      const w = this.weaponOf(p), cdm = this.cdMul(p, w);
      if (w.type === 'ranged') {
        if (!s || s.l <= 0) { this.startReload(p); p.cd = 0.25; return; }
        s.l--; p.cd = w.cd * cdm; p.swing = 0.25; p.swingN++; p.invDirty = true;
        let spread = (aiming ? w.aimSpread : w.spread) * (Math.hypot(p.vx, p.vz) > 1 ? 1.6 : 1) * (p.sprinting ? 1.6 : 1) * (p.crouch ? 0.75 : 1);
        if (p.wclass && C.WEAPON_CLASS[w.id] === p.wclass && p.advs.has('weapon_training')) spread *= 0.85;
        this.spawnProjectile(p, w.id, w.dmg, w.speed, w.gravity, spread, w.ammo, s, aiming);
        this.bcast({ t: 'shot', i: p.id, w: w.id, x: R2(p.x), z: R2(p.z) }); this.noise(p.x, p.z, 28, p.id);
        this.wear(p, s, 1);
        if (s && p.inv[p.sel] === s && s.l <= 0 && this.count(p, w.ammo) > 0) this.startReload(p);
        return;
      }
      if (aiming && w.throw && s) {   // thrown weapon
        const it = p.inv[p.sel]; if (!it) return;
        p.inv[p.sel] = null; p.invDirty = true; p.cd = 0.7; p.swing = 0.3; p.swingN++;
        this.spawnProjectile(p, w.id, w.throw.dmg, w.throw.speed, w.throw.gravity, 1.2, 'thrown', it, true);
        this.bcast({ t: 'shot', i: p.id, w: w.id, x: R2(p.x), z: R2(p.z), th: 1 }); this.noise(p.x, p.z, 14, p.id); return;
      }
      // melee
      p.cd = w.cd * cdm; p.swing = 0.28; p.swingN++;
      this.noise(p.x, p.z, 16, p.id);
      const ex = p.x, ez = p.z, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      let best = null, bd = 1e9, bkind = 0;
      const cand = [];
      for (const q of this.players.values()) if (q.alive && q.id !== p.id && !this.friendly(p, q) && !this.noDamage(q)) cand.push([q, 0]);
      for (const m of this.mutts) cand.push([m, 1]);
      for (const [q, kind] of cand) {
        const dx = q.x - ex, dz = q.z - ez, d = Math.hypot(dx, dz); if (d > w.range + 0.5 || Math.abs(q.y - p.y) > 2.2) continue;
        const dot = (dx * fx + dz * fz) / (d || 1); if (dot < Math.cos(w.arc / 2)) continue;
        if (this.wallBetween(ex, ez, q.x, q.z, p.y + 1)) continue;
        if (d < bd) { bd = d; best = q; bkind = kind; }
      }
      if (best) {
        let dmg = w.dmg;
        if (bkind === 0 && w.backstab) { const bfx = -Math.sin(best.yaw), bfz = -Math.cos(best.yaw); const to = Math.hypot(best.x - ex, best.z - ez) || 1; if (((best.x - ex) * bfx + (best.z - ez) * bfz) / to > 0.55) { dmg *= w.backstab; this.to(p.id, { t: 'crit' }); } }
        this.wear(p, p.inv[p.sel], 1);
        if (bkind === 0) this.damage(best, dmg, p, w.id, { melee: true }); else this.hurtMutt(best, dmg, p);
      }
    }
    wear(p, s, amt) {
      if (!s || s.d == null) return;
      const w = C.WEAPONS[s.id]; let k = amt;
      if (w && p.wclass && C.WEAPON_CLASS[w.id] === p.wclass && p.advs.has('weapon_training')) k *= 0.8;
      s.dw = (s.dw || 0) + k; if (s.dw >= 1) { s.d -= Math.floor(s.dw); s.dw -= Math.floor(s.dw); p.invDirty = true; }
      if (s.d <= 0) { const i = p.inv.indexOf(s); if (i >= 0) p.inv[i] = null; p.invDirty = true; this.to(p.id, { t: 'broke', id: s.id }); }
    }
    noDamage(q) { return q.role === 'dummyGhost'; }

    spawnProjectile(p, wid, dmg, speed, grav, spreadDeg, kind, item, aim) {
      const ey = Move.eyeY(p);
      let by = p.yaw, bp = p.pitch;
      if (!p.isBot) {   // humans use an over-the-shoulder camera: converge the shot onto the camera's line of sight (45 m) so it lands where the crosshair points
        const cp0 = Math.cos(p.pitch), d0x = -Math.sin(p.yaw) * cp0, d0y = Math.sin(p.pitch), d0z = -Math.cos(p.yaw) * cp0;
        const dist = aim ? 1.9 : 3.5, sh = aim ? 0.75 : 0.55, rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
        const tx = p.x - d0x * dist + rx * sh + d0x * 45, ty = ey - d0y * dist + d0y * 45, tz = p.z - d0z * dist + rz * sh + d0z * 45;
        const vx = tx - p.x, vy = ty - ey, vz = tz - p.z, hl = Math.hypot(vx, vz);
        if (hl > 1) { by = Math.atan2(-vx, -vz); bp = Math.atan2(vy, hl); }
      }
      let yaw = by + (this.rng() - 0.5) * 2 * spreadDeg * Math.PI / 180 * 0.6, pitch = bp + (this.rng() - 0.5) * 2 * spreadDeg * Math.PI / 180 * 0.6;
      const cp = Math.cos(pitch);
      const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
      this.proj.push({ id: this.nextProj++, o: p.id, tm: p.team, wid, kind, dmg, g: grav, x: p.x + dx * 0.6, y: ey - 0.1 + dy * 0.6, z: p.z + dz * 0.6, vx: dx * speed, vy: dy * speed, vz: dz * speed, life: 4, item: kind === 'thrown' ? item : null, sx: p.x, sz: p.z });
    }

    updateProjectiles(dt) {
      const w = this.world;
      for (let i = this.proj.length - 1; i >= 0; i--) {
        const q = this.proj[i]; q.life -= dt;
        const sp = Math.hypot(q.vx, q.vy, q.vz), steps = Math.max(1, Math.ceil(sp * dt / 0.4)), h = dt / steps;
        let hit = false;
        for (let s = 0; s < steps && !hit; s++) {
          q.vy -= q.g * h; q.x += q.vx * h; q.y += q.vy * h; q.z += q.vz * h;
          if (q.y <= w.height(q.x, q.z) + 0.02 || Math.hypot(q.x, q.z) > W.radius + 30) { hit = true; this.projLand(q); break; }
          for (const o of w.query(q.x, q.z, 1.5)) {
            if (o.k === 0) { if (q.y < o.top && dist2(q.x, q.z, o.x, o.z) < o.r * o.r) { hit = true; this.projLand(q); break; } }
            else if (q.x > o.minx && q.x < o.maxx && q.z > o.minz && q.z < o.maxz && q.y < o.top && q.y > o.base) { hit = true; this.projLand(q); break; }
          }
          if (hit) break;
          for (const t of this.players.values()) {
            if (!t.alive || t.id === q.o || t.team === q.tm || this.noDamage(t)) continue;
            const att = this.players.get(q.o); if (att && this.isAllied(att.id, t.id)) continue;
            const hgt = t.crouch ? P.crouchHeight : P.height;
            if (q.y < t.y || q.y > t.y + hgt + 0.1) continue;
            const dx = q.x - t.x, dz = q.z - t.z; if (dx * dx + dz * dz > 0.5 * 0.5) continue;
            const head = q.y > t.y + hgt * 0.78; hit = true;
            let dmg = q.dmg * (head ? 1.6 : 1); if (q.kind === 'arrow' || q.kind === 'bolt') dmg *= clamp(1 - Math.hypot(q.x - q.sx, q.z - q.sz) / 400, 0.6, 1);
            this.damage(t, dmg, att || null, q.wid, { head, proj: true }); break;
          }
          if (hit) break;
          for (const m of this.mutts) { if (Math.abs(q.y - (m.y + 0.5)) < 0.8 && dist2(q.x, q.z, m.x, m.z) < 0.7 * 0.7) { hit = true; this.hurtMutt(m, q.dmg, this.players.get(q.o)); break; } }
        }
        if (hit || q.life <= 0) this.proj.splice(i, 1);
      }
    }
    projLand(q) {   // thrown weapons drop back as loot
      if (q.kind === 'thrown' && q.item) { const it = q.item; if (it.d != null) it.d = Math.max(1, it.d - 3); this.addLoot(it, q.x, q.z); }
      this.bcast({ t: 'impact', x: R2(q.x), y: R2(q.y), z: R2(q.z) });
    }

    damage(v, amt, att, wid, meta) {
      if (!v.alive || this.phase !== 'live') return;
      meta = meta || {};
      if (att && att.id !== v.id && this.isAllied(att.id, v.id)) return;
      if (att && att.team === v.team && att.id !== v.id) return;
      if (v.role === 'dummy' && v.dummyInvuln) return;
      if (!meta.ignoreArmor) {
        let red = v.redExtra; if (v.armor) { red += C.ITEMS[v.armor.id].red; v.armor.d -= amt * 0.5; if (v.armor.d <= 0) { v.armor = null; v.invDirty = true; this.to(v.id, { t: 'broke', id: 'armor' }); } else v.invDirty = true; }
        amt *= (1 - Math.min(0.6, red));
      }
      amt = Math.max(0, amt); v.hp -= amt; v.lastDmgT = this.t; v.regenT = 5;
      if (att) { v.lastHitBy = att.id; v.lastHit = this.t; att.stats.dmg += amt; if (meta.head) att.stats.head++; this.to(att.id, { t: 'hitm', h: meta.head ? 1 : 0, d: Math.round(amt) }); }
      this.to(v.id, { t: 'hurt', d: Math.round(amt), a: att ? { x: R2(att.x), z: R2(att.z) } : null, k: meta.kind || 'hit' });
      this.bcast({ t: 'hit', i: v.id, x: R2(v.x), y: R2(v.y + 1.2), z: R2(v.z), h: meta.head ? 1 : 0 });
      if (v.bot) v.bot.onDamaged(att, amt);
      if (v.hp <= 0) this.eliminate(v, att, wid, meta);
    }

    hurtMutt(m, dmg, att) {
      m.hp -= dmg; m.target = att ? att.id : m.target; m.state = 1;
      this.bcast({ t: 'hit', i: -m.id, x: R2(m.x), y: R2(m.y + 0.8), z: R2(m.z), h: 0 });
      if (m.hp <= 0) { this.bcast({ t: 'muttdead', id: m.id }); this.mutts.splice(this.mutts.indexOf(m), 1); if (att) this.to(att.id, { t: 'msg', m: 'Mutt slain' }); }
    }

    eliminate(v, att, wid, meta) {
      meta = meta || {};
      v.alive = false; v.hp = 0; v.diedAt = this.t; v.using = null; v.reloading = null;
      v.killedBy = att ? att.id : 0;
      this.aliveCount--;
      // drop everything
      for (const s of v.inv) if (s) this.dropAt(v, s, v.x, v.z);
      if (v.armor) this.dropAt(v, v.armor, v.x, v.z);
      v.inv = v.inv.map(() => null); v.armor = null; v.invDirty = true;
      // credit
      if (att && att.id !== v.id) {
        att.stats.kills++; if (v.isBot) att.stats.botKills++; else att.stats.humanKills++;
        const cls = C.WEAPON_CLASS[wid] || (wid === 'zone' ? 'env' : 'other'); att.stats.byClass[cls] = (att.stats.byClass[cls] || 0) + 1;
        att.stats.victims.push({ n: v.name, bot: v.isBot, acct: v.acct, t: this.t });
        if (att.bot) att.bot.onKill(v);
      }
      this.bcast({ t: 'kill', k: att ? att.id : 0, v: v.id, w: wid || meta.kind || 'env', h: meta.head ? 1 : 0, x: R2(v.x), y: R2(v.y), z: R2(v.z) });
      this.bcast({ t: 'cannon' });
      this.noise(v.x, v.z, 55, v.id);
      this.deathOrder.push(v.id);
      // team placement
      const tm = this.teamAlive(v.team);
      if (tm === 0) this.teamEliminated(v.team);
      if (!v.isBot && !v.quit) this.to(v.id, { t: 'died', by: att ? att.id : 0, w: wid || meta.kind || 'env' });
    }
    teamAlive(team) { let n = 0; for (const p of this.players.values()) if (p.team === team && p.alive) n++; return n; }
    aliveTeams() { const s = new Set(); for (const p of this.players.values()) if (p.alive) s.add(p.team); return s; }
    teamEliminated(team) {
      const placement = this.aliveTeams().size + 1;
      for (const p of this.players.values()) if (p.team === team) { p.placement = placement; }
      this.teamsOut++;
      if (this.hooks.onTeamOut) this.hooks.onTeamOut(this, team, placement);
    }

    /* ---------------------------------------------------------- use / consume */
    startUse(p) {
      const s = this.held(p); if (!s) return; const def = C.ITEMS[s.id];
      if (def.type === 'med' && p.hp >= P.maxHp) return;
      if (def.type === 'food' && p.hunger >= 98) return; if (def.type === 'water' && p.thirst >= 98) return;
      p.using = { slot: p.sel, t: def.use, d: def.use }; this.to(p.id, { t: 'use', d: def.use });
    }
    tickUse(p, dt) {
      const u = p.using; if (p.sel !== u.slot || !p.inv[u.slot]) { p.using = null; return; }
      u.t -= dt; if (u.t > 0) return;
      const s = p.inv[u.slot], def = C.ITEMS[s.id]; p.using = null;
      if (def.heal) { p.hp = Math.min(P.maxHp, p.hp + def.heal); p.stats.heals++; }
      if (def.hunger) p.hunger = Math.min(100, p.hunger + def.hunger);
      if (def.thirst) p.thirst = Math.min(100, p.thirst + def.thirst);
      s.n--; if (s.n <= 0) p.inv[u.slot] = null; p.invDirty = true;
      this.to(p.id, { t: 'used', id: s.id });
    }
    finishReload(p) {
      const r = p.reloading; p.reloading = null; const s = p.inv[r.slot]; if (!s) return; const w = C.WEAPONS[s.id]; if (!w || w.type !== 'ranged') return;
      const need = w.mag - s.l, have = Math.min(need, this.count(p, w.ammo)); if (have <= 0) return;
      this.take(p, w.ammo, have); s.l += have; p.invDirty = true;
    }

    /* ------------------------------------------------------------------- traps */
    placeTrap(p, s) {
      const def = C.ITEMS[s.id], x = p.x - Math.sin(p.yaw) * 1.4, z = p.z - Math.cos(p.yaw) * 1.4;
      if (this.world.inWater(x, z)) { this.to(p.id, { t: 'msg', m: 'Cannot place in water' }); return; }
      this.traps.push({ id: this.nextTrap++, kind: def.id === 'trap_snare' ? 'snare' : 'spike', o: p.id, tm: p.team, x, z, y: this.world.height(x, z), armedAt: this.t + 1.5, life: 240 });
      s.n--; if (s.n <= 0) p.inv[p.sel] = null; p.invDirty = true; this.bcast({ t: 'sfx', k: 'trap', x: R2(x), z: R2(z) });
    }
    updateTraps(dt) {
      for (let i = this.traps.length - 1; i >= 0; i--) {
        const tr = this.traps[i]; tr.life -= dt; if (tr.life <= 0) { this.traps.splice(i, 1); continue; }
        if (this.t < tr.armedAt) continue;
        for (const q of this.players.values()) {
          if (!q.alive || q.team === tr.tm || dist2(q.x, q.z, tr.x, tr.z) > 1.1 * 1.1 || q.y - tr.y > 0.6) continue;
          const o = this.players.get(tr.o);
          if (o && this.isAllied(o.id, q.id)) continue;
          if (tr.kind === 'snare') { q.rootT = 3.5; this.damage(q, 8, o, 'trap_snare', { kind: 'trap' }); }
          else { q.rootT = 0.8; q.speedMul = 0.6; this.damage(q, 38, o, 'trap_spike', { kind: 'trap' }); }
          this.bcast({ t: 'sfx', k: 'trigger', x: R2(tr.x), z: R2(tr.z), tk: tr.kind }); this.noise(tr.x, tr.z, 30, 0);
          if (q.bot) q.bot.onTrapped(tr);
          this.traps.splice(i, 1); break;
        }
      }
    }

    /* ----------------------------------------------------------------- mutts */
    updateMutts(dt) {
      const cfg = C.WILDLIFE.mutt, w = this.world;
      for (const m of this.mutts) {
        m.cd -= dt;
        let tgt = null, bd = 1e9;
        for (const p of this.players.values()) {
          if (!p.alive) continue; const d = Math.hypot(p.x - m.x, p.z - m.z);
          const ag = m.hunting ? 90 : cfg.aggro * (p.crouch ? 0.5 : 1) * (p.sprinting ? 1.3 : 1);
          if (d < ag && d < bd) { bd = d; tgt = p; }
        }
        let tx = m.hx, tz = m.hz, sp = cfg.speed * 0.35;
        if (tgt && (!m.leash || Math.hypot(m.x - m.hx, m.z - m.hz) < cfg.leash || m.hunting)) { tx = tgt.x; tz = tgt.z; sp = cfg.speed; m.state = 1; if (bd < 1.6 && m.cd <= 0 && Math.abs(tgt.y - m.y) < 2) { m.cd = cfg.cd; this.damage(tgt, cfg.dmg, null, 'mutt', { kind: 'mutt' }); } }
        else { m.state = 0; if (Math.hypot(m.x - m.hx, m.z - m.hz) < 3 || this.tick % 150 === 0) { const a = this.rng() * 6.28, r = this.rng() * 25; m.hx = clamp(m.hx + Math.cos(a) * r, -W.radius + 20, W.radius - 20); m.hz = clamp(m.hz + Math.sin(a) * r, -W.radius + 20, W.radius - 20); } }
        const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
        if (d > 1.2) { const k = Math.min(sp * dt, d) / d; m.yaw = Math.atan2(-dx, -dz); const nx = m.x + dx * k, nz = m.z + dz * k; const st = { x: nx, y: m.y, z: nz }; Move.pushOut(w, st, cfg.radius); m.x = st.x; m.z = st.z; }
        m.y = w.height(m.x, m.z);
      }
    }

    /* ------------------------------------------------------------------- zone */
    updateZone(dt) {
      const z = this.zone;
      if (this.phase !== 'live') return;
      if (z.idx >= z.phases.length) { z.final += dt; z.dps = 9 + Math.min(8, z.final / 15); this.damageOutside(dt); return; }
      const ph = z.phases[z.idx];
      z.timer -= dt;
      if (z.state === 'wait') {
        z.dps = idxDps(z.idx - 1);
        if (z.timer <= 0) { z.state = 'shrink'; z.timer = ph.shrink; z.fromX = z.x; z.fromZ = z.z; z.fromR = z.r; this.bcast({ t: 'announce', m: 'THE ARENA IS CLOSING', k: 'zone' }); }
      } else {
        const k = 1 - Math.max(0, z.timer) / ph.shrink;
        z.r = z.fromR + (ph.r - z.fromR) * k; z.x = z.fromX + (ph.x - z.fromX) * k; z.z = z.fromZ + (ph.z - z.fromZ) * k; z.dps = ph.dps;
        if (z.timer <= 0) { z.idx++; z.state = 'wait'; if (z.idx < z.phases.length) z.timer = z.phases[z.idx].wait; else z.timer = 0; }
      }
      this.damageOutside(dt);
      function idxDps(i) { return i < 0 ? 0.6 : z.phases[i].dps; }
    }
    damageOutside(dt) {
      const z = this.zone;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (dist2(p.x, p.z, z.x, z.z) > z.r * z.r) { p.zoneAcc = (p.zoneAcc || 0) + z.dps * dt; p.outside = true; if (p.zoneAcc >= 1) { const a = Math.floor(p.zoneAcc); p.zoneAcc -= a; this.damage(p, a, null, 'zone', { kind: 'zone', ignoreArmor: true }); } }
        else p.outside = false;
      }
      for (const m of this.mutts) if (dist2(m.x, m.z, z.x, z.z) > (z.r + 20) * (z.r + 20) && !m.hunting) { m.hx = z.x; m.hz = z.z; }
    }

    /* ---------------------------------------------------------- arena events */
    updateEvents(dt) {
      if (this.phase !== 'live') return;
      this.eventClock -= dt;
      if (this.eventClock <= 0 && this.aliveCount > 1) {
        this.eventClock = 42 + this.rng() * 30;
        const kinds = ['fog', 'fire', 'storm', 'mutts', 'drop', 'drop', 'flood', 'fog'], k = kinds[Math.floor(this.rng() * kinds.length)];
        this.launchEvent(k);
      }
      for (let i = this.strikes.length - 1; i >= 0; i--) {
        const s = this.strikes[i]; s.t -= dt;
        if (s.t <= 0) { this.bcast({ t: 'bolt', x: R2(s.x), z: R2(s.z) }); for (const p of this.players.values()) if (p.alive && dist2(p.x, p.z, s.x, s.z) < 16) this.damage(p, 40, null, 'lightning', { kind: 'lightning' }); this.strikes.splice(i, 1); }
      }
      if (this.t < this.stormUntil) {
        this.nextStrike -= dt;
        if (this.nextStrike <= 0) {
          this.nextStrike = 1.6 + this.rng() * 2;
          const alive = [...this.players.values()].filter(p => p.alive);
          if (alive.length) { const t = alive[Math.floor(this.rng() * alive.length)], a = this.rng() * 6.28, r = 4 + this.rng() * 35; const s = { x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r, t: 1.6 }; this.strikes.push(s); this.bcast({ t: 'warnbolt', x: R2(s.x), z: R2(s.z) }); }
        }
      }
    }
    launchEvent(k) {
      const cfg = C.EVENTS[k], z = this.zone, a = this.rng() * 6.28, rr = Math.sqrt(this.rng()) * Math.max(20, z.r * 0.8);
      let x = z.x + Math.cos(a) * rr, zz = z.z + Math.sin(a) * rr;
      if (k === 'flood') { const rc = this.world.riverCenter(zz); x = rc; }
      const ann = { t: 'announce', m: cfg.name.toUpperCase(), k: 'event', ev: k };
      if (k === 'storm') { this.stormUntil = this.t + cfg.warn + cfg.dur; this.weather = { type: 2, until: this.stormUntil }; ann.m = 'A STORM APPROACHES'; this.bcast(ann); return; }
      if (k === 'mutts') { ann.m = 'THE CAPITOL RELEASES THE MUTTS'; this.bcast(ann); setTimeout_(this, cfg.warn, () => { this.spawnMutts(6, false); }); return; }
      ann.x = R2(x); ann.z = R2(zz); ann.r = cfg.r; ann.c = cfg.color; this.bcast(ann);
      this.hazards.push({ id: this.nextHaz++, k, x, z: zz, r: cfg.r, dps: cfg.dps, start: this.t + cfg.warn, end: this.t + cfg.warn + (cfg.dur || 0), color: cfg.color });
      if (k === 'drop') { const hz = this.hazards[this.hazards.length - 1]; hz.end = hz.start + 90; hz.landed = false; }
    }
    updateHazards(dt) {
      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const h = this.hazards[i];
        if (this.t >= h.end) { this.hazards.splice(i, 1); continue; }
        if (this.t < h.start) continue;
        if (h.k === 'drop') { if (!h.landed) { h.landed = true; for (let j = 0; j < 5; j++) this.rollLoot(4, h.x + (this.rng() - 0.5) * 3, h.z + (this.rng() - 0.5) * 3); this.bcast({ t: 'sfx', k: 'dropland', x: R2(h.x), z: R2(h.z) }); } continue; }
        for (const p of this.players.values()) if (p.alive && dist2(p.x, p.z, h.x, h.z) < h.r * h.r) { p.hazAcc = (p.hazAcc || 0) + h.dps * dt; if (p.hazAcc >= 1) { const a = Math.floor(p.hazAcc); p.hazAcc -= a; this.damage(p, a, null, h.k, { kind: h.k, ignoreArmor: h.k !== 'flood' }); } }
        if (h.k === 'fog' || h.k === 'fire') for (const m of this.mutts) if (dist2(m.x, m.z, h.x, h.z) < h.r * h.r) m.hp -= h.dps * dt * 0.5;
      }
    }
    updateWeather(dt) {
      if (this.t >= this.weather.until && this.t >= this.stormUntil) {
        const r = this.rng(); this.weather = { type: r < 0.55 ? 0 : 1, until: this.t + 60 + this.rng() * 90 };
        this.bcast({ t: 'weather', w: this.weather.type });
      }
    }

    /* ----------------------------------------------- survival, misc, objectives */
    updateSurvival(dt) {
      for (const p of this.players.values()) {
        if (!p.alive || this.phase !== 'live') continue;
        p.hunger = Math.max(0, p.hunger - P.hungerDrain * dt * (p.sprinting ? 1.6 : 1)); p.thirst = Math.max(0, p.thirst - P.thirstDrain * dt * (p.sprinting ? 1.8 : 1));
        if (p.hunger <= 0 || p.thirst <= 0) { p.starveAcc = (p.starveAcc || 0) + P.starveDps * dt; if (p.starveAcc >= 1) { p.starveAcc -= 1; this.damage(p, 1, null, 'starve', { kind: 'starve', ignoreArmor: true }); } }
        else if (p.hunger > 50 && p.thirst > 50 && p.hp < P.maxHp && this.t - p.lastDmgT > 6) p.hp = Math.min(P.maxHp, p.hp + 0.45 * dt);
        if (p.marked) { p.markT -= dt; if (p.markT <= 0) { p.markT = 48 + this.rng() * 12; this.bcast({ t: 'mark', i: p.id, x: R2(p.x), z: R2(p.z), d: 4 }); } }
        if (this.t > 180) p.scoutUntil = Math.min(p.scoutUntil, 0);
      }
    }
    updateMisc(dt) {
      for (let i = this.tracks.length - 1; i >= 0; i--) if (this.t - this.tracks[i].t > 25) this.tracks.splice(i, 1);
      if (this.tracks.length > 400) this.tracks.splice(0, this.tracks.length - 400);
      if (this.loot.size > 900) { const k = this.loot.keys().next().value; this.loot.delete(k); this.bcast({ t: 'lr', id: k }); }
      for (const [k, v] of this.offers) if (v < this.t) this.offers.delete(k);
    }
    dispatchNoise() {
      if (!this.noise_.length) return;
      for (const p of this.players.values()) {
        if (!p.alive || !p.bot) continue;
        for (const n of this.noise_) { if (n[3] === p.id) continue; const d = Math.hypot(n[0] - p.x, n[1] - p.z); if (d < n[2]) p.bot.hear(n[0], n[1], n[2] - d, n[3]); }
      }
      this.noise_.length = 0;
    }

    wallBetween(ax, az, bx, bz, y) {
      const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.8);
      for (let i = 1; i < n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; for (const o of this.world.query(x, z, 0.5)) if (o.k === 1 && x > o.minx && x < o.maxx && z > o.minz && z < o.maxz) return true; }
      return false;
    }
    /* line of sight between eye points incl. trees/rocks (used by bots) */
    los(ax, ay, az, bx, by, bz) {
      const d = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(d / 1.5));
      for (let i = 1; i < n; i++) {
        const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
        if (y < this.world.height(x, z) + 0.2) return false;
        for (const o of this.world.query(x, z, 1)) {
          if (o.k === 0) { if (y < o.top && dist2(x, z, o.x, o.z) < (o.r + 0.1) * (o.r + 0.1) && (o.r > 0.9 || d > 3)) return false; }
          else if (x > o.minx && x < o.maxx && z > o.minz && z < o.maxz && y < o.top) return false;
        }
      }
      return true;
    }

    /* ------------------------------------------------------------ objectives */
    updateObjectives() {
      if (!this.objectives.length || this.phase !== 'live') return;
      const hu = [...this.players.values()].find(p => !p.isBot); if (!hu) return;
      for (const o of this.objectives) {
        if (o.done || o.failed) continue;
        switch (o.type) {
          case 'survive': o.p = Math.min(o.seconds, this.t); if (this.t >= o.seconds && hu.alive) o.done = true; break;
          case 'top': o.p = this.aliveCount; if (hu.alive && this.aliveCount <= o.n) o.done = true; break;
          case 'kills': { const k = o.cls ? (hu.stats.byClass[o.cls] || 0) : hu.stats.kills; o.p = k; if (k >= o.n) o.done = true; break; }
          case 'collect': o.p = hu.stats.resources; if (hu.stats.resources >= o.n) o.done = true; break;
          case 'reach': { o.p = 0; if (dist2(hu.x, hu.z, o.x, o.z) < o.r * o.r) o.done = true; break; }
          case 'hidden': o.p = hu.stats.hidden.length; if (hu.stats.hidden.length >= (o.n || 1)) o.done = true; break;
          case 'killTarget': { const t = [...this.players.values()].find(p => p.tag === o.tag); if (t && !t.alive) o.done = true; break; }
          case 'protect': { const t = [...this.players.values()].find(p => p.tag === o.tag); if (t && !t.alive) o.failed = true; break; }
          case 'noheal': if (hu.stats.heals > 0) o.failed = true; else if (this.t > (o.seconds || 180)) o.done = true; break;
          case 'win': if (hu.alive && this.aliveCount === 1) o.done = true; break;
          case 'unseen': { if (o.alarm) o.failed = true; break; }
          case 'craft': o.p = hu.stats.crafts; if (hu.stats.crafts >= o.n) o.done = true; break;
          case 'dummies': { const left = [...this.players.values()].filter(p => p.role === 'dummy' && p.alive).length; o.p = (o.total || 0) - left; if (left === 0) o.done = true; break; }
        }
        this.to(hu.id, { t: 'obj', id: o.id, p: Math.floor(o.p), done: o.done, failed: o.failed });
      }
      const req = this.objectives.filter(o => !o.optional);
      if (req.some(o => o.failed) && this.objectives.length) return this.finish('fail');
      if (req.length && req.every(o => o.done)) return this.finish('success');
      if (this.opts.timeLimit && this.t > this.opts.timeLimit) return this.finish('fail');
    }

    checkEnd() {
      if (this.phase !== 'live') return;
      const humansAlive = [...this.players.values()].filter(p => !p.isBot && p.alive && !p.left).length;
      const humans = [...this.players.values()].filter(p => !p.isBot && !p.left).length;
      const teams = this.aliveTeams();
      if (this.objectives.length) { const hu = [...this.players.values()].find(p => !p.isBot); if (hu && !hu.alive) return this.finish('fail'); return; }
      if (teams.size <= 1) return this.finish('done');
      if (humans > 0 && humansAlive === 0) { if (!this.endT) this.endT = this.t + 6; if (this.t >= this.endT) this.finish('done'); }
      if (humans === 0 && [...this.players.values()].some(p => !p.isBot)) this.finish('abandoned');
    }

    finish(kind) {
      if (this.phase === 'ended') return;
      this.phase = 'ended'; this.finishKind = kind;
      const alive = [...this.players.values()].filter(p => p.alive);
      const winTeam = alive.length ? alive[0].team : -1;
      if (kind === 'done' || kind === 'success') for (const p of this.players.values()) if (p.team === winTeam && p.alive) p.placement = 1;
      // anyone without a placement (abandoned / failures) gets last
      let last = this.aliveTeams().size + 1;
      for (const p of this.players.values()) if (!p.placement) p.placement = kind === 'fail' ? Math.max(2, last) : (p.team === winTeam ? 1 : last);
      this.result = { kind, winTeam, t: this.t, objectives: this.objectives.map(o => ({ id: o.id, done: o.done, failed: o.failed, optional: !!o.optional })) };
      const standings = [...this.players.values()].sort((a, b) => a.placement - b.placement || b.stats.kills - a.stats.kills);
      this.bcast({ t: 'end', k: kind, win: winTeam, st: standings.slice(0, 24).map(p => ({ i: p.id, n: p.name, pl: p.placement, k: p.stats.kills, b: p.isBot ? 1 : 0 })) });
      this.snapshots();
      if (this.hooks.onEnd) this.hooks.onEnd(this);
    }

    leave(pid, intentional) {
      const p = this.players.get(pid); if (!p || p.left) return;
      p.left = true; p.connected = false;
      if (p.alive && this.phase === 'live') { p.quit = !!intentional; this.eliminate(p, null, 'quit', { kind: 'quit' }); }
      else if (p.alive && this.phase === 'countdown') { p.alive = false; this.aliveCount--; p.quit = false; p.placement = this.aliveTeams().size + 1; this.teamsOut++; }
    }

    /* ---------------------------------------------------------------- snapshots */
    pubFlags(p) {
      return (Math.hypot(p.vx, p.vz) > 0.5 ? 1 : 0) | (p.sprinting ? 2 : 0) | (p.crouch ? 4 : 0) | (p.aiming ? 8 : 0) | (p.swing > 0 ? 16 : 0) | (p.alive ? 0 : 32) | (p.rootT > 0 ? 64 : 0) | (p.inWater ? 128 : 0) | (p.using ? 256 : 0) | (p.reloading ? 512 : 0);
    }
    snapshots() {
      const w = this.world, z = this.zone, ph = z.phases[Math.min(z.idx, z.phases.length - 1)];
      const pl = [];
      for (const p of this.players.values()) {
        const s = this.held(p); const wid = s && C.WEAPONS[s.id] ? s.id : (s && C.ITEMS[s.id] ? s.id : '');
        pl.push({ i: p.id, x: R2(p.x), y: R2(p.y), z: R2(p.z), r: R2(p.yaw), p: R2(p.pitch), f: this.pubFlags(p), h: Math.max(0, Math.round(p.hp)), w: wid, sw: p.swingN, v: R2(Math.hypot(p.vx, p.vz)) });
      }
      const common = {
        t: R2(this.t), k: this.tick, ph: this.phase, cd: R2(Math.max(0, this.countdown)), p: pl, c: this.aliveCount,
        m: this.mutts.map(m => ({ i: m.id, x: R2(m.x), y: R2(m.y), z: R2(m.z), r: R2(m.yaw), h: m.hp, s: m.state })),
        pr: this.proj.map(q => ({ i: q.id, x: R2(q.x), y: R2(q.y), z: R2(q.z), w: q.wid, vx: R2(q.vx), vy: R2(q.vy), vz: R2(q.vz) })),
        z: { x: R2(z.x), z: R2(z.z), r: R2(z.r), nx: R2(ph.x), nz: R2(ph.z), nr: ph.r, s: z.state === 'off' ? 'o' : z.state === 'wait' ? 'w' : 's', tl: R2(Math.max(0, z.timer)), i: z.idx, dps: R2(z.dps) },
        hz: this.hazards.map(h => ({ i: h.id, k: h.k, x: R2(h.x), z: R2(h.z), r: h.r, a: this.t >= h.start ? 1 : 0, e: R2(h.end - this.t) })),
        wt: this.weather.type, tod: R2((0.33 + this.t / 1100) % 1),
      };
      const evAll = this.evAll; this.evAll = [];
      const full = this.tick % (C.SNAP_EVERY * 5) === 0;
      for (const p of this.players.values()) {
        if (p.isBot || !p.connected) { this.evTo.delete(p.id); continue; }
        const ev = evAll.concat(this.evTo.get(p.id) || []); this.evTo.delete(p.id);
        const msg = Object.assign({}, common, { e: ev, a: p.lastSeq });
        const s = this.held(p), wdef = s && C.WEAPONS[s.id];
        msg.y = { x: R2(p.x), yy: R2(p.y), z: R2(p.z), vx: R2(p.vx), vy: R2(p.vy), vz: R2(p.vz), og: p.onGround ? 1 : 0, st: R2(p.stamina), ex: R2(p.exhausted || 0), rt: R2(p.rootT || 0), hp: R2(p.hp), hu: R2(p.hunger), th: R2(p.thirst),
          cd: R2(Math.max(0, p.cd)), rl: p.reloading ? R2(p.reloading.t) : 0, us: p.using ? R2(p.using.t) : 0, ms: p.maxStamina, al: p.alive ? 1 : 0, out: p.outside ? 1 : 0 };
        if (p.invDirty || full) { msg.inv = { s: p.inv.map(q => q ? [q.id, q.n, q.d == null ? 0 : q.d, q.l == null ? 0 : q.l] : 0), arm: p.armor ? [p.armor.id, Math.round(p.armor.d)] : 0, sel: p.sel, cap: p.cap }; p.invDirty = false; }
        // nearby loot (interest management)
        if (this.tick % (C.SNAP_EVERY * 4) === 0) {
          const R = p.scoutUntil > this.t ? 140 : 70, near = [];
          for (const L of this.loot.values()) { if (dist2(L.x, L.z, p.x, p.z) < R * R) near.push([L.id, L.it.id, L.it.n, R2(L.x), R2(L.z)]); }
          msg.lt = near; msg.ltR = R;
        }
        if (p.tracker) { const near = []; for (const tk of this.tracks) if (tk.o !== p.id && dist2(tk.x, tk.z, p.x, p.z) < 2500) near.push([R2(tk.x), R2(tk.z), R2(this.t - tk.t), R2(tk.a)]); msg.tk = near.slice(-60); }
        const trs = []; for (const tr of this.traps) if (tr.tm === p.team || this.isAllied(tr.o, p.id) || dist2(tr.x, tr.z, p.x, p.z) < 100) trs.push({ i: tr.id, k: tr.kind, x: R2(tr.x), z: R2(tr.z), own: tr.tm === p.team ? 1 : 0 });
        msg.tr = trs;
        if (this.allies.size) { const s2 = this.allies.get(p.id); msg.al = s2 ? [...s2] : []; }
        this.send(p.id, 'snap', msg);
      }
      this.evTo.clear();
    }
  }

  function setTimeout_(match, sec, fn) { match.timers = match.timers || []; match.timers.push({ t: match.t + sec, fn }); }
  const origTick = Match.prototype.tickOnce;
  Match.prototype.tickOnce = function () {
    origTick.call(this);
    if (this.timers && this.timers.length) { for (let i = this.timers.length - 1; i >= 0; i--) if (this.t >= this.timers[i].t) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); } }
  };

  return { Match };
});
