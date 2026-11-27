/* AI tributes. Bots drive exactly the same movement/combat code as humans (they only produce inputs and call actions).
   Difficulty changes perception, reaction, aim error, decision quality and resource management — never health or damage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'), require('./movement'));
  else { root.HG = root.HG || {}; root.HG.Bots = factory(root.HG.C, root.HG.Move); }
})(typeof self !== 'undefined' ? self : globalThis, function (C, Move) {
  const F = Move.F, P = C.PLAYER;
  const TAU = Math.PI * 2;
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  const wscore = id => { const w = C.WEAPONS[id]; if (!w) return 12; return w.type === 'ranged' ? w.dmg / Math.max(0.5, w.cd + w.reload * 0.5) * 1.4 : w.dmg / w.cd; };

  class Brain {
    constructor(m, p) {
      this.m = m; this.p = p; this.per = C.PERSONALITIES[p.personality] || C.PERSONALITIES.strategist; this.diff = C.DIFFICULTY[p.botDiff] || C.DIFFICULTY.normal;
      this.r = () => m.rng();
      this.state = 'loot'; this.dest = null; this.destKind = ''; this.thinkT = this.r() * 0.6; this.vis = new Map(); this.target = null; this.heard = [];
      this.stuck = 0; this.lastX = p.x; this.lastZ = p.z; this.lastChk = 0; this.sideT = 0; this.sideDir = 1; this.jumpT = 0; this.hide = null; this.hideT = 0;
      this.aimErr = { y: 0, p: 0, t: 0 }; this.allyCd = 0; this.allyAt = {}; this.trapCd = 20 + this.r() * 30; this.useWant = null; this.fleeFrom = null; this.t = 0; this.pending = null;
      this.hostile = new Set(); this.waypoint = 0; this.berserk = 0; this.lootBan = new Map(); this.nextStrafe = 0; this.strafeDir = 1; this.detect = 0;
      this.leaderId = 0; this.lastSeenEnemyT = -99;
    }

    /* ------------------------------------------------------------------ events */
    hear(x, z, strength, src) {
      const q = this.m.players.get(src); if (q && this.m.friendly(this.p, q)) return;
      if (this.r() > 0.25 + this.diff.tactics * 0.7) return;
      this.heard.push({ x, z, t: this.t, w: strength, src }); if (this.heard.length > 6) this.heard.shift();
    }
    onDamaged(att, amt) {
      if (att) { this.hostile.add(att.id); if (!this.vis.has(att.id)) this.vis.set(att.id, { since: this.t - 5, last: this.t }); else this.vis.get(att.id).since = Math.min(this.vis.get(att.id).since, this.t - this.diff.react); if (this.m.isAllied(this.p.id, att.id)) { this.m.setAlly(this.p.id, att.id, false); } }
      this.thinkT = 0;
    }
    onKill() { this.target = null; this.thinkT = 0; }
    onTrapped() { this.thinkT = 0; }
    onBetrayed(by) { this.hostile.add(by.id); this.thinkT = 0; }
    onOffer(from) {
      if (this.hostile.has(from.id) || this.m.t - this.p.lastDmgT < 6) return;
      const acc = this.per.social * 0.85 + 0.1 - (this.per.aggr > 0.8 ? 0.2 : 0);
      if (this.r() < acc * (0.5 + this.diff.tactics * 0.5)) this.allyAt[from.id] = this.t + 1.2;
    }

    /* ---------------------------------------------------------------- perception */
    canSee(q) {
      const m = this.m, p = this.p, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      let range = 80; if (m.weather.type === 1) range *= 0.85; else if (m.weather.type === 2) range *= 0.65;
      const tod = (0.33 + m.t / 1100) % 1; if (tod < 0.2 || tod > 0.88) range *= 0.7;
      if (q.crouch) range *= 0.6; if (d > 8 && m.world.inBush(q.x, q.z)) range *= 0.15;
      if (d > range) return false;
      if (d > 9 && Math.abs(angDiff(p.yaw, yawTo(dx, dz))) > 1.3) return false;
      return m.los(p.x, Move.eyeY(p), p.z, q.x, Move.eyeY(q), q.z);
    }
    perceive() {
      const m = this.m, p = this.p; const seen = [];
      for (const q of m.players.values()) {
        if (!q.alive || q.id === p.id || m.friendly(p, q)) continue;
        if (Math.abs(q.x - p.x) > 90 || Math.abs(q.z - p.z) > 90) { this.vis.delete(q.id); continue; }
        if (this.canSee(q)) { let v = this.vis.get(q.id); if (!v) this.vis.set(q.id, v = { since: this.t, last: this.t }); v.last = this.t; if (this.t - v.since >= this.diff.react * (0.7 + this.r() * 0.6) || this.hostile.has(q.id)) seen.push(q); }
        else { const v = this.vis.get(q.id); if (v && this.t - v.last > 2 + this.diff.react) this.vis.delete(q.id); else if (v && this.t - v.last < 2) seen.push(q); }
      }
      return seen;
    }

    /* ------------------------------------------------------------------ helpers */
    zoneInfo() {
      const z = this.m.zone, p = this.p; if (z.state === 'off') return { safe: true, cx: 0, cz: 0, margin: 999 };
      const ph = z.phases[Math.min(z.idx, z.phases.length - 1)];
      // plan for the next circle during the wait phase (smarter bots start moving early)
      const early = this.r() < this.diff.tactics;
      const useNext = z.state === 'shrink' || (z.state === 'wait' && early && z.timer < 40 + 60 * this.diff.tactics);
      const cx = useNext ? ph.x : z.x, cz = useNext ? ph.z : z.z, cr = useNext ? ph.r : z.r;
      const d = Math.hypot(p.x - cx, p.z - cz);
      return { safe: d < cr - 12 && Math.hypot(p.x - z.x, p.z - z.z) < z.r - 4, cx, cz, margin: cr - d };
    }
    hazardDanger() {
      const m = this.m, p = this.p;
      for (const h of m.hazards) { if (h.k === 'drop') continue; const d = Math.hypot(p.x - h.x, p.z - h.z); if (d < h.r + 8 && (m.t >= h.start - 6)) return h; }
      for (const s of m.strikes) if (Math.hypot(p.x - s.x, p.z - s.z) < 7) return { x: s.x, z: s.z, r: 7 };
      return null;
    }
    bestSlot(pred) { let bi = -1, bs = -1; this.p.inv.forEach((s, i) => { if (s && pred(s)) { const sc = wscore(s.id); if (sc > bs) { bs = sc; bi = i; } } }); return bi; }
    hasAmmo(w) { return this.m.count(this.p, w.ammo) > 0; }
    armed() { return this.p.inv.some(x => x && C.WEAPONS[x.id] && (C.WEAPONS[x.id].type === 'melee' ? wscore(x.id) > 33 : (x.l > 0 || this.hasAmmo(C.WEAPONS[x.id])))); }
    myScore() { const w = this.m.weaponOf(this.p); const s = this.m.held(this.p); let sc = wscore(w.id); if (w.type === 'ranged' && !(s && (s.l > 0 || this.hasAmmo(w)))) sc *= 0.2; return sc; }
    bestWeaponSlot(dist) {
      const p = this.p; let bi = -1, bs = -1;
      p.inv.forEach((s, i) => {
        if (!s) return; const w = C.WEAPONS[s.id]; if (!w) return;
        let sc = wscore(w.id);
        if (w.type === 'ranged') { if (!(s.l > 0 || this.hasAmmo(w))) return; sc *= dist < 5 ? 0.35 : 1.25; if (dist > 18) sc *= 1.5; }
        else { if (dist > w.range + 4) sc *= 0.2; if (w.range > 3 && dist > 2.5) sc *= 1.2; }
        if (sc > bs) { bs = sc; bi = i; }
      });
      return bi;
    }
    select(i) { if (i >= 0 && i !== this.p.sel) this.m.action(this.p.id, 'sel', { i }); }
    setDest(x, z, kind) { this.dest = { x, z }; this.destKind = kind; }

    lootValue(L) {
      const p = this.p, m = this.m, it = L.it, def = C.ITEMS[it.id]; let v = 1;
      const hasR = p.inv.some(s => s && C.WEAPONS[s.id] && C.WEAPONS[s.id].type === 'ranged'), bestMelee = Math.max(0, ...p.inv.map(s => s && C.WEAPONS[s.id] && C.WEAPONS[s.id].type === 'melee' ? wscore(s.id) : 0));
      switch (def.type) {
        case 'weapon': { const w = C.WEAPONS[it.id], sc = wscore(it.id); if (w.type === 'ranged') v = (this.m.count(p, w.ammo) > 0 || it.l > 0 ? 7 : 4) * (hasR ? 0.5 : 1) * (w.id === 'crossbow' ? 1.3 : 1); else v = sc > bestMelee * 1.2 ? 4 + sc / 12 : 1.2; break; }
        case 'ammo': v = p.inv.some(s => s && C.WEAPONS[s.id] && C.WEAPONS[s.id].ammo === it.id) ? 6 : 1; if (m.count(p, it.id) > 20) v = 0.5; break;
        case 'armor': v = p.armor ? (C.ITEMS[it.id].red > C.ITEMS[p.armor.id].red ? 4 : 0.5) : 6; break;
        case 'med': v = (it.id === 'medkit' ? 5 : 3) * (m.count(p, it.id) >= 3 ? 0.3 : 1); break;
        case 'food': v = 2 + (100 - p.hunger) / 15 * (m.count(p, 'berries') + m.count(p, 'bread') + m.count(p, 'ration') > 3 ? 0.3 : 1); break;
        case 'water': v = 2 + (100 - p.thirst) / 12; if (m.count(p, 'water_bottle') >= 3) v *= 0.3; break;
        case 'mat': v = 0.8 + this.per.trap * 1.2; break;
        case 'trap': v = 1.5 + this.per.trap * 3; break;
      }
      return v;
    }
    freeSlots() { return this.p.inv.filter(s => !s).length; }
    makeRoom() {
      const p = this.p; let wi = -1, wv = 1e9;
      p.inv.forEach((s, i) => { if (!s) return; const def = C.ITEMS[s.id]; let v = def.type === 'mat' ? 1 : def.type === 'weapon' ? wscore(s.id) / 8 : 5; if (i === p.sel) v += 3; if (v < wv) { wv = v; wi = i; } });
      if (wi >= 0 && wv < 4) this.m.action(p.id, 'drop', { i: wi });
    }

    /* ------------------------------------------------------------------- brain */
    think() {
      const m = this.m, p = this.p, per = this.per, df = this.diff, rn = this.r;
      if (m.phase !== 'live') { this.state = 'loot'; return; }
      const hpF = p.hp / P.maxHp, zi = this.zoneInfo(), haz = this.hazardDanger(), seen = this.perceive();
      // prune stale heard
      this.heard = this.heard.filter(h => this.t - h.t < 8);
      // ---- upkeep: eat/drink/heal when safe
      const threatNear = seen.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 30);
      const hungerAt = 18 + 25 * df.loot * (rn() < df.tactics ? 1 : 0.4), healAt = 0.45 + 0.2 * df.tactics;
      if (!p.using && !threatNear) {
        const find = (types, ids) => p.inv.findIndex(s => s && types.includes(C.ITEMS[s.id].type) && (!ids || ids(s)));
        let want = -1;
        if (hpF < healAt || (hpF < 0.8 && df.tactics > 0.7 && m.t - p.lastDmgT > 8)) { const mk = p.inv.findIndex(s => s && s.id === 'medkit'), bd = p.inv.findIndex(s => s && s.id === 'bandage'); want = hpF < 0.35 && mk >= 0 ? mk : bd >= 0 ? bd : mk; }
        if (want < 0 && p.thirst < hungerAt) want = find(['water']);
        if (want < 0 && p.hunger < hungerAt) want = find(['food']);
        if (want >= 0) { this.select(want); this.useWant = true; } else this.useWant = null;
      }
      // water source when thirsty without bottles
      if (p.thirst < 30 && !p.inv.some(s => s && s.id === 'water_bottle') && !seen.length) {
        let bd = 1e9, bx = 0, bz = 0; const rc = m.world.riverCenter(p.z); if (Math.abs(rc - p.x) < 140) { bd = Math.abs(rc - p.x); bx = rc; bz = p.z; }
        if (bd < 140) { this.setDest(bx, bz, 'water'); this.state = 'water'; return; }
      }
      // ---- zone / hazards have priority
      if (haz) { const dx = p.x - haz.x, dz = p.z - haz.z, d = Math.hypot(dx, dz) || 1; this.setDest(p.x + dx / d * (haz.r + 14 - d + 10), p.z + dz / d * (haz.r + 14 - d + 10), 'hazard'); this.state = 'hazard'; return; }
      if (!zi.safe) { this.setDest(zi.cx + (rn() - 0.5) * 16, zi.cz + (rn() - 0.5) * 16, 'zone'); this.state = 'zone'; this.sprintOk = true; if (!threatNear || p.outside) return; }
      // ---- loot
      const lootBias = per.loot * df.loot;
      let bestL = null, bs = 0; const rad = 45 + 110 * lootBias;
      const early = m.t < 55, bloodbath = early && per.caution > 0.6 && df.tactics > 0.4;
      for (const L of m.loot.values()) {
        const dx = L.x - p.x, dz = L.z - p.z, d = Math.hypot(dx, dz); if (d > rad) continue; if ((this.lootBan.get(L.id) || 0) > this.t) continue;
        let sc = this.lootValue(L) / (1 + d / 18);
        if (bloodbath && Math.hypot(L.x, L.z) < 34) sc *= 0.15;
        if (this.freeSlots() === 0 && sc < 3) continue;
        if (sc > bs) { bs = sc; bestL = L; }
      }
      // ---- threats
      let tgt = null, skipFlee = false;
      if (seen.length) {
        this.lastSeenEnemyT = this.t;
        let best = -1e9;
        for (const q of seen) {
          const d = Math.hypot(q.x - p.x, q.z - p.z); let sc = -d + (q.hp < 50 ? 18 : 0) + (this.hostile.has(q.id) ? 25 : 0);
          if (per.id === 'hunter' || per.id === 'berserker') sc += (100 - q.hp) * 0.3; if (per.id === 'assassin') sc += this.facingAway(q) ? 14 : 0;
          if (sc > best) { best = sc; tgt = q; }
        }
      }
      this.target = tgt;
      if (tgt) {
        const d = Math.hypot(tgt.x - p.x, tgt.z - p.z), mine = this.myScore() * (0.4 + hpF * 0.6), theirs = wscore(tgt.w || 'fists') * (0.4 + tgt.hp / 100 * 0.6);
        // alliance first for diplomats
        if (this.m.isAllied(p.id, tgt.id)) { this.target = null; }
        else if (per.social > 0.5 && !this.hostile.has(tgt.id) && this.allyCd <= this.t && df.tactics > 0.3 && d < 22 && tgt.hp > 0 && !this.betrayalPlanned(tgt)) {
          this.allyCd = this.t + 15; m.allyAction(p.id, { to: tgt.id }); if (this.allyAt[tgt.id] === undefined) this.allyAt[tgt.id] = 0;
        }
        let fight = false;
        const weak = tgt.hp < 45 || m.t - tgt.lastDmgT < 6;
        if (per.id === 'berserker') fight = true;
        else if (per.id === 'hunter') fight = hpF > per.fleeHp + 0.1 && mine > theirs * 0.55;
        else if (per.id === 'survivor') fight = (d < 7 && hpF > 0.35) || (weak && mine > theirs * 1.2 && hpF > 0.6) || this.hostile.has(tgt.id) && d < 12 && hpF > 0.5;
        else if (per.id === 'opportunist') fight = weak && hpF > 0.4 || (this.hostile.has(tgt.id) && mine > theirs) || d < 5 && mine > theirs;
        else if (per.id === 'assassin') fight = (this.facingAway(tgt) && d < 30 && hpF > 0.4) || (mine > theirs * 1.4 && hpF > 0.5) || d < 4;
        else fight = mine > theirs * (0.9 + (1 - df.tactics) * 0.3) && hpF > per.fleeHp + 0.1;
        if (hpF < per.fleeHp && per.id !== 'berserker' && d > 3) fight = false;
        if (this.m.isAllied(p.id, tgt.id)) fight = false;
        if (this.berserk > this.t) fight = true;
        const armed = this.armed(), lootFirst = !armed && bestL && bs > 1.2 && d > 7 && !this.hostile.has(tgt.id) && per.id !== 'berserker' && m.t < 240 && !(per.id === 'hunter' && hpF > 0.9 && d < 12);
        if (lootFirst) { fight = false; skipFlee = true; }
        if (per.id === 'berserker' && rn() < 0.04) this.berserk = this.t + 5 + rn() * 6;
        if (fight) { this.state = 'fight'; this.destKind = 'fight'; return; }
        this.fleeFrom = tgt;
        if (!skipFlee) this.state = d < 40 ? 'flee' : 'hide';
        if (!skipFlee && this.state === 'flee') { const dx = p.x - tgt.x, dz = p.z - tgt.z, dd = Math.hypot(dx, dz) || 1; this.setDest(p.x + dx / dd * 40 + (rn() - 0.5) * 20, p.z + dz / dd * 40 + (rn() - 0.5) * 20, 'flee'); this.keepInZone(zi); return; }
      } else { this.target = null; }
      // ---- allies: accept offers, maintain, betray
      if (this.manageAllies(zi)) return;
      // ---- team leader follow
      const leader = [...m.players.values()].find(q => q.alive && q.id !== p.id && q.team === p.team && !q.isBot) || null;
      const needLoot = bestL && bs > (p.inv.some(s => s && C.WEAPONS[s.id] && s.id !== 'knife_crude') ? 0.7 : 0.25);
      if (needLoot && !(per.id === 'assassin' && this.hide && rn() < 0.5)) { this.setDest(bestL.x, bestL.z, 'loot'); this.lootId = bestL.id; this.state = 'loot'; this.keepInZone(zi); return; }
      // ---- strategy by personality
      this.strategy(zi, leader);
    }

    keepInZone(zi) { if (this.dest && zi.margin < 20 && this.destKind !== 'zone') { const dd = Math.hypot(this.dest.x - zi.cx, this.dest.z - zi.cz); if (dd > Math.max(10, zi.margin + 30)) this.setDest(zi.cx, zi.cz, 'zone'); } }
    facingAway(q) { const dx = this.p.x - q.x, dz = this.p.z - q.z, d = Math.hypot(dx, dz) || 1; const fx = -Math.sin(q.yaw), fz = -Math.cos(q.yaw); return (dx * fx + dz * fz) / d < 0.2; }
    betrayalPlanned(q) { return false; }

    manageAllies(zi) {
      const m = this.m, p = this.p, per = this.per, st = m.allies.get(p.id);
      for (const id in this.allyAt) { if (this.allyAt[id] && this.allyAt[id] < this.t) { delete this.allyAt[id]; m.allyAction(p.id, { to: +id }); } }
      if (!st || !st.size) return false;
      const alive = [...st].map(id => m.players.get(id)).filter(q => q && q.alive);
      if (!alive.length) return false;
      const enemies = [...m.players.values()].filter(q => q.alive && q.id !== p.id && !m.friendly(p, q)).length;
      for (const a of alive) {
        const age = this.t - (this.allyStart && this.allyStart[a.id] || (this.allyStart = this.allyStart || {}, this.allyStart[a.id] = this.t));
        const only = enemies === 0, d = Math.hypot(a.x - p.x, a.z - p.z);
        let betray = false;
        if (only && m.t > 120) betray = true;                                   // last two: only one victor
        else if (per.id === 'diplomat' && age > 70 + 80 * (1 - this.diff.tactics) && m.aliveCount <= 8) betray = true;
        else if (per.id === 'opportunist' && a.hp < 40 && d < 8) betray = true;
        else if (per.id === 'strategist' && m.aliveCount <= 4 && age > 40) betray = true;
        else if (per.id === 'assassin' && age > 90 && this.facingAway(a) && d < 3) betray = true;
        else if (per.aggr > 0.7 && age > 150 && this.r() < 0.02) betray = true;
        if (betray && d < 12) { m.allyAction(p.id, { to: a.id, k: 'break' }); this.hostile.add(a.id); this.target = a; this.state = 'fight'; this.thinkT = 0; delete this.allyStart[a.id]; return true; }
      }
      // stay near the closest ally unless something better to do
      const a = alive[0], d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d > 22 && !(zi.margin < 0)) { this.setDest(a.x + (this.r() - 0.5) * 6, a.z + (this.r() - 0.5) * 6, 'follow'); this.state = 'ally'; return true; }
      return false;
    }

    strategy(zi, leader) {
      const m = this.m, p = this.p, per = this.per, df = this.diff, rn = this.r;
      // traps
      if (this.trapCd <= this.t && per.trap > 0.25 && df.tactics > 0.4 && rn() < per.trap) {
        const ti = p.inv.findIndex(s => s && C.ITEMS[s.id].type === 'trap');
        if (ti >= 0 && !this.target) { this.select(ti); this.pending = { kind: 'trap', t: this.t + 0.6 }; this.trapCd = this.t + 45 + rn() * 40; return; }
        const rec = C.RECIPES.find(r => (r.id === 'snare' || r.id === 'spike') && Object.keys(r.needs).every(k => m.count(p, k) >= r.needs[k]));
        if (rec && df.tactics > 0.5) { m.action(p.id, 'craft', { id: rec.id }); this.trapCd = this.t + 20; }
      }
      // opportunistic crafting for ammo / bandages
      if (df.tactics > 0.45 && rn() < 0.2) {
        for (const id of ['arrows', 'bandage']) { const r = C.RECIPES.find(x => x.id === id); if (!r || !Object.keys(r.needs).every(k => m.count(p, k) >= r.needs[k])) continue;
          if (id === 'arrows' && !(p.inv.some(s => s && s.id === 'bow') && m.count(p, 'arrow') < 8)) continue; if (id === 'bandage' && m.count(p, 'bandage') >= 3) continue; m.action(p.id, 'craft', { id }); break; }
      }
      // investigate / avoid sounds
      const h = this.heard.length ? this.heard[this.heard.length - 1] : null;
      if (h && this.t - h.t < 6) {
        const d = Math.hypot(h.x - p.x, h.z - p.z);
        if (['hunter', 'berserker'].includes(per.id) || (per.id === 'opportunist' && d > 25) || (per.id === 'strategist' && p.hp > 70 && df.tactics > 0.6) || per.id === 'assassin') { this.setDest(h.x, h.z, 'investigate'); this.state = per.id === 'assassin' ? 'stalk' : 'hunt'; this.keepInZone(zi); return; }
        if (['survivor', 'diplomat'].includes(per.id) && d < 40) { const dx = p.x - h.x, dz = p.z - h.z, dd = Math.hypot(dx, dz) || 1; this.setDest(p.x + dx / dd * 30, p.z + dz / dd * 30, 'avoid'); this.state = 'avoid'; this.keepInZone(zi); return; }
      }
      // hiding behaviour
      const hideLike = ['survivor', 'assassin', 'opportunist'].includes(per.id) && m.t > 40;
      if (hideLike && (this.hideT > this.t || rn() < per.stealth * 0.5)) {
        if (!this.hide || this.hideT < this.t - 5) this.hide = this.findHide(zi);
        if (this.hide) { this.setDest(this.hide.x, this.hide.z, 'hide'); this.state = 'hide'; if (this.hideT < this.t) this.hideT = this.t + 12 + rn() * 25; return; }
      }
      // follow human team-mate
      if (leader && Math.hypot(leader.x - p.x, leader.z - p.z) > 18) { this.setDest(leader.x + (rn() - 0.5) * 8, leader.z + (rn() - 0.5) * 8, 'follow'); this.state = 'follow'; return; }
      // hunters track footprints & nearest known player
      if (['hunter', 'berserker', 'strategist'].includes(per.id) || (per.id === 'opportunist' && m.aliveCount < 6)) {
        let bq = null, bd = 1e9; for (const q of m.players.values()) { if (!q.alive || q.id === p.id || m.friendly(p, q)) continue; const d = Math.hypot(q.x - p.x, q.z - p.z); const known = d < 130 || (zi.margin < 40 && m.aliveCount < 8) || df.tactics > 0.9; if (known && d < bd) { bd = d; bq = q; } }
        if (bq && (per.aggr > 0.5 || m.t > 150)) { this.setDest(bq.x + (rn() - 0.5) * 10, bq.z + (rn() - 0.5) * 10, 'hunt'); this.state = 'hunt'; this.keepInZone(zi); return; }
      }
      // wander toward interesting places inside the zone
      const spots = [{ x: 0, z: 0 }].concat(m.world.buildings, m.world.caves);
      let tx, tz;
      if (rn() < 0.55 && df.tactics > 0.3) { const s = spots[Math.floor(rn() * spots.length)]; tx = s.x; tz = s.z; }
      else { const a = rn() * TAU, r = rn() * Math.max(20, zi.margin > 0 ? 70 : 30); tx = p.x + Math.cos(a) * r; tz = p.z + Math.sin(a) * r; }
      if (Math.hypot(tx - zi.cx, tz - zi.cz) > (m.zone.r || 300) - 10) { tx = zi.cx + (rn() - 0.5) * 40; tz = zi.cz + (rn() - 0.5) * 40; }
      this.setDest(tx, tz, 'explore'); this.state = 'explore';
    }

    findHide(zi) {
      const m = this.m, p = this.p; let best = null, bs = 1e9;
      const cands = m.world.bushes.filter((b, i) => i % 3 === 0).concat(m.world.buildings.map(b => ({ x: b.x, z: b.z })));
      for (const b of cands) { const d = Math.hypot(b.x - p.x, b.z - p.z); if (d > 90) continue; if (Math.hypot(b.x - zi.cx, b.z - zi.cz) > (m.zone.r - 25)) continue; if (Math.hypot(b.x, b.z) < 40) continue; const sc = d + this.r() * 25; if (sc < bs) { bs = sc; best = b; } }
      return best;
    }

    /* -------------------------------------------------------------------- act */
    update(dt) {
      const m = this.m, p = this.p; this.t += dt;
      this.thinkT -= dt; if (this.thinkT <= 0) { this.thinkT = this.diff.think * (0.7 + this.r() * 0.6); this.think(); }
      let f = 0, mx = 0, mz = 0, yaw = p.yaw, pitch = 0;
      if (m.phase !== 'live') { p.cmd = { mx: 0, mz: 0, yaw, pitch: 0, f: 0 }; return; }
      const turn = (2.6 + 6.5 * this.diff.tactics) * dt;
      // using consumables: stand still & press attack
      if (this.useWant && !this.target) { const s = m.held(p); if (s && ['food', 'water', 'med'].includes(C.ITEMS[s.id].type)) { f |= F.ATTACK; this.useWant = this.useWant; } if (p.using) { f |= F.ATTACK; } p.cmd = { mx: 0, mz: 0, yaw, pitch: 0, f: f | (this.state === 'hide' ? F.CROUCH : 0) }; if (!s || !['food', 'water', 'med'].includes(C.ITEMS[s.id].type)) this.useWant = null; return; }
      if (this.pending && this.pending.kind === 'trap') { const s = m.held(p); if (s && C.ITEMS[s.id].type === 'trap' && this.t >= this.pending.t) { f |= F.ATTACK; this.pending = null; } else if (!s || C.ITEMS[s.id].type !== 'trap') this.pending = null; p.cmd = { mx: 0, mz: 0, yaw, pitch: 0, f }; return; }
      if (this.target && (this.state === 'fight' || this.state === 'flee')) {
        const q = this.target; if (!q.alive) { this.target = null; }
        else if (this.state === 'fight') return this.fight(dt, turn);
      }
      // loot pickup
      if (this.destKind === 'loot' && this.lootId) {
        const L = m.loot.get(this.lootId);
        if (!L) { this.lootId = 0; this.thinkT = 0; }
        else if (Math.hypot(L.x - p.x, L.z - p.z) < 2.2) { if (this.freeSlots() === 0) this.makeRoom(); m.action(p.id, 'pick'); const still = m.loot.get(this.lootId); if (still) this.lootBan.set(this.lootId, this.t + 25); this.lootId = 0; this.thinkT = 0.05; this.equipBest(); }
      }
      if (this.dest) {
        const dx = this.dest.x - p.x, dz = this.dest.z - p.z, d = Math.hypot(dx, dz);
        const arrive = this.destKind === 'hide' ? 2.5 : this.destKind === 'loot' ? 1.4 : 4;
        if (d < arrive) { if (this.destKind === 'hide') { f |= F.CROUCH; } if (this.destKind !== 'loot') { this.dest = null; this.thinkT = Math.min(this.thinkT, 0.2); } }
        else {
          const dir = this.steer(yawTo(dx, dz), 3.2);
          yaw = this.turnTo(p.yaw, dir, turn); mz = Math.abs(angDiff(yaw, dir)) < 1 ? 1 : 0.2;
          const urgent = this.destKind === 'zone' || this.destKind === 'hazard' || this.destKind === 'flee' || (this.destKind === 'hunt' && this.per.aggr > 0.7);
          if (urgent && p.stamina > 20 && p.hunger > 3) f |= F.SPRINT;
          else if (['hide', 'stalk'].includes(this.state) && d < 25 && this.per.stealth > 0.4) f |= F.CROUCH;
          if (this.sprintOk && p.stamina > 30) f |= F.SPRINT;
          if (p.inWater && d > 10) f |= 0;
        }
      } else if (this.state === 'hide') { f |= F.CROUCH; yaw = p.yaw; }
      // stuck handling
      if (this.t - this.lastChk > 0.6) { const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ); if (mz > 0.5 && moved < 0.35 && !p.rootT) { this.stuck++; this.sideT = this.t + 0.9; this.sideDir = this.r() < 0.5 ? 1 : -1; if (this.stuck > 2) { f |= F.JUMP; } if (this.stuck > 4) { this.setDest(p.x + (this.r() - 0.5) * 60, p.z + (this.r() - 0.5) * 60, 'explore'); this.stuck = 0; this.lootBan.set(this.lootId, this.t + 40); this.lootId = 0; } } else this.stuck = 0; this.lastX = p.x; this.lastZ = p.z; this.lastChk = this.t; }
      if (this.t < this.sideT) mx = this.sideDir * 0.8;
      p.cmd = { mx, mz, yaw, pitch: 0, f };
    }

    equipBest() {
      const p = this.p, i = this.bestWeaponSlot(this.target ? Math.hypot(this.target.x - p.x, this.target.z - p.z) : 10);
      if (i >= 0) this.select(i); else { const ai = p.inv.findIndex(s => s && C.ITEMS[s.id].type === 'armor'); if (ai >= 0) this.m.action(p.id, 'armor', { i: ai }); }
      const ai = p.inv.findIndex(s => s && C.ITEMS[s.id].type === 'armor'); if (ai >= 0 && (!p.armor || C.ITEMS[p.inv[ai].id].red > C.ITEMS[p.armor.id].red)) this.m.action(p.id, 'armor', { i: ai });
    }

    turnTo(cur, want, maxStep) { const d = angDiff(want, cur); return Math.abs(d) <= maxStep ? want : cur + Math.sign(d) * maxStep; }

    /* obstacle-avoiding heading: probe ahead, rotate until clear */
    steer(yaw, look) {
      const p = this.p, w = this.m.world;
      const blocked = y => {
        for (const dist of [1.2, look]) {
          const x = p.x - Math.sin(y) * dist, z = p.z - Math.cos(y) * dist;
          for (const o of w.query(x, z, 1)) { if (o.k === 0) { if (Math.hypot(x - o.x, z - o.z) < o.r + 0.7 && p.y < o.top - 0.3) return true; } else if (x > o.minx - 0.7 && x < o.maxx + 0.7 && z > o.minz - 0.7 && z < o.maxz + 0.7 && p.y < o.top - 0.3) return true; }
          if (this.destKind !== 'water' && w.inWater(x, z) && !p.inWater && Math.hypot(x, z) < 460 && this.destKind !== 'zone') return true;
        }
        return false;
      };
      if (!blocked(yaw)) return yaw;
      for (const k of [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3]) { const y = yaw + k * (this.sideDir || 1); if (!blocked(y)) return y; }
      return yaw;
    }

    fight(dt, turn) {
      const m = this.m, p = this.p, q = this.target, df = this.diff, per = this.per;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      const slot = this.bestWeaponSlot(d); if (slot >= 0 && (this.t - (this.lastSwap || 0) > 1.2 || !m.held(p))) { if (slot !== p.sel) { this.lastSwap = this.t; this.select(slot); } }
      const w = m.weaponOf(p), s = m.held(p); let f = 0, mx = 0, mz = 0;
      // lead + gravity compensation for ranged
      let tx = q.x, ty = q.y + 1.2, tz = q.z;
      const speed = w.type === 'ranged' ? w.speed : (w.throw ? w.throw.speed : 0);
      if (w.type === 'ranged') { const tt = d / speed; if (df.tactics > 0.4) { tx += q.vx * tt * df.tactics; tz += q.vz * tt * df.tactics; } ty += 0.5 * w.gravity * tt * tt; }
      if (this.t >= this.aimErr.t) { const sc = (0.5 + d / 35) * (1 + Math.hypot(q.vx, q.vz) / 8) * df.aim * Math.PI / 180; this.aimErr = { y: gauss(this.r) * sc, p: gauss(this.r) * sc * 0.7, t: this.t + 0.35 }; }
      const want = yawTo(tx - p.x, tz - p.z) + this.aimErr.y;
      const yaw = this.turnTo(p.yaw, want, turn * 1.8);
      const pitch = Math.atan2(ty - (Move.eyeY(p)), Math.max(0.1, Math.hypot(tx - p.x, tz - p.z))) + this.aimErr.p;
      const facing = Math.abs(angDiff(p.yaw, want)) < (w.type === 'ranged' ? 0.06 + df.aim * 0.012 : 0.45);
      const los = m.los(p.x, Move.eyeY(p), p.z, q.x, Move.eyeY(q), q.z);
      if (w.type === 'ranged') {
        f |= F.AIM; const ideal = per.id === 'assassin' ? 22 : 18;
        if (d < ideal - 6) mz = -0.6; else if (d > ideal + 15 || !los) mz = 0.9; else mx = this.strafe(df);
        if (facing && los && d < 100 && (s && (s.l > 0)) && this.t > (this.lastFire || 0) + 0.2 + df.react * 0.6) { f |= F.ATTACK; this.lastFire = this.t; }
        if (s && s.l <= 0) m.action(p.id, 'reload');
      } else {
        if (w.throw && d > w.range + 3 && d < 22 && los && facing && df.tactics > 0.7 && this.r() < 0.02 && p.inv.filter(s => s && C.WEAPONS[s.id]).length > 1) { f |= F.AIM | F.ATTACK; }
        if (d > w.range * 0.8) { mz = 1; if (d > 8 && p.stamina > 25 && (per.aggr > 0.5)) f |= F.SPRINT; }
        else { mx = this.strafe(df); mz = d < w.range * 0.45 ? -0.3 : 0.1; }
        if (d < w.range + 0.15 && facing) f |= F.ATTACK;
        if (per.id === 'assassin' && d > 6 && !q.crouch) f |= F.CROUCH;
      }
      // steer around walls when closing in
      if (mz > 0.5) { const dir = this.steer(want, 2.5); if (Math.abs(angDiff(dir, want)) > 0.3) { p.cmd = { mx: 0, mz: 1, yaw: this.turnTo(p.yaw, dir, turn * 2), pitch, f }; return; } }
      if (df.tactics > 0.7 && d < 4 && this.r() < 0.01 && p.onGround) f |= F.JUMP;
      p.cmd = { mx, mz, yaw, pitch, f };
      if (!q.alive) { this.target = null; this.thinkT = 0; }
    }
    strafe(df) { if (this.t > this.nextStrafe) { this.strafeDir = this.r() < 0.5 ? -1 : 1; this.nextStrafe = this.t + 0.6 + this.r() * 1.2; } return df.tactics > 0.3 ? this.strafeDir * (0.4 + 0.5 * df.tactics) : 0; }
  }
  function gauss(r) { return (r() + r() + r() - 1.5) * 1.15; }

  return { Brain };
});
