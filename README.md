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
- **Weapons.** 20 guns: M4A1, Grau 5.56, Kilo 141, M13, RAM-7, FAL, Oden, AUG, MP5, MP7, Bruen,
  MG34, HDR, AX-50, Kar98k, Model 680, .50 GS, 1911, X16 and the RPG-7.
  - Damage-over-range tables, RPM, magazine sizes, reload and ADS times, and bullet velocity with drop.
  - Five rarity tiers from common to legendary.
- **Armor.** 3 armor plates of 50 each; you carry 5, or 8 with an Armor Satchel.
- **Ground loot and supply boxes.** Cash, lethals, tacticals, killstreaks (UAV, Cluster Strike,
  Precision Airstrike), gas masks and Self-Revive Kits.
- **Buy stations.** Plates, Self-Revive, Gas Mask, UAV, Cluster Strike, Precision Airstrike,
  Munitions Box, Loadout Drop ($10,000) and Buyback, at the 2020 launch prices.
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

| Key | Action |
|---|---|
| WASD / mouse | Move / look |
| LMB / RMB | Fire / aim down sights |
| Shift | Sprint. Press again while sprinting to tactical sprint |
| Space | Jump / mantle, jump from the plane, deploy or cut the chute, brake. In the helicopter: climb |
| C | Crouch. While sprinting: slide |
| Z / Ctrl | Prone. In the helicopter: descend |
| R | Reload |
| F | Interact. Hold to revive or use a Self-Revive Kit, and to enter or exit vehicles |
| 4 | Armor plate. Hold to chain plates |
| 1 / 2 / X / wheel | Switch weapons |
| G / Q / 5 | Lethal / tactical / killstreak |
| Middle mouse | Ping. Your squad moves to it |
| M | Tac map. Click to place a marker |
| Esc | Pause and settings (sensitivity, FOV, volume, graphics) |

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
