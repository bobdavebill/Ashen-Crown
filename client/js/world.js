/* Renderer + static world builder: terrain, instanced forest (chunked LOD), buildings, Cornucopia, sky / day-night / weather,
   zone wall, hazards, loot, projectiles, mutts, traps, lightning, particles. */
(function () {
  const T = THREE, C = HG.C, A = HG.Avatar;
  const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const col = h => new T.Color(h);
  function hash(x, z) { let h = Math.imul((x * 73856093) ^ (z * 19349663), 2246822519); h ^= h >>> 15; h = Math.imul(h, 3266489917); h ^= h >>> 13; return (h >>> 0) / 4294967296; }

  /* merge a list of {geo, color, m(Matrix4)} into one non-indexed geometry with vertex colours */
  function merge(parts) {
    const pos = [], nor = [], colr = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); if (p.m) g.applyMatrix4(p.m);
      const c = new T.Color(p.color), pa = g.attributes.position, na = g.attributes.normal;
      for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); nor.push(na.getX(i), na.getY(i), na.getZ(i)); colr.push(c.r, c.g, c.b); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
    return g;
  }
  const M4 = (x, y, z, rx, ry, rz, sx, sy, sz) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(sx || 1, sy == null ? (sx || 1) : sy, sz == null ? (sx || 1) : sz));

  function create(canvas) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(70, 1, 0.1, 1400);
    scene.fog = new T.Fog(0x9aa5ad, 60, 520); scene.background = new T.Color(0x9aa5ad);
    const hemi = new T.HemisphereLight(0xbfd2e6, 0x4a4535, 0.5); scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff0d8, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 400; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    scene.add(sun); scene.add(sun.target);

    /* ------------------------------------------------------------- sky */
    const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: col(0x4d6f94) }, hor: { value: col(0xaebfc9) }, sunDir: { value: new T.Vector3(0, 1, 0) }, sunCol: { value: col(0xffe2b0) }, stars: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top,hor,sunDir,sunCol; uniform float stars; varying vec3 vP; float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} void main(){ vec3 d=normalize(vP); float h=clamp(d.y,0.0,1.0); vec3 c=mix(hor,top,pow(h,0.5)); float s=max(dot(d,normalize(sunDir)),0.0); c+=sunCol*(pow(s,900.0)*4.0+pow(s,10.0)*0.22); vec2 g=floor(vec2(atan(d.x,d.z)*90.0,d.y*180.0)); float st=step(0.9965,h21(g))*stars*smoothstep(0.05,0.3,d.y); c+=vec3(st); gl_FragColor=vec4(c,1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n }' });
    const sky = new T.Mesh(new T.SphereGeometry(1000, 32, 20), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

    const R = { renderer, scene, camera, sun, hemi, world: null, group: new T.Group(), chunks: [], flashT: 0, tod: 0.4, weather: 0, rainAmt: 0, time: 0, bolts: [], parts: [], focus: new T.Vector3(), quality: 'high' };
    scene.add(R.group);

    /* ------------------------------------------------------------- rain */
    const NR = 1800, rp = new Float32Array(NR * 6), rv = new Float32Array(NR);
    for (let i = 0; i < NR; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 32, z = (Math.random() - 0.5) * 60; rp.set([x, y, z, x, y - 0.9, z], i * 6); rv[i] = 22 + Math.random() * 10; }
    const rainGeo = new T.BufferGeometry(); rainGeo.setAttribute('position', new T.BufferAttribute(rp, 3));
    const rain = new T.LineSegments(rainGeo, new T.LineBasicMaterial({ color: 0xaab8c6, transparent: true, opacity: 0.0, depthWrite: false, fog: true })); rain.frustumCulled = false; scene.add(rain);

    /* ------------------------------------------------------------- world build */
    const mats = {
      terrain: new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
      vc: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
      stone: new T.MeshStandardMaterial({ color: 0x6d6a64, roughness: 0.95 }), wood: new T.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95 }),
      gold: new T.MeshStandardMaterial({ color: 0xc9a13b, roughness: 0.3, metalness: 0.85, side: T.DoubleSide }), dark: new T.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.8 }),
    };
    const water = new T.Mesh(new T.PlaneGeometry(1400, 1400), new T.MeshStandardMaterial({ color: 0x1d4b5c, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.y = C.WORLD.waterLevel; water.receiveShadow = true; R.group.add(water);

    const zoneMat = new T.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.16, side: T.DoubleSide, depthWrite: false, fog: false });
    const zoneWall = new T.Mesh(new T.CylinderGeometry(1, 1, 260, 96, 1, true), zoneMat); zoneWall.position.y = 60; zoneWall.frustumCulled = false; scene.add(zoneWall);
    const zoneEdge = new T.LineLoop(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })); zoneEdge.frustumCulled = false; scene.add(zoneEdge);
    let zoneKey = '';

    R.load = function (world) {
      R.clear(); R.world = world; const g = R.group;
      /* terrain */
      const N = 250, S = world.size, geo = new T.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2);
      const pa = geo.attributes.position, cols = new Float32Array(pa.count * 3);
      for (let i = 0; i < pa.count; i++) pa.setY(i, world.height(pa.getX(i), pa.getZ(i)));
      geo.computeVertexNormals();
      const na = geo.attributes.normal, cg = col(0x41592a), cd = col(0x6b5b3a), cr = col(0x6e6a63), cs = col(0xdde6ec), csand = col(0xa89868), cash = col(0x55524c), tmp = new T.Color();
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i), ny = na.getY(i), n = hash(Math.round(x / 4), Math.round(z / 4)), r = Math.hypot(x, z);
        tmp.copy(cg).lerp(cd, 0.25 + n * 0.35 + clamp((y - 8) / 30, 0, 0.3));
        if (y < 0.5) tmp.lerp(csand, sstep(0.5, -0.4, y) * 0.9);
        if (r < 62) tmp.lerp(cash, 1 - sstep(34, 62, r));
        const rock = sstep(0.9, 0.7, ny) + sstep(26, 40, y) * 0.8; tmp.lerp(cr, clamp(rock, 0, 1));
        tmp.lerp(cs, sstep(48, 64, y + n * 6));
        tmp.multiplyScalar(0.9 + n * 0.2); cols.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      geo.setAttribute('color', new T.BufferAttribute(cols, 3));
      const terrain = new T.Mesh(geo, mats.terrain); terrain.receiveShadow = true; g.add(terrain);

      /* forest — chunked instanced meshes (frustum culling + distance LOD + shadow LOD) */
      const coneG = new T.ConeGeometry(1, 1, 7), icoG = new T.IcosahedronGeometry(1, 1), cylG = new T.CylinderGeometry(0.2, 0.3, 1, 6);
      const conifer = merge([{ geo: cylG, color: 0x3d2c1c, m: M4(0, 1.2, 0, 0, 0, 0, 1, 2.4, 1) }, { geo: coneG, color: 0x1f3d25, m: M4(0, 3.2, 0, 0, 0, 0, 2.3, 3.4, 2.3) }, { geo: coneG, color: 0x24472b, m: M4(0, 5.1, 0, 0, 0, 0, 1.8, 3.0, 1.8) }, { geo: coneG, color: 0x2a5230, m: M4(0, 6.8, 0, 0, 0, 0, 1.2, 2.6, 1.2) }]);
      const broad = merge([{ geo: cylG, color: 0x4a3623, m: M4(0, 1.5, 0, 0, 0, 0, 1.3, 3, 1.3) }, { geo: icoG, color: 0x3c5a22, m: M4(0, 4.4, 0, 0, 0, 0, 2.4, 2.0, 2.4) }, { geo: icoG, color: 0x4a6a2a, m: M4(1.2, 3.8, 0.5, 0, 0, 0, 1.6, 1.4, 1.6) }, { geo: icoG, color: 0x44632a, m: M4(-1.0, 5.2, -0.6, 0, 0, 0, 1.5, 1.3, 1.5) }]);
      const rockG = icoG.clone(); { const p = rockG.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.78 + hash(Math.round(p.getX(i) * 40), Math.round(p.getZ(i) * 40 + p.getY(i) * 13)) * 0.45; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); } rockG.computeVertexNormals(); }
      const bushG = merge([{ geo: icoG, color: 0x2f4a22, m: M4(0, 0.45, 0, 0, 0, 0, 0.9, 0.6, 0.9) }, { geo: icoG, color: 0x3a5a28, m: M4(0.5, 0.35, 0.2, 0, 0, 0, 0.6, 0.45, 0.6) }]);
      const CH = 125, cells = new Map(), dummy = new T.Object3D();
      const put = (kind, o, sc, rot) => { const k = Math.floor((o.x + 500) / CH) + ':' + Math.floor((o.z + 500) / CH) + ':' + kind; let c = cells.get(k); if (!c) cells.set(k, c = { kind, list: [], cx: 0, cz: 0 }); c.list.push([o.x, o.y, o.z, sc, rot]); c.cx += o.x; c.cz += o.z; };
      world.trees.forEach(t => put(t.type ? 'b' : 'c', t, t.s, hash(Math.round(t.x), Math.round(t.z)) * 6.28));
      world.rocks.forEach(t => put('r', t, t.s, t.rot)); world.bushes.forEach(t => put('u', t, t.s, hash(Math.round(t.x * 3), Math.round(t.z * 3)) * 6.28));
      const geoOf = { c: conifer, b: broad, r: rockG, u: bushG }, matOf = { c: mats.vc, b: mats.vc, r: new T.MeshStandardMaterial({ color: 0x77736b, roughness: 1, flatShading: true }), u: mats.vc };
      for (const c of cells.values()) {
        const im = new T.InstancedMesh(geoOf[c.kind], matOf[c.kind], c.list.length); const tint = new T.Color();
        c.list.forEach((l, i) => { dummy.position.set(l[0], l[1] - (c.kind === 'r' ? 0.15 * l[3] : 0), l[2]); dummy.rotation.set(0, l[4], 0); const sy = c.kind === 'r' ? l[3] : l[3] * (c.kind === 'u' ? 1 : 1.05); dummy.scale.set(l[3], sy, l[3]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
          const v = 0.82 + hash(Math.round(l[0] * 7), Math.round(l[2] * 7)) * 0.36; tint.setRGB(v, v * (0.95 + hash(Math.round(l[2]), Math.round(l[0])) * 0.1), v * 0.95); im.setColorAt(i, tint); });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = c.kind === 'r';
        im.userData = { cx: c.cx / c.list.length, cz: c.cz / c.list.length, kind: c.kind }; g.add(im); R.chunks.push(im);
      }
      /* grass tufts near the player */
      const grassG = merge([0, 1, 2].map(i => ({ geo: new T.ConeGeometry(0.09, 0.75, 3), color: 0x4c6a2c, m: M4(Math.cos(i * 2.1) * 0.12, 0.37, Math.sin(i * 2.1) * 0.12, 0.15 * Math.cos(i), 0, 0.15 * Math.sin(i), 1, 1, 1) })));
      R.grass = new T.InstancedMesh(grassG, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 5200); R.grass.frustumCulled = false; R.grass.count = 0; R.grass.receiveShadow = true; g.add(R.grass); R.grassKey = '';

      /* buildings — walls come straight from the shared collision boxes so visuals == physics */
      const stoneM = new T.MeshStandardMaterial({ color: 0x5b5750, roughness: 1 }), roofM = new T.MeshStandardMaterial({ color: 0x3a2e24, roughness: 1 });
      for (const b of world.boxes) { const m = new T.Mesh(new T.BoxGeometry(b.maxx - b.minx, b.top - b.base + 1.5, b.maxz - b.minz), stoneM); m.position.set((b.minx + b.maxx) / 2, (b.top + b.base) / 2 - 0.75, (b.minz + b.maxz) / 2); m.castShadow = true; m.receiveShadow = true; g.add(m); }
      for (const b of world.buildings) {
        const r = new T.Mesh(new T.BoxGeometry(b.w + 1.2, 0.35, b.d + 1.2), roofM); r.position.set(b.x, b.y + b.h + 0.18, b.z); r.castShadow = true; r.receiveShadow = true; g.add(r);
        const fl = new T.Mesh(new T.BoxGeometry(b.w, 0.2, b.d), mats.wood); fl.position.set(b.x, b.y + 0.02, b.z); fl.receiveShadow = true; g.add(fl);
        const crates = new T.Mesh(new T.BoxGeometry(1.1, 1.1, 1.1), mats.wood); crates.position.set(b.x + b.w * 0.3, b.y + 0.6, b.z - b.d * 0.3); crates.castShadow = true; g.add(crates);
      }
      /* caves */
      for (const c of world.caves) {
        for (let k = 0; k < 5; k++) { const a = Math.PI * 2 * k / 5, m = new T.Mesh(rockG, matOf.r); m.position.set(c.x + Math.cos(a) * 6.5, c.y + 2, c.z + Math.sin(a) * 6.5); m.scale.set(3.2, 4.4, 3.2); m.rotation.y = k; m.castShadow = true; g.add(m); }
        const roof = new T.Mesh(rockG, matOf.r); roof.position.set(c.x, c.y + 6.4, c.z); roof.scale.set(7.2, 2.2, 7.2); roof.castShadow = true; g.add(roof);
        const dk = new T.Mesh(new T.CircleGeometry(5, 16), new T.MeshBasicMaterial({ color: 0x050505 })); dk.rotation.x = -Math.PI / 2; dk.position.set(c.x, c.y + 0.1, c.z); g.add(dk);
      }
      /* hidden locations — small props, one per type */
      for (const h of world.hidden) {
        const grp = new T.Group(); grp.position.set(h.x, h.y, h.z);
        if (h.id === 'shrine') { const a = new T.Mesh(new T.BoxGeometry(1.6, 1.0, 1.6), mats.stone); a.position.y = 0.5; const o = new T.Mesh(new T.OctahedronGeometry(0.4), new T.MeshBasicMaterial({ color: 0x7fe0ff })); o.position.y = 1.7; o.userData.spin = 1; grp.add(a, o); }
        else if (h.id === 'wreck') { const b = new T.Mesh(new T.BoxGeometry(6, 1.6, 3), mats.dark); b.rotation.set(0.1, 0.5, 0.2); b.position.y = 0.9; const w = new T.Mesh(new T.BoxGeometry(5, 0.2, 1), mats.gold); w.position.set(1, 1.7, 1); w.rotation.set(0.2, 0.5, 0.5); grp.add(b, w); }
        else if (h.id === 'overlook') { const p = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 5, 6), mats.wood); p.position.y = 2.5; const f = new T.Mesh(new T.PlaneGeometry(1.8, 1.0), new T.MeshBasicMaterial({ color: 0xb02a22, side: T.DoubleSide })); f.position.set(0.95, 4.4, 0); grp.add(p, f); }
        else if (h.id === 'grotto') { for (let k = 0; k < 6; k++) { const m = new T.Mesh(rockG, matOf.r); const a = k * 1.05; m.position.set(Math.cos(a) * 3, 0.7, Math.sin(a) * 3); m.scale.set(1.5, 1.4, 1.5); grp.add(m); } const gl = new T.Mesh(new T.SphereGeometry(0.5, 8, 6), new T.MeshBasicMaterial({ color: 0x4aa3ff })); gl.position.y = 0.8; gl.userData.spin = 1; grp.add(gl); }
        else { const b = new T.Mesh(new T.BoxGeometry(3.4, 0.7, 3.4), mats.stone); b.position.y = 0.35; const hh = new T.Mesh(new T.BoxGeometry(1.2, 0.2, 1.2), mats.dark); hh.position.y = 0.8; grp.add(b, hh); }
        g.add(grp);
      }
      /* spawn pedestals + Cornucopia */
      for (const s of world.spawns) { const p = new T.Mesh(new T.CylinderGeometry(1.1, 1.3, 0.7, 14), new T.MeshStandardMaterial({ color: 0x8a8272, roughness: 0.6, metalness: 0.2 })); p.position.set(s.x, world.height(s.x, s.z) + 0.1, s.z); p.receiveShadow = true; p.castShadow = true; g.add(p); }
      const cor = world.cornucopia, cy = world.height(0, 0);
      const plat = new T.Mesh(new T.CylinderGeometry(15, 16.5, 0.6, 40), new T.MeshStandardMaterial({ color: 0x4d4a44, roughness: 0.7 })); plat.position.y = cy + 0.15; plat.receiveShadow = true; g.add(plat);
      for (let pi = 0; pi < 18; pi++) { const pa2 = pi / 18 * Math.PI * 2, dM = Math.abs(Math.atan2(Math.sin(pa2 - cor.mouth), Math.cos(pa2 - cor.mouth))); if (dM < 0.5) continue; const c = { x: Math.cos(pa2) * cor.r, z: Math.sin(pa2) * cor.r }; const p = new T.Mesh(new T.CylinderGeometry(1.35, 1.7, 8.2, 12), new T.MeshStandardMaterial({ color: 0x8a8576, roughness: 0.75 })); p.position.set(c.x, cy + 4.2, c.z); p.castShadow = true; p.receiveShadow = true; g.add(p); const cap = new T.Mesh(new T.CylinderGeometry(1.9, 1.5, 0.5, 12), mats.gold); cap.position.set(c.x, cy + 8.4, c.z); g.add(cap); }
      /* the horn: a tapering golden spiral, mouth toward `cor.mouth`, hovering over the pillar ring */
      const dir = new T.Vector3(Math.cos(cor.mouth), 0, Math.sin(cor.mouth)), side = new T.Vector3(-dir.z, 0, dir.x);
      const pts = []; for (let i = 0; i <= 28; i++) { const t = i / 28; pts.push(new T.Vector3().addScaledVector(dir, lerp(16, -12, t)).addScaledVector(side, Math.sin(t * 2.4) * 6 * t).setY(cy + lerp(7.2, 21, Math.pow(t, 1.6)))); }
      const curve = new T.CatmullRomCurve3(pts); const horn = new T.Group(); const up = new T.Vector3(0, 1, 0);
      const SEG = 30; for (let i = 0; i < SEG; i++) { const a = curve.getPoint(i / SEG), b = curve.getPoint((i + 1) / SEG), r0 = lerp(6.2, 0.7, Math.pow(i / SEG, 0.85)), r1 = lerp(6.2, 0.7, Math.pow((i + 1) / SEG, 0.85)), len = a.distanceTo(b);
        const m = new T.Mesh(new T.CylinderGeometry(r1, r0, len * 1.02, 16, 1, true), mats.gold); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize()); m.castShadow = true; horn.add(m); }
      const rim = new T.Mesh(new T.TorusGeometry(6.2, 0.35, 8, 28), mats.gold); rim.position.copy(curve.getPoint(0)); rim.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), curve.getTangent(0)); horn.add(rim);
      g.add(horn);
      R.minimap = R.makeMinimap(world);
      R.updateGrass(0, 0, true);
    };

    R.makeMinimap = function (world) {
      const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d'), img = x.createImageData(S, S), half = world.size / 2;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const wx = (i / S - 0.5) * world.size, wz = (j / S - 0.5) * world.size, h = world.height(wx, wz), r = Math.hypot(wx, wz); let c;
        if (h < C.WORLD.waterLevel) c = [28, 70, 92]; else if (h > 40) c = [225, 230, 235]; else if (h > 22) c = [112, 108, 100]; else if (h > 12) c = [74, 88, 54]; else c = [60, 86, 44];
        if (r < 55) c = [78, 74, 66]; const sh = 0.85 + (world.height(wx + 6, wz + 6) - h) * -0.05; const o = (j * S + i) * 4; img.data[o] = clamp(c[0] * sh, 0, 255); img.data[o + 1] = clamp(c[1] * sh, 0, 255); img.data[o + 2] = clamp(c[2] * sh, 0, 255); img.data[o + 3] = 255;
      }
      x.putImageData(img, 0, 0); return cv;
    };

    R.clear = function () {
      for (const o of R.group.children.slice()) { if (o === water) continue; R.group.remove(o); o.traverse && o.traverse(c => { if (c.geometry && !c.userData.keep) c.geometry.dispose && 0; }); }
      R.group.add(water); R.chunks = []; for (const m of [R.lootG, R.projG, R.muttG, R.trapG, R.hazG]) if (m) scene.remove(m);
      R.lootG = new T.Group(); R.projG = new T.Group(); R.muttG = new T.Group(); R.trapG = new T.Group(); R.hazG = new T.Group(); scene.add(R.lootG, R.projG, R.muttG, R.trapG, R.hazG);
      R.loot = new Map(); R.proj = new Map(); R.mutts = new Map(); R.traps = new Map(); R.haz = new Map(); R.parts.forEach(p => scene.remove(p.m)); R.parts = []; R.world = null;
    };
    R.clear();

    /* ------------------------------------------------------------- grass */
    R.updateGrass = function (px, pz, force) {
      const w = R.world; if (!w || !R.grass) return; const cs = 2.4, ci = Math.floor(px / cs), cj = Math.floor(pz / cs), key = ci + ',' + cj;
      if (!force && key === R.grassKey) return; R.grassKey = key; const g = R.grass, d = new T.Object3D(), tint = new T.Color(); let n = 0, rad = R.quality === 'low' ? 14 : 20;
      for (let i = ci - rad; i <= ci + rad && n < 5100; i++) for (let j = cj - rad; j <= cj + rad && n < 5100; j++) {
        const dx = (i - ci), dz = (j - cj); if (dx * dx + dz * dz > rad * rad) continue; const h1 = hash(i, j); if (h1 > 0.55) continue;
        const x = (i + hash(i, j + 7)) * cs, z = (j + hash(i + 3, j)) * cs, y = w.height(x, z); if (y < C.WORLD.waterLevel + 0.25 || Math.hypot(x, z) < 38 || y > 26) continue;
        d.position.set(x, y - 0.05, z); d.rotation.set(0, h1 * 40, 0); const s = 0.8 + hash(j, i) * 0.9; d.scale.set(s, s, s); d.updateMatrix(); g.setMatrixAt(n, d.matrix); const v = 0.8 + hash(i * 3, j * 5) * 0.5; tint.setRGB(v, v, v * 0.9); g.setColorAt(n, tint); n++;
      }
      g.count = n; g.instanceMatrix.needsUpdate = true; if (g.instanceColor) g.instanceColor.needsUpdate = true;
    };

    /* ------------------------------------------------------------- sky / weather / lighting */
    const SK = { day: [col(0x4f78a6), col(0xb4c4cf)], dusk: [col(0x353b66), col(0xe08a55)], night: [col(0x04060e), col(0x101a2c)], over: [col(0x4b5159), col(0x808890)], storm: [col(0x23272d), col(0x3c4249)] };
    R.setTime = function (tod, weather) {
      R.tod = tod; R.weather = weather | 0;
      const ang = (tod - 0.25) * Math.PI * 2, e = Math.sin(ang);       // tod .25 sunrise, .5 noon, .75 sunset, 0 midnight
      const dayF = sstep(-0.05, 0.3, e), duskF = (1 - Math.abs(clamp(e / 0.28, -1, 1))) * (e > -0.2 ? 1 : 0);
      const top = SK.night[0].clone().lerp(SK.day[0], dayF).lerp(SK.dusk[0], duskF * 0.75), hor = SK.night[1].clone().lerp(SK.day[1], dayF).lerp(SK.dusk[1], duskF * 0.85);
      const cover = R.weather === 0 ? 0 : R.weather === 1 ? 0.7 : 0.95; R.cover = lerp(R.cover || 0, cover, 0.02);
      const grey = (R.weather >= 2 ? SK.storm : SK.over), gl = R.cover * (0.35 + 0.65 * dayF + 0.0); const ntop = grey[0].clone().multiplyScalar(0.25 + 0.75 * dayF), nhor = grey[1].clone().multiplyScalar(0.2 + 0.8 * dayF);
      top.lerp(ntop, gl); hor.lerp(nhor, gl);
      skyMat.uniforms.top.value.copy(top); skyMat.uniforms.hor.value.copy(hor); skyMat.uniforms.stars.value = (1 - dayF) * (1 - R.cover);
      const sd = new T.Vector3(Math.cos(ang) * 0.85, Math.sin(ang), 0.45).normalize(); skyMat.uniforms.sunDir.value.copy(sd); skyMat.uniforms.sunCol.value.setRGB(1, 0.78 + 0.2 * dayF, 0.55 + 0.4 * dayF).multiplyScalar(1 - R.cover * 0.9);
      R.sunDir = e > -0.02 ? sd : sd.clone().negate();
      sun.color.copy(e > 0 ? new T.Color(0xfff0d8).lerp(new T.Color(0xff9a55), duskF) : new T.Color(0x6f86c9));
      sun.intensity = (e > 0 ? 0.25 + 2.2 * sstep(0, 0.35, e) : 0.35 * sstep(-0.05, -0.3, e) + 0.12) * (1 - R.cover * 0.65);
      hemi.intensity = (0.16 + 0.42 * dayF) * (1 + R.cover * 0.3) + R.flashT * 3.2; hemi.color.copy(top).lerp(new T.Color(0xffffff), 0.35); hemi.groundColor.set(0x3f3a2c);
      const fogC = hor.clone().multiplyScalar(0.9); scene.fog.color.copy(fogC); scene.background = fogC;
      scene.fog.near = lerp(70, 10, R.cover); scene.fog.far = lerp(560, R.weather >= 2 ? 170 : 250, R.cover);
      R.dayF = dayF; R.rainAmt = lerp(R.rainAmt, R.weather >= 1 ? 1 : 0, 0.02); rain.material.opacity = 0.38 * R.rainAmt * (0.5 + 0.5 * dayF + 0.3);
      renderer.toneMappingExposure = 0.85 + 0.35 * dayF;
    };

    R.flash = function (s) { R.flashT = Math.max(R.flashT, s || 1); };
    R.bolt = function (x, z) {
      const y = R.world ? R.world.height(x, z) : 0, pts = []; let cx = x, cz = z; for (let i = 0; i <= 14; i++) { const k = i / 14; pts.push(new T.Vector3(cx, y + (1 - k) * 120, cz)); cx += (Math.random() - 0.5) * 5; cz += (Math.random() - 0.5) * 5; }
      pts[14].x = x; pts[14].z = z; pts[14].y = y;
      const l = new T.Line(new T.BufferGeometry().setFromPoints(pts.reverse()), new T.LineBasicMaterial({ color: 0xcfe0ff, fog: false })); scene.add(l); R.bolts.push({ m: l, t: 0.28 }); R.flash(1);
      const pl = new T.PointLight(0xbfd4ff, 60, 60); pl.position.set(x, y + 4, z); scene.add(pl); R.bolts.push({ m: pl, t: 0.2 });
    };
    R.spark = function (x, y, z, color, n, speed, life, size) {   // small pooled particle burst
      for (let i = 0; i < n; i++) { if (R.parts.length > 220) { const o = R.parts.shift(); scene.remove(o.m); }
        const m = new T.Mesh(R.pg || (R.pg = new T.BoxGeometry(1, 1, 1)), new T.MeshBasicMaterial({ color, transparent: true, fog: true })); const s = (size || 0.07) * (0.6 + Math.random() * 0.8); m.scale.set(s, s, s); m.position.set(x, y, z); scene.add(m);
        const a = Math.random() * 6.28, up = Math.random() * 0.9 + 0.1, sp = (speed || 3) * (0.4 + Math.random() * 0.8); R.parts.push({ m, vx: Math.cos(a) * sp * (1 - up * 0.5), vy: up * sp, vz: Math.sin(a) * sp * (1 - up * 0.5), life: life || 0.6, max: life || 0.6, g: 9 }); }
    };

    /* ------------------------------------------------------------- zone */
    R.setZone = function (z) {
      zoneWall.scale.set(Math.max(1, z.r), 1, Math.max(1, z.r)); zoneWall.position.set(z.x, 60, z.z); zoneWall.visible = z.s !== 'o'; zoneEdge.visible = z.s !== 'o';
      zoneMat.opacity = 0.13 + 0.05 * Math.sin(R.time * 2) + (z.s === 's' ? 0.07 : 0);
      const key = z.nx + ',' + z.nz + ',' + z.nr; if (key !== zoneKey && R.world) { zoneKey = key; const pts = []; for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, x = z.nx + Math.cos(a) * z.nr, zz = z.nz + Math.sin(a) * z.nr; pts.push(new T.Vector3(x, R.world.height(x, zz) + 1.2, zz)); } zoneEdge.geometry.dispose(); zoneEdge.geometry = new T.BufferGeometry().setFromPoints(pts); }
    };

    /* ------------------------------------------------------------- loot meshes */
    const ICOL = { arrow: 0xd8c9a0, bolt: 0x9aa0a8, berries: 0x6b2a8a, bread: 0xc99a52, ration: 0x6d7a52, water_bottle: 0x4aa3ff, bandage: 0xf0f0e8, medkit: 0xd8d8d8, armor_light: 0x7a5a38, armor_heavy: 0x7d8590, stick: 0x6a4a2a, rope: 0xb59a6a, stone: 0x8a8a8a, cloth: 0xb06a6a, trap_snare: 0xb59a6a, trap_spike: 0x8a8d95 };
    function lootMesh(id) {
      const def = C.ITEMS[id], g = new T.Group(); let body;
      if (def.type === 'weapon') { body = A.weaponModel(id, {}); body.scale.setScalar(0.9); body.rotation.z = Math.PI / 2; body.position.y = 0.5; g.add(body); }
      else if (def.type === 'water') { body = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.4, 8), new T.MeshStandardMaterial({ color: ICOL[id], roughness: 0.2 })); body.position.y = 0.25; g.add(body); }
      else if (def.type === 'ammo') { for (let i = 0; i < 4; i++) { const s = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 0.7, 4), new T.MeshStandardMaterial({ color: ICOL[id] })); s.rotation.z = Math.PI / 2; s.position.set(0, 0.2 + i * 0.03, (i - 1.5) * 0.06); g.add(s); } }
      else if (def.type === 'trap') { body = new T.Mesh(new T.TorusGeometry(0.28, 0.05, 6, 12), new T.MeshStandardMaterial({ color: ICOL[id] })); body.rotation.x = Math.PI / 2; body.position.y = 0.15; g.add(body); }
      else { body = new T.Mesh(def.type === 'food' ? new T.SphereGeometry(0.16, 8, 6) : new T.BoxGeometry(def.type === 'armor' ? 0.55 : 0.3, def.type === 'armor' ? 0.3 : 0.2, 0.3), new T.MeshStandardMaterial({ color: ICOL[id] || 0xaaaaaa, roughness: 0.6 })); body.position.y = 0.25; g.add(body); }
      const hi = def.type === 'weapon' || id === 'medkit' || id === 'armor_heavy' || id === 'crossbow';
      const ring = new T.Mesh(new T.RingGeometry(0.35, 0.45, 20), new T.MeshBasicMaterial({ color: hi ? 0xf2d27a : 0xcfd6c0, transparent: true, opacity: hi ? 0.8 : 0.4, side: T.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
      if (hi) { const beam = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 5, 6, 1, true), new T.MeshBasicMaterial({ color: 0xf2d27a, transparent: true, opacity: 0.22, depthWrite: false })); beam.position.y = 2.5; g.add(beam); }
      g.userData.spin = def.type === 'weapon' ? 0 : 0.8; g.userData.body = body; return g;
    }
    R.updateLoot = function (lootMap, dt) {
      const w = R.world; if (!w) return;
      for (const [id, o] of R.loot) if (!lootMap.has(id)) { R.lootG.remove(o); R.loot.delete(id); }
      for (const [id, L] of lootMap) { let o = R.loot.get(id); if (!o) { o = lootMesh(L.id); o.position.set(L.x, w.height(L.x, L.z), L.z); o.userData.ph = Math.random() * 6; R.lootG.add(o); R.loot.set(id, o); }
        if (o.userData.body) { o.userData.body.position.y = 0.3 + Math.sin(R.time * 2 + o.userData.ph) * 0.06; o.userData.body.rotation.y += dt * (o.userData.spin || 0.5); } }
    };

    /* ------------------------------------------------------------- projectiles / mutts / traps / hazards */
    R.updateProj = function (list, dt) {
      const seen = new Set();
      for (const q of list) { seen.add(q.i); let o = R.proj.get(q.i);
        if (!o) { const wd = C.WEAPONS[q.w] || {}; const thrown = wd.type === 'melee'; const m = new T.Group();
          if (thrown) { const wm = A.weaponModel(q.w, {}); m.add(wm); wm.rotation.x = -Math.PI / 2; m.userData.spinT = true; }
          else { const sh = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.9, 5), new T.MeshStandardMaterial({ color: q.w === 'crossbow' ? 0x666b72 : 0xcdbb8a })); sh.rotation.x = Math.PI / 2; m.add(sh); const tip = new T.Mesh(new T.ConeGeometry(0.04, 0.12, 5), new T.MeshStandardMaterial({ color: 0x9aa0a8 })); tip.rotation.x = Math.PI / 2; tip.position.z = 0.5; m.add(tip); }
          R.projG.add(m); o = { m, x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, vz: q.vz, g: thrown ? (wd.throw ? wd.throw.gravity : 12) : (wd.gravity || 9.8), spin: 0 }; R.proj.set(q.i, o); }
        else { o.x = q.x; o.y = q.y; o.z = q.z; o.vx = q.vx; o.vy = q.vy; o.vz = q.vz; } }
      for (const [id, o] of R.proj) { if (!seen.has(id)) { R.projG.remove(o.m); R.proj.delete(id); continue; } }
      for (const o of R.proj.values()) { o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.vy -= o.g * dt; o.m.position.set(o.x, o.y, o.z); const d = new T.Vector3(o.vx, o.vy, o.vz); if (d.lengthSq() > 0.01) o.m.lookAt(o.m.position.clone().add(d)); if (o.m.userData.spinT) { o.spin += dt * 18; o.m.rotateX(o.spin); } }
    };
    function muttMesh() {
      const g = new T.Group(), dk = new T.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.9 }), body = new T.Mesh(new T.BoxGeometry(0.7, 0.65, 1.5), dk); body.position.y = 0.95; g.add(body);
      const head = new T.Mesh(new T.BoxGeometry(0.55, 0.5, 0.7), dk); head.position.set(0, 1.15, -0.95); g.add(head);
      for (const sx of [-1, 1]) { const e = new T.Mesh(new T.BoxGeometry(0.1, 0.07, 0.04), new T.MeshBasicMaterial({ color: 0xff2a1a })); e.position.set(sx * 0.15, 1.22, -1.31); g.add(e); const ear = new T.Mesh(new T.ConeGeometry(0.1, 0.3, 4), dk); ear.position.set(sx * 0.2, 1.55, -0.85); g.add(ear); }
      g.userData.legs = []; for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new T.Mesh(new T.BoxGeometry(0.2, 0.8, 0.2), dk); l.geometry.translate(0, -0.4, 0); l.position.set(sx * 0.28, 0.85, sz * 0.5); g.add(l); g.userData.legs.push(l); }
      const tail = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.7), dk); tail.position.set(0, 1.1, 1.05); tail.rotation.x = 0.5; g.add(tail);
      g.traverse(o => { o.castShadow = true; }); return g;
    }
    R.updateMutts = function (list, dt) {
      const seen = new Set(); for (const m of list) { seen.add(m.i); let o = R.mutts.get(m.i); if (!o) { const g = muttMesh(); g.position.set(m.x, m.y, m.z); R.muttG.add(g); o = { g, ph: 0, lx: m.x, lz: m.z }; R.mutts.set(m.i, o); }
        const k = Math.min(1, dt * 10); o.g.position.x += (m.x - o.g.position.x) * k; o.g.position.y += (m.y - o.g.position.y) * k; o.g.position.z += (m.z - o.g.position.z) * k;
        let dy = m.r - o.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); o.g.rotation.y += dy * k; const sp = Math.hypot(m.x - o.lx, m.z - o.lz) / Math.max(dt, 0.001); o.lx = m.x; o.lz = m.z; o.ph += dt * clamp(sp, 0, 9) * 2.2; o.g.userData.legs.forEach((l, i) => { l.rotation.x = Math.sin(o.ph + (i % 3 ? Math.PI : 0)) * clamp(sp / 6, 0, 1) * 0.9; }); }
      for (const [id, o] of R.mutts) if (!seen.has(id)) { R.muttG.remove(o.g); R.mutts.delete(id); }
    };
    R.updateTraps = function (list) {
      const w = R.world; if (!w) return; const seen = new Set();
      for (const t of list) { seen.add(t.i); if (R.traps.has(t.i)) continue; const g = new T.Group(); if (t.k === 'snare') { const r = new T.Mesh(new T.TorusGeometry(0.6, 0.05, 6, 18), new T.MeshStandardMaterial({ color: 0xb59a6a })); r.rotation.x = Math.PI / 2; r.position.y = 0.08; g.add(r); } else { const d = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 0.06, 12), new T.MeshStandardMaterial({ color: 0x555a60, metalness: 0.5 })); d.position.y = 0.04; g.add(d); for (let i = 0; i < 7; i++) { const c = new T.Mesh(new T.ConeGeometry(0.06, 0.3, 4), new T.MeshStandardMaterial({ color: 0xaeb4bb, metalness: 0.7 })); const a = i * 0.9; c.position.set(Math.cos(a) * 0.3 * (i ? 1 : 0), 0.2, Math.sin(a) * 0.3 * (i ? 1 : 0)); g.add(c); } }
        if (t.own) { const l = new T.Mesh(new T.RingGeometry(0.7, 0.8, 16), new T.MeshBasicMaterial({ color: 0x5bd16a, side: T.DoubleSide, transparent: true, opacity: 0.6 })); l.rotation.x = -Math.PI / 2; l.position.y = 0.05; g.add(l); }
        g.position.set(t.x, w.height(t.x, t.z), t.z); R.trapG.add(g); R.traps.set(t.i, g); }
      for (const [id, g] of R.traps) if (!seen.has(id)) { R.trapG.remove(g); R.traps.delete(id); }
    };
    R.updateHaz = function (list, dt) {
      const w = R.world; if (!w) return; const seen = new Set();
      for (const h of list) { seen.add(h.i); let o = R.haz.get(h.i);
        if (!o) { const cfg = C.EVENTS[h.k] || {}, c = new T.Color(cfg.color || '#fff'), g = new T.Group(); g.position.set(h.x, w.height(h.x, h.z), h.z);
          const wall = new T.Mesh(new T.CylinderGeometry(h.r, h.r, h.k === 'flood' ? 3 : 16, 40, 1, true), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false })); wall.position.y = h.k === 'flood' ? 0.6 : 7; g.add(wall);
          const ring = new T.Mesh(new T.RingGeometry(h.r - 0.8, h.r, 48), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, side: T.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6; g.add(ring);
          const fl = []; if (h.k === 'fire') for (let i = 0; i < 34; i++) { const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * h.r, f = new T.Mesh(new T.ConeGeometry(0.8, 3, 5), new T.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xff6a1f : 0xffb02e, transparent: true, opacity: 0.85 })); f.position.set(Math.cos(a) * rr, 1.4, Math.sin(a) * rr); f.userData.ph = Math.random() * 6; g.add(f); fl.push(f); }
          const pl = h.k === 'fire' ? new T.PointLight(0xff7a2a, 40, h.r * 2) : null; if (pl) { pl.position.y = 4; g.add(pl); }
          R.hazG.add(g); o = { g, wall, ring, fl, pl }; R.haz.set(h.i, o); }
        const on = h.a === 1; o.wall.material.opacity = on ? 0.2 + 0.06 * Math.sin(R.time * 3) : 0; o.ring.material.opacity = on ? 0.5 : 0.35 + 0.35 * Math.sin(R.time * 8); o.fl.forEach(f => { f.visible = on; f.scale.y = 0.7 + 0.6 * Math.abs(Math.sin(R.time * 7 + f.userData.ph)); }); if (o.pl) o.pl.intensity = on ? 30 + Math.sin(R.time * 11) * 8 : 0; }
      for (const [id, o] of R.haz) if (!seen.has(id)) { R.hazG.remove(o.g); R.haz.delete(id); }
    };

    /* ------------------------------------------------------------- per-frame */
    R.update = function (dt, fx, fz) {
      R.time += dt; R.flashT = Math.max(0, R.flashT - dt * 3.5);
      sky.position.copy(camera.position);
      // sun / shadow follows the focus point, snapped to texel grid to avoid shimmering
      const sx = Math.round(fx / 4) * 4, sz = Math.round(fz / 4) * 4, fy = R.world ? R.world.height(sx, sz) : 0; sun.target.position.set(sx, fy, sz); const sd = R.sunDir || new T.Vector3(0, 1, 0); sun.position.set(sx + sd.x * 180, fy + Math.max(40, sd.y * 180), sz + sd.z * 180);
      sun.castShadow = R.quality !== 'low';
      for (const c of R.chunks) { const d = Math.hypot(c.userData.cx - fx, c.userData.cz - fz), far = scene.fog.far + 90; c.visible = d < far; c.castShadow = R.quality !== 'low' && d < 110 && c.userData.kind !== 'u'; }
      if (R.grass) R.updateGrass(fx, fz);
      water.position.y = C.WORLD.waterLevel + Math.sin(R.time * 0.8) * 0.04; water.position.x = fx; water.position.z = fz;
      // rain follows camera
      rain.visible = R.rainAmt > 0.02; if (rain.visible) { rain.position.set(Math.round(camera.position.x), 0, Math.round(camera.position.z)); const p = rainGeo.attributes.position.array, wind = R.weather >= 2 ? 6 : 2, cy = camera.position.y;
        for (let i = 0; i < NR; i++) { const k = i * 6; let y = p[k + 1] - rv[i] * dt; let x = p[k] - wind * dt; if (y < -4 + 0 * cy) { y += 36; x = (Math.random() - 0.5) * 60; } if (x < -30) x += 60; p[k] = x; p[k + 1] = y; p[k + 3] = x - wind * 0.04; p[k + 4] = y - 0.9; }
        rainGeo.attributes.position.needsUpdate = true; rain.position.y = cy - 6; }
      for (let i = R.bolts.length - 1; i >= 0; i--) { const b = R.bolts[i]; b.t -= dt; if (b.t <= 0) { scene.remove(b.m); if (b.m.geometry) b.m.geometry.dispose(); R.bolts.splice(i, 1); } }
      for (let i = R.parts.length - 1; i >= 0; i--) { const p = R.parts[i]; p.life -= dt; if (p.life <= 0) { scene.remove(p.m); p.m.material.dispose(); R.parts.splice(i, 1); continue; } p.vy -= p.g * dt; p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt; p.m.material.opacity = p.life / p.max; }
      renderer.render(scene, camera);
    };
    R.resize = function () { const w = innerWidth, h = innerHeight, pr = R.quality === 'low' ? 0.75 : Math.min(devicePixelRatio || 1, R.quality === 'high' ? 2 : 1.25); renderer.setPixelRatio(pr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    R.setQuality = function (q) { R.quality = q; renderer.shadowMap.enabled = q !== 'low'; R.resize(); if (R.world) R.updateGrass(R.focus.x, R.focus.z, true); };
    addEventListener('resize', R.resize); R.resize();
    return R;
  }
  HG.createRenderer = create;
})();
