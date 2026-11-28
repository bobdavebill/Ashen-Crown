/* Persistence test: runs a mock of the Upstash REST API, then proves accounts survive a full server restart with NO local file. */
const http = require('http'), { spawn } = require('child_process'), assert = require('assert'), WebSocket = require('ws');
const H = new Map(), S = new Map(); let calls = 0, fail = 0;
const exec = c => { const [op, k, a, b] = c;
  if (op === 'HGETALL') { const h = H.get(k) || new Map(), o = []; for (const [f, v] of h) o.push(f, v); return o; }
  if (op === 'HSET') { if (!H.has(k)) H.set(k, new Map()); H.get(k).set(a, b); return 1; }
  if (op === 'HDEL') { return H.has(k) && H.get(k).delete(a) ? 1 : 0; }
  if (op === 'GET') return S.has(k) ? S.get(k) : null; if (op === 'SET') { S.set(k, a); return 'OK'; } throw new Error('bad op ' + op); };
const mock = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
  if (q.headers.authorization !== 'Bearer tok') { r.statusCode = 401; return r.end('no'); }
  if (fail > 0) { fail--; r.statusCode = 500; return r.end('boom'); }
  calls++; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(JSON.parse(b).map(c => ({ result: exec(c) })))); }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
function boot(port) { const p = spawn('node', ['server/server.js'], { env: Object.assign({}, process.env, { PORT: port, HG_DB: '/nonexistent-dir/never.json', UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:3955', UPSTASH_REDIS_REST_TOKEN: 'tok', HG_QUIET: '' }), cwd: __dirname + '/..' }); p.out = ''; p.stdout.on('data', d => p.out += d); p.stderr.on('data', d => p.out += d); return p; }
function client(port) { return new Promise(res => { const ws = new WebSocket('ws://localhost:' + port + '/ws'), c = { ws, me: null, err: null, token: null }; ws.on('message', b => { const m = JSON.parse(b); if (m.t === 'authed') { c.me = m.p; c.token = m.token; } if (m.t === 'me') c.me = m.p; if (m.t === 'autherr') c.err = m.m; }); c.send = o => ws.send(JSON.stringify(o)); ws.on('open', () => res(c)); }); }
(async () => {
  await new Promise(r => mock.listen(3955, r));
  let s = boot(3956); await wait(1200); assert(/saving to remote/.test(s.out), 'uses remote: ' + s.out);
  let a = await client(3956); a.send({ t: 'register', user: 'Persist', pass: 'secret1' }); await wait(400);
  assert(a.me && a.me.credits === 150, 'registered'); const token = a.token;
  a.send({ t: 'buy', id: 'hair:ponytail', txid: 'p1' }); await wait(300); assert.strictEqual(a.me.credits, 110);
  fail = 1; await wait(2500);   // first writes hit simulated outage; server must retry
  await wait(6500); assert(H.get('hg:accounts') && H.get('hg:accounts').has('persist'), 'account stored remotely');
  s.kill('SIGTERM'); await wait(600);
  assert(JSON.parse(H.get('hg:accounts').get('persist')).profile.owned.includes('hair:ponytail'), 'purchase stored');
  s = boot(3957); await wait(1200); assert(/1 accounts loaded/.test(s.out), 'reloaded: ' + s.out);
  a = await client(3957); a.send({ t: 'login', user: 'Persist', pass: 'secret1' }); await wait(400);
  assert(a.me && a.me.credits === 110 && a.me.owned.includes('hair:ponytail'), 'login after restart keeps credits+cosmetics');
  const b = await client(3957); b.send({ t: 'resume', token }); await wait(400); assert(b.me && b.me.credits === 110, 'session token survives restart');
  s.kill('SIGTERM'); mock.close();
  // bad credentials must stop the server loudly instead of silently losing data
  const bad = spawn('node', ['server/server.js'], { env: Object.assign({}, process.env, { PORT: 3958, UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1', UPSTASH_REDIS_REST_TOKEN: 'x' }), cwd: __dirname + '/..' });
  let o = ''; bad.stderr.on('data', d => o += d); const code = await new Promise(r => bad.on('exit', r)); assert(code === 1 && /FATAL/.test(o), 'fatal on unreachable db');
  console.log('PERSIST OK (' + calls + ' db calls)'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
