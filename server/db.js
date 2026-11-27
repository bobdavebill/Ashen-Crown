/* Tiny durable JSON store (atomic writes, debounced). Swap for SQLite/Postgres by re-implementing this interface. */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file; this.dirty = false; this.timer = null;
    this.data = { accounts: {}, sessions: {}, matches: [], meta: { created: Date.now(), version: 1 } };
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { /* ignore */ }
    try { if (fs.existsSync(file)) this.data = Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (e) { console.error('[db] could not read', file, e.message); try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ } }
  }
  get accounts() { return this.data.accounts; }
  get sessions() { return this.data.sessions; }
  markDirty() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 400); }
  flush() {
    if (!this.dirty) return; this.dirty = false;
    const tmp = this.file + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); }
    catch (e) { console.error('[db] write failed', e.message); this.dirty = true; }
  }
  addMatch(rec) { this.data.matches.push(rec); if (this.data.matches.length > 500) this.data.matches.splice(0, this.data.matches.length - 500); this.markDirty(); }
}
module.exports = { Store };
