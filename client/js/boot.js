/* Loads Three.js (local /vendor copy first, then CDN), then the game scripts in order. */
(async function () {
  const $ = id => document.getElementById(id);
  const ui = $('ui');
  ui.innerHTML = '<section class="screen center" id="scr-load"><h1 class="logo">THE ASHEN CROWN</h1><p id="load-msg">Loading the arena…</p><div class="loadbar"><div id="load-bar"></div></div></section>';
  const setP = (f, m) => { const b = $('load-bar'); if (b) b.style.width = Math.round(f * 100) + '%'; if (m && $('load-msg')) $('load-msg').textContent = m; };
  const CDNS = ['./vendor/three.module.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'https://unpkg.com/three@0.160.0/build/three.module.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js'];
  let THREE_ = null;
  // classic script first: works even when the page is opened straight from disk (file://)
  await new Promise(res => { const sc = document.createElement('script'); sc.src = 'vendor/three.min.js'; sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
  if (window.THREE && window.THREE.WebGLRenderer) THREE_ = window.THREE;
  for (let i = 0; i < CDNS.length && !THREE_; i++) {
    try { setP(0.1 + i * 0.1, i ? 'Fetching 3D engine…' : 'Loading 3D engine…'); THREE_ = await import(CDNS[i]); } catch (e) { console.warn('three source failed', CDNS[i]); }
  }
  if (!THREE_) { $('load-msg').innerHTML = 'Could not load the 3D engine (Three.js). Connect to the internet, or place <code>three.module.js</code> in <code>client/vendor/</code> (see README), then reload.'; return; }
  window.THREE = THREE_;
  const files = ['audio', 'net', 'avatar', 'world', 'game', 'ui', 'screens', 'main'];
  for (let i = 0; i < files.length; i++) {
    setP(0.5 + i / files.length * 0.5, 'Loading ' + files[i] + '…');
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/' + files[i] + '.js'; s.onload = res; s.onerror = () => rej(new Error('failed ' + files[i])); document.body.appendChild(s); });
  }
  HG.main();
})().catch(e => { console.error(e); const m = document.getElementById('load-msg'); if (m) m.textContent = 'Error: ' + e.message; });
