/* Shared player movement step. The server runs it authoritatively; the client runs the same code for prediction. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'));
  else { root.HG = root.HG || {}; root.HG.Move = factory(root.HG.C); }
})(typeof self !== 'undefined' ? self : globalThis, function (C) {
  const P = C.PLAYER, W = C.WORLD;

  // input flags
  const F = { JUMP: 1, SPRINT: 2, CROUCH: 4, AIM: 8, ATTACK: 16 };

  function pushOut(world, p, rad) {
    const near = world.query(p.x, p.z, rad + 4);
    for (const o of near) {
      if (o.k === 0) {
        if (p.y >= o.top - 0.25) continue;
        const dx = p.x - o.x, dz = p.z - o.z, min = o.r + rad, d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001; const k = (min - d) / d;
          p.x += dx * k; p.z += dz * k;
        }
      } else {
        if (p.y >= o.top - 0.25) continue;
        const cx = Math.max(o.minx, Math.min(p.x, o.maxx)), cz = Math.max(o.minz, Math.min(p.z, o.maxz));
        let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
        if (d2 < rad * rad) {
          if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (rad - d) / d; p.x += dx * k; p.z += dz * k; }
          else { // centre inside box: push out along the shallowest axis
            const l = p.x - o.minx, r = o.maxx - p.x, t = p.z - o.minz, b = o.maxz - p.z, m = Math.min(l, r, t, b);
            if (m === l) p.x = o.minx - rad; else if (m === r) p.x = o.maxx + rad; else if (m === t) p.z = o.minz - rad; else p.z = o.maxz + rad;
          }
        }
      }
    }
  }

  /* state p: x,y,z,vx,vy,vz,onGround,crouch,stamina,stamDelay,sprinting,inWater ; mods: speedMul, maxStamina, rooted
     input: mx (strafe -1..1, + = right), mz (forward -1..1), yaw, flags */
  function step(p, inp, world, dt) {
    const f = inp.f | 0;
    const rooted = (p.rootT || 0) > 0;
    const maxSt = p.maxStamina || P.maxStamina;
    p.crouch = !!(f & F.CROUCH) && p.onGround;
    p.aiming = !!(f & F.AIM);
    let mx = Math.max(-1, Math.min(1, +inp.mx || 0)), mz = Math.max(-1, Math.min(1, +inp.mz || 0));
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const moving = ml > 0.05 && !rooted;
    const wantSprint = !!(f & F.SPRINT) && moving && mz > 0.2 && !p.crouch && !p.aiming && p.stamina > 4 && !(p.exhausted > 0);
    p.sprinting = wantSprint;
    p.yaw = +inp.yaw || 0;
    // speed
    let sp = p.crouch ? P.crouch : (wantSprint ? P.sprint : P.walk);
    if (p.aiming) sp *= P.aimMul;
    const gh = world.height(p.x, p.z);
    p.inWater = gh < W.waterLevel - 0.1;
    if (p.inWater) sp *= P.waterMul;
    sp *= (p.speedMul || 1);
    if (rooted) sp = 0;
    // world-space wish direction (yaw 0 faces -Z, like three.js)
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const wx = mx * cy - mz * sy, wz = -mx * sy - mz * cy;   // right = (cos,-sin), forward = (-sin,-cos)
    const tvx = wx * sp, tvz = wz * sp;
    const acc = (p.onGround ? P.accel : P.airAccel) * dt;
    const dvx = tvx - p.vx, dvz = tvz - p.vz, dl = Math.hypot(dvx, dvz);
    if (dl <= acc || dl < 1e-6) { p.vx = tvx; p.vz = tvz; } else { p.vx += dvx / dl * acc; p.vz += dvz / dl * acc; }
    // jump
    if ((f & F.JUMP) && p.onGround && !rooted && p.stamina >= P.jumpCost && !p.crouch) { p.vy = P.jump; p.onGround = false; p.stamina -= P.jumpCost; p.stamDelay = P.staminaDelay; }
    // stamina
    if (wantSprint && ml > 0.05) { p.stamina -= P.sprintCost * dt; p.stamDelay = P.staminaDelay; if (p.stamina <= 0) { p.stamina = 0; p.exhausted = 1.2; } }
    else { if (p.stamDelay > 0) p.stamDelay -= dt; else p.stamina = Math.min(maxSt, p.stamina + P.staminaRegen * dt * (p.crouch ? 1.3 : 1)); }
    if (p.exhausted > 0) p.exhausted -= dt;
    if (p.stamina > maxSt) p.stamina = maxSt;
    if (p.rootT > 0) p.rootT -= dt;
    // gravity & integrate (two sub-steps for stability at speed)
    p.vy -= P.gravity * dt;
    const sub = 2, h = dt / sub, rad = P.radius;
    for (let i = 0; i < sub; i++) {
      p.x += p.vx * h; p.z += p.vz * h; p.y += p.vy * h;
      pushOut(world, p, rad);
      const g = world.height(p.x, p.z);
      if (p.y <= g) { p.y = g; if (p.vy < 0) { p.vy = 0; } p.onGround = true; }
      else if (p.y > g + 0.06) p.onGround = false;
    }
    // soft edge of the world
    const r = Math.hypot(p.x, p.z), lim = W.radius;
    if (r > lim) { const k = lim / r; p.x *= k; p.z *= k; p.vx *= 0.5; p.vz *= 0.5; }
    return p;
  }

  function newState(x, z, world) {
    return { x, z, y: world.height(x, z), vx: 0, vy: 0, vz: 0, yaw: 0, onGround: true, crouch: false, aiming: false, sprinting: false, inWater: false,
      stamina: P.maxStamina, stamDelay: 0, exhausted: 0, rootT: 0, speedMul: 1, maxStamina: P.maxStamina };
  }

  // eye height (for aiming / vision)
  const eyeY = p => p.y + (p.crouch ? P.crouchEye : P.eye);

  return { F, step, newState, pushOut, eyeY };
});
