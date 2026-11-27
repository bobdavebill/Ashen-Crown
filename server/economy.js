/* Server-side economy, progression, challenges and campaign progress. The client NEVER supplies a balance — it only asks; every
   change is computed here and written to the profile with a unique transaction id (replays of the same id are ignored). */
const C = require('../shared/constants');
const E = require('../shared/catalog');
const K = require('../shared/campaign');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dayKey = now => 'D' + E.dayIndex(now);

function newProfile(user) {
  const p = {
    user, created: Date.now(), credits: 150, lifetime: 150, xp: 0, level: 1, title: 'Tribute',
    owned: E.freeIds(), appearance: Object.assign({}, E.DEFAULT_APPEARANCE),
    stats: { matches: 0, wins: 0, losses: 0, kills: 0, botKills: 0, humanKills: 0, deaths: 0, surviveTotal: 0, bestPlacement: 0, top3: 0, ghostWins: 0, bowWins: 0, craft: 0,
      hiddenFound: [], longestSurvival: 0, nightmareWins: 0, campaignEndings: 0, resources: 0 },
    achievements: {}, ch: { d: '', w: '', daily: {}, weekly: {}, done: {} },
    campaign: { done: {}, flags: {}, rel: {}, unlocks: {}, endings: [], diff: 'normal' },
    tx: [{ id: 'welcome', t: Date.now(), type: 'grant', amount: 150, reason: 'Welcome stipend', bal: 150 }], txids: { welcome: 1 }, txOrder: ['welcome'],
    history: [], penaltyUntil: 0, botDay: { k: '', n: 0 }, victims: { k: '', m: {} }, loadout: { adv: [], dis: [], wclass: 'blade' }, lastBeg: 0,
  };
  return p;
}

/* ------------------------------------------------------------------ transactions */
function tx(p, id, type, amount, reason, now) {
  if (!id || p.txids[id]) return { ok: false, dup: true };
  amount = Math.round(amount);
  if (amount < 0 && p.credits + amount < 0) return { ok: false, short: true };      // never negative
  p.credits += amount; if (amount > 0) p.lifetime += amount;
  p.txids[id] = 1; p.txOrder.push(id);
  p.tx.push({ id, t: now || Date.now(), type, amount, reason, bal: p.credits });
  if (p.tx.length > 150) p.tx.splice(0, p.tx.length - 150);
  while (p.txOrder.length > 600) delete p.txids[p.txOrder.shift()];
  return { ok: true };
}
/* debit up to `amt` (clamped to the balance) — used for stakes lost; never produces a negative balance */
function debitUpTo(p, id, amt, reason, now) { amt = Math.min(Math.round(amt), p.credits); if (amt <= 0) return 0; const r = tx(p, id, 'loss', -amt, reason, now); return r.ok ? amt : 0; }

/* ---------------------------------------------------------------------- xp */
function addXp(p, n) {
  n = Math.max(0, Math.round(n)); p.xp += n;
  const lv = E.levelFromXp(p.xp); const up = lv.level > p.level; p.level = lv.level; p.title = E.titleForLevel(p.level); return up;
}
function levelInfo(p) { return E.levelFromXp(p.xp); }

