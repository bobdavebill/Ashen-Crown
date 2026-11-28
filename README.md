# THE ASHEN CROWN — 3D Tribute Battle Royale

A browser-based 3D survival battle royale (original setting, inspired by the atmosphere of dystopian arena survival stories): a forest arena with a central Cornucopia, a shrinking zone, hazards, wildlife, loot, crafting, bots with personalities, an 8-chapter campaign, an earn-only credits economy, cosmetics, challenges and persistent accounts.

## Quickest start (no install)
Double-click `client/index.html` → **Play offline** → Practice vs AI. Needs nothing but a modern browser.

## Online play (needs Node.js, not npm)
Install Node.js (LTS) from https://nodejs.org, then double-click `start-server.bat` (Windows) or run `./start-server.sh`, and open http://localhost:3000. The one dependency (`ws`) is already bundled in `node_modules/`, so `npm install` is not needed.

## Run it (with npm)
```bash
npm install        # installs "ws" (the only dependency)
npm start          # http://localhost:3000   (PORT=8080 npm start to change)
npm test           # end-to-end server test: real WebSocket clients, a bot match, economy checks
```
Three.js r160 is vendored in `client/vendor/` so the game needs no CDN. Fonts are optional (Google Fonts, falls back to system serif/sans).

## Playing with friends over the internet
Run the server on any machine reachable from the internet (a VPS, or a PaaS such as Render/Fly/Railway — they provide HTTPS and set `PORT`).
Everyone opens the server's URL. One player uses **CREATE GAME**, shares the 5-letter room code, friends use **JOIN GAME**. Or use **MULTIPLAYER → FIND MATCH** for public matchmaking (empty slots fill with AI so a match always starts).
Behind a reverse proxy (nginx/Caddy) forward the `/ws` path with WebSocket upgrade headers; the client automatically uses `wss://` on HTTPS.

## Controls
**Phones/tablets (landscape):** left thumb drag = move (push to the edge to sprint) · right side drag = look · ATTACK/SHOOT (hold) · AIM (toggle; aim + THROW throws a held spear/axe/knife) · JUMP / CROUCH / RELOAD / PICK UP · BAG = inventory (tap a slot, then USE / MOVE / DROP) · tap a hotbar slot to equip · ALLY · tap the minimap to enlarge · MENU (emote, break alliance, fullscreen). Touch mode switches on automatically on touch-first devices (add `?touch=1` to the URL to force it). Graphics default to Low on phones.

**Crosshair:** dot for melee · four spread ticks for bow/crossbow (they widen when you move or sprint, tighten when aiming/crouching, and go red when the weapon is empty) · ring when aiming a throwable weapon. Shots are fired along the camera's line of sight, so arrows land on the crosshair.

**Desktop:**
WASD move · Mouse look · LMB attack/shoot · RMB aim · Shift sprint · Space jump · C crouch · E pick up/interact · R reload · Tab inventory (drag to rearrange, right-click drop, double-click use/equip, crafting panel) · 1-9 hotbar · Esc menu.

## What is implemented
| Area | Notes |
|---|---|
| World | Procedural terrain from a seed (shared client/server), instanced forest/grass/rocks, rivers & lakes, Cornucopia, ruins, caves, hidden locations, day/night, fog, rain/storms/lightning, shadows |
| Combat | Bow, crossbow, sword, spear, axe, knife, thrown weapons, traps; real projectile physics with gravity; server-side hit detection, damage, durability, reload, accuracy/spread |
| Survival | Health, stamina, hunger, thirst, bleeding, armour, loot, 12-slot inventory, crafting, shrinking zone, hazards (fire/storm/flood/fog), supply drops, wildlife (mutts), rare-loot areas |
| Multiplayer | Authoritative server at 20 Hz, client prediction + reconciliation, interpolation, server-side movement validation (speed/jump/stamina), rooms with codes, public matchmaking, private lobbies with chat, reconnect within a grace period, live player count, results |
| Modes | Solo, Duos, Teams, Private, Practice (fully offline in-browser, same simulation code as the server) |
| AI | 7 personalities (Hunter, Survivor, Strategist, Assassin, Opportunist, Diplomat, Berserker), 4 difficulties that change perception, reaction time, accuracy and decision quality (never extra health/damage); loot, hide, flee, ally/betray, traps, react to sound |
| Campaign | 8 chapters, original story set in the Vael Dominion, cutscene player with dialogue, moral choices that set flags/relationships (validated server-side by replaying your picks), 4 endings, replayable missions with optional objectives and star ratings |
| Economy | CREDITS only — no real-money anything. Server-side balances, transaction ledger with unique IDs (no duplicate claims), never negative, free beginner tier, low/high stakes, quit penalty, refunds on server fault, per-day bot-reward cap and repeat-victim decay against farming |
| Pre-match shop | 8 advantages and 6 disadvantages (disadvantages pay credits), match-specific, no ranked access, nothing gives raw damage |
| Cosmetics | 19 slots, five rarities, unlock by credits / level / achievements / campaign / seasonal events, live 3D preview, saved to the account |
| Progression | XP, levels to 60, titles, 17 achievements, daily + weekly challenges validated from real match results, match history, leaderboard |
| Audio | Fully synthesised with WebAudio (no sound files to license): ambience, footsteps, weapons, water, wind, rain, announcements, music |

## Layout
```
client/    index.html, style.css, js/{boot,audio,net,avatar,world,game,ui,screens,main}.js, vendor/three.module.js
server/    server.js (HTTP + WebSocket protocol, rooms, matchmaking, match runner), economy.js, db.js
shared/    constants, catalog (items/cosmetics/perks), terrain, movement, sim (authoritative match), bots, campaign
tests/     mp.test.js
data/      db.json (created at runtime — accounts, profiles, match history)
```
`shared/` is loaded by both Node and the browser, so the offline practice mode runs the exact same simulation as the server.

## Keeping accounts on free hosting (free Upstash database)
Render's free plan wipes the disk on every redeploy/restart, so a local file loses accounts. Set these two environment variables and the server saves accounts, credits, cosmetics, sessions and match history to a free [Upstash](https://upstash.com) Redis database instead (nothing to install):
| Variable | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | the **REST URL** from your Upstash database page |
| `UPSTASH_REDIS_REST_TOKEN` | the **REST Token** from the same page |
Without them the server uses `data/db.json`. If they are set but wrong, the server refuses to start (so it never silently runs without saving). The startup log says `saving to remote (Upstash Redis)` and how many accounts were loaded. `npm run test:persist` proves accounts survive a restart.

## Notes & honest limitations
* **Transport:** the spec suggested Express + Socket.IO. This build uses Node's built-in `http` plus the `ws` WebSocket library (same real-time, authoritative architecture, one small dependency) because it was developed in an environment where only `ws` could be installed. Swapping the transport touches `server/server.js` and `client/js/net.js` only.
* **Database:** accounts, profiles and match history persist to a free Upstash Redis database when configured (above), otherwise to `data/db.json` through a small atomic-write store (`server/db.js`). That is fine for a friends-and-community server; for a large public service replace `db.js` with SQLite/Postgres — the rest of the server only uses `store.accounts`, `store.sessions` and `store.addMatch`.
* **Graphics** are stylised low-poly (blocky characters, simple foliage) to hold 60 FPS on ordinary hardware; there are no external art or sound assets.
* Tested here with headless Chromium on a software renderer (so frame rate figures are not representative), including two separate browser clients in one match, plus the Node end-to-end test.
