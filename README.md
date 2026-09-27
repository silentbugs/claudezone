# Verdansk — a Warzone (2020) rebuild

A browser rebuild of the original 2020 Warzone Battle Royale on Verdansk: a 150-player trios
match against 149 bots, on a map traced from the 2020 tac map. Everything you see and hear is
generated in code (no ripped assets): terrain, buildings, soldiers, weapons, vehicles, textures,
and sound.

```sh
npm install
npm run dev      # http://127.0.0.1:5173
npm test         # headless: terrain, world gen, warm-up, and a full 150-bot match
npm run build
```

## What's in it

**Map.** Verdansk as it was in 2020: the Dam and its frozen reservoir, Military Base, Quarry
terraces, Airport (runway, terminal, control tower, hangars, radar dome), Storage Town, Superstore,
Boneyard planes, TV Station and its broadcast tower, Stadium, Downtown, Hospital, Train Station,
Promenade East and West (with the Ferris wheel), Hills, Park, Port cranes and containers, Lumber,
Farmland, and the Zordaya prison. The Gora and Karst rivers and their canals, the southern coast,
and the mountain rim are also there.
- Positions, rivers, coast, roads and the playable boundary were traced from 2020 map references.
- The road network and built-up areas come from the tac map, so streets and blocks sit where they
  did.
- The map is about 3.2 km across (1 grid square ≈ 380 m), and the tac map uses the same A–J / 0–9
  grid.

**Match flow.**
1. **Warm-up.** You start on the map with a random gun, and respawns are on.
2. **Infil.** Everyone boards a C-130 that flies a random route across the map.
3. **Jump.** You freefall (look down to dive), and the parachute auto-deploys near the ground. You
   can cut the chute and redeploy it as often as you like.
4. **The circle.** There are seven circles plus a final collapse, using the post-April-2020 timings.
   The gas deals about 8.4 HP/s, ignores armor, and a gas mask gives 12 s of protection.
5. **Downs and revives.** Players are downed rather than killed while a squadmate is still up. Revives
   take 5 s, and you can use a Self-Revive Kit. The squad dies when everyone is down.
6. **The Gulag.** On your first death you go to the Gulag for a 1v1 with a shared random kit. In
   overtime a flag appears. Spectators throw rocks. The winner redeploys from the sky, and the Gulag
   closes during circle 4.
7. **Buybacks.** A teammate can buy you back for $4,500 at a Buy Station.

**Loot and economy.**
- **Weapons.** The whole 2020 Warzone arsenal: every Modern Warfare gun in Verdansk before December 2020 (13 ARs, 9 SMGs, 7 LMGs, 6 marksman rifles, 4 snipers, 6 shotguns, 6 pistols, 5 launchers, the knife) plus the Black Ops Cold War guns added on 16 Dec 2020.
  - Damage-over-range tables, RPM, magazine sizes, reload and ADS times, burst fire, bullet velocity with drop.
  - The five Warzone ammo pools (Heavy, Light, Sniper, Shotgun, Rockets) and five rarity tiers with attachments and blueprint names.
- **Armor.** 3 armor plates of 50 each; you carry 5, or 8 with an Armor Satchel.
- **Ground loot** lies on the floor as real models (guns on their side) with a rarity glow; looking at an item shows the Warzone item card (name, rarity, attachments, stat bars compared with your gun).
- **Buy stations** at 2020 prices: Armor Plate Bundle, Gas Mask, Self-Revive Kit, UAV, Cluster Strike, Precision Airstrike, Shield Turret, Munitions Box, Armor Box, Loadout Drop and Squad Buyback.
- **Contracts.** Bounty, Scavenger and Recon.

**Vehicles.** ATV, Tactical Rover, SUV, Cargo Truck and a light helicopter.
- Seats: passengers can shoot, drivers can't.
- Vehicles take damage and explode.
- You can run players over.

**Bots.**
- They pick drop spots along the flight path and skydive to them.
- They loot, open supply boxes and rotate ahead of the gas.
- In fights they commit to one target, react with a delay, track with error, strafe and plate up.
- They revive teammates, buy back teammates and call in loadout drops.
- Bots in your squad jump with you and move to your ping.

## Controls

Every key is rebindable in **Settings → Key bindings** (from the main menu or **Esc** in a match). Crouch, prone, aim, sprint, tactical sprint and plating each have hold/toggle options; there are also sensitivity, ADS multiplier, FOV, graphics preset, render scale, foliage density, volume buses and an announcer toggle.

| Default key | Action |
|---|---|
| WASD / mouse | Move / look |
| LMB / RMB | Fire / aim down sights (aiming while sprinting drops you out of the sprint) |
| Left Shift | Sprint. Double-tap: tactical sprint |
| Space | Jump / mantle, jump from the plane, deploy or cut the chute. In vehicles: brake / helicopter climb |
| C | Crouch. While sprinting: slide (press again mid-slide to slide-cancel) |
| Left Ctrl / Z | Prone |
| R | Reload |
| F | Use: loot, open boxes, buy station, revive, vehicles, turrets |
| 4 | Armor plate (hold to chain) |
| 1 / 2 / wheel | Switch weapons |
| V / E | Melee |
| G / Q | Lethal / tactical |
| 5 / X | Killstreak / field upgrade |
| Q (while parachuting) | Hold for third person |
| MMB / Left Alt | Ping (your squad moves to it) |
| M | Tac map |
| Esc | Pause menu and settings |

## Layout

| Path | Contents |
|---|---|
| `src/data` | Traced map data (`verdansk.ts`) and the weapon table |
| `public/map/masks.bin` | Road, built-up, snow and sea masks (1080², 3 m/px) |
| `src/world` | Terrain, collision (oriented structures of boxes and ramps), building archetypes, landmarks, placement |
| `src/sim` | The headless, deterministic game: players, movement, combat, loot, circle, Gulag, contracts, vehicles, bots |
| `src/render` | three.js scene: chunked terrain LODs, merged building chunks with facade LODs, instanced soldiers, viewmodel, effects, vehicles |
| `src/ui` | DOM HUD, minimap and tac map, menus |
| `src/audio` | WebAudio sounds synthesized at startup, with HRTF positional playback |
| `scripts/export-map.mjs` | One-off tool that turned the traced references into `verdansk.ts` and `masks.bin` |

## Third-party assets

- **Sound effects:** recorded CC0 / public-domain clips from Freesound, BigSoundBank and Kenney (113 files in `public/sfx`; per-file sources in `public/sfx/CREDITS.md`). Anything missing falls back to the in-code synthesizer.
- **Materials and sky lighting:** CC0 photo-scanned textures and an HDRI from [Poly Haven](https://polyhaven.com) (`public/tex`, resized to 512 px).
- Nothing is taken from Call of Duty itself.