/* ----------------------------------------------------------- unlocks / cosmetics */
function statOf(p, key) {
  const s = p.stats;
  switch (key) {
    case 'hiddenCount': return s.hiddenFound.length;
    case 'lifetime': return p.lifetime;
    case 'owned': return p.owned.filter(id => E.BY_ID[id] && E.BY_ID[id].unlock.t !== 'free').length;
    case 'level': return p.level;
    default: return s[key] || 0;
  }
}
function grantUnlocks(p) {     // auto-grant free / achievement / campaign / level-free cosmetics
  const set = new Set(p.owned), got = [];
  for (const c of E.COSMETICS) {
    if (set.has(c.id)) continue;
    const u = c.unlock; let ok = false;
    if (u.t === 'free') ok = true;
    else if (u.t === 'ach') ok = !!p.achievements[u.v];
    else if (u.t === 'camp') ok = !!p.campaign.unlocks[u.v];
    if (ok) { set.add(c.id); got.push(c.id); }
  }
  p.owned = [...set]; return got;
}
function checkAchievements(p, now) {
  const out = [];
  for (const a of E.ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue;
    if (statOf(p, a.stat) >= a.target) {
      p.achievements[a.id] = now || Date.now();
      if (a.credits) tx(p, 'ach:' + a.id, 'achievement', a.credits, 'Achievement: ' + a.name, now);
      if (a.xp) addXp(p, a.xp);
      out.push({ id: a.id, name: a.name, credits: a.credits, xp: a.xp });
    }
  }
  if (out.length) { const g = grantUnlocks(p); if (g.length) out.push(...g.map(id => ({ cosmetic: id }))); checkAchievements2(p, out, now); }
  return out;
}
function checkAchievements2(p, out, now) { for (const a of E.ACHIEVEMENTS) if (!p.achievements[a.id] && statOf(p, a.stat) >= a.target) { p.achievements[a.id] = now || Date.now(); if (a.credits) tx(p, 'ach:' + a.id, 'achievement', a.credits, 'Achievement: ' + a.name, now); if (a.xp) addXp(p, a.xp); out.push({ id: a.id, name: a.name, credits: a.credits, xp: a.xp }); } }

function buyCosmetic(p, id, txid, now) {
  const c = E.BY_ID[id]; if (!c) return { ok: false, error: 'Unknown item' };
  if (p.owned.includes(id)) return { ok: false, error: 'Already owned' };
  const u = c.unlock;
  if (u.t === 'ach' || u.t === 'camp') return { ok: false, error: 'Earned through achievements / the campaign — cannot be bought' };
  if (u.t === 'free') { p.owned.push(id); return { ok: true }; }
  if (u.t === 'level' && p.level < u.v) return { ok: false, error: 'Requires level ' + u.v };
  if (u.t === 'event' && !E.eventActive(u.v, now)) return { ok: false, error: 'Only available during the ' + E.EVENT_WINDOWS[u.v].name + ' event' };
  if (p.credits < c.price) return { ok: false, error: 'Not enough credits' };
  const r = tx(p, 'buy:' + (txid || id + ':' + now), 'purchase', -c.price, 'Bought ' + c.name, now);
  if (!r.ok) return { ok: false, error: r.dup ? 'Duplicate request ignored' : 'Not enough credits' };
  p.owned.push(id); const ach = checkAchievements(p, now); return { ok: true, ach };
}
function equip(p, ap) { const clean = E.cleanAppearance(ap, p.owned); p.appearance = clean; return clean; }

/* ------------------------------------------------------------------ loadout / perks */
function validateLoadout(p, lo, ranked) {
  const out = { adv: [], dis: [], wclass: null, cost: 0, bonus: 0 };
  if (ranked || !lo) return out;
  const seenA = new Set(), seenD = new Set();
  for (const id of (lo.adv || [])) { const pk = E.PERKS[id]; if (pk && pk.kind === 'adv' && !seenA.has(id) && seenA.size < E.MAX_ADV) { seenA.add(id); out.cost += pk.price; } }
  for (const id of (lo.dis || [])) { const pk = E.PERKS[id]; if (pk && pk.kind === 'dis' && !seenD.has(id) && seenD.size < E.MAX_DIS) { seenD.add(id); out.bonus += pk.bonus; } }
  out.adv = [...seenA]; out.dis = [...seenD];
  if (seenA.has('weapon_training')) { const classes = new Set(Object.values(C.WEAPON_CLASS)); out.wclass = classes.has(lo.wclass) ? lo.wclass : 'blade'; }
  return out;
}

