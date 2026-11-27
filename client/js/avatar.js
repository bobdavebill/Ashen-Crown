/* Procedural tribute avatars: built from primitives using the equipped cosmetics, animated without any skeleton files. */
(function () {
  const T = THREE, E = HG.E;
  const geoCache = new Map(), matCache = new Map();
  const G = {
    box(w, h, d) { const k = 'b' + w + ',' + h + ',' + d; let g = geoCache.get(k); if (!g) geoCache.set(k, g = new T.BoxGeometry(w, h, d)); return g; },
    sph(r, ws, hs) { const k = 's' + r + ',' + ws + ',' + hs; let g = geoCache.get(k); if (!g) geoCache.set(k, g = new T.SphereGeometry(r, ws || 10, hs || 8)); return g; },
    cyl(rt, rb, h, s) { const k = 'c' + rt + ',' + rb + ',' + h + ',' + s; let g = geoCache.get(k); if (!g) geoCache.set(k, g = new T.CylinderGeometry(rt, rb, h, s || 8)); return g; },
    cone(r, h, s) { const k = 'n' + r + ',' + h + ',' + s; let g = geoCache.get(k); if (!g) geoCache.set(k, g = new T.ConeGeometry(r, h, s || 8)); return g; },
    cap(r) { const k = 'h' + r; let g = geoCache.get(k); if (!g) geoCache.set(k, g = new T.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)); return g; },
    tor(r, t, a) { const k = 't' + r + ',' + t + ',' + a; let g = geoCache.get(k); if (!g) geoCache.set(k, g = new T.TorusGeometry(r, t, 6, 16, a || Math.PI * 2)); return g; },
  };
  function mat(color, o) { o = o || {}; const k = color + (o.e || '') + (o.m || 0) + (o.r || 0); let m = matCache.get(k); if (!m) { m = new T.MeshStandardMaterial({ color: new T.Color(color), roughness: o.r != null ? o.r : 0.85, metalness: o.m || 0, emissive: o.e ? new T.Color(o.e) : new T.Color(0x000000), emissiveIntensity: o.e ? 0.8 : 0 }); matCache.set(k, m); } return m; }
  function mesh(geo, color, x, y, z, parent, o) { const m = new T.Mesh(geo, mat(color, o)); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; if (parent) parent.add(m); return m; }
  const v = (slot, app) => { const it = E.BY_ID[app[slot]]; return it ? it.v : {}; };

  function weaponModel(id, skin) {
    const g = new T.Group(), c = skin.c || '#8a6a44', mc = skin.m || '#b9bcc2', glow = skin.glow;
    const metal = { m: 0.8, r: 0.35, e: glow };
    switch (id) {
      case 'sword': mesh(G.box(0.06, 0.95, 0.014), mc, 0, -0.55, 0, g, metal); mesh(G.box(0.3, 0.05, 0.05), c, 0, -0.06, 0, g); mesh(G.cyl(0.02, 0.02, 0.22, 6), c, 0, 0.06, 0, g); break;
      case 'knife': case 'knife_crude': { const L = id === 'knife' ? 0.34 : 0.28; mesh(G.box(0.045, L, 0.012), id === 'knife' ? mc : '#7c7770', 0, -L / 2 - 0.04, 0, g, metal); mesh(G.cyl(0.02, 0.02, 0.14, 6), c, 0, 0.04, 0, g); break; }
      case 'spear': mesh(G.cyl(0.018, 0.018, 2.0, 6), c, 0, -0.35, 0, g); mesh(G.cone(0.04, 0.22, 6), mc, 0, -1.45, 0, g, metal); g.rotation.x = 0; break;
      case 'axe': mesh(G.cyl(0.022, 0.022, 0.85, 6), c, 0, -0.35, 0, g); mesh(G.box(0.05, 0.22, 0.26), mc, 0, -0.72, -0.1, g, metal); break;
      case 'bow': { const a = mesh(G.tor(0.5, 0.018, Math.PI), c, 0, 0, 0, g); a.rotation.z = -Math.PI / 2; a.position.set(0, 0, 0); mesh(G.box(0.006, 1.0, 0.006), '#ddd', 0.0, 0, 0, g).position.x = -0.02; g.userData.ranged = 1; break; }
      case 'crossbow': mesh(G.box(0.07, 0.07, 0.6), c, 0, -0.1, -0.2, g); const p = mesh(G.box(0.7, 0.04, 0.05), mc, 0, -0.1, -0.45, g, metal); mesh(G.box(0.01, 0.01, 0.4), '#ddd', 0, -0.1, -0.3, g); g.userData.ranged = 1; break;
      case 'berries': mesh(G.sph(0.06, 8, 6), '#6a2c91', 0, -0.05, 0, g); mesh(G.sph(0.05, 8, 6), '#7a35a8', 0.05, -0.02, 0.02, g); break;
      case 'bread': mesh(G.box(0.2, 0.09, 0.1), '#c58b4a', 0, -0.05, 0, g); break;
      case 'ration': mesh(G.cyl(0.05, 0.05, 0.12, 8), '#8a8f94', 0, -0.05, 0, g, { m: 0.6 }); break;
      case 'water_bottle': mesh(G.cyl(0.04, 0.04, 0.2, 8), '#4a90d9', 0, -0.08, 0, g, { r: 0.2 }); break;
      case 'bandage': mesh(G.cyl(0.05, 0.05, 0.06, 8), '#f1ede4', 0, -0.05, 0, g); break;
      case 'medkit': mesh(G.box(0.2, 0.14, 0.1), '#e8e8e8', 0, -0.08, 0, g); mesh(G.box(0.05, 0.1, 0.11), '#c0392b', 0, -0.08, 0, g); break;
      case 'trap_snare': mesh(G.tor(0.1, 0.012, null), '#7a5a35', 0, -0.05, 0, g); break;
      case 'trap_spike': mesh(G.cone(0.08, 0.14, 6), '#6b6f75', 0, -0.07, 0, g, { m: 0.6 }); break;
      case 'armor_light': case 'armor_heavy': mesh(G.box(0.22, 0.26, 0.06), id === 'armor_heavy' ? '#8b8f96' : '#6b4528', 0, -0.1, 0, g); break;
      default: if (id && /^(arrow|bolt|stick|rope|stone|cloth)$/.test(id)) mesh(G.box(0.03, 0.2, 0.03), '#9a7a4a', 0, -0.08, 0, g);
    }
    return g;
  }

  function nameTexture(name, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.font = '600 24px Inter,Segoe UI,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,.85)'; x.strokeText(name, 128, 24); x.fillStyle = color; x.fillText(name, 128, 24);
    const t = new T.CanvasTexture(c); return t;
  }

  function create(app, opts) {
    opts = opts || {};
    const av = { root: new T.Group(), app: null, phase: 0, swingT: 0, lastSwing: -1, deadT: 0, emoteT: 0, emote: '', parts: {}, weaponId: '', tmp: 0, victory: '', alive: true };
    const root = av.root; const rig = new T.Group(); root.add(rig); av.rig = rig;
    let body = new T.Group(); rig.add(body); av.body = body;
    let nameSprite = null;
    if (opts.name) {
      nameSprite = new T.Sprite(new T.SpriteMaterial({ map: nameTexture(opts.name, opts.color || '#ffffff'), transparent: true, depthTest: false, fog: false })); nameSprite.scale.set(1.5, 0.28, 1); nameSprite.position.y = 2.15; nameSprite.renderOrder = 10; root.add(nameSprite); av.nameSprite = nameSprite;
    }
    function build(a) {
      av.app = a;
      rig.remove(body); body = new T.Group(); rig.add(body); av.body = body;
      const skin = v('skin', a).c || '#e3b894', outfit = v('outfit', a), jacket = v('jacket', a), pants = v('pants', a), boots = v('boots', a), gloves = v('gloves', a), armor = v('armorSkin', a),
        hairS = v('hair', a).style || 'short', hairC = v('hairColor', a).c || '#4a2f1d', eyes = v('eyes', a).c || '#4d2e17', face = v('face', a).style || 'none',
        pack = v('backpack', a), mask = v('mask', a), hat = v('hat', a), scarf = v('scarf', a);
      const shirt = outfit.c || '#555', trousers = pants.c || outfit.c2 || '#444';
      // legs
      for (const s of [-1, 1]) {
        const leg = new T.Group(); leg.position.set(s * 0.115, 0.92, 0); body.add(leg);
        mesh(G.box(0.17, 0.46, 0.19), trousers, 0, -0.23, 0, leg); const shin = new T.Group(); shin.position.set(0, -0.46, 0); leg.add(shin);
        mesh(G.box(0.15, 0.4, 0.17), trousers, 0, -0.2, 0, shin); mesh(G.box(0.17, 0.12, 0.24), boots.c || '#3a2c20', 0, -0.4, -0.03, shin, { e: boots.glow ? boots.c : null });
        av.parts[s < 0 ? 'legL' : 'legR'] = leg; av.parts[s < 0 ? 'shinL' : 'shinR'] = shin;
      }
      // torso
      const torso = new T.Group(); torso.position.y = 0.92; body.add(torso); av.parts.torso = torso;
      mesh(G.box(0.44, 0.34, 0.24), outfit.c2 || trousers, 0, 0.17, 0, torso); mesh(G.box(0.46, 0.36, 0.26), shirt, 0, 0.5, 0, torso);
      if (jacket.c) { mesh(G.box(0.49, 0.4, 0.29), jacket.c, 0, 0.48, 0, torso); if (jacket.cloak) { const cl = mesh(G.box(0.5, 0.75, 0.05), jacket.c, 0, 0.22, 0.17, torso); cl.rotation.x = 0.08; } }
      if (armor.c) { mesh(G.box(0.5, 0.38, 0.31), armor.c, 0, 0.5, 0, torso, { m: 0.5, r: 0.5 }); mesh(G.box(0.1, 0.1, 0.34), armor.c, -0.3, 0.7, 0, torso, { m: 0.5 }); mesh(G.box(0.1, 0.1, 0.34), armor.c, 0.3, 0.7, 0, torso, { m: 0.5 }); }
      if (scarf.c) { mesh(G.tor(0.12, 0.05), scarf.c, 0, 0.74, 0, torso).rotation.x = Math.PI / 2; if (scarf.c2) mesh(G.tor(0.12, 0.052, Math.PI), scarf.c2, 0, 0.74, 0, torso).rotation.x = Math.PI / 2; mesh(G.box(0.08, 0.3, 0.03), scarf.c, 0.08, 0.58, -0.14, torso); }
      // backpack
      if (pack.s) {
        if (pack.s === 'satchel') mesh(G.box(0.26, 0.22, 0.1), pack.c, 0.27, 0.12, 0, torso);
        else if (pack.s === 'big') { mesh(G.box(0.34, 0.5, 0.2), pack.c, 0, 0.5, 0.23, torso); mesh(G.box(0.3, 0.12, 0.22), pack.c, 0, 0.78, 0.23, torso); }
        else if (pack.s === 'roll') { mesh(G.box(0.3, 0.4, 0.16), pack.c, 0, 0.48, 0.21, torso); mesh(G.cyl(0.07, 0.07, 0.34, 8), '#ccc', 0, 0.74, 0.21, torso).rotation.z = Math.PI / 2; }
        else if (pack.s === 'quiver') { const q = mesh(G.cyl(0.06, 0.05, 0.55, 8), pack.c, 0.1, 0.5, 0.2, torso); q.rotation.z = 0.35; for (let i = 0; i < 4; i++) mesh(G.cyl(0.006, 0.006, 0.12, 4), '#d8c8a0', 0.17 + i * 0.012, 0.8, 0.2, torso); }
      }
      // head
      const head = new T.Group(); head.position.set(0, 1.62, 0); body.add(head); av.parts.head = head;
      mesh(G.sph(0.135, 12, 10), skin, 0, 0, 0, head); mesh(G.box(0.05, 0.05, 0.06), skin, 0, -0.01, -0.13, head);
      for (const s of [-1, 1]) { mesh(G.box(0.035, 0.03, 0.01), '#f4f1ea', s * 0.05, 0.02, -0.125, head); mesh(G.box(0.02, 0.02, 0.012), eyes, s * 0.05, 0.02, -0.131, head, { e: eyes === '#c0262d' ? eyes : null }); }
      if (face === 'freckles') for (let i = 0; i < 6; i++) mesh(G.box(0.012, 0.012, 0.006), '#8a5a3a', (i % 3 - 1) * 0.04 + (i < 3 ? -0.0 : 0), -0.025 - (i > 2 ? 0.02 : 0), -0.128, head);
      else if (face === 'scar') mesh(G.box(0.012, 0.09, 0.006), '#8a3a3a', 0.06, 0.02, -0.127, head);
      else if (face === 'war_paint') { mesh(G.box(0.2, 0.03, 0.006), '#b3261e', 0, -0.02, -0.128, head); mesh(G.box(0.2, 0.03, 0.006), '#eee', 0, 0.06, -0.128, head); }
      else if (face === 'tribal') { for (const s of [-1, 1]) { mesh(G.box(0.012, 0.1, 0.006), '#222', s * 0.08, -0.01, -0.12, head); mesh(G.box(0.05, 0.012, 0.006), '#222', s * 0.06, -0.05, -0.125, head); } }
      else if (face === 'glitter') for (let i = 0; i < 10; i++) mesh(G.box(0.01, 0.01, 0.006), '#ffe27a', (Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.14, -0.13, head, { e: '#ffcc33' });
      else if (face === 'ember') for (const s of [-1, 1]) mesh(G.box(0.01, 0.12, 0.006), '#ff6a1f', s * 0.075, 0, -0.126, head, { e: '#ff5a00' });
      // hair
      const hc = hairC;
      switch (hairS) {
        case 'short': mesh(G.cap(0.15), hc, 0, 0.0, 0.0, head).scale.set(1, 0.9, 1.02); break;
        case 'long': mesh(G.cap(0.15), hc, 0, 0.0, 0.01, head); mesh(G.box(0.3, 0.5, 0.08), hc, 0, -0.22, 0.1, head); break;
        case 'ponytail': mesh(G.cap(0.15), hc, 0, 0, 0.01, head); { const t = mesh(G.cyl(0.04, 0.02, 0.35, 6), hc, 0, -0.15, 0.17, head); t.rotation.x = -0.35; } break;
        case 'braid': mesh(G.cap(0.15), hc, 0, 0, 0.01, head); for (let i = 0; i < 4; i++) mesh(G.sph(0.045 - i * 0.004, 6, 5), hc, -0.14, -0.06 - i * 0.09, 0.0 + i * 0.02, head); break;
        case 'bun': mesh(G.cap(0.15), hc, 0, 0, 0.01, head); mesh(G.sph(0.08, 8, 6), hc, 0, 0.16, 0.05, head); break;
        case 'curly': for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; mesh(G.sph(0.07, 6, 5), hc, Math.cos(a) * 0.1, 0.08 + (i % 3) * 0.03, Math.sin(a) * 0.1, head); } mesh(G.sph(0.1, 8, 6), hc, 0, 0.14, 0, head); break;
        case 'mohawk': mesh(G.box(0.04, 0.12, 0.28), hc, 0, 0.15, 0, head); break;
      }
      // hat / mask
      if (hat.s) {
        const hcol = hat.c || '#444';
        if (hat.s === 'cap') { mesh(G.cyl(0.16, 0.16, 0.07, 10), hcol, 0, 0.1, 0, head); mesh(G.box(0.2, 0.015, 0.1), hcol, 0, 0.08, -0.17, head); }
        else if (hat.s === 'beanie') mesh(G.cap(0.17), hcol, 0, 0.04, 0, head);
        else if (hat.s === 'hood') { mesh(G.cap(0.19), hcol, 0, 0.02, 0.02, head); mesh(G.box(0.3, 0.3, 0.1), hcol, 0, -0.1, 0.13, head); }
        else if (hat.s === 'wide') { mesh(G.cyl(0.34, 0.34, 0.015, 14), hcol, 0, 0.09, 0, head); mesh(G.cyl(0.11, 0.14, 0.12, 10), hcol, 0, 0.15, 0, head); }
        else if (hat.s === 'helm') { mesh(G.cap(0.17), hcol, 0, 0.03, 0, head, { m: 0.7, r: 0.4 }); mesh(G.box(0.03, 0.12, 0.3), '#a23', 0, 0.2, 0, head); }
        else if (hat.s === 'laurel') for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; mesh(G.sph(0.03, 5, 4), hcol, Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15, head, { e: hat.c === '#a8d8ff' ? hcol : null }); }
      }
      if (mask.s) {
        const mc = mask.c || '#aaa';
        if (mask.s === 'bandana') mesh(G.box(0.25, 0.1, 0.1), mc, 0, -0.07, -0.08, head);
        else if (mask.s === 'half') mesh(G.box(0.26, 0.11, 0.06), mc, 0, 0.01, -0.13, head);
        else if (mask.s === 'full') mesh(G.box(0.27, 0.28, 0.06), mc, 0, -0.02, -0.12, head, { m: mask.shine ? 0.9 : 0, r: mask.shine ? 0.15 : 0.7 });
      }
      // arms
      for (const s of [-1, 1]) {
        const sh = new T.Group(); sh.position.set(s * 0.29, 1.4, 0); body.add(sh);
        const sleeve = jacket.c || shirt;
        mesh(G.box(0.12, 0.3, 0.13), sleeve, 0, -0.14, 0, sh);
        const el = new T.Group(); el.position.set(0, -0.3, 0); sh.add(el); mesh(G.box(0.105, 0.28, 0.115), sleeve, 0, -0.13, 0, el);
        mesh(G.box(0.1, 0.1, 0.11), gloves.c || skin, 0, -0.3, 0, el, gloves.c ? { r: 0.7 } : null);
        av.parts[s < 0 ? 'armL' : 'armR'] = sh; av.parts[s < 0 ? 'foreL' : 'foreR'] = el;
        if (s > 0) { const hand = new T.Group(); hand.position.set(0, -0.33, -0.03); el.add(hand); av.parts.hand = hand; }
      }
      av.wskin = v('weaponSkin', a); const w = av.weaponId; av.weaponId = ''; av.setWeapon(w);
      av.victory = (E.BY_ID[a.victory] && E.BY_ID[a.victory].v.a) || 'salute'; av.emoteSet = (E.BY_ID[a.emote] && E.BY_ID[a.emote].v.a) || 'wave'; av.pose = (E.BY_ID[a.pose] && E.BY_ID[a.pose].v.a) || 'ready';
    }
    av.setAppearance = a => { build(E.cleanAppearance(a)); };
    av.setWeapon = id => {
      id = id || ''; if (id === av.weaponId) return; av.weaponId = id;
      if (av.wmodel && av.wmodel.parent) av.wmodel.parent.remove(av.wmodel);
      if (!id || !av.parts.hand) { av.wmodel = null; av.ranged = false; return; }
      av.wmodel = weaponModel(id, av.wskin || {}); av.parts.hand.add(av.wmodel); av.ranged = !!av.wmodel.userData.ranged;
      av.wmodel.rotation.x = -Math.PI / 2 * 0.0; av.isSpear = id === 'spear';
    };
    av.setName = (n, color) => { if (av.nameSprite) { av.nameSprite.material.map = nameTexture(n, color || '#fff'); av.nameSprite.material.needsUpdate = true; } };
    av.playEmote = e => { av.emote = e; av.emoteT = e === 'dance' ? 3.2 : 2.0; };

    /* st: {speed, crouch, aim, sprint, alive, swingN, using, reload, water, rooted, pitch} */
    av.update = function (dt, st) {
      const P = av.parts; if (!P.legL) return;
      if (!st.alive) { av.alive = false; av.deadT = Math.min(1, av.deadT + dt * 1.6); rig.rotation.x = -av.deadT * Math.PI / 2 * 0.95; rig.position.y = av.deadT * 0.12; if (av.nameSprite) av.nameSprite.visible = false; return; }
      if (!av.alive) { av.alive = true; av.deadT = 0; rig.rotation.x = 0; rig.position.y = 0; if (av.nameSprite) av.nameSprite.visible = true; }
      if (st.swingN !== av.lastSwing) { if (av.lastSwing >= 0) av.swingT = 0.32; av.lastSwing = st.swingN; }
      av.swingT = Math.max(0, av.swingT - dt); av.emoteT = Math.max(0, av.emoteT - dt);
      const sp = st.speed || 0, moving = sp > 0.4; av.phase += dt * (sp * (st.sprint ? 1.25 : 1.6) * 1.4);
      const amp = Math.min(1, sp / 6) * (st.sprint ? 1.1 : 0.85), s = Math.sin(av.phase), c = Math.cos(av.phase);
      const crouch = st.crouch ? 1 : 0; av.tmp += (crouch - av.tmp) * Math.min(1, dt * 12);
      rig.position.y = -0.22 * av.tmp * 0 + 0; body.position.y = -0.28 * av.tmp; body.rotation.x = 0.12 * av.tmp + (st.sprint ? 0.2 : 0);
      P.legL.rotation.x = moving ? s * amp * 0.9 + av.tmp * -0.7 : av.tmp * -0.7; P.legR.rotation.x = moving ? -s * amp * 0.9 + av.tmp * -0.7 : av.tmp * -0.7;
      P.shinL.rotation.x = moving ? Math.max(0, -s) * amp * 1.1 + av.tmp * 1.2 : av.tmp * 1.2; P.shinR.rotation.x = moving ? Math.max(0, s) * amp * 1.1 + av.tmp * 1.2 : av.tmp * 1.2;
      if (st.inWater) { P.legL.rotation.x *= 0.5; P.legR.rotation.x *= 0.5; }
      P.torso.scale.y = 1 + Math.sin(av.phase * 0.2 + performance.now() / 900) * 0.008;
      // arms
      const idle = av.pose;
      let aL = moving ? -s * amp * 0.8 : 0, aR = moving ? s * amp * 0.8 : 0, fL = 0.1, fR = 0.1, aLz = -0.08, aRz = 0.08, torsoY = 0;
      if (!moving) { if (idle === 'relaxed') { aLz = -0.16; aRz = 0.16; } else if (idle === 'cocky') { aRz = 0.9; fR = 1.4; aR = -0.3; torsoY = 0.1; } else if (idle === 'proud') { aL = 0.2; aR = 0.2; fL = 1.2; fR = 1.2; aLz = -0.6; aRz = 0.6; } else { fL = 0.5; fR = 0.9; aR = -0.4; } }
      const pitch = st.pitch || 0;
      if (st.aim || av.ranged && (st.aim || av.swingT > 0)) { aR = -1.5 - pitch * 0.9; fR = 0.05; aL = av.ranged ? -1.5 - pitch * 0.9 : 0; fL = 0.1; aLz = 0; aRz = 0.05; }
      else if (av.ranged) { aR = -0.7; fR = 0.7; aL = -0.7; fL = 0.7; aLz = 0; aRz = 0; }
      if (av.swingT > 0 && !av.ranged) { const k = 1 - av.swingT / 0.32; aR = av.isSpear ? -1.4 : -2.4 + k * 3.0; fR = av.isSpear ? 0.1 : 0.2; aRz = av.isSpear ? 0 : 0.2; }
      else if (av.swingT > 0 && av.ranged) { aR += 0.2 * (av.swingT / 0.32); }
      if (st.using) { aR = -1.7 + Math.sin(performance.now() / 120) * 0.12; fR = 2.0; aRz = 0.0; }
      if (st.reload) { aL = -1.2; fL = 1.5; aR = -0.8; fR = 1.0; }
      if (st.rooted) { body.rotation.z = Math.sin(performance.now() / 70) * 0.05; } else body.rotation.z = 0;
      // emotes / victory (override)
      const em = av.emoteT > 0 ? av.emote : (st.victory || '');
      if (em && !moving) {
        const t = performance.now() / 1000;
        switch (em) {
          case 'wave': aR = -2.7; aRz = 0.35; fR = 0.3 + Math.sin(t * 9) * 0.5; break;
          case 'nod': P.head.rotation.x = Math.sin(t * 6) * 0.25; break;
          case 'bow': body.rotation.x = 0.9 * Math.sin(Math.min(1, (2 - av.emoteT) * 1.6) * Math.PI * 0.5) * (av.emoteT > 0.4 ? 1 : av.emoteT / 0.4); break;
          case 'taunt': aR = -2.2; aL = -2.2; aRz = 0.5; aLz = -0.5; body.rotation.x = -0.1; P.head.rotation.x = Math.sin(t * 8) * 0.12; break;
          case 'dance': body.rotation.y = Math.sin(t * 5) * 0.5; aR = -2.4 + Math.sin(t * 10) * 0.5; aL = -2.4 - Math.sin(t * 10) * 0.5; aRz = 0.4; aLz = -0.4; body.position.y = Math.abs(Math.sin(t * 5)) * 0.1; break;
          case 'mourn': aR = -1.6; fR = 1.8; aRz = 0.0; break;
          case 'salute': aR = -2.2; fR = 2.2; aRz = 0.0; break;
          case 'kneel': body.position.y = -0.4; P.legL.rotation.x = -1.4; P.legR.rotation.x = -0.4; P.shinL.rotation.x = 1.6; P.shinR.rotation.x = 1.2; body.rotation.x = 0.2; aR = 0.3; aL = 0.3; break;
          case 'triumph': aR = -3.0; aL = -3.0; aRz = 0.5; aLz = -0.5; break;
          case 'fireworks': aR = -3.0; aL = -2.8; aRz = 0.4; aLz = -0.4; body.position.y = Math.abs(Math.sin(t * 4)) * 0.18; break;
          case 'ascend': aR = -2.9; aL = -2.9; aRz = 0.7; aLz = -0.7; rig.position.y = 0.4 + Math.sin(t) * 0.1; break;
        }
      } else { P.head.rotation.x += (-pitch * 0.5 - P.head.rotation.x) * Math.min(1, dt * 12); body.rotation.y *= 0.8; }
      P.armL.rotation.set(aL, 0, aLz); P.armR.rotation.set(aR, 0, aRz); P.foreL.rotation.x = -fL; P.foreR.rotation.x = -fR;
      if (!em) P.head.rotation.x = -pitch * 0.5;
    };
    av.dispose = () => { if (av.nameSprite) { av.nameSprite.material.map.dispose(); av.nameSprite.material.dispose(); } };
    av.setAppearance(app || E.DEFAULT_APPEARANCE);
    return av;
  }
  HG.Avatar = { create, weaponModel, G, mat, mesh };
})();
