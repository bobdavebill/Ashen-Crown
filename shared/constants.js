/* Shared gameplay constants — loaded by Node (require) and by the browser (window.HG.C). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.HG = root.HG || {}; root.HG.C = api; }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const TICK = 30;                 // simulation ticks / second
  const SNAP_EVERY = 2;            // snapshot every N ticks (15 Hz)
  const DT = 1 / TICK;

  const WORLD = {
    size: 1000,          // terrain square edge
    radius: 470,         // hard play boundary
    zoneStart: 440,      // initial safe-zone radius
    waterLevel: -0.55,
  };

  const PLAYER = {
    radius: 0.45, height: 1.8, crouchHeight: 1.25, eye: 1.62, crouchEye: 1.1,
    walk: 5.2, sprint: 8.6, crouch: 2.5, aimMul: 0.72, waterMul: 0.62,
    accel: 46, airAccel: 9, jump: 7.6, gravity: 24,
    maxHp: 100, maxStamina: 100, sprintCost: 17, staminaRegen: 15, staminaDelay: 0.8, jumpCost: 9,
    hungerDrain: 0.12, thirstDrain: 0.18, starveDps: 1.2,
    pickupRange: 2.7,
  };

  /* ------------------------------------------------------------------ weapons */
  const WEAPONS = {
    fists:       { id: 'fists', name: 'Fists', type: 'melee', dmg: 6, range: 1.6, cd: 0.5, dur: 0, arc: 0.9 },
    knife_crude: { id: 'knife_crude', name: 'Crude Knife', type: 'melee', dmg: 12, range: 1.8, cd: 0.45, dur: 50, arc: 0.9,
                   backstab: 1.6, throw: { dmg: 14, speed: 30, gravity: 14 } },
    knife:       { id: 'knife', name: 'Hunting Knife', type: 'melee', dmg: 21, range: 1.9, cd: 0.36, dur: 90, arc: 0.9,
                   backstab: 2.0, throw: { dmg: 28, speed: 38, gravity: 12 } },
    sword:       { id: 'sword', name: 'Sword', type: 'melee', dmg: 34, range: 2.5, cd: 0.72, dur: 110, arc: 1.1 },
    spear:       { id: 'spear', name: 'Spear', type: 'melee', dmg: 29, range: 3.4, cd: 0.85, dur: 80, arc: 0.55,
                   throw: { dmg: 48, speed: 34, gravity: 14 } },
    axe:         { id: 'axe', name: 'Axe', type: 'melee', dmg: 41, range: 2.2, cd: 1.0, dur: 100, arc: 1.2,
                   throw: { dmg: 33, speed: 28, gravity: 17 } },
    bow:         { id: 'bow', name: 'Hunting Bow', type: 'ranged', ammo: 'arrow', dmg: 34, speed: 58, gravity: 9.8, cd: 0.55,
                   reload: 0.7, mag: 1, spread: 2.4, aimSpread: 0.45, dur: 130 },
    crossbow:    { id: 'crossbow', name: 'Crossbow', type: 'ranged', ammo: 'bolt', dmg: 58, speed: 96, gravity: 6, cd: 0.4,
                   reload: 2.4, mag: 1, spread: 1.3, aimSpread: 0.2, dur: 120 },
  };
  const WEAPON_CLASS = {   // used for Weapon Training perk + challenges
    fists: 'melee', knife_crude: 'blade', knife: 'blade', sword: 'blade', spear: 'polearm', axe: 'axe', bow: 'bow', crossbow: 'crossbow',
  };

  /* -------------------------------------------------------------------- items */
  const ITEMS = {};
  for (const w of Object.values(WEAPONS)) if (w.id !== 'fists') ITEMS[w.id] = { id: w.id, name: w.name, type: 'weapon', stack: 1, dur: w.dur, icon: '⚔' };
  Object.assign(ITEMS, {
    arrow:        { id: 'arrow', name: 'Arrows', type: 'ammo', stack: 30, icon: '➶' },
    bolt:         { id: 'bolt', name: 'Crossbow Bolts', type: 'ammo', stack: 24, icon: '➴' },
    berries:      { id: 'berries', name: 'Wild Berries', type: 'food', stack: 6, hunger: 18, use: 1.0, icon: '🫐' },
    bread:        { id: 'bread', name: 'District Bread', type: 'food', stack: 4, hunger: 34, use: 1.4, icon: '🍞' },
    ration:       { id: 'ration', name: 'Capitol Ration', type: 'food', stack: 3, hunger: 55, thirst: 8, use: 1.8, icon: '🥫' },
    water_bottle: { id: 'water_bottle', name: 'Water Bottle', type: 'water', stack: 4, thirst: 38, use: 1.2, icon: '💧' },
    bandage:      { id: 'bandage', name: 'Bandage', type: 'med', stack: 5, heal: 18, use: 1.5, icon: '🩹' },
    medkit:       { id: 'medkit', name: 'Medical Kit', type: 'med', stack: 2, heal: 65, use: 3.2, icon: '✚' },
    armor_light:  { id: 'armor_light', name: 'Leather Vest', type: 'armor', stack: 1, red: 0.15, dur: 60, icon: '🛡' },
    armor_heavy:  { id: 'armor_heavy', name: 'Plated Armor', type: 'armor', stack: 1, red: 0.30, dur: 90, icon: '🛡' },
    stick:        { id: 'stick', name: 'Sticks', type: 'mat', stack: 12, icon: '🪵' },
    rope:         { id: 'rope', name: 'Rope', type: 'mat', stack: 6, icon: '🪢' },
    stone:        { id: 'stone', name: 'Stones', type: 'mat', stack: 8, icon: '🪨' },
    cloth:        { id: 'cloth', name: 'Cloth', type: 'mat', stack: 8, icon: '🧵' },
    trap_snare:   { id: 'trap_snare', name: 'Snare Trap', type: 'trap', stack: 3, icon: '⭕' },
    trap_spike:   { id: 'trap_spike', name: 'Spike Trap', type: 'trap', stack: 2, icon: '✹' },
  });

  const RECIPES = [
    { id: 'arrows', name: 'Arrows ×4', out: { id: 'arrow', n: 4 }, needs: { stick: 2, stone: 1 } },
    { id: 'bolts', name: 'Bolts ×3', out: { id: 'bolt', n: 3 }, needs: { stick: 2, stone: 2 } },
    { id: 'bandage', name: 'Bandage', out: { id: 'bandage', n: 1 }, needs: { cloth: 2 } },
    { id: 'snare', name: 'Snare Trap', out: { id: 'trap_snare', n: 1 }, needs: { rope: 1, stick: 2 } },
    { id: 'spike', name: 'Spike Trap', out: { id: 'trap_spike', n: 1 }, needs: { stick: 3, stone: 2, rope: 1 } },
    { id: 'spear', name: 'Spear', out: { id: 'spear', n: 1 }, needs: { stick: 3, stone: 1, rope: 1 } },
    { id: 'knife', name: 'Crude Knife', out: { id: 'knife_crude', n: 1 }, needs: { stone: 2, stick: 1 } },
    { id: 'bow', name: 'Makeshift Bow', out: { id: 'bow', n: 1 }, needs: { stick: 3, rope: 2 }, dur: 0.6 },
    { id: 'vest', name: 'Cloth Vest', out: { id: 'armor_light', n: 1 }, needs: { cloth: 4, rope: 1 }, dur: 0.6 },
  ];

  /* loot tables: [item, weight, min, max] */
  const LOOT = {
    1: [['stick', 14, 2, 4], ['stone', 10, 1, 3], ['cloth', 8, 1, 3], ['rope', 6, 1, 2], ['berries', 10, 2, 4], ['water_bottle', 8, 1, 2],
        ['bandage', 6, 1, 2], ['knife_crude', 5, 1, 1], ['arrow', 3, 3, 6], ['bread', 3, 1, 1]],
    2: [['knife', 8, 1, 1], ['spear', 7, 1, 1], ['axe', 5, 1, 1], ['bow', 7, 1, 1], ['arrow', 9, 5, 10], ['bread', 8, 1, 2], ['water_bottle', 7, 1, 2],
        ['armor_light', 6, 1, 1], ['trap_snare', 6, 1, 2], ['trap_spike', 4, 1, 1], ['bandage', 8, 1, 3], ['rope', 5, 1, 2], ['cloth', 5, 2, 3]],
    3: [['sword', 9, 1, 1], ['bow', 9, 1, 1], ['arrow', 12, 8, 14], ['crossbow', 4, 1, 1], ['bolt', 6, 4, 8], ['axe', 7, 1, 1], ['spear', 7, 1, 1],
        ['armor_light', 6, 1, 1], ['armor_heavy', 3, 1, 1], ['medkit', 5, 1, 1], ['bandage', 6, 2, 3], ['ration', 6, 1, 2], ['water_bottle', 7, 2, 3],
        ['trap_spike', 5, 1, 2], ['trap_snare', 5, 1, 2], ['knife', 6, 1, 1]],
    4: [['crossbow', 10, 1, 1], ['bolt', 12, 6, 10], ['armor_heavy', 10, 1, 1], ['medkit', 12, 1, 2], ['ration', 10, 2, 3], ['sword', 8, 1, 1],
        ['arrow', 8, 10, 16], ['bandage', 6, 3, 4], ['trap_spike', 6, 2, 2]],
  };

  /* --------------------------------------------------------------- arena rules */
  // each phase: wait (zone stays), shrink (seconds), r (target radius), dps (outside damage/s)
  const ZONE_PHASES = [
    { wait: 80, shrink: 55, r: 320, dps: 1.2 },
    { wait: 60, shrink: 45, r: 215, dps: 2.2 },
    { wait: 50, shrink: 40, r: 125, dps: 3.8 },
    { wait: 40, shrink: 35, r: 60, dps: 6 },
    { wait: 30, shrink: 30, r: 14, dps: 9 },
  ];
  const COUNTDOWN = 12;           // seconds before the gong
  const GRACE = 60;               // reconnect grace (seconds)

  const EVENTS = {
    fog:      { name: 'Poison Fog', dps: 3.5, r: 38, dur: 55, color: '#9bd45c', warn: 8 },
    fire:     { name: 'Wildfire', dps: 7, r: 30, dur: 42, color: '#ff6a1f', warn: 8 },
    storm:    { name: 'Lightning Storm', dps: 0, r: 0, dur: 50, color: '#9fb4ff', warn: 6 },
    mutts:    { name: 'Mutt Pack Released', dps: 0, r: 0, dur: 0, color: '#c33', warn: 5 },
    drop:     { name: 'Sponsor Supply Drop', dps: 0, r: 0, dur: 0, color: '#ffd24a', warn: 10 },
    flood:    { name: 'Flash Flood', dps: 4, r: 55, dur: 35, color: '#4aa3ff', warn: 8 },
  };

  const WILDLIFE = { mutt: { hp: 45, dmg: 9, speed: 7.2, aggro: 24, leash: 55, cd: 0.9, radius: 0.6 } };

  const MODES = {
    solo:     { id: 'solo', name: 'Solo Survival', teamSize: 1 },
    duos:     { id: 'duos', name: 'Duos', teamSize: 2 },
    teams:    { id: 'teams', name: 'Teams (3v3…)', teamSize: 3 },
    private:  { id: 'private', name: 'Private Game', teamSize: 1 },
    practice: { id: 'practice', name: 'Practice', teamSize: 1 },
    campaign: { id: 'campaign', name: 'Campaign', teamSize: 1 },
  };

  const DIFFICULTY = {
    easy:      { id: 'easy',      name: 'Easy',      react: 0.85, aim: 7.0, think: 1.4, loot: 0.55, tactics: 0.25, rewardMul: 0.6 },
    normal:    { id: 'normal',    name: 'Normal',    react: 0.50, aim: 4.2, think: 0.9, loot: 0.75, tactics: 0.55, rewardMul: 1.0 },
    hard:      { id: 'hard',      name: 'Hard',      react: 0.28, aim: 2.3, think: 0.55, loot: 0.9, tactics: 0.8, rewardMul: 1.25 },
    nightmare: { id: 'nightmare', name: 'Nightmare', react: 0.14, aim: 1.2, think: 0.3, loot: 1.0, tactics: 1.0, rewardMul: 1.5 },
  };

  const PERSONALITIES = {
    hunter:      { id: 'hunter', name: 'The Hunter', aggr: 0.9, caution: 0.25, stealth: 0.2, social: 0.2, loot: 0.5, trap: 0.2, fleeHp: 0.2 },
    survivor:    { id: 'survivor', name: 'The Survivor', aggr: 0.2, caution: 0.9, stealth: 0.6, social: 0.4, loot: 0.8, trap: 0.4, fleeHp: 0.6 },
    strategist:  { id: 'strategist', name: 'The Strategist', aggr: 0.5, caution: 0.65, stealth: 0.4, social: 0.5, loot: 1.0, trap: 0.7, fleeHp: 0.4 },
    assassin:    { id: 'assassin', name: 'The Assassin', aggr: 0.6, caution: 0.6, stealth: 1.0, social: 0.1, loot: 0.5, trap: 0.3, fleeHp: 0.35 },
    opportunist: { id: 'opportunist', name: 'The Opportunist', aggr: 0.45, caution: 0.7, stealth: 0.5, social: 0.3, loot: 0.7, trap: 0.5, fleeHp: 0.4 },
    diplomat:    { id: 'diplomat', name: 'The Diplomat', aggr: 0.35, caution: 0.6, stealth: 0.3, social: 1.0, loot: 0.7, trap: 0.3, fleeHp: 0.45 },
    berserker:   { id: 'berserker', name: 'The Berserker', aggr: 1.0, caution: 0.05, stealth: 0.0, social: 0.1, loot: 0.3, trap: 0.1, fleeHp: 0.0 },
  };

  const BOT_NAMES = [
    'Kael Brandt', 'Sable Rourke', 'Mira Oakes', 'Tobias Finch', 'Ivo Marsh', 'Wren Calloway', 'Dax Holloway', 'Juno Pike', 'Orin Vask',
    'Lyra Thorne', 'Bram Keller', 'Nessa Coil', 'Corvin Ash', 'Tamsin Reed', 'Rook Dalen', 'Elsin Voss', 'Hale Mercer', 'Petra Lund',
    'Gideon Cray', 'Iris Fenwick', 'Marek Stone', 'Sorrel Quick', 'Anselm Birch', 'Dara Quill', 'Fenn Archer', 'Odessa Rue', 'Cato Ridge',
    'Maren Wick', 'Teodor Blaze', 'Yara Lowe', 'Silas Gorse', 'Briar Hale', 'Quin Alder', 'Nova Pell', 'Jasper Knoll', 'Rhea Dunmore',
  ];

  const MAX_PLAYERS = 24;
  const SPECTATE_RETAIN = 3600;

  return { TICK, SNAP_EVERY, DT, WORLD, PLAYER, WEAPONS, WEAPON_CLASS, ITEMS, RECIPES, LOOT, ZONE_PHASES, COUNTDOWN, GRACE, EVENTS, WILDLIFE,
           MODES, DIFFICULTY, PERSONALITIES, BOT_NAMES, MAX_PLAYERS, SPECTATE_RETAIN };
});
