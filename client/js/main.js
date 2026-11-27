/* Entry point: creates the renderer, wires the game loop, connects to the server and shows the first screen. */
(function () {
  HG.main = function () {
    const G = HG.Game, UI = HG.UI, Net = HG.Net, canvas = document.getElementById('gl');
    let R;
    try { R = HG.createRenderer(canvas); } catch (e) {
      document.getElementById('ui').innerHTML = '<section class="screen center"><h1 class="logo">WEBGL UNAVAILABLE</h1><p style="max-width:520px;margin-top:12px;color:var(--dim)">This game needs WebGL. Enable hardware acceleration or try the latest Chrome, Edge or Firefox.</p></section>'; throw e;
    }
    G.init(R); G.loadSettings(); if (R.setQuality) R.setQuality(G.settings.quality || 'high');
    UI.authScreen();
    Net.connect();
    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      try { G.update(dt); } catch (e) { if (!frame.err) { frame.err = 1; console.error('[frame]', e); } }
    }
    requestAnimationFrame(frame);
    // debug / test hook
    window.__hg = { G, UI, Net, R };
    window.addEventListener('beforeunload', () => { try { Net.close(); } catch (e) { /* */ } });
  };
})();
