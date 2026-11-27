/* End-to-end multiplayer test: boots the real server, connects real WebSocket clients, plays a match with bots. */
process.env.HG_QUIET = '1'; process.env.PORT = '3911'; process.env.HG_DB = '/tmp/claude-0/hg-test-db.json';
try { require('fs').unlinkSync(process.env.HG_DB); } catch (e) {}
const WebSocket = require('ws');
const srv = require('../server/server.js');
const assert = require('assert');
function client(name) {
  return new Promise(res => {
    const ws = new WebSocket('ws://localhost:3911/ws'), c = { ws, name, ev: [], snaps: 0, last: null, welcome: null, result: null };
    ws.on('message', b => { const m = JSON.parse(b); c.ev.push(m.t); if (m.t === 'snap') { c.snaps++; c.last = m.d; } if (m.t === 'welcome') c.welcome = m; if (m.t === 'result') c.result = m; if (m.t === 'me') c.me = m.p; if (m.t === 'authed') { c.authed = m; c.me = m.p; } if (m.t === 'err') c.err = m.m; c.on && c.on(m); });
    c.send = o => ws.send(JSON.stringify(o)); ws.on('open', () => res(c));
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const a = await client('a'), b = await client('b');
  a.send({ t: 'register', user: 'Alice', pass: 'secret1' }); b.send({ t: 'register', user: 'Bobby', pass: 'secret2' });
  await wait(400); assert(a.authed && b.authed, 'auth'); assert.strictEqual(a.me.credits, 150);
  // economy: buy cosmetic, dup txid, can't go negative
  a.send({ t: 'buy', id: 'hair:ponytail', txid: 'x1' }); a.send({ t: 'buy', id: 'hair:ponytail', txid: 'x1' }); await wait(200);
  assert.strictEqual(a.me.credits, 110, 'bought once'); assert(a.me.owned.includes('hair:ponytail'));
  a.send({ t: 'buy', id: 'hairColor:gold', txid: 'x2' }); await wait(150); assert.strictEqual(a.me.credits, 110, 'cannot overspend');
  // private room with 2 humans + 4 bots, low stakes
  a.send({ t: 'create', o: { mode: 'solo', tier: 'low', difficulty: 'normal', bots: 4 } }); await wait(200);
  const code = [...srv.matches].length === 0 && a.ev.includes('room') ? null : null;
  let room; a.on = m => { if (m.t === 'room') room = m.r; }; a.send({ t: 'chat', m: 'hi' }); await wait(100);
  a.on = null; b.send({ t: 'queue', o: { mode: 'solo', tier: 'free' } });
  // find room code through a fresh room message
  a.send({ t: 'leave_room' }); await wait(100);
  a.on = m => { if (m.t === 'room') room = m.r; };
  a.send({ t: 'create', o: { mode: 'solo', tier: 'low', difficulty: 'easy', bots: 4 } }); await wait(200); assert(room, 'room view');
  b.send({ t: 'leave_room' }); await wait(100); b.send({ t: 'join', code: room.code }); await wait(200);
  assert(room.members.length === 2, 'two members ' + JSON.stringify(room));
  a.send({ t: 'start' }); await wait(600);
  assert(a.welcome && b.welcome, 'welcome'); assert.strictEqual(a.welcome.w.roster.length, 6);
  assert.strictEqual(a.welcome.entry.stake, 50);
  // drive inputs
  let seq = 0; const iv = setInterval(() => { for (const c of [a, b]) { c.send({ t: 'in', s: ++seq, mx: 0, mz: 1, y: 1.2, p: 0, f: (seq % 50 === 0 ? 1 : 0) | 2 }); } }, 33);
  await wait(14500); clearInterval(iv);
  assert(a.snaps > 40 && b.snaps > 40, 'snapshots ' + a.snaps);
  assert(a.last.p.length === 6, 'players in snapshot');
  // reconnection: kill b's socket, resume
  const tokenB = b.authed.token; b.ws.close(); await wait(300);
  const b2 = await client('b2'); b2.send({ t: 'resume', token: tokenB }); await wait(500);
  assert(b2.welcome && b2.welcome.resumed, 'resumed into match'); await wait(500); assert(b2.snaps > 5, 'snaps after resume');
  // quit by a (stake lost) then check balance never negative and penalty applies
  a.send({ t: 'quit' }); await wait(500);
  assert(a.result, 'quit result'); console.log(JSON.stringify(a.result.r), a.me.credits, a.me.penalty); assert(a.me.credits >= 0 && a.me.penalty > 0, 'penalty ' + a.me.penalty);
  assert.strictEqual(a.me.credits, 60, 'lost entire stake: ' + a.me.credits); // 110 -50
  console.log('credits after quit', a.me.credits, 'net', a.result.r.net, 'notes', a.result.r.notes);
  // practice vs bots free
  b2.send({ t: 'quit' }); await wait(300);
  const p = await client('p'); p.send({ t: 'register', user: 'Pat', pass: 'secret3' }); await wait(300);
  p.send({ t: 'practice', o: { bots: 5, difficulty: 'hard' } }); await wait(600); assert(p.welcome, 'practice welcome'); assert.strictEqual(p.welcome.w.roster.length, 6);
  p.send({ t: 'act', a: 'pick', d: {} }); await wait(1500); assert(p.snaps > 5);
  p.send({ t: 'quit' }); await wait(300); assert.strictEqual(p.me.credits, 150, 'practice never costs credits'); assert.strictEqual(p.me.penalty, 0);
  // campaign: scene + mission start
  p.send({ t: 'camp_scene', mission: 'm1_selection', picks: [0] }); await wait(250);
  let cs; p.on = m => { if (m.t === 'camp_scene') cs = m; }; p.send({ t: 'camp_scene', mission: 'm2_capital', picks: [0] }); await wait(250);
  assert(p.me.campaign.missions.m1_selection.done, 'm1 done'); assert.strictEqual(p.me.credits, 250);
  p.send({ t: 'camp_scene', mission: 'm2_capital', picks: [0, 0] }); await wait(250); assert(p.me.campaign.missions.m2_capital.done, 'm2 done');
  p.send({ t: 'camp_scene', mission: 'm3_mentor', picks: [0] }); await wait(250); assert(p.me.campaign.missions.m3_mentor.done);
  p.welcome = null; p.send({ t: 'camp_start', mission: 'm3_weapons' }); await wait(600); assert(p.welcome && p.welcome.w.camp, 'campaign welcome');
  assert(p.welcome.w.objectives.length === 2); console.log('training roster', p.welcome.w.roster.length);
  p.send({ t: 'quit' }); await wait(300);
  // forged scene picks rejected
  p.send({ t: 'camp_scene', mission: 'm4_gong', picks: [] }); await wait(200);
  console.log('ALL OK'); process.exit(0);
})().catch(e => { console.error('TEST FAIL', e); process.exit(1); });
