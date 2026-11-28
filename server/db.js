/* Durable store with two backends behind one interface:
   - FILE  (default): JSON file on disk, atomic debounced writes.
   - REMOTE (when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set): a free Upstash Redis database over HTTPS, so accounts survive
     hosts with temporary disks (Render free plan). Accounts/sessions are stored one-per-field so we only send what changed.
   The server uses store.accounts / store.sessions as plain in-memory objects; call `await store.init()` once before listening. */
const fs = require('fs');
const path = require('path');

const K_ACC = 'hg:accounts', K_SES = 'hg:sessions', K_MAT = 'hg:matches', K_META = 'hg:meta';
const env = process.env;
const REMOTE_URL = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').replace(/\/+$/, '');
const REMOTE_TOKEN = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';

class Store {
  constructor(file, opts) {
    opts = opts || {};
    this.file = file; this.dirty = false; this.timer = null; this.busy = null;
    this.remote = opts.url !== undefined ? !!(opts.url && opts.token) : !!(REMOTE_URL && REMOTE_TOKEN);
    this.url = (opts.url !== undefined ? opts.url : REMOTE_URL).replace(/\/+$/, ''); this.token = opts.token !== undefined ? opts.token : REMOTE_TOKEN;
    this.delay = this.remote ? 1500 : 400;
    this.data = { accounts: {}, sessions: {}, matches: [], meta: { created: Date.now(), version: 1 } };
    this.seen = { acc: new Map(), ses: new Map(), mat: '' };   // last value written remotely, to send only changes
    if (!this.remote) this._loadFile();
  }
  get backend() { return this.remote ? 'remote (Upstash Redis)' : 'file ' + this.file; }
  _loadFile() {
    const file = this.file;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { /* ignore */ }
    try { if (fs.existsSync(file)) this.data = Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (e) { console.error('[db] could not read', file, e.message); try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ } }
  }
  async init() {
    if (!this.remote) return this;
    const r = await this._cmds([['HGETALL', K_ACC], ['HGETALL', K_SES], ['GET', K_MAT], ['GET', K_META]]);
    const pairs = (arr, into, seen) => { if (!Array.isArray(arr)) return; for (let i = 0; i + 1 < arr.length; i += 2) { try { into[arr[i]] = JSON.parse(arr[i + 1]); seen.set(arr[i], arr[i + 1]); } catch (e) { console.error('[db] skipped unreadable record', arr[i]); } } };
    pairs(r[0], this.data.accounts, this.seen.acc); pairs(r[1], this.data.sessions, this.seen.ses);
    try { if (r[2]) { this.data.matches = JSON.parse(r[2]); this.seen.mat = r[2]; } } catch (e) { /* ignore */ }
    try { if (r[3]) this.data.meta = JSON.parse(r[3]); } catch (e) { /* ignore */ }
    const t = Date.now(); for (const k of Object.keys(this.data.sessions)) if (this.data.sessions[k].exp < t) delete this.data.sessions[k];
    this.dirty = true; await this.flush();   // writes meta on first run
    return this;
  }
  get accounts() { return this.data.accounts; }
  get sessions() { return this.data.sessions; }
  markDirty() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delay); }
  /* file backend: synchronous. remote backend: returns a promise (await it on shutdown). */
  flush() {
    if (!this.dirty) return this.remote ? (this.busy || Promise.resolve()) : undefined;
    if (!this.remote) {
      this.dirty = false; const tmp = this.file + '.tmp';
      try { fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); }
      catch (e) { console.error('[db] write failed', e.message); this.dirty = true; }
      return;
    }
    if (this.busy) { this.again = true; return this.busy; }
    this.busy = this._flushRemote().finally(() => { this.busy = null; if (this.again) { this.again = false; this.flush(); } });
    return this.busy;
  }
  async _flushRemote() {
    this.dirty = false; const cmds = [], commit = [], t = Date.now();
    for (const k of Object.keys(this.data.sessions)) if (this.data.sessions[k].exp < t) delete this.data.sessions[k];
    const diff = (obj, seen, key) => {
      for (const k of Object.keys(obj)) { const s = JSON.stringify(obj[k]); if (seen.get(k) !== s) { cmds.push(['HSET', key, k, s]); commit.push(() => seen.set(k, s)); } }
      for (const k of [...seen.keys()]) if (!(k in obj)) { cmds.push(['HDEL', key, k]); commit.push(() => seen.delete(k)); }
    };
    diff(this.data.accounts, this.seen.acc, K_ACC); diff(this.data.sessions, this.seen.ses, K_SES);
    const mat = JSON.stringify(this.data.matches.slice(-200)); if (mat !== this.seen.mat) { cmds.push(['SET', K_MAT, mat]); commit.push(() => { this.seen.mat = mat; }); }
    if (!this.metaSaved) { cmds.push(['SET', K_META, JSON.stringify(this.data.meta)]); commit.push(() => { this.metaSaved = true; }); }
    if (!cmds.length) return;
    try { await this._cmds(cmds); commit.forEach(f => f()); }
    catch (e) { console.error('[db] remote write failed (will retry):', e.message); this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 5000); }
  }
  /* send commands through Upstash's /pipeline endpoint, in batches that stay well under its 1 MB request limit */
  async _cmds(cmds) {
    const out = []; let batch = [], size = 0;
    const send = async () => {
      if (!batch.length) return;
      const res = await fetch(this.url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
      if (!res.ok) throw new Error('database HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
      const j = await res.json(); for (const x of j) { if (x.error) throw new Error('database: ' + x.error); out.push(x.result); }
      batch = []; size = 0;
    };
    for (const c of cmds) { const n = JSON.stringify(c).length; if (batch.length && (size + n > 700000 || batch.length >= 100)) await send(); batch.push(c); size += n; }
    await send(); return out;
  }
  addMatch(rec) { this.data.matches.push(rec); if (this.data.matches.length > 500) this.data.matches.splice(0, this.data.matches.length - 500); this.markDirty(); }
}
module.exports = { Store };
