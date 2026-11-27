/* Deterministic procedural world: heightmap, river, lake, mountains, forests, buildings, caves, loot spots, colliders.
   Server generates the world and sends the object lists to clients so both sides agree exactly. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'));
  else { root.HG = root.HG || {}; root.HG.Terrain = factory(root.HG.C); }
})(typeof self !== 'undefined' ? self : globalThis, function (C) {
  const W = C.WORLD;

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash2(ix, iz, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const sm = t => t * t * (3 - 2 * t);
  function vnoise(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    const u = sm(fx), v = sm(fz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, seed, oct) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f, seed + i * 17); f *= 2.03; amp *= 0.5; }
    return s;
  }
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  function createWorld(seed) {
    seed = (seed | 0) || 1;
    const rnd = mulberry(seed ^ 0x9e3779b9);
    const riverPhase = rnd() * 6.28, riverOff = 150 + rnd() * 60, mtAng = rnd() * 6.28;
    const mt = { x: Math.cos(mtAng) * 290, z: Math.sin(mtAng) * 290, r: 150 };
    const lake = { x: -Math.cos(mtAng) * 230 + 40, z: -Math.sin(mtAng) * 230, r: 52 };
    const riverX = z => riverOff + 55 * Math.sin(z / 115 + riverPhase) + 20 * Math.sin(z / 47 + riverPhase * 2);
    // keep river on the side opposite the mountains
    const riverSign = Math.cos(mtAng) > 0 ? -1 : 1;
    const riverCenter = z => riverSign * riverX(z);

    const pads = [];
    function baseH(x, z) {
      const r = Math.sqrt(x * x + z * z);
      let h = (fbm(x * 0.0045, z * 0.0045, seed, 5) - 0.42) * 26;          // rolling hills
      h += (fbm(x * 0.03, z * 0.03, seed + 99, 3) - 0.5) * 2.2;             // micro detail
      const mdx = x - mt.x, mdz = z - mt.z, md = Math.sqrt(mdx * mdx + mdz * mdz);
      const mw = 1 - smooth(mt.r * 0.35, mt.r, md);
      if (mw > 0) h += mw * (34 + 52 * Math.abs(fbm(x * 0.011, z * 0.011, seed + 7, 4) - 0.5) * 2.2);
      // river carve
      const rd = Math.abs(x - riverCenter(z));
      const rw = 1 - smooth(5, 15, rd);
      if (rw > 0 && Math.abs(z) < 520) h = h * (1 - rw) + (-2.4) * rw;
      // lake
      const ld = Math.sqrt((x - lake.x) ** 2 + (z - lake.z) ** 2);
      const lw = 1 - smooth(lake.r * 0.5, lake.r, ld);
      if (lw > 0) h = h * (1 - lw) + (-3.2) * lw;
      // flatten cornucopia plain
      const cw = 1 - smooth(34, 62, r);
      h = h * (1 - cw) + 0.4 * cw;
      // bowl of hills around the border
      h += smooth(W.radius - 25, W.radius + 40, r) * 60;
      return h;
    }
    function height(x, z) {
      let h = baseH(x, z);
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i], dx = Math.abs(x - p.x) - p.hw, dz = Math.abs(z - p.z) - p.hd;
        if (dx > 7 || dz > 7) continue;
        const f = 1 - smooth(0, 6, Math.max(dx, dz, 0));
        h = h * (1 - f) + p.y * f;
      }
      return h;
    }
    const inWater = (x, z) => height(x, z) < W.waterLevel;

    const world = { seed, size: W.size, height, inWater, mt, lake, riverCenter,
      trees: [], rocks: [], bushes: [], buildings: [], walls: [], caves: [], lootSpots: [], hidden: [], spawns: [], cornucopia: { x: 0, z: 0, r: 11, mouth: Math.PI / 2 },
      circles: [], boxes: [] };

    const free = (x, z, minR) => {
      const r = Math.sqrt(x * x + z * z); if (r > W.radius - 12) return false;
      if (height(x, z) < W.waterLevel + 0.15) return false;
      return true;
    };
    const slope = (x, z) => Math.max(Math.abs(height(x + 2, z) - height(x - 2, z)), Math.abs(height(x, z + 2) - height(x, z - 2))) / 4;
    const taken = [];
    function clear(x, z, r) { for (const t of taken) { const dx = t[0] - x, dz = t[1] - z, rr = t[2] + r; if (dx * dx + dz * dz < rr * rr) return false; } return true; }
    function reserve(x, z, r) { taken.push([x, z, r]); }

    // cornucopia ring pillars
    const cor = world.cornucopia;
    reserve(0, 0, 70);
    const nP = 18;
    for (let i = 0; i < nP; i++) {
      const a = (i / nP) * Math.PI * 2;
      const dMouth = Math.abs(Math.atan2(Math.sin(a - cor.mouth), Math.cos(a - cor.mouth)));
      if (dMouth < 0.5) continue;        // opening of the horn
      world.circles.push({ x: Math.cos(a) * cor.r, z: Math.sin(a) * cor.r, r: 1.7, top: 8, kind: 'corn' });
    }
    // starting pedestals
    for (let i = 0; i < C.MAX_PLAYERS; i++) {
      const a = (i / C.MAX_PLAYERS) * Math.PI * 2;
      world.spawns.push({ x: Math.cos(a) * 33, z: Math.sin(a) * 33, a });
    }

    // buildings (abandoned structures) — axis-aligned, one door gap
    const nB = 11;
    let tries = 0;
    while (world.buildings.length < nB && tries++ < 400) {
      const ang = rnd() * 6.28, rad = 90 + rnd() * 330; const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      const w = 9 + rnd() * 6, d = 8 + rnd() * 6;
      if (!free(x, z) || slope(x, z) > 0.18 || !clear(x, z, 18)) continue;
      if (inWater(x - w, z - d) || inWater(x + w, z + d) || inWater(x - w, z + d) || inWater(x + w, z - d)) continue;
      const gy = height(x, z);
      pads.push({ x, z, hw: w / 2 + 1.5, hd: d / 2 + 1.5, y: gy });
      const door = Math.floor(rnd() * 4);
      const b = { x, z, w, d, y: gy, h: 3.6, door };
      world.buildings.push(b); reserve(x, z, Math.max(w, d) + 8);
      const t = 0.5, hw = w / 2, hd = d / 2, dg = 1.6;
      // 4 walls; wall `door` has a gap in the middle
      const segs = [
        [x - hw, x + hw, z - hd - t / 2, z - hd + t / 2],   // north (0)
        [x - hw, x + hw, z + hd - t / 2, z + hd + t / 2],   // south (1)
        [x - hw - t / 2, x - hw + t / 2, z - hd, z + hd],   // west (2)
        [x + hw - t / 2, x + hw + t / 2, z - hd, z + hd],   // east (3)
      ];
      segs.forEach((s, i) => {
        if (i !== door) { world.boxes.push({ minx: s[0], maxx: s[1], minz: s[2], maxz: s[3], top: gy + b.h, base: gy }); return; }
        if (i < 2) { const cx = (s[0] + s[1]) / 2; world.boxes.push({ minx: s[0], maxx: cx - dg, minz: s[2], maxz: s[3], top: gy + b.h, base: gy }, { minx: cx + dg, maxx: s[1], minz: s[2], maxz: s[3], top: gy + b.h, base: gy }); }
        else { const cz = (s[2] + s[3]) / 2; world.boxes.push({ minx: s[0], maxx: s[1], minz: s[2], maxz: cz - dg, top: gy + b.h, base: gy }, { minx: s[0], maxx: s[1], minz: cz + dg, maxz: s[3], top: gy + b.h, base: gy }); }
      });
      for (let k = 0; k < 4; k++) world.lootSpots.push({ x: x + (rnd() - 0.5) * (w - 3), z: z + (rnd() - 0.5) * (d - 3), tier: 2 });
    }

    // caves (rare loot) — carved into hillsides: a rock arch with loot inside
    tries = 0;
    while (world.caves.length < 4 && tries++ < 600) {
      const ang = rnd() * 6.28, rad = 120 + rnd() * 320; const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (!free(x, z) || slope(x, z) < 0.12 || slope(x, z) > 0.6 || !clear(x, z, 40)) continue;
      const cv = { x, z, y: height(x, z), r: 7 };
      world.caves.push(cv); reserve(x, z, 28);
      for (let k = 0; k < 3; k++) world.lootSpots.push({ x: x + (rnd() - 0.5) * 5, z: z + (rnd() - 0.5) * 5, tier: 4 });
      for (let k = 0; k < 5; k++) { const a = Math.PI * 2 * k / 5 + rnd() * 0.4; world.circles.push({ x: x + Math.cos(a) * 6.5, z: z + Math.sin(a) * 6.5, r: 2.2, top: height(x, z) + 6, kind: 'rock' }); }
    }

    // hidden locations (one per type)
    ['shrine', 'wreck', 'overlook', 'grotto', 'bunker'].forEach((id, i) => {
      for (let t = 0; t < 300; t++) {
        const ang = rnd() * 6.28, rad = 110 + rnd() * 330; const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
        if (!free(x, z) || !clear(x, z, 30) || slope(x, z) > 0.4) continue;
        world.hidden.push({ id, x, z, y: height(x, z), r: 7 }); reserve(x, z, 24);
        world.lootSpots.push({ x, z, tier: 4 });
        break;
      }
    });

    // trees
    const nTrees = 2600; tries = 0;
    while (world.trees.length < nTrees && tries++ < nTrees * 5) {
      const x = (rnd() * 2 - 1) * (W.radius + 20), z = (rnd() * 2 - 1) * (W.radius + 20);
      const r = Math.sqrt(x * x + z * z);
      const density = fbm(x * 0.008, z * 0.008, seed + 31, 3);
      if (r < 60 || r > W.radius + 15 || density < 0.40 + rnd() * 0.12) continue;
      if (!free(x, z) || slope(x, z) > 0.55 || !clear(x, z, 0)) continue;
      if (rnd() < 0.5 && !clear(x, z, 5)) continue;
      const s = 0.8 + rnd() * 0.9, type = rnd() < 0.68 ? 0 : 1;   // 0 conifer, 1 broadleaf
      const y = height(x, z);
      world.trees.push({ x, z, y, s, type });
      world.circles.push({ x, z, r: 0.35 * s + 0.15, top: y + 20, kind: 'tree' });
    }
    // rocks
    tries = 0;
    while (world.rocks.length < 320 && tries++ < 3000) {
      const x = (rnd() * 2 - 1) * (W.radius + 10), z = (rnd() * 2 - 1) * (W.radius + 10);
      if (Math.sqrt(x * x + z * z) > W.radius || !free(x, z) || !clear(x, z, -6)) continue;
      const s = 0.8 + rnd() * 2.6;
      const y = height(x, z);
      world.rocks.push({ x, z, y, s, rot: rnd() * 6.28 });
      world.circles.push({ x, z, r: s * 0.85, top: y + s * 1.4, kind: 'rock' });
    }
    // bushes (hiding places — no collision, bots/players inside are harder to see)
    tries = 0;
    while (world.bushes.length < 900 && tries++ < 6000) {
      const x = (rnd() * 2 - 1) * W.radius, z = (rnd() * 2 - 1) * W.radius;
      if (Math.sqrt(x * x + z * z) > W.radius - 5 || !free(x, z) || fbm(x * 0.01, z * 0.01, seed + 5, 3) < 0.38) continue;
      world.bushes.push({ x, z, y: height(x, z), s: 0.8 + rnd() * 0.9 });
    }

    // general loot spots
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; world.lootSpots.push({ x: Math.cos(a) * 6, z: Math.sin(a) * 6, tier: 3 }); }
    for (let i = 0; i < 30; i++) { const a = rnd() * 6.28, rr = 14 + rnd() * 44; world.lootSpots.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, tier: 3 }); }
    tries = 0; let nf = 0;
    while (nf < 110 && tries++ < 2000) {
      const ang = rnd() * 6.28, rad = 70 + rnd() * 380; const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (!free(x, z)) continue; world.lootSpots.push({ x, z, tier: 1 }); nf++;
    }
    for (const s of world.lootSpots) s.y = height(s.x, s.z);

    // spatial grid for colliders
    const CELL = 16, grid = new Map();
    const key = (i, j) => i * 100003 + j;
    function put(o, minx, maxx, minz, maxz) {
      for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++) for (let j = Math.floor(minz / CELL); j <= Math.floor(maxz / CELL); j++) {
        const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(o);
      }
    }
    for (const c of world.circles) { c.k = 0; put(c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r); }
    for (const b of world.boxes) { b.k = 1; put(b, b.minx, b.maxx, b.minz, b.maxz); }
    world.query = function (x, z, rad) {
      const out = [];
      for (let i = Math.floor((x - rad) / CELL); i <= Math.floor((x + rad) / CELL); i++) for (let j = Math.floor((z - rad) / CELL); j <= Math.floor((z + rad) / CELL); j++) {
        const a = grid.get(key(i, j)); if (a) for (const o of a) if (out.indexOf(o) < 0) out.push(o);
      }
      return out;
    };
    world.inBush = (x, z) => { for (const b of world.bushes) { const dx = b.x - x, dz = b.z - z; if (dx * dx + dz * dz < 1.6 * b.s * b.s) return true; } return false; };
    world.inBuilding = (x, z) => { for (const b of world.buildings) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b; return null; };
    world.inCorn = (x, z) => x * x + z * z < (cor.r + 1) * (cor.r + 1);

    // serialisable payload for clients (objects only; terrain is regenerated from seed)
    world.payload = function () {
      const r1 = v => Math.round(v * 10) / 10;
      return { seed, trees: world.trees.map(t => [r1(t.x), r1(t.z), r1(t.s), t.type]), rocks: world.rocks.map(t => [r1(t.x), r1(t.z), r1(t.s), r1(t.rot)]),
        bushes: world.bushes.map(t => [r1(t.x), r1(t.z), r1(t.s)]), buildings: world.buildings.map(b => [r1(b.x), r1(b.z), r1(b.w), r1(b.d), b.door]),
        caves: world.caves.map(c => [r1(c.x), r1(c.z)]), hidden: world.hidden.map(h => [h.id, r1(h.x), r1(h.z)]) };
    };
    return world;
  }

  /* Rebuild a world on the client from a server payload (same height function, same objects, same colliders). */
  function worldFromPayload(p) {
    const w = createWorld(p.seed);
    const trees = p.trees.map(t => ({ x: t[0], z: t[1], s: t[2], type: t[3], y: w.height(t[0], t[1]) }));
    w.trees.length = 0; trees.forEach(t => w.trees.push(t));
    w.rocks.length = 0; p.rocks.forEach(t => w.rocks.push({ x: t[0], z: t[1], s: t[2], rot: t[3], y: w.height(t[0], t[1]) }));
    w.bushes.length = 0; p.bushes.forEach(t => w.bushes.push({ x: t[0], z: t[1], s: t[2], y: w.height(t[0], t[1]) }));
    w.buildings.length = 0; p.buildings.forEach(t => w.buildings.push({ x: t[0], z: t[1], w: t[2], d: t[3], door: t[4], y: w.height(t[0], t[1]), h: 3.6 }));
    w.caves.length = 0; p.caves.forEach(t => w.caves.push({ x: t[0], z: t[1], y: w.height(t[0], t[1]), r: 7 }));
    w.hidden.length = 0; p.hidden.forEach(t => w.hidden.push({ id: t[0], x: t[1], z: t[2], y: w.height(t[1], t[2]), r: 7 }));
    return rebuildColliders(w);
  }

  /* Rebuild collider grid from the object lists (used by client after replacing lists). */
  function rebuildColliders(w) {
    const CELL = 16, grid = new Map(), key = (i, j) => i * 100003 + j;
    const cor = w.cornucopia;
    const circles = [], boxes = [];
    const nP = 18;
    for (let i = 0; i < nP; i++) {
      const a = (i / nP) * Math.PI * 2, dM = Math.abs(Math.atan2(Math.sin(a - cor.mouth), Math.cos(a - cor.mouth)));
      if (dM < 0.5) continue; circles.push({ x: Math.cos(a) * cor.r, z: Math.sin(a) * cor.r, r: 1.7, top: 8 });
    }
    w.trees.forEach(t => circles.push({ x: t.x, z: t.z, r: 0.35 * t.s + 0.15, top: t.y + 20 }));
    w.rocks.forEach(t => circles.push({ x: t.x, z: t.z, r: t.s * 0.85, top: t.y + t.s * 1.4 }));
    w.caves.forEach(c => { for (let k = 0; k < 5; k++) { const a = Math.PI * 2 * k / 5; circles.push({ x: c.x + Math.cos(a) * 6.5, z: c.z + Math.sin(a) * 6.5, r: 2.2, top: c.y + 6 }); } });
    w.buildings.forEach(b => {
      const gy = b.y, t = 0.5, hw = b.w / 2, hd = b.d / 2, dg = 1.6, x = b.x, z = b.z;
      const segs = [[x - hw, x + hw, z - hd - t / 2, z - hd + t / 2], [x - hw, x + hw, z + hd - t / 2, z + hd + t / 2], [x - hw - t / 2, x - hw + t / 2, z - hd, z + hd], [x + hw - t / 2, x + hw + t / 2, z - hd, z + hd]];
      segs.forEach((s, i) => {
        if (i !== b.door) { boxes.push({ minx: s[0], maxx: s[1], minz: s[2], maxz: s[3], top: gy + b.h, base: gy }); return; }
        if (i < 2) { const cx = (s[0] + s[1]) / 2; boxes.push({ minx: s[0], maxx: cx - dg, minz: s[2], maxz: s[3], top: gy + b.h, base: gy }, { minx: cx + dg, maxx: s[1], minz: s[2], maxz: s[3], top: gy + b.h, base: gy }); }
        else { const cz = (s[2] + s[3]) / 2; boxes.push({ minx: s[0], maxx: s[1], minz: s[2], maxz: cz - dg, top: gy + b.h, base: gy }, { minx: s[0], maxx: s[1], minz: cz + dg, maxz: s[3], top: gy + b.h, base: gy }); }
      });
    });
    function put(o, minx, maxx, minz, maxz) { for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++) for (let j = Math.floor(minz / CELL); j <= Math.floor(maxz / CELL); j++) { const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(o); } }
    circles.forEach(c => { c.k = 0; put(c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r); });
    boxes.forEach(b => { b.k = 1; put(b, b.minx, b.maxx, b.minz, b.maxz); });
    w.circles = circles; w.boxes = boxes;
    w.query = function (x, z, rad) {
      const out = [];
      for (let i = Math.floor((x - rad) / CELL); i <= Math.floor((x + rad) / CELL); i++) for (let j = Math.floor((z - rad) / CELL); j <= Math.floor((z + rad) / CELL); j++) { const a = grid.get(key(i, j)); if (a) for (const o of a) if (out.indexOf(o) < 0) out.push(o); }
      return out;
    };
    return w;
  }

  return { createWorld, worldFromPayload, rebuildColliders, mulberry, hash2, fbm };
});