/* --------------------------------------------------------------- challenges */
function ensureChallenges(p, now) {
  const cf = E.challengesFor(now), c = p.ch;
  if (c.d !== cf.dayKey) { c.d = cf.dayKey; c.daily = {}; }
  if (c.w !== cf.weekKey) { c.w = cf.weekKey; c.weekly = {}; }
  return cf;
}
function challengeView(p, now) {
  const cf = ensureChallenges(p, now);
  const f = (list, store, key) => list.map(ch => ({ id: ch.id, desc: ch.desc, target: ch.target, credits: ch.credits, xp: ch.xp, cosmetic: ch.cosmetic || null, progress: Math.min(ch.target, store[ch.id] || 0), done: !!p.ch.done[key + ':' + ch.id] }));
  return { daily: f(cf.daily, p.ch.daily, cf.dayKey), weekly: f(cf.weekly, p.ch.weekly, cf.weekKey), dayKey: cf.dayKey };
}
function applyChallenges(p, m, now) {
  const cf = ensureChallenges(p, now), done = [];
  const run = (list, store, key) => {
    for (const ch of list) {
      const k = key + ':' + ch.id; if (p.ch.done[k]) continue;
      const v = m[ch.metric] || 0; if (!v) continue;
      store[ch.id] = ch.mode === 'max' ? Math.max(store[ch.id] || 0, v) : (store[ch.id] || 0) + v;
      if (store[ch.id] >= ch.target) {
        p.ch.done[k] = 1; tx(p, 'chal:' + k + ':' + p.user, 'challenge', ch.credits, 'Challenge: ' + ch.desc, now); addXp(p, ch.xp);
        if (ch.cosmetic && E.BY_ID[ch.cosmetic] && !p.owned.includes(ch.cosmetic)) p.owned.push(ch.cosmetic);
        done.push({ id: ch.id, desc: ch.desc, credits: ch.credits, xp: ch.xp, cosmetic: ch.cosmetic || null });
      }
    }
  };
  run(cf.daily, p.ch.daily, cf.dayKey); run(cf.weekly, p.ch.weekly, cf.weekKey);
  const keys = Object.keys(p.ch.done); if (keys.length > 60) for (const k of keys.slice(0, keys.length - 40)) delete p.ch.done[k];
  return done;
}

/* ------------------------------------------------------------ entry & settlement */
function canEnter(p, tierId, now) {
  const t = E.TIERS[tierId]; if (!t) return { ok: false, error: 'Unknown tier' };
  if (p.penaltyUntil > now) return { ok: false, error: 'Matchmaking penalty: ' + Math.ceil((p.penaltyUntil - now) / 1000) + 's remaining (you quit a match)' };
  if (p.credits < t.stake) return { ok: false, error: 'Not enough credits for the ' + t.stake + ' entry. Free Beginner matches are always open.' };
  return { ok: true };
}
/* charge stake + perks when a match actually starts. Returns false if the player can't pay (then they are entered with no perks, stake waived). */
function chargeEntry(p, matchId, stake, perkCost, now) {
  const info = { stake: 0, perks: 0 };
  if (stake > 0) { const r = tx(p, 'stake:' + matchId, 'stake', -stake, 'Entry stake', now); if (r.ok) info.stake = stake; else return { ok: false, info }; }
  if (perkCost > 0) { const r = tx(p, 'perks:' + matchId, 'purchase', -perkCost, 'Pre-match supplies', now); if (r.ok) info.perks = perkCost; else info.perkFail = true; }
  return { ok: true, info };
}

function refundFraction(tier, placement, total) {
  if (tier.stake <= 0) return 0;
  if (placement <= 3) return 1;
  const half = Math.ceil(total / 2);
  if (placement <= half) return 1 - tier.loseBottom * 0.5;
  return 1 - tier.loseBottom;
}

