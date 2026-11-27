/* Campaign: "THE ASHEN CROWN". Original story set in the Vael Dominion — twelve districts, the glittering capital Aurelis, and the televised Gauntlet.
   Scenes are graphs; the server replays the player's picks against the graph, so story effects can't be forged by the client. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'));
  else { root.HG = root.HG || {}; root.HG.Camp = factory(root.HG.C); }
})(typeof self !== 'undefined' ? self : globalThis, function (C) {

  const CHARS = {
    hero:    { name: 'You', per: 'strategist' },
    cassian: { name: 'Cassian Thorne', per: 'hunter', district: 1, bio: 'District 1 career tribute. Raised for the Gauntlet, proud of it.', app: { hair: 'hair:short', hairColor: 'hairColor:blonde', outfit: 'outfit:d1', jacket: 'jacket:leather' } },
    wren:    { name: 'Wren Calloway', per: 'diplomat', district: 11, bio: 'District 11 orchard-keeper. Quiet, quick, and kinder than the arena deserves.', app: { hair: 'hair:braid', hairColor: 'hairColor:auburn', outfit: 'outfit:d11' } },
    tobias:  { name: 'Tobias Finch', per: 'strategist', district: 3, bio: 'District 3 engineer. Counts everything twice. Trusts numbers more than people.', app: { hair: 'hair:curly', hairColor: 'hairColor:black', outfit: 'outfit:d3' } },
    mara:    { name: 'Mara Quill', per: 'assassin', district: 5, bio: 'District 5 lineworker. Silent, patient, deadly.', app: { hair: 'hair:ponytail', hairColor: 'hairColor:black', outfit: 'outfit:d5' } },
    hal:     { name: 'Haldane Brisk', per: 'survivor', bio: 'Your mentor. Victor of the 41st Gauntlet. Sober about half the time.' },
    lucian:  { name: 'Lucian Vale', bio: 'Host of the Gauntlet broadcast. Smiles like a blade.' },
    corvane: { name: 'President Corvane', bio: 'Ruler of the Vael Dominion.' },
    escort:  { name: 'Ismene Crowe', bio: 'Capital escort for your district.' },
  };

  /* ---- scene graphs. node: {who, text, next} | {who, text, choices:[{t, set, rel, next, req}]} | {end:true}. `set` writes flags, `rel` adds to relationships. */
  const SCENES = {
    s1_selection: { title: 'The Selection', bg: 'district', nodes: {
      start: { who: 'narr', text: 'Ash drifts over the square of your district. The whole Dominion is watching on the great screens — the Gauntlet is the one thing every district is forced to love.', next: 'n1' },
      n1: { who: 'escort', text: 'Welcome, welcome! The Capital thanks you for your service. And now — the moment we have all waited for. The girl\'s bowl first… no, the lots are drawn by chance, naturally!', next: 'n2' },
      n2: { who: 'narr', text: 'A name is read. The crowd goes quiet — not with sorrow. With relief that it is not theirs. The name is yours.', next: 'n3' },
      n3: { who: 'hero', text: 'Your legs move before your mind catches up. On the stage you can see your family in the crowd; your younger sibling is gripping the arm of a neighbour, mouth open on a scream you cannot hear.', next: 'n4' },
      n4: { who: 'escort', text: 'Remarkable! Do we have any words for the cameras, dear tribute?', choices: [
        { t: '"I will come home." (promise)', set: { vow: 'home' }, rel: { hal: 1 }, next: 'n5' },
        { t: '"Take care of them." (look at your family)', set: { vow: 'family' }, rel: { wren: 1 }, next: 'n5' },
        { t: 'Say nothing. Stare down the camera.', set: { vow: 'defy' }, rel: { cassian: 1, corvane: -1 }, next: 'n5' } ] },
      n5: { who: 'narr', text: 'The train east is sleek, silent and faster than anything your district has ever built. Out of the window the grey fields stream away. Ahead lies Aurelis.', next: 'end' },
      end: { end: true } } },

    s2_capital: { title: 'The Capital', bg: 'capital', nodes: {
      start: { who: 'narr', text: 'Aurelis. Towers of glass and gold, streets that glow at night, and crowds who treat tributes like celebrities and livestock at once.', next: 'n1' },
      n1: { who: 'hal', text: 'Eyes up. Smile when they look, stop when they don\'t. You\'re merchandise until the gong, and then you\'re a gamble. Make them bet on you.', next: 'n2' },
      n2: { who: 'narr', text: 'In the tribute atrium you meet the others. Cassian Thorne leans on a pillar, already signing autographs. Wren Calloway sits alone, peeling a fruit she brought from home. Tobias Finch is measuring the room with his steps.', next: 'n3' },
      n3: { who: 'hal', text: 'You have one evening before training. Who do you talk to?', choices: [
        { t: 'Approach Cassian — know your biggest threat.', rel: { cassian: 1 }, set: { met: 'cassian' }, next: 'c1' },
        { t: 'Sit with Wren and share her fruit.', rel: { wren: 2 }, set: { met: 'wren' }, next: 'w1' },
        { t: 'Ask Tobias what he has worked out.', rel: { tobias: 2 }, set: { met: 'tobias' }, next: 't1' } ] },
      c1: { who: 'cassian', text: 'Fresh face. Don\'t worry — I\'ll make it quick if we cross. The audience likes it when I\'m merciful.', next: 'c2' },
      c2: { who: 'hero', text: 'You hold his stare a beat too long. Behind him, Mara Quill of District 5 has stopped pretending not to listen.', next: 'n4' },
      w1: { who: 'wren', text: 'It\'s a plum. Last of the season. My grandmother says if you share a fruit with someone you owe them one day. Careful.', next: 'w2' },
      w2: { who: 'hero', text: 'She laughs — barely — and for a moment it is a kitchen table and not a stage.', next: 'n4' },
      t1: { who: 'tobias', text: 'Thirty-one cameras in this room. Eleven are not pointed at us. Those eleven are the ones that matter — they\'re for the Gamemakers.', next: 't2' },
      t2: { who: 'hero', text: 'He writes something on his palm and rubs it out again before you can read it.', next: 'n4' },
      n4: { who: 'narr', text: 'That night the stylists strip you, scrub you, and dress you as your district\'s idea of itself. Customise your tribute at the Tribute Suite — then step out to face the cameras.', next: 'n5' },
      n5: { who: 'lucian', text: 'And here is the tribute everyone is whispering about! Tell us, how are you feeling? Be honest. The Dominion loves honesty, ah-ha.', choices: [
        { t: 'Charming: play the crowd.', set: { interview: 'charm', sponsors: 2 }, rel: { lucian: 2 }, next: 'n6' },
        { t: 'Humble: speak about home.', set: { interview: 'humble', sponsors: 1 }, rel: { wren: 1 }, next: 'n6' },
        { t: 'Defiant: refuse to perform.', set: { interview: 'defy', sponsors: 0 }, rel: { corvane: -2, cassian: 1 }, next: 'n6' } ] },
      n6: { who: 'narr', text: 'The applause is thunder. Somewhere in the stands, a sponsor makes a note. Tomorrow: training.', next: 'end' },
      end: { end: true } } },

    s3_mentor: { title: 'Mentor', bg: 'training', nodes: {
      start: { who: 'hal', text: 'Three days. The Gamemakers watch what you do at training, so they decide what to throw at you. Hide everything useful — or show off and be feared. Your call.', next: 'n1' },
      n1: { who: 'hero', text: 'What do I need to learn first?', choices: [
        { t: 'How to fight.', set: { focus: 'combat' }, rel: { hal: 1 }, next: 'a' },
        { t: 'How to stay alive.', set: { focus: 'survival' }, rel: { hal: 1 }, next: 'b' },
        { t: 'How to not be seen.', set: { focus: 'stealth' }, rel: { hal: 1 }, next: 'c' } ] },
      a: { who: 'hal', text: 'Hit first, hit once, hit where it counts. Everybody has a plan until their sword gets stuck in a tree.', next: 'end' },
      b: { who: 'hal', text: 'Water, then food, then everything else. The arena kills more tributes by Day Three than blades ever will.', next: 'end' },
      c: { who: 'hal', text: 'Bushes, night, patience. The camera loves a hero — it doesn\'t love someone it can\'t find.', next: 'end' },
      end: { end: true } } },

    s4_gong: { title: 'The Gong', bg: 'arena', nodes: {
      start: { who: 'narr', text: 'You rise from beneath the earth into daylight. Twenty-odd pedestals form a ring. At the centre, the Cornucopia — a spiral horn of black iron, spilling spears, bows and bread.', next: 'n1' },
      n1: { who: 'lucian', text: 'Ladies and gentlemen of the Dominion — the Gauntlet begins in ten… nine…', next: 'n2' },
      n2: { who: 'hal', text: 'Don\'t go for the horn. Take what\'s near, run for the trees. Survive the first minute — then the rest.', next: 'end' },
      end: { end: true } } },

    s5_camp: { title: 'A Fire Without Smoke', bg: 'forest', nodes: {
      start: { who: 'narr', text: 'Day Two. Cannon shots echo — eight so far. Your hands still shake. A rustle in the ferns, and three tributes step into view, none of them armed against you.', next: 'n1' },
      n1: { who: 'wren', text: 'We saw the mutt tracks. If we stay apart we\'re bait. Together we\'re… a smaller bait.', next: 'n2' },
      n2: { who: 'tobias', text: 'Statistically alliances of two survive twenty-six percent longer. Statistically.', next: 'n3' },
      n3: { who: 'cassian', text: 'I could use someone who doesn\'t flinch. Come with me and we eat well. Say no and I\'ll remember it.', choices: [
        { t: 'Ally with Wren.', set: { ally: 'wren' }, rel: { wren: 3 }, next: 'end' },
        { t: 'Ally with Tobias.', set: { ally: 'tobias' }, rel: { tobias: 3 }, next: 'end' },
        { t: 'Ally with Cassian.', set: { ally: 'cassian' }, rel: { cassian: 3, wren: -1, tobias: -1 }, next: 'end' },
        { t: 'Trust no one. Go alone.', set: { ally: 'none' }, rel: { hal: 1 }, next: 'end' } ] },
      end: { end: true } } },

    s6_trust: { title: 'The Long Night', bg: 'night', nodes: {
      start: { who: 'narr', text: 'The fire is a bed of embers. The Capital\'s sky-screens drift past: faces of the fallen, one by one. You keep count. Eight, nine, ten.', next: 'n1' },
      n1: { who: 'narr', text: 'One loaf of bread remains between you and the others. Your stomach has been arguing with you all evening.', choices: [
        { t: 'Split it evenly.', set: { shared: 'even' }, rel: { ally: 2 }, next: 'end' },
        { t: 'Give your ally the larger share.', set: { shared: 'gave' }, rel: { ally: 3 }, next: 'end' },
        { t: 'Keep the larger share. Strength matters.', set: { shared: 'kept' }, rel: { ally: -2 }, next: 'end' } ] },
      end: { end: true } } },

    s6_after: { title: 'What Was Done', bg: 'night', nodes: {
      start: { who: 'narr', text: 'The betrayal came from the one hand you had learned to rely on. In the silence afterward you realise the Capital was watching for exactly this moment — and wagering on it.', next: 'n1' },
      n1: { who: 'lucian', text: '(voice from the sky, amplified) A heartbreaking turn, folks! Who do you think survives the night?', next: 'n2' },
      n2: { who: 'hero', text: 'What do you do with the one who betrayed you?', choices: [
        { t: 'Forgive. The arena already took enough.', set: { betrayer: 'forgiven' }, rel: { betrayer: 3, hal: 1 }, next: 'end' },
        { t: 'Leave them. Walk away and never look back.', set: { betrayer: 'left' }, next: 'end' },
        { t: 'Make them pay.', set: { betrayer: 'revenge' }, rel: { cassian: 1, betrayer: -3 }, next: 'end' } ] },
      end: { end: true } } },

    s7_final: { title: 'The Rule Changes', bg: 'arena', nodes: {
      start: { who: 'lucian', text: 'Citizens of the Dominion! A twist! Tonight the Gamemakers have decided that two victors may emerge — if they come from the same district!', next: 'n1' },
      n1: { who: 'narr', text: 'The cannon-fire of the day dies. Somewhere in the dark another tribute heard that announcement too. A hope the Capital hands out like a dropped coin — to be taken away.', next: 'n2' },
      n2: { who: 'hero', text: 'You feel the old fear: they are rewriting the rules to make you choose.', choices: [
        { t: 'Look for your closest ally.', set: { seekAlly: true }, next: 'end' },
        { t: 'Ignore the broadcast. Press on alone.', set: { seekAlly: false }, next: 'end' } ] },
      end: { end: true } } },

    s8_choice: { title: 'The Last Two', bg: 'arena', nodes: {
      start: { who: 'narr', text: 'The rule is rescinded as swiftly as it was promised: only one victor. The Dominion needs a single face for its poster. The last other tribute stands thirty paces away, breathing hard.', next: 'n1' },
      n1: { who: 'corvane', text: '(a cold voice over the speakers) Ladies and gentlemen — this is the moment. Let the Dominion see what a tribute is made of.', next: 'n2' },
      n2: { who: 'hero', text: 'In your hand: a blade, a pouch of nightlock berries, a lifetime of choices. What is your move?', choices: [
        { t: 'Fight. Win this, and go home.', set: { final: 'fight' }, next: 'end' },
        { t: 'Raise the berries. Refuse to perform for them.', set: { final: 'refuse' }, rel: { corvane: -3 }, next: 'end' },
        { t: 'Lay down your weapon so the other can live. (requires a strong bond)', set: { final: 'sacrifice' }, req: { relAlly: 3 }, next: 'end' },
        { t: 'Propose a pact — both walk out, or neither does.', set: { final: 'pact' }, req: { relAlly: 4 }, next: 'end' } ] },
      end: { end: true } } },
  };

  /* ---- missions. objective types match Sim.updateObjectives. */
  const D = C.DIFFICULTY;
  const MISSIONS = {
    m1_selection: { ch: 1, title: 'The Selection', type: 'scene', scene: 's1_selection', req: [], reward: 100, xp: 60, brief: 'You have been chosen.' },
    m2_capital:   { ch: 2, title: 'Aurelis', type: 'scene', scene: 's2_capital', req: ['m1_selection'], reward: 100, xp: 60, brief: 'Meet the tributes, dress for the cameras.', customize: true },
    m3_mentor:    { ch: 3, title: 'Mentor', type: 'scene', scene: 's3_mentor', req: ['m2_capital'], reward: 100, xp: 40, brief: 'Prepare for training.' },
    m3_weapons:   { ch: 3, title: 'Training: Weapons', type: 'arena', req: ['m3_mentor'], reward: 100, xp: 70, brief: 'Hit all five practice dummies using any weapon from the rack.', replay: true,
      env: { seed: 7741, noZone: true, noEvents: true, noWildlife: true, noCountdown: true, timeLimit: 240, spawn: { x: 40, z: 10 } },
      give: [{ id: 'sword', n: 1 }, { id: 'bow', n: 1 }, { id: 'arrow', n: 12 }],
      dummies: [{ dx: 10, dz: -6 }, { dx: 14, dz: 2 }, { dx: 18, dz: -4 }, { dx: 22, dz: 4 }, { dx: 26, dz: -2 }],
      objectives: [{ id: 'd', type: 'dummies', text: 'Defeat the 5 practice dummies', total: 5 }, { id: 'f', type: 'kills', text: 'Optional: finish with a bow elimination of a dummy', n: 1, cls: 'bow', optional: true }] },
    m3_survival:  { ch: 3, title: 'Training: Survival', type: 'arena', req: ['m3_mentor'], reward: 100, xp: 70, brief: 'Gather 8 resources and craft two items before the horn.', replay: true,
      env: { seed: 7742, noZone: true, noEvents: true, noWildlife: true, noCountdown: true, timeLimit: 300, spawn: { x: 60, z: 40 } },
      give: [], objectives: [{ id: 'c', type: 'collect', text: 'Collect 8 resources', n: 8 }, { id: 'k', type: 'craft', text: 'Craft 2 items', n: 2 }, { id: 'h', type: 'hidden', text: 'Optional: discover a hidden location', n: 1, optional: true }] },
    m3_stealth:   { ch: 3, title: 'Training: Stealth', type: 'arena', req: ['m3_mentor'], reward: 120, xp: 80, brief: 'Cross the training grounds past the sentries and reach the beacon.', replay: true,
      env: { seed: 7743, noZone: true, noEvents: true, noWildlife: true, noCountdown: true, timeLimit: 300, spawn: { x: 70, z: -60 } }, reachFromSpawn: { dist: 130 },
      bots: [{ name: 'Sentry A', per: 'assassin', diffOverride: 'easy', near: 'reach', n: 2 }], noBotsAggressiveStart: true,
      objectives: [{ id: 'r', type: 'reach', text: 'Reach the beacon', r: 6 }, { id: 'k', type: 'noheal', text: 'Optional: no healing used', seconds: 60, optional: true }] },
    m3_combat:    { ch: 3, title: 'Training: Sparring', type: 'arena', req: ['m3_mentor'], reward: 130, xp: 90, brief: 'Defeat Cassian Thorne in the sparring ring.', replay: true, diff: true,
      env: { seed: 7744, noZone: true, noEvents: true, noWildlife: true, noCountdown: true, timeLimit: 300, spawn: { x: 45, z: 20 } },
      give: [{ id: 'sword', n: 1 }, { id: 'armor_light', n: 1 }],
      bots: [{ char: 'cassian', tag: 'cassian', give: [{ id: 'sword', n: 1 }], near: 'spawn', dx: 22, dz: 0 }],
      objectives: [{ id: 'k', type: 'killTarget', text: 'Defeat Cassian Thorne', tag: 'cassian' }] },
    m4_gong:      { ch: 4, title: 'The Gong', type: 'scene', scene: 's4_gong', req: ['m3_weapons', 'm3_survival', 'm3_stealth', 'm3_combat'], reward: 60, xp: 30, brief: 'Rise into the arena.' },
    m4_arena:     { ch: 4, title: 'The Arena', type: 'arena', req: ['m4_gong'], reward: 150, xp: 140, brief: 'Survive the bloodbath and reach the top 8.', replay: true, diff: true,
      env: { seed: 4001, timeLimit: 1200 }, fill: 15, mix: ['hunter', 'berserker', 'survivor', 'opportunist', 'strategist', 'assassin', 'diplomat'],
      bots: [{ char: 'cassian', tag: 'cassian' }, { char: 'wren', tag: 'wren' }, { char: 'tobias', tag: 'tobias' }, { char: 'mara', tag: 'mara' }],
      objectives: [{ id: 'a', type: 'top', text: 'Be among the last 8 tributes', n: 8 }, { id: 'k', type: 'kills', text: 'Optional: eliminate 2 tributes', n: 2, optional: true }, { id: 'h', type: 'hidden', text: 'Optional: discover a hidden location', n: 1, optional: true }] },
    m5_camp:      { ch: 5, title: 'A Fire Without Smoke', type: 'scene', scene: 's5_camp', req: ['m4_arena'], reward: 80, xp: 50, brief: 'Decide who to trust.' },
    m5_alliance:  { ch: 5, title: 'Alliances', type: 'arena', req: ['m5_camp'], reward: 170, xp: 160, brief: 'With your ally, reach the old bunker site on the far ridge, alive.', replay: true, diff: true,
      env: { seed: 4002, timeLimit: 1200 }, fill: 11, mix: ['hunter', 'berserker', 'opportunist', 'assassin', 'survivor'], bots: [{ char: 'cassian', tag: 'cassian', ifNotAlly: 'cassian' }, { char: 'ally', tag: 'ally', alliance: true }, { char: 'mara', tag: 'mara' }],
      objectives: [{ id: 'a', type: 'top', text: 'Be among the last 6 tributes', n: 6 }, { id: 'p', type: 'protect', text: 'Keep your ally alive', tag: 'ally', optionalIfNone: true }, { id: 'c', type: 'collect', text: 'Optional: collect 10 resources', n: 10, optional: true }] },
    m6_trust:     { ch: 6, title: 'The Long Night', type: 'scene', scene: 's6_trust', req: ['m5_alliance'], reward: 60, xp: 40, brief: 'A quiet moment before everything changes.' },
    m6_betrayal:  { ch: 6, title: 'The Betrayal', type: 'arena', req: ['m6_trust'], reward: 200, xp: 200, brief: 'Your alliance collapses. Survive the Capital\'s fire and reach the top 5.', replay: true, diff: true,
      env: { seed: 4003, timeLimit: 1200 }, fill: 9, mix: ['hunter', 'berserker', 'opportunist', 'assassin'], bots: [{ char: 'cassian', tag: 'cassian', ifNotAlly: 'cassian' }, { char: 'ally', tag: 'ally', alliance: true }, { char: 'mara', tag: 'mara' }],
      script: [{ at: 150, op: 'announce', m: 'THE CAPITAL SETS THE FOREST ALIGHT' }, { at: 150, op: 'event', k: 'fire' }, { at: 170, op: 'betray', tag: 'ally' }, { at: 260, op: 'event', k: 'fog' }],
      objectives: [{ id: 'a', type: 'top', text: 'Be among the last 5 tributes', n: 5 }, { id: 'k', type: 'killTarget', text: 'Optional: defeat the traitor', tag: 'ally', optional: true }] },
    m6_after:     { ch: 6, title: 'What Was Done', type: 'scene', scene: 's6_after', req: ['m6_betrayal'], reward: 70, xp: 40, brief: 'Decide the traitor\'s fate.', unlock: 'ch6_done' },
    m7_final:     { ch: 7, title: 'The Rule Changes', type: 'scene', scene: 's7_final', req: ['m6_after'], reward: 60, xp: 40, brief: 'The Capital rewrites the rules.' },
    m7_tributes:  { ch: 7, title: 'The Final Tributes', type: 'arena', req: ['m7_final'], reward: 240, xp: 240, brief: 'Survive until only two tributes remain.', replay: true, diff: true,
      env: { seed: 4004, timeLimit: 1500 }, fill: 4, mix: ['hunter', 'berserker', 'assassin'], bots: [{ char: 'cassian', tag: 'cassian', ifNotAlly: 'cassian' }, { char: 'ally', tag: 'ally', alliance: true, ifFlagNot: { betrayer: 'revenge' } }, { char: 'mara', tag: 'mara' }],
      script: [{ at: 90, op: 'event', k: 'storm' }, { at: 200, op: 'event', k: 'fog' }, { at: 320, op: 'event', k: 'flood' }],
      objectives: [{ id: 'a', type: 'top', text: 'Be among the last 2 tributes', n: 2 }, { id: 'k', type: 'kills', text: 'Optional: eliminate 2 tributes', n: 2, optional: true }, { id: 'n', type: 'noheal', text: 'Optional: no healing for 3 minutes', seconds: 180, optional: true }] },
    m8_choice:    { ch: 8, title: 'The Last Two', type: 'scene', scene: 's8_choice', req: ['m7_tributes'], reward: 100, xp: 80, brief: 'The final decision.', final: true },
    m8_duel:      { ch: 8, title: 'The Duel', type: 'arena', req: ['m8_choice'], reward: 300, xp: 300, brief: 'Win the final duel.', replay: true, diff: true, onlyIf: { final: 'fight' },
      env: { seed: 4005, timeLimit: 600, zoneFast: true }, fill: 0, bots: [{ char: 'rival', tag: 'rival' }], objectives: [{ id: 'w', type: 'win', text: 'Be the last tribute standing' }] },
  };

  const CHAPTERS = [
    { n: 1, title: 'The Selection', blurb: 'Your name is drawn. Your life is no longer yours.' },
    { n: 2, title: 'The Capital', blurb: 'Gilded streets, hungry cameras, and the first alliances of the night.' },
    { n: 3, title: 'Training', blurb: 'Three days to learn how to survive. Every Gamemaker is watching.' },
    { n: 4, title: 'The Arena', blurb: 'The gong sounds. The forest is full of strangers.' },
    { n: 5, title: 'Alliances', blurb: 'Who will you trust when trust is the most dangerous weapon of all?' },
    { n: 6, title: 'The Betrayal', blurb: 'An alliance collapses and the arena itself turns on you.' },
    { n: 7, title: 'The Final Tributes', blurb: 'Hunger, fire, flood — and the last few who remain.' },
    { n: 8, title: 'The Victory', blurb: 'One tribute. Many endings.' },
  ];

  const ENDINGS = {
    victor:    { id: 'victor', title: 'VICTOR OF THE GAUNTLET', unlock: 'ending_victor', credits: 500, text: 'You win. The crown of ash is lowered onto your head. The Dominion cheers as you are lifted into the Capital\'s golden light — and you understand, in the quiet of the victory banquet, that the Gauntlet never lets its victors leave. Home is a promise the Capital will never let you keep.' },
    defiance:  { id: 'defiance', title: 'THE ASHEN DEFIANCE', unlock: 'ending_defiance', credits: 600, text: 'You raise the berries, and the arena falls silent. For the first time in forty-one Gauntlets the broadcast cuts to static. In districts across the Dominion, people who watched in silence begin to speak. The fire you lit will be called a rebellion by the Capital — and a beginning by everyone else.' },
    sacrifice: { id: 'sacrifice', title: 'THE LAST GIFT', unlock: 'ending_sacrifice', credits: 450, text: 'You lower your weapon and the bond between you carries the weight the Capital cannot. Your ally lives, carrying your name home — and your district hears of what you did. They will remember you long after the Dominion has forgotten the winner.' },
    pact:      { id: 'pact', title: 'THE PACT', unlock: 'ending_pact', credits: 550, text: 'Neither of you will kill. The Gamemakers hesitate, their broadcast flickering — and rather than see two corpses and no victor, they let the pact stand. The Dominion calls it a trick. The districts call it hope.' },
    fallen:    { id: 'fallen', title: 'THE FALLEN', unlock: null, credits: 0, text: 'The final blow falls, and it is not yours. Your cannon sounds across the arena. In your district they hold a quiet vigil. Perhaps another tribute, another year, another try.' },
  };

  function resolveEnding(flags, duelWon) {
    const f = flags.final;
    if (f === 'refuse') return 'defiance';
    if (f === 'sacrifice') return 'sacrifice';
    if (f === 'pact') return 'pact';
    if (f === 'fight') return duelWon ? 'victor' : 'fallen';
    return null;
  }

  function relOf(prof, who) { return (prof.relations && prof.relations[who]) || 0; }
  /* Walk a scene with the player's picks (array of choice indexes). Returns {ok, flags, rel, nodes}. */
  function walkScene(sceneId, picks, ctx) {
    const sc = SCENES[sceneId]; if (!sc) return { ok: false };
    let id = 'start', pi = 0; const flags = {}, rel = {}; let guard = 0;
    while (guard++ < 200) {
      const n = sc.nodes[id]; if (!n) return { ok: false };
      if (n.end) return { ok: pi === (picks || []).length, flags, rel };
      if (n.choices) {
        const avail = n.choices.map((c, i) => [c, i]).filter(([c]) => !c.req || !c.req.relAlly || ctx.allyRel >= c.req.relAlly);
        const want = (picks || [])[pi++]; const hit = avail.find(([, i]) => i === want); if (!hit) return { ok: false };
        const c = hit[0]; if (c.set) Object.assign(flags, c.set);
        if (c.rel) for (const k in c.rel) { const who = k === 'ally' ? (ctx.flags.ally && ctx.flags.ally !== 'none' ? ctx.flags.ally : null) : k === 'betrayer' ? (ctx.flags.ally && ctx.flags.ally !== 'none' ? ctx.flags.ally : null) : k; if (who) rel[who] = (rel[who] || 0) + c.rel[k]; }
        id = c.next;
      } else id = n.next;
    }
    return { ok: false };
  }

  function missionOrder() { return Object.keys(MISSIONS); }
  function available(m, prog, flags) {
    const mi = MISSIONS[m]; if (!mi) return false;
    if (mi.onlyIf) for (const k in mi.onlyIf) if (flags[k] !== mi.onlyIf[k]) return false;
    return mi.req.every(r => prog[r] && prog[r].done);
  }
  const DIFF_REWARD = { easy: 0.7, normal: 1, hard: 1.4, nightmare: 1.9 };
  function missionReward(mi, diff, first) {
    const base = mi.reward * (mi.diff ? DIFF_REWARD[diff] || 1 : 1);
    return Math.round(first ? base : base * 0.25);
  }

  return { CHARS, SCENES, MISSIONS, CHAPTERS, ENDINGS, resolveEnding, walkScene, missionOrder, available, missionReward, relOf, DIFF_REWARD };
});
