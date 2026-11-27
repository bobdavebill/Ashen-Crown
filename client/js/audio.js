/* Procedural audio (WebAudio) — everything is synthesised, so there are no sound files to license or download. */
(function () {
  window.HG = window.HG || {};
  let ctx = null, master, sfxG, ambG, musG, noiseBuf = null;
  const vol = { master: 0.8, sfx: 1, amb: 0.7, mus: 0.55 };
  const L = { x: 0, z: 0, yaw: 0 };
  let amb = null, musicNodes = [], birdT = 0, weather = 0, night = 0, waterNear = 0, rainG, windG, windF, waterG, rainOn = false, muted = false;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = vol.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; master.connect(comp); comp.connect(ctx.destination);
    sfxG = ctx.createGain(); ambG = ctx.createGain(); musG = ctx.createGain(); sfxG.gain.value = vol.sfx; ambG.gain.value = vol.amb; musG.gain.value = vol.mus;
    sfxG.connect(master); ambG.connect(master); musG.connect(master);
    const len = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate); const d = noiseBuf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = (w * 0.6 + b * 6) * 0.7; }
    return ctx;
  }
  function resume() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setVolumes(v) { Object.assign(vol, v); if (!ctx) return; master.gain.value = muted ? 0 : vol.master; sfxG.gain.value = vol.sfx; ambG.gain.value = vol.amb; musG.gain.value = vol.mus; }
  function dest(o) { // spatialised destination
    if (!o || o.x == null) return sfxG;
    const dx = o.x - L.x, dz = o.z - L.z, d = Math.hypot(dx, dz), rng = o.range || 60;
    if (d > rng) return null;
    const g = ctx.createGain(); g.gain.value = Math.pow(1 - d / rng, 1.6) * (o.vol || 1);
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); const sy = Math.sin(L.yaw), cy = Math.cos(L.yaw); const right = (dx * cy - dz * sy) / (d || 1); p.pan.value = Math.max(-1, Math.min(1, right * 0.8)); g.connect(p); p.connect(sfxG); }
    else g.connect(sfxG);
    return node;
  }
  function tone(f, dur, type, v, o) {
    if (!ctx) return; const dst = dest(o); if (!dst) return; const t = ctx.currentTime;
    const os = ctx.createOscillator(), g = ctx.createGain(); os.type = type || 'sine'; os.frequency.setValueAtTime(f, t);
    if (o && o.slide) os.frequency.exponentialRampToValueAtTime(Math.max(20, f * o.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.3, t + (o && o.att || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g); g.connect(dst); os.start(t); os.stop(t + dur + 0.05);
  }
  function burst(dur, ftype, freq, q, v, o) {
    if (!ctx) return; const dst = dest(o); if (!dst) return; const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = rnd(0.8, 1.2);
    const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(freq, t); if (o && o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * o.sweep), t + dur); f.Q.value = q || 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.4, t + (o && o.att || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dst); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  const S = {
    click: () => tone(620, 0.06, 'square', 0.08), hover: () => tone(900, 0.03, 'sine', 0.04),
    step: o => { const w = o && o.water; if (w) burst(0.16, 'lowpass', 900, 0.8, 0.18, o); else { burst(0.07, 'bandpass', rnd(260, 420), 1.2, 0.2, o); tone(rnd(70, 95), 0.06, 'sine', 0.12, o); } },
    swing: o => burst(0.18, 'bandpass', 1400, 1.2, 0.16, Object.assign({ sweep: 0.35 }, o)),
    hit: o => { burst(0.1, 'lowpass', 700, 0.8, 0.5, o); tone(rnd(110, 150), 0.12, 'triangle', 0.35, Object.assign({ slide: 0.5 }, o)); },
    headshot: o => { S.hit(o); tone(1300, 0.14, 'sine', 0.25, o); },
    hurt: () => { burst(0.2, 'lowpass', 500, 0.8, 0.5); tone(90, 0.25, 'sawtooth', 0.2, { slide: 0.5 }); },
    bow: o => { tone(210, 0.12, 'triangle', 0.3, Object.assign({ slide: 0.45 }, o)); burst(0.14, 'highpass', 2500, 0.8, 0.2, Object.assign({ sweep: 0.3 }, o)); },
    crossbow: o => { tone(130, 0.14, 'square', 0.22, Object.assign({ slide: 0.4 }, o)); burst(0.12, 'bandpass', 900, 1, 0.3, o); },
    thud: o => { burst(0.1, 'lowpass', 500, 1, 0.3, o); tone(90, 0.08, 'sine', 0.25, o); },
    cannon: () => { burst(1.4, 'lowpass', 220, 0.7, 0.9, { sweep: 0.4, att: 0.01 }); tone(55, 1.2, 'sine', 0.7, { slide: 0.5 }); },
    gong: () => { [110, 164, 221, 332, 442].forEach((f, i) => tone(f, 4.2, 'sine', 0.3 / (i + 1), { att: 0.01 })); burst(0.6, 'lowpass', 900, 0.7, 0.4); },
    pickup: () => { tone(520, 0.08, 'triangle', 0.18); setTimeout(() => tone(780, 0.1, 'triangle', 0.16), 70); },
    drink: () => { for (let i = 0; i < 3; i++) setTimeout(() => burst(0.09, 'bandpass', rnd(500, 900), 3, 0.2), i * 110); },
    eat: () => { for (let i = 0; i < 4; i++) setTimeout(() => burst(0.06, 'bandpass', rnd(900, 1500), 2, 0.2), i * 140); },
    heal: () => { [440, 554, 659].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sine', 0.15), i * 90)); },
    craft: () => { tone(300, 0.07, 'square', 0.1); setTimeout(() => tone(450, 0.09, 'square', 0.1), 80); burst(0.08, 'highpass', 3000, 1, 0.15); },
    reload: () => { burst(0.05, 'bandpass', 1800, 4, 0.2); setTimeout(() => tone(240, 0.05, 'square', 0.12), 120); },
    trap: o => { burst(0.1, 'bandpass', 1200, 3, 0.25, o); tone(320, 0.08, 'square', 0.12, o); },
    trigger: o => { burst(0.3, 'bandpass', 600, 1, 0.5, o); tone(180, 0.3, 'sawtooth', 0.3, Object.assign({ slide: 0.4 }, o)); },
    discover: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sine', 0.16), i * 110)); },
    thunder: o => { burst(2.4, 'lowpass', 300, 0.7, 0.8, Object.assign({ sweep: 0.3, att: 0.05 }, o)); tone(48, 2, 'sine', 0.4, { slide: 0.6 }); },
    bolt: o => { burst(0.25, 'highpass', 1500, 0.6, 0.7, o); setTimeout(() => S.thunder(o), 200 + (o && o.d ? o.d * 3 : 0)); },
    warn: () => { tone(880, 0.18, 'square', 0.14); setTimeout(() => tone(660, 0.22, 'square', 0.14), 200); },
    announce: () => { [196, 262, 330].forEach((f, i) => setTimeout(() => tone(f, 1.2, 'sawtooth', 0.12, { att: 0.15 }), i * 130)); burst(0.8, 'lowpass', 400, 0.6, 0.2); },
    zone: () => { for (let i = 0; i < 3; i++) setTimeout(() => tone(110, 0.5, 'sawtooth', 0.2, { slide: 0.7 }), i * 520); },
    mutt: o => { tone(rnd(120, 180), 0.5, 'sawtooth', 0.2, Object.assign({ slide: 0.6 }, o)); burst(0.4, 'bandpass', 500, 2, 0.15, o); },
    ally: () => { [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.18), i * 100)); },
    betray: () => { [330, 233, 156].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'sawtooth', 0.2), i * 160)); },
    break: o => { burst(0.2, 'highpass', 1800, 1, 0.4, o); tone(150, 0.15, 'square', 0.18, o); },
    victory: () => { const n = [392, 494, 587, 784, 988, 1175]; n.forEach((f, i) => setTimeout(() => { tone(f, 1.4, 'triangle', 0.2, { att: 0.02 }); tone(f / 2, 1.4, 'sine', 0.14); }, i * 240)); setTimeout(() => [392, 494, 587, 784].forEach(f => tone(f, 3, 'triangle', 0.14, { att: 0.05 })), 1700); },
    defeat: () => { [262, 247, 220, 165].forEach((f, i) => setTimeout(() => tone(f, 1.2, 'sine', 0.2, { att: 0.05 }), i * 380)); },
    emote: o => tone(660, 0.12, 'sine', 0.1, o),
    splash: o => burst(0.35, 'lowpass', 1200, 0.7, 0.35, o),
  };
  function play(name, o) { if (!ctx || ctx.state !== 'running' && ctx.state !== 'suspended') return; if (S[name]) try { S[name](o || {}); } catch (e) { /* ignore */ } }
  function listener(x, z, yaw) { L.x = x; L.z = z; L.yaw = yaw; }

  /* -------------------------------------------------------------- ambience */
  function loopNoise(filterType, freq, q, gain) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(ambG); s.start(); return { s, f, g };
  }
  function startAmbience() {
    if (!init() || amb) return; amb = {};
    amb.wind = loopNoise('bandpass', 380, 0.6, 0.07); windG = amb.wind.g; windF = amb.wind.f;
    amb.rain = loopNoise('highpass', 1800, 0.5, 0); rainG = amb.rain.g;
    amb.water = loopNoise('lowpass', 700, 0.4, 0); waterG = amb.water.g;
    amb.timer = setInterval(ambTick, 120); amb.lfo = 0;
  }
  function ambTick() {
    if (!ctx || !amb) return; const t = ctx.currentTime; amb.lfo += 0.12;
    windG.gain.setTargetAtTime(0.05 + 0.03 * Math.sin(amb.lfo * 0.7) + (weather === 2 ? 0.08 : weather === 1 ? 0.02 : 0), t, 0.5); windF.frequency.setTargetAtTime(300 + 120 * Math.sin(amb.lfo * 0.5) + weather * 120, t, 0.5);
    rainG.gain.setTargetAtTime(weather === 2 ? 0.12 : weather === 1 ? 0.07 : 0, t, 1.2);
    waterG.gain.setTargetAtTime(waterNear * 0.12, t, 0.4);
    birdT -= 0.12;
    if (birdT <= 0 && weather < 2) { birdT = night > 0.5 ? rnd(4, 9) : rnd(1.5, 5); if (night > 0.5) { for (let i = 0; i < 2; i++) setTimeout(() => tone(rnd(420, 520), 0.5, 'sine', 0.025, { att: 0.2 }), i * 700); /* crickets-ish hoots */ } else { const f = rnd(2200, 3600), n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) setTimeout(() => tone(f * rnd(0.9, 1.2), 0.07, 'sine', 0.035, { slide: rnd(0.8, 1.4) }), i * 85); } }
  }
  function stopAmbience() { if (!amb) return; clearInterval(amb.timer); for (const k of ['wind', 'rain', 'water']) { try { amb[k].s.stop(); } catch (e) { /* */ } } amb = null; }
  function setWeather(w) { weather = w | 0; } function setNight(n) { night = n; } function setWater(n) { waterNear = Math.max(0, Math.min(1, n)); }

  /* ------------------------------------------------------------------ music */
  function startMusic(kind) {
    if (!init()) return; stopMusic();
    const roots = kind === 'menu' ? [55, 65.4, 49] : kind === 'tense' ? [49, 58.3, 44] : [55, 82.4, 65.4];
    const nodes = [];
    roots.forEach((f, i) => { [1, 1.5, 2.005].forEach((m, j) => { const os = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter(); os.type = j === 1 ? 'triangle' : 'sawtooth'; os.frequency.value = f * m; fl.type = 'lowpass'; fl.frequency.value = 380; g.gain.value = 0.018 / (j + 1);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.05 + i * 0.03 + j * 0.02; lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain); lfo.start();
      os.connect(fl); fl.connect(g); g.connect(musG); os.start(); nodes.push(os, lfo); }); });
    musicNodes = nodes;
  }
  function stopMusic() { for (const n of musicNodes) { try { n.stop(); } catch (e) { /* */ } } musicNodes = []; }
  function speak(text) { try { if (!('speechSynthesis' in window) || vol.master <= 0) return; const u = new SpeechSynthesisUtterance(text); u.rate = 0.82; u.pitch = 0.6; u.volume = Math.min(1, vol.master); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* */ } }
  function mute(m) { muted = m; if (master) master.gain.value = m ? 0 : vol.master; }

  HG.Audio = { init, resume, setVolumes, play, listener, startAmbience, stopAmbience, setWeather, setNight, setWater, startMusic, stopMusic, speak, mute, get vol() { return vol; } };
})();