/* d: { matchId, mode, tier, ranked, difficulty, humans, bots, total, placement, survive, duration, quit, connFail, entry:{stake,perks}, perks:{dis:[]}, stats(sim stats), kind, campaign } */
function settleMatch(p, d, now) {
  const tier = E.TIERS[d.tier] || E.TIERS.free, st = d.stats, S = p.stats, hasBots = d.bots > 0;
  const out = { placement: d.placement, total: d.total, stake: d.entry.stake, refund: 0, earned: { placement: 0, kills: 0, hidden: 0, bonus: 0 }, xp: 0, net: 0, notes: [], challenges: [], achievements: [], unlocked: [], level: p.level, capped: false };
  const settleId = 'settle:' + d.matchId;
  if (p.txids[settleId + ':done']) return null;
  p.txids[settleId + ':done'] = 1; p.txOrder.push(settleId + ':done');
  if (d.aborted || d.connFail) {       // server crash or early connection failure: full refund, nothing else changes
    if (d.entry.stake) { tx(p, 'refund:' + d.matchId, 'refund', d.entry.stake, 'Match aborted — stake refunded', now); out.refund = d.entry.stake; out.notes.push('Match interrupted — your entry stake was refunded.'); }
    if (d.entry.perks) tx(p, 'refundperk:' + d.matchId, 'refund', d.entry.perks, 'Match aborted — supplies refunded', now);
    out.net = out.refund; return out;
  }
  const practice = d.mode === 'practice', campaign = d.mode === 'campaign';
  const survive = Math.round(d.survive);
  // ---- stats
  S.matches++; S.kills += st.kills; S.botKills += st.botKills; S.humanKills += st.humanKills; S.surviveTotal += survive; S.longestSurvival = Math.max(S.longestSurvival, survive);
  S.craft += st.crafts; S.resources += st.resources;
  const won = d.placement === 1 && !d.quit, top3 = d.placement <= 3 && !d.quit;
  if (won) { S.wins++; if (!st.corn) S.ghostWins++; if ((st.byClass.bow || 0) > 0) S.bowWins++; if (d.difficulty === 'nightmare' && hasBots) S.nightmareWins++; } else S.losses++;
  if (top3) S.top3++;
  if (st.alive === false || !won) S.deaths++;
  if (!S.bestPlacement || d.placement < S.bestPlacement) S.bestPlacement = d.placement;
  const newHidden = []; for (const h of st.hidden) if (!S.hiddenFound.includes(h)) { S.hiddenFound.push(h); newHidden.push(h); }
  // ---- credits
  let earned = 0;
  const lenF = clamp(d.duration / 420, 0.3, 1);
  const dm = hasBots ? C.DIFFICULTY[d.difficulty || 'normal'].rewardMul * (d.humans >= 2 ? 1 : 0.85) : 1;
  const tm = practice ? 0.3 : campaign ? 0 : tier.rewardMul * (d.ranked ? 1.1 : 1);
  if (!d.quit && survive >= E.MIN_SURVIVE_FOR_PARTICIPATION) {
    const base = (E.PLACEMENT[d.placement] || 0) + E.PARTICIPATION;
    out.earned.placement = Math.round(base * tm * dm * lenF);
    // kills
    const day = dayKey(now); if (p.victims.k !== day) p.victims = { k: day, m: {} };
    let kc = 0, bc = 0;
    for (const v of st.victims) {
      if (v.bot) bc++; else { const n = (p.victims.m[v.acct || v.n] = (p.victims.m[v.acct || v.n] || 0) + 1); kc += E.REPEAT_VICTIM_FACTOR[Math.min(n - 1, E.REPEAT_VICTIM_FACTOR.length - 1)]; }
    }
    out.earned.kills = Math.round((kc * E.KILL_BONUS + Math.min(E.BOT_KILL_CAP, bc * E.KILL_BONUS * E.BOT_KILL_FACTOR * dm)) * Math.max(tm, 0.15));
    for (const id of newHidden) { const h = E.HIDDEN_TYPES.find(x => x.id === id); if (h) out.earned.hidden += h.credits; }
    for (const id of (d.perks.dis || [])) { const pk = E.PERKS[id]; if (pk) out.earned.bonus += pk.bonus; }
    if (survive < 90 || d.placement > Math.ceil(d.total * 0.75)) out.earned.bonus = Math.round(out.earned.bonus * 0.4);
    earned = out.earned.placement + out.earned.kills + out.earned.hidden + out.earned.bonus;
    // bot-match farming cap per UTC day
    if (hasBots && !campaign) {
      if (p.botDay.k !== day) p.botDay = { k: day, n: 0 };
      const room = Math.max(0, E.BOT_DAILY_CAP - p.botDay.n); if (earned > room) { earned = room; out.capped = true; out.notes.push('Daily bot-match reward limit reached — humans and campaign still pay in full.'); }
      p.botDay.n += earned;
    }
    if (campaign) earned = 0;
  } else if (d.quit && !practice) out.notes.push(d.entry.stake ? 'You quit the match: entry stake forfeited and a short matchmaking penalty applies.' : 'You quit the match: a short matchmaking penalty applies.');
  if (earned > 0) tx(p, 'reward:' + d.matchId, 'reward', earned, 'Match reward (#' + d.placement + ')', now);
  // ---- stake
  if (d.entry.stake > 0) {
    const frac = d.quit ? 0 : refundFraction(tier, d.placement, d.total);
    out.refund = Math.round(d.entry.stake * frac);
    if (out.refund > 0) tx(p, 'refund:' + d.matchId, 'refund', out.refund, 'Stake returned', now);
    if (frac < 1) out.notes.push('Lost ' + (d.entry.stake - out.refund) + ' of your ' + d.entry.stake + ' stake.');
  }
  if (d.quit && !practice && !campaign) p.penaltyUntil = now + E.QUIT_PENALTY_SEC * 1000;
  out.earned.total = earned; out.net = earned + out.refund - d.entry.stake - d.entry.perks;
  // ---- xp: rewards surviving & skill, diminishing for very short matches
  let xp = 20 + ({ 1: 120, 2: 80, 3: 55, 4: 35, 5: 35 }[d.placement] || 0) + st.kills * 15 + Math.min(10, survive / 60) * 4;
  xp *= clamp(survive / 150, 0.2, 1) * (hasBots ? 0.6 + 0.4 * C.DIFFICULTY[d.difficulty || 'normal'].rewardMul : 1) * (practice ? 0.5 : 1);
  if (d.quit) xp = 0; xp = Math.min(E.MATCH_XP_CAP, Math.round(xp));
  const before = p.level; addXp(p, xp); out.xp = xp; out.level = p.level; out.levelUp = p.level > before;
  // ---- challenges (server validated; need a real, meaningful match)
  const eligible = !practice && !campaign && !d.quit && d.total >= 6 && (d.humans >= 2 || (d.difficulty && d.difficulty !== 'easy')) && survive >= 60;
  if (eligible) {
    out.challenges = applyChallenges(p, { matches: 1, survive, kills: st.kills, bowWin: won && (st.byClass.bow || 0) > 0 ? 1 : 0, resources: st.resources, noHealMatch: survive >= 180 && st.heals === 0 ? 1 : 0,
      ghostWin: won && !st.corn ? 1 : 0, top3: top3 ? 1 : 0, craft: st.crafts, hidden: newHidden.length, wins: won ? 1 : 0, surviveTotal: survive }, now);
  }
  out.achievements = checkAchievements(p, now);
  out.unlocked = grantUnlocks(p);
  p.history.unshift({ id: d.matchId, t: now, mode: d.mode, tier: d.tier, placement: d.placement, total: d.total, kills: st.kills, survive, net: out.net, diff: hasBots ? d.difficulty : null });
  if (p.history.length > 25) p.history.length = 25;
  return out;
}

