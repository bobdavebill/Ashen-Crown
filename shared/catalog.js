/* Economy / progression data: stake tiers, rewards, perks, cosmetics, achievements, challenges. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'));
  else { root.HG = root.HG || {}; root.HG.E = factory(root.HG.C); }
})(typeof self !== 'undefined' ? self : globalThis, function (C) {

  /* ------------------------------------------------------------------ tiers */
  const TIERS = {
    free: { id: 'free', name: 'Beginner (Free Entry)', stake: 0, rewardMul: 0.4, loseBottom: 0, desc: 'No entry cost. Smaller rewards. Always available.' },
    low:  { id: 'low',  name: 'Low Stakes', stake: 50, rewardMul: 1.0, loseBottom: 0.75, desc: 'Entry 50. Bottom finishers lose most of the stake.' },
    high: { id: 'high', name: 'High Stakes', stake: 200, rewardMul: 2.0, loseBottom: 1.0, desc: 'Entry 200. Bottom finishers lose the whole stake.' },
  };
  const PLACEMENT = { 1: 500, 2: 250, 3: 150, 4: 75, 5: 75 };       // base reward by placement
  const PARTICIPATION = 25;
  const KILL_BONUS = 25;
  const BOT_KILL_FACTOR = 0.4;
  const BOT_KILL_CAP = 80;                 // credits per match from bot kills
  const BOT_DAILY_CAP = 1500;              // credits per UTC day from bot-containing matches
  const MIN_SURVIVE_FOR_PARTICIPATION = 60;
  const QUIT_PENALTY_SEC = 180;
  const REPEAT_VICTIM_FACTOR = [1, 0.5, 0.25, 0];

  /* ------------------------------------------------------------------ perks */
  const PERKS = {
    survival_kit:   { id: 'survival_kit', kind: 'adv', name: 'Survival Kit', price: 45, desc: 'Start with +2 food, +2 water, +2 bandages.' },
    medical_kit:    { id: 'medical_kit', kind: 'adv', name: 'Medical Kit', price: 70, desc: 'Start with a Medical Kit and a bandage.' },
    scout_training: { id: 'scout_training', kind: 'adv', name: 'Scout Training', price: 60, desc: 'For the first 3 minutes you can sense loot up to 140 m away (normal: 70 m).' },
    weapon_training:{ id: 'weapon_training', kind: 'adv', name: 'Weapon Training', price: 80, desc: 'Pick a weapon class: 8% faster attacks, 15% tighter spread, 20% slower wear. No extra damage.', needsClass: true },
    reinforced:     { id: 'reinforced', kind: 'adv', name: 'Reinforced Clothing', price: 55, desc: 'Take 6% less damage this match.' },
    tracker:        { id: 'tracker', kind: 'adv', name: 'Tracker Equipment', price: 75, desc: 'See fresh footprints of tributes within 50 m.' },
    extra_space:    { id: 'extra_space', kind: 'adv', name: 'Extra Inventory Space', price: 50, desc: '+4 inventory slots.' },
    knowledge:      { id: 'knowledge', kind: 'adv', name: 'Survival Knowledge', price: 55, desc: 'See every hazard on the map and get event warnings early.' },

    limited_supplies:{ id: 'limited_supplies', kind: 'dis', name: 'Limited Supplies', bonus: 20, desc: 'Start without food or water.' },
    damaged_equip:  { id: 'damaged_equip', kind: 'dis', name: 'Damaged Equipment', bonus: 25, desc: 'Your starting knife is nearly broken; found gear is 25% worn.' },
    no_medical:     { id: 'no_medical', kind: 'dis', name: 'No Medical Kit', bonus: 15, desc: 'Start without a bandage.' },
    heavy_load:     { id: 'heavy_load', kind: 'dis', name: 'Heavy Load', bonus: 25, desc: 'Maximum stamina reduced to 70.' },
    marked:         { id: 'marked', kind: 'dis', name: 'Marked Tribute', bonus: 45, desc: 'Every ~50 s the cameras reveal your position to all tributes for 4 s.' },
    poor_prep:      { id: 'poor_prep', kind: 'dis', name: 'Poor Preparation', bonus: 25, desc: 'Start hungry and thirsty (60%) with 2 fewer inventory slots.' },
  };
  const MAX_ADV = 3, MAX_DIS = 2;

  /* --------------------------------------------------------------- progression */
  const LEVEL_CAP = 60;
  function xpForLevel(l) { return 100 + 55 * (l - 1); }       // xp needed to go from level l to l+1
  function levelFromXp(xp) {
    let l = 1, rem = xp;
    while (l < LEVEL_CAP && rem >= xpForLevel(l)) { rem -= xpForLevel(l); l++; }
    return { level: l, into: rem, need: l >= LEVEL_CAP ? 0 : xpForLevel(l) };
  }
  const MATCH_XP_CAP = 320;
  const TITLES = { 1: 'Tribute', 5: 'Scavenger', 10: 'Survivor', 15: 'Tracker', 20: 'Contender', 30: 'Gladiator', 40: 'Champion', 50: 'Legend', 60: 'Victor of Victors' };
  function titleForLevel(l) { let t = 'Tribute'; for (const k of Object.keys(TITLES)) if (l >= +k) t = TITLES[k]; return t; }

  /* ---------------------------------------------------------------- cosmetics */
  const RARITY = { common: { name: 'Common', color: '#b9b9b9', price: 40 }, uncommon: { name: 'Uncommon', color: '#5bd16a', price: 120 },
    rare: { name: 'Rare', color: '#4aa3ff', price: 320 }, epic: { name: 'Epic', color: '#b26bff', price: 750 }, legendary: { name: 'Legendary', color: '#ffb02e', price: 1800 } };
  const COSMETICS = [];
  const BY_ID = {};
  function add(slot, id, name, rarity, v, unlock, price) {
    unlock = unlock || { t: 'buy' };
    if (price === undefined) price = unlock.t === 'free' ? 0 : (unlock.t === 'ach' || unlock.t === 'camp') ? 0 : RARITY[rarity].price;
    const it = { id: slot + ':' + id, slot, key: id, name, rarity, price, unlock, v: v || {} };
    COSMETICS.push(it); BY_ID[it.id] = it; return it;
  }
  const F = { t: 'free' }, L = n => ({ t: 'level', v: n }), A = n => ({ t: 'ach', v: n }), K = n => ({ t: 'camp', v: n }), EV = n => ({ t: 'event', v: n });

  [['pale', '#f2d3bd'], ['fair', '#e3b894'], ['olive', '#c99a6e'], ['tan', '#a87349'], ['brown', '#7a4b2d'], ['deep', '#4b2c1c']]
    .forEach(([k, c]) => add('skin', k, k[0].toUpperCase() + k.slice(1) + ' skin', 'common', { c }, F));
  [['none', 'Shaved', F], ['short', 'Short crop', F], ['long', 'Long loose', F], ['ponytail', 'Ponytail', null, 'common'], ['braid', 'Side braid', null, 'uncommon'],
   ['bun', 'Top bun', null, 'common'], ['curly', 'Curls', null, 'uncommon'], ['mohawk', 'Mohawk', L(8), 'rare']]
    .forEach(([k, n, u, r]) => add('hair', k, n, r || 'common', { style: k }, u || undefined));
  [['brown', '#4a2f1d', F], ['black', '#17161a', F], ['blonde', '#d8b45a', F], ['red', '#a3361f'], ['auburn', '#7b3a22'], ['grey', '#8d9096'],
   ['white', '#ececec', null, 'uncommon'], ['ocean', '#2f6dd6', null, 'rare'], ['violet', '#7b3fc7', null, 'rare'], ['emerald', '#1fa862', null, 'epic'], ['gold', '#e6b432', null, 'legendary']]
    .forEach(([k, c, u, r]) => add('hairColor', k, k[0].toUpperCase() + k.slice(1) + ' hair', r || 'common', { c }, u || (['brown', 'black', 'blonde'].includes(k) ? F : undefined)));
  [['brown', '#4d2e17', F], ['green', '#3e8a4a', F], ['blue', '#3a74c0', F], ['hazel', '#8d6a2f'], ['grey', '#8a98a6'], ['amber', '#e0a21f', null, 'uncommon'],
   ['violet', '#8f52d6', null, 'rare'], ['crimson', '#c0262d', null, 'epic']]
    .forEach(([k, c, u, r]) => add('eyes', k, k[0].toUpperCase() + k.slice(1) + ' eyes', r || 'common', { c }, u || (u === F ? F : undefined)));
  [['none', 'Clean', F, 'common'], ['freckles', 'Freckles', null, 'common'], ['scar', 'Old scar', null, 'uncommon'], ['war_paint', 'War paint', null, 'rare'],
   ['tribal', 'Tribal lines', L(15), 'rare'], ['glitter', 'Stage glitter', null, 'epic'], ['ember', 'Ember veins', K('ending_any'), 'legendary']]
    .forEach(([k, n, u, r]) => add('face', k, n, r, { style: k }, u || undefined));

  const DISTRICTS = [['d1', 'District 1 — Luxury', '#d6b24a', '#5a3b8a', 3], ['d2', 'District 2 — Masonry', '#8a8f98', '#3b3f46', 6], ['d3', 'District 3 — Technology', '#4bb5c9', '#223', 9],
    ['d4', 'District 4 — Fishing', '#2f7fb5', '#d9d2b8', 12], ['d5', 'District 5 — Power', '#e0a73a', '#3a2f1f', 15], ['d6', 'District 6 — Transport', '#8b5a3a', '#2d2d33', 18],
    ['d7', 'District 7 — Lumber', '#4c7a3a', '#5b3a22', 21], ['d8', 'District 8 — Textiles', '#b0507a', '#e9dccb', 24], ['d9', 'District 9 — Grain', '#c9a54b', '#6b4a2b', 1],
    ['d10', 'District 10 — Livestock', '#9b6a45', '#3d4a35', 27], ['d11', 'District 11 — Orchards', '#6a8f3b', '#4a3524', 30], ['d12', 'District 12 — Mining', '#555a60', '#222428', 0]];
  DISTRICTS.forEach(([k, n, c, c2, lv]) => add('outfit', k, n, lv >= 24 ? 'rare' : lv >= 12 ? 'uncommon' : 'common', { c, c2 }, lv ? L(lv) : F, lv ? (lv >= 24 ? 320 : lv >= 12 ? 120 : 40) : 0));
  add('outfit', 'capital_gold', 'Capital Gold Regalia', 'legendary', { c: '#f5d36a', c2: '#2b1a3f' }, K('ending_victor'));
  add('outfit', 'rebel_grey', 'Rebel Fatigues', 'epic', { c: '#6d756b', c2: '#2c3028' }, K('ending_defiance'));

  [['none', 'None', F, 'common', {}], ['hunter', 'Hunter Jacket', null, 'common', { c: '#3d5a34' }], ['leather', 'Leather Jacket', null, 'common', { c: '#6b4528' }],
   ['storm', 'Storm Cloak', null, 'uncommon', { c: '#3b4a63', cloak: 1 }], ['rebel', 'Rebel Red Coat', null, 'rare', { c: '#a1262e' }],
   ['ashen', 'Ashen Coat', null, 'epic', { c: '#34343a', cloak: 1 }], ['mantle', "Victor's Mantle", A('champion'), 'legendary', { c: '#e8c86a', cloak: 1 }]]
    .forEach(([k, n, u, r, v]) => add('jacket', k, n, r, v, u || undefined));
  [['work', 'Work Trousers', F, 'common', { c: '#4b4a44' }], ['canvas', 'Canvas Trousers', null, 'common', { c: '#8b7d5c' }], ['camo', 'Forest Camo', null, 'uncommon', { c: '#4b5a3a' }],
   ['night', 'Night Weave', null, 'rare', { c: '#1e2230' }], ['silver', 'Silverthread', null, 'epic', { c: '#a9b2c4' }]]
    .forEach(([k, n, u, r, v]) => add('pants', k, n, r, v, u || undefined));
  [['worn', 'Worn Boots', F, 'common', { c: '#3a2c20' }], ['leather', 'Leather Boots', null, 'common', { c: '#5a3d26' }], ['ranger', 'Ranger Boots', null, 'uncommon', { c: '#2f3b2b' }],
   ['iron', 'Ironclad Boots', null, 'rare', { c: '#6b7078' }], ['ember', 'Emberstep Boots', L(40), 'epic', { c: '#d4501c', glow: 1 }]]
    .forEach(([k, n, u, r, v]) => add('boots', k, n, r, v, u || undefined));
  [['none', 'Bare hands', F, 'common', {}], ['leather', 'Leather Gloves', null, 'common', { c: '#5a3d26' }], ['fingerless', 'Fingerless Gloves', null, 'uncommon', { c: '#2a2a2e' }],
   ['steel', 'Steel Gauntlets', null, 'rare', { c: '#9aa1ab' }]].forEach(([k, n, u, r, v]) => add('gloves', k, n, r, v, u || undefined));
  [['none', 'Plain vest', F, 'common', {}], ['bronze', 'Bronze Plate', null, 'uncommon', { c: '#a8733a' }], ['iron', 'Ironwork', null, 'rare', { c: '#7e848c' }],
   ['obsidian', 'Obsidian Plate', L(35), 'epic', { c: '#18181f' }], ['gilded', 'Gilded Plate', A('victor'), 'legendary', { c: '#e2bd55' }]]
    .forEach(([k, n, u, r, v]) => add('armorSkin', k, n, r, v, u || undefined));
  [['none', 'No pack', F, 'common', {}], ['satchel', 'Satchel', F, 'common', { s: 'satchel', c: '#6b4a2b' }], ['hiking', 'Hiking Pack', null, 'common', { s: 'big', c: '#3d5a34' }],
   ['rolltop', 'Roll-top Pack', null, 'uncommon', { s: 'roll', c: '#8b6a3a' }], ['quiver', 'Quiver', null, 'uncommon', { s: 'quiver', c: '#5a3d26' }],
   ['golden', 'Golden Pack', K('ch8_done'), 'legendary', { s: 'big', c: '#e2bd55' }]].forEach(([k, n, u, r, v]) => add('backpack', k, n, r, v, u || undefined));
  [['none', 'No mask', F, 'common', {}], ['bandana', 'Bandana', null, 'common', { s: 'bandana', c: '#a1262e' }], ['fox', 'Fox Mask', null, 'rare', { s: 'half', c: '#d6702a' }],
   ['skull', 'Bone Mask', L(25), 'epic', { s: 'full', c: '#e8e4d6' }], ['mirror', 'Mirror Mask', A('nightmare_victor'), 'legendary', { s: 'full', c: '#c9d7e6', shine: 1 }]]
    .forEach(([k, n, u, r, v]) => add('mask', k, n, r, v, u || undefined));
  [['none', 'No hat', F, 'common', {}], ['cap', 'Flat Cap', null, 'common', { s: 'cap', c: '#4b4a44' }], ['beanie', 'Wool Beanie', null, 'common', { s: 'beanie', c: '#7a2a2a' }],
   ['hood', 'Hood', null, 'uncommon', { s: 'hood', c: '#2f3b2b' }], ['wide', 'Wide-brim Hat', null, 'rare', { s: 'wide', c: '#6b5a3a' }],
   ['helm', 'Bronze Helm', L(20), 'epic', { s: 'helm', c: '#b07a3a' }], ['laurel', 'Laurel Crown', A('champion'), 'legendary', { s: 'laurel', c: '#7bbf5a' }]]
    .forEach(([k, n, u, r, v]) => add('hat', k, n, r, v, u || undefined));
  [['none', 'No scarf', F, 'common', {}], ['red', 'Red Scarf', null, 'common', { c: '#a1262e' }], ['green', 'Green Scarf', null, 'common', { c: '#3d6a3a' }],
   ['grey', 'Grey Scarf', null, 'common', { c: '#7a7d84' }], ['striped', 'Striped Scarf', null, 'uncommon', { c: '#c9a54b', c2: '#2f3b63' }],
   ['silk', 'Capitol Silk', null, 'rare', { c: '#c14fb4' }]].forEach(([k, n, u, r, v]) => add('scarf', k, n, r, v, u || undefined));
  [['default', 'Standard issue', F, 'common', { c: '#8a6a44', m: '#b9bcc2' }], ['hickory', 'Hickory Grip', null, 'common', { c: '#7a5230', m: '#b9bcc2' }],
   ['ironwood', 'Ironwood', null, 'uncommon', { c: '#3a2a22', m: '#9aa1ab' }], ['bone', 'Bonecraft', null, 'rare', { c: '#e2dccb', m: '#d8d2c0' }],
   ['obsidian', 'Obsidian Edge', L(30), 'epic', { c: '#18181f', m: '#2a2a36', glow: '#6a4cff' }], ['golden', 'Golden Arms', K('ch8_done'), 'legendary', { c: '#e2bd55', m: '#f5d36a' }]]
    .forEach(([k, n, u, r, v]) => add('weaponSkin', k, n, r, v, u || undefined));
  [['none', 'None', F, 'common'], ['salute', 'Salute', F, 'common'], ['kneel', 'Humble Kneel', null, 'uncommon'], ['triumph', 'Triumph', null, 'rare'],
   ['fireworks', 'Fireworks', A('champion'), 'epic'], ['ascend', 'Ascension', K('ending_victor'), 'legendary']].forEach(([k, n, u, r]) => add('victory', k, n, r, { a: k }, u || undefined));
  [['wave', 'Wave', F, 'common'], ['nod', 'Nod', F, 'common'], ['bow', 'Bow', null, 'common'], ['taunt', 'Taunt', null, 'uncommon'], ['dance', 'Victory Dance', null, 'rare'],
   ['mourn', 'Three-finger Salute', K('ch6_done'), 'epic']].forEach(([k, n, u, r]) => add('emote', k, n, r, { a: k }, u || undefined));
  [['ready', 'Ready stance', F, 'common'], ['relaxed', 'Relaxed', null, 'common'], ['cocky', 'Cocky', null, 'uncommon'], ['proud', 'Proud', null, 'rare']]
    .forEach(([k, n, u, r]) => add('pose', k, n, r, { a: k }, u || undefined));

  // seasonal event items (purchasable only inside the window)
  const EVENT_WINDOWS = {
    winterfest: { name: 'Winterfest', start: [10, 20], end: [0, 6] },   // [month(0-11), day] — Nov 20 → Jan 6
    harvest: { name: 'Harvest Trials', start: [8, 15], end: [9, 31] },
  };
  add('hat', 'frost_crown', 'Frostbound Crown', 'epic', { s: 'laurel', c: '#a8d8ff' }, EV('winterfest'));
  add('scarf', 'snowdrift', 'Snowdrift Scarf', 'rare', { c: '#e8f3ff' }, EV('winterfest'));
  add('jacket', 'harvest', 'Harvest Coat', 'rare', { c: '#b87a2a' }, EV('harvest'));
  function eventActive(name, now) {
    const w = EVENT_WINDOWS[name]; if (!w) return false;
    const d = new Date(now || Date.now()); const m = d.getUTCMonth(), day = d.getUTCDate();
    const v = m * 40 + day, s = w.start[0] * 40 + w.start[1], e = w.end[0] * 40 + w.end[1];
    return s <= e ? (v >= s && v <= e) : (v >= s || v <= e);
  }

  const DEFAULT_APPEARANCE = { skin: 'skin:fair', hair: 'hair:short', hairColor: 'hairColor:brown', eyes: 'eyes:brown', face: 'face:none', outfit: 'outfit:d12', jacket: 'jacket:none',
    pants: 'pants:work', boots: 'boots:worn', gloves: 'gloves:none', armorSkin: 'armorSkin:none', backpack: 'backpack:none', mask: 'mask:none', hat: 'hat:none', scarf: 'scarf:none',
    weaponSkin: 'weaponSkin:default', victory: 'victory:salute', emote: 'emote:wave', pose: 'pose:ready' };
  const SLOTS = Object.keys(DEFAULT_APPEARANCE);
  function freeIds() { return COSMETICS.filter(c => c.unlock.t === 'free').map(c => c.id); }
  function cleanAppearance(a, owned) {
    const out = {}; const ownedSet = owned ? new Set(owned) : null;
    for (const s of SLOTS) {
      const id = a && a[s]; const it = id && BY_ID[id];
      out[s] = (it && it.slot === s && (!ownedSet || ownedSet.has(id))) ? id : DEFAULT_APPEARANCE[s];
    }
    return out;
  }

  /* --------------------------------------------------------------- achievements */
  // stat: profile.stats key (cumulative) — target; special tests handled by server via `flag`
  const ACHIEVEMENTS = [
    { id: 'first_blood', name: 'First Blood', desc: 'Eliminate a tribute.', stat: 'kills', target: 1, credits: 30, xp: 30 },
    { id: 'hunter', name: 'Career Tribute', desc: 'Eliminate 25 tributes.', stat: 'kills', target: 25, credits: 150, xp: 150 },
    { id: 'slayer', name: 'Arena Legend', desc: 'Eliminate 100 tributes.', stat: 'kills', target: 100, credits: 400, xp: 400 },
    { id: 'survivor', name: 'Still Standing', desc: 'Play 10 matches.', stat: 'matches', target: 10, credits: 60, xp: 80 },
    { id: 'veteran', name: 'Veteran', desc: 'Play 50 matches.', stat: 'matches', target: 50, credits: 250, xp: 250 },
    { id: 'victor', name: 'Victor', desc: 'Win a match.', stat: 'wins', target: 1, credits: 150, xp: 150 },
    { id: 'champion', name: 'Champion', desc: 'Win 10 matches.', stat: 'wins', target: 10, credits: 600, xp: 500 },
    { id: 'podium', name: 'On the Podium', desc: 'Finish in the top three 5 times.', stat: 'top3', target: 5, credits: 120, xp: 120 },
    { id: 'ghost', name: 'Ghost of the Arena', desc: 'Win without ever entering the Cornucopia.', stat: 'ghostWins', target: 1, credits: 200, xp: 200 },
    { id: 'archer', name: 'Bow Master', desc: 'Win a match with at least one bow elimination.', stat: 'bowWins', target: 1, credits: 150, xp: 150 },
    { id: 'endurance', name: 'Endurance', desc: 'Survive 10 minutes in one match.', stat: 'longestSurvival', target: 600, credits: 100, xp: 120 },
    { id: 'crafter', name: 'Resourceful', desc: 'Craft 15 items.', stat: 'craft', target: 15, credits: 80, xp: 80 },
    { id: 'explorer', name: 'Explorer', desc: 'Discover 5 different hidden locations.', stat: 'hiddenCount', target: 5, credits: 250, xp: 200 },
    { id: 'rich', name: 'Sponsored', desc: 'Earn 5,000 credits in your lifetime.', stat: 'lifetime', target: 5000, credits: 0, xp: 200 },
    { id: 'nightmare_victor', name: 'Nightmare Victor', desc: 'Win a match against Nightmare-difficulty bots.', stat: 'nightmareWins', target: 1, credits: 400, xp: 400 },
    { id: 'story', name: 'The Story So Far', desc: 'Finish the campaign.', stat: 'campaignEndings', target: 1, credits: 300, xp: 300 },
    { id: 'collector', name: 'Collector', desc: 'Own 25 cosmetic items.', stat: 'owned', target: 25, credits: 100, xp: 100 },
    { id: 'level10', name: 'Rising Tribute', desc: 'Reach level 10.', stat: 'level', target: 10, credits: 100, xp: 0 },
  ];

  /* ------------------------------------------------------------ daily challenges */
  const DAILY_POOL = [
    { id: 'play2', metric: 'matches', mode: 'sum', target: 2, desc: 'Play 2 matches.', credits: 30, xp: 40 },
    { id: 'survive600', metric: 'survive', mode: 'max', target: 600, desc: 'Survive for 10 minutes in a single match.', credits: 80, xp: 80 },
    { id: 'kill3', metric: 'kills', mode: 'sum', target: 3, desc: 'Eliminate three opponents.', credits: 60, xp: 60 },
    { id: 'bowwin', metric: 'bowWin', mode: 'sum', target: 1, desc: 'Win a match using a bow.', credits: 160, xp: 120 },
    { id: 'collect10', metric: 'resources', mode: 'sum', target: 10, desc: 'Collect 10 resources.', credits: 40, xp: 40 },
    { id: 'noheal', metric: 'noHealMatch', mode: 'sum', target: 1, desc: 'Complete a match (3+ min) without using healing items.', credits: 70, xp: 70 },
    { id: 'nocorn', metric: 'ghostWin', mode: 'sum', target: 1, desc: 'Win a match without entering the Cornucopia.', credits: 180, xp: 140 },
    { id: 'top3', metric: 'top3', mode: 'sum', target: 1, desc: 'Finish in the top three.', credits: 90, xp: 80 },
    { id: 'craft3', metric: 'craft', mode: 'sum', target: 3, desc: 'Craft 3 items.', credits: 40, xp: 40 },
    { id: 'hidden1', metric: 'hidden', mode: 'sum', target: 1, desc: 'Discover a hidden location.', credits: 50, xp: 50 },
  ];
  const WEEKLY_POOL = [
    { id: 'w_kill15', metric: 'kills', mode: 'sum', target: 15, desc: 'Eliminate 15 tributes this week.', credits: 250, xp: 250 },
    { id: 'w_win1', metric: 'wins', mode: 'sum', target: 1, desc: 'Win a match this week.', credits: 300, xp: 300, cosmetic: 'scarf:striped' },
    { id: 'w_top3x3', metric: 'top3', mode: 'sum', target: 3, desc: 'Finish top three 3 times.', credits: 250, xp: 220 },
    { id: 'w_survive', metric: 'surviveTotal', mode: 'sum', target: 3600, desc: 'Survive 60 minutes in total.', credits: 220, xp: 220 },
    { id: 'w_collect60', metric: 'resources', mode: 'sum', target: 60, desc: 'Collect 60 resources.', credits: 200, xp: 200, cosmetic: 'boots:ranger' },
    { id: 'w_craft12', metric: 'craft', mode: 'sum', target: 12, desc: 'Craft 12 items.', credits: 180, xp: 180 },
  ];
  function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function pick(pool, seed, n) { const r = rngFrom(seed), a = pool.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(r() * a.length), 1)[0]); return out; }
  function dayIndex(now) { return Math.floor((now || Date.now()) / 86400000); }
  function weekIndex(now) { return Math.floor((dayIndex(now) + 3) / 7); }
  function challengesFor(now) {
    const d = dayIndex(now), w = weekIndex(now);
    return { dayKey: 'D' + d, weekKey: 'W' + w,
      daily: pick(DAILY_POOL, d * 7919 + 13, 3).map(c => Object.assign({ period: 'D' + d }, c)),
      weekly: pick(WEEKLY_POOL, w * 104729 + 7, 2).map(c => Object.assign({ period: 'W' + w }, c)) };
  }

  /* -------------------------------------------------------------- hidden places */
  const HIDDEN_TYPES = [
    { id: 'shrine', name: 'Forgotten Shrine', credits: 25 }, { id: 'wreck', name: 'Sponsor Hovercraft Wreck', credits: 35 },
    { id: 'overlook', name: 'Eagle Overlook', credits: 20 }, { id: 'grotto', name: 'Hidden Grotto', credits: 30 }, { id: 'bunker', name: 'Old Bunker', credits: 40 },
  ];

  return { TIERS, PLACEMENT, PARTICIPATION, KILL_BONUS, BOT_KILL_FACTOR, BOT_KILL_CAP, BOT_DAILY_CAP, MIN_SURVIVE_FOR_PARTICIPATION, QUIT_PENALTY_SEC, REPEAT_VICTIM_FACTOR,
    PERKS, MAX_ADV, MAX_DIS, LEVEL_CAP, xpForLevel, levelFromXp, MATCH_XP_CAP, titleForLevel, TITLES, RARITY, COSMETICS, BY_ID, DEFAULT_APPEARANCE, SLOTS, freeIds, cleanAppearance,
    EVENT_WINDOWS, eventActive, ACHIEVEMENTS, challengesFor, DAILY_POOL, WEEKLY_POOL, HIDDEN_TYPES, dayIndex };
});