/* ----------------------------------------------------------------- campaign */
function campState(p) {
  const cp = p.campaign, mis = {};
  for (const id of K.missionOrder()) { const m = K.MISSIONS[id]; mis[id] = { avail: K.available(id, cp.done, cp.flags), done: !!(cp.done[id] && cp.done[id].done), stars: (cp.done[id] && cp.done[id].stars) || 0 }; }
  return { missions: mis, flags: cp.flags, rel: cp.rel, endings: cp.endings, diff: cp.diff, unlocks: Object.keys(cp.unlocks) };
}
function allyRel(p) { const a = p.campaign.flags.ally; return a && a !== 'none' ? (p.campaign.rel[a] || 0) : 0; }
function applyEnding(p, eid, now) {
  const en = K.ENDINGS[eid]; if (!en) return null; const cp = p.campaign; const first = !cp.endings.includes(eid);
  if (first) cp.endings.push(eid);
  if (en.unlock) cp.unlocks[en.unlock] = 1; cp.unlocks.ending_any = 1;
  if (eid !== 'fallen') { cp.unlocks.ch8_done = 1; if (first) { tx(p, 'ending:' + eid, 'campaign', en.credits, 'Ending: ' + en.title, now); addXp(p, 400); } p.stats.campaignEndings = cp.endings.filter(x => x !== 'fallen').length; }
  const ach = checkAchievements(p, now), unl = grantUnlocks(p); return { ending: eid, first, ach, unlocked: unl };
}
function campScene(p, mid, picks, now) {
  const m = K.MISSIONS[mid], cp = p.campaign;
  if (!m || m.type !== 'scene') return { ok: false, error: 'Not a story scene' };
  if (!K.available(mid, cp.done, cp.flags)) return { ok: false, error: 'Mission locked' };
  const already = cp.done[mid] && cp.done[mid].done;
  const w = K.walkScene(m.scene, picks, { flags: Object.assign({}, cp.flags), allyRel: allyRel(p) });
  if (!w.ok) return { ok: false, error: 'Invalid story choices' };
  if (already) return { ok: true, replay: true };            // re-watching a scene never re-applies consequences
  Object.assign(cp.flags, w.flags);
  for (const k in w.rel) cp.rel[k] = clamp((cp.rel[k] || 0) + w.rel[k], -9, 9);
  cp.done[mid] = { done: true, stars: 1, t: now };
  const reward = K.missionReward(m, cp.diff, true); tx(p, 'camp:' + mid, 'campaign', reward, 'Story: ' + m.title, now); addXp(p, m.xp || 40);
  if (m.unlock) cp.unlocks[m.unlock] = 1;
  const res = { ok: true, reward, flags: cp.flags, rel: cp.rel };
  if (m.final) { const eid = K.resolveEnding(cp.flags, false); if (eid && eid !== 'victor') res.ending = applyEnding(p, eid, now); }
  res.ach = checkAchievements(p, now); res.unlocked = grantUnlocks(p); return res;
}
function campMission(p, mid, r, diff, now, runId) {
  const m = K.MISSIONS[mid], cp = p.campaign; const out = { ok: true, mission: mid, success: r.kind === 'success', reward: 0, bonus: 0, stars: 0 };
  const d = cp.done[mid] || (cp.done[mid] = { done: false, stars: 0 });
  const ok = r.kind === 'success'; const optOk = r.objectives.filter(o => o.optional && o.done).length;
  out.stars = ok ? 1 + Math.min(2, optOk) : 0;
  if (ok) {
    const first = !d.done, base = K.missionReward(m, diff, first);
    const bonus = (first ? 25 : 8) * optOk; out.reward = base; out.bonus = bonus;
    tx(p, 'camp:' + mid + ':' + runId, 'campaign', base + bonus, (first ? 'Mission: ' : 'Replay: ') + m.title, now);
    addXp(p, Math.round((m.xp || 80) * (first ? 1 : 0.3)));
    d.done = true; d.stars = Math.max(d.stars || 0, out.stars);
    if (mid === 'm8_duel') { const eid = K.resolveEnding(cp.flags, true); out.ending = applyEnding(p, eid, now); }
  } else if (mid === 'm8_duel') { out.ending = applyEnding(p, 'fallen', now); }
  out.ach = checkAchievements(p, now); out.unlocked = grantUnlocks(p); return out;
}

/* ----------------------------------------------------- public (client-safe) view */
function publicProfile(p, now) {
  const lv = levelInfo(p), cp = campState(p);
  return { user: p.user, credits: p.credits, lifetime: p.lifetime, xp: p.xp, level: lv.level, into: lv.into, need: lv.need, title: p.title, owned: p.owned, appearance: p.appearance,
    stats: Object.assign({}, p.stats, { hiddenFound: p.stats.hiddenFound.length }), achievements: p.achievements, challenges: challengeView(p, now), campaign: cp, tx: p.tx.slice(-60).reverse(),
    history: p.history, penalty: Math.max(0, p.penaltyUntil - now), loadout: p.loadout, botDay: p.botDay.k === dayKey(now) ? p.botDay.n : 0 };
}
/* what other players see */
function card(p) { return { name: p.user, level: p.level, title: p.title, app: p.appearance }; }

module.exports = { newProfile, tx, debitUpTo, addXp, grantUnlocks, checkAchievements, buyCosmetic, equip, validateLoadout, challengeView, applyChallenges, canEnter, chargeEntry,
  settleMatch, campState, campScene, campMission, publicProfile, card, allyRel, ensureChallenges, dayKey };
