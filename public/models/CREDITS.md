# 3D model credits

Most models in this folder are **CC0 1.0 (public domain)**; attribution isn't required for those, but we credit the authors anyway. Some newer gun models are **CC-BY 3.0** (https://creativecommons.org/licenses/by/3.0/) and **must** keep the attribution in the "CC-BY 3.0 attribution" section below. None of them are ripped game assets.

## Authors
- **Quaternius** (https://quaternius.com, https://www.patreon.com/quaternius): SWAT character (Ultimate Modular Men pack), Universal Animation Library 1 & 2 (Standard) animations, and most props. CC0.
- **Pichuliru** (https://poly.pizza/u/Pichuliru): the realistic low-poly firearms, attachments, grenades and ammo. CC0.
- **CreativeTrio** (https://poly.pizza/u/CreativeTrio): RPG launcher ("Bazooka"). CC0.

- **Lucian Pavel** (https://opengameart.org/users/lucian-pavel): Lee-Enfield rifle, RPG-7. CC0.
- **loafbrr_1** (https://opengameart.org/users/loafbrr1): AK, .357 revolver. CC0.
- **nisu** (https://opengameart.org/users/nisu): M4A1. CC0.
- **SirDraco65** (https://opengameart.org/users/sirdraco65): Desert Eagle. CC0.
- **austincford** (https://poly.pizza/u/austincford): MDR, SRS A1, MK14, MPSD, MPX. CC-BY 3.0.
- **Kristian** (via Google Poly / poly.pizza): SCAR-H. CC-BY 3.0.
- **Dark** (https://poly.pizza/u/Dark): MP7. CC-BY 3.0.
- **PuKkBuMXDD** (https://poly.pizza/u/PuKkBuMXDD): Glock 19. CC-BY 3.0.

## CC-BY 3.0 attribution (required)
These files are licensed under Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/). We changed them: re-oriented, rescaled to real size, re-centred, textures downsized, some parts removed, and some meshes simplified.
- `guns/ar_bullpup.glb`: "MDR" by austincford, https://poly.pizza/m/DdK4yHu7fi
- `guns/sniper_bullpup.glb`: "SRSA1" by austincford, https://poly.pizza/m/4FyY7r5sjB (built-in scope removed)
- `guns/dmr_ebr.glb`: "MK14" by austincford, https://poly.pizza/m/lNGPW2NGPZ
- `guns/smg_mp5sd.glb`: "Mpsd" by austincford, https://poly.pizza/m/Wj8MhwBVF5 (red dot removed)
- `guns/smg_mpx.glb`: "MPX" by austincford, https://poly.pizza/m/p7sAqeuUWR
- `guns/ar_scar_hd.glb`: "Scar-H" by Kristian, https://poly.pizza/m/9A4jh0k82NZ (simplified)
- `guns/smg_mp7_hd.glb`: "MP7" by Dark, https://poly.pizza/m/goyOzONDIr
- `guns/pistol_glock.glb`: "Rigged Glock 19" by PuKkBuMXDD, https://poly.pizza/m/gDhOo5jkNX

## Derived work
`characters/soldier_swat.glb` combines Quaternius' "SWAT" mesh (https://poly.pizza/m/Btfn3G5Xv4) and its 24 native clips (prefixed `Swat_`) with 35 clips from Quaternius' **Universal Animation Library** (https://quaternius.itch.io/universal-animation-library) and **Universal Animation Library 2** (https://quaternius.itch.io/universal-animation-library-2). Both libraries are CC0, and we used the Standard, non-root-motion versions.
The clips were retargeted in three.js by applying world-space rotation deltas measured from each rig's T-pose bind pose, then exported with GLTFExporter. Tooling: `.harness/retarget_swat.html` and `.harness/retarget_run.mjs`.

## Per-file sources
| key | file | original title | author | license | source |
|---|---|---|---|---|---|
| `soldier_swat` | characters/soldier_swat.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/Btfn3G5Xv4 |
| `ar_m4` | guns/ar_m4.glb | Assault Rifle West | Pichuliru | CC0 1.0 | https://poly.pizza/m/ss1nz3gJnx |
| `ar_ak` | guns/ar_ak.glb | Rifle Assault East | Pichuliru | CC0 1.0 | https://poly.pizza/m/xrJfQgAuDL |
| `lmg_rpk` | guns/lmg_rpk.glb | Rifle Battle East | Pichuliru | CC0 1.0 | https://poly.pizza/m/tJaWNYo064 |
| `dmr_west` | guns/dmr_west.glb | Rifle West | Pichuliru | CC0 1.0 | https://poly.pizza/m/wED1MSx2SK |
| `smg_mp5` | guns/smg_mp5.glb | Smg West | Pichuliru | CC0 1.0 | https://poly.pizza/m/7Dh5JSbZcp |
| `smg_east` | guns/smg_east.glb | Smg Full East | Pichuliru | CC0 1.0 | https://poly.pizza/m/0SC1d2gERM |
| `smg_compact_west` | guns/smg_compact_west.glb | Smg Compact West | Pichuliru | CC0 1.0 | https://poly.pizza/m/RmWDMB5bI9 |
| `smg_compact_east` | guns/smg_compact_east.glb | Smg Compact East | Pichuliru | CC0 1.0 | https://poly.pizza/m/7IK1O1FfXu |
| `pistol_west` | guns/pistol_west.glb | Pistol West | Pichuliru | CC0 1.0 | https://poly.pizza/m/r8RjoAwN5A |
| `pistol_east` | guns/pistol_east.glb | Pistol Full East | Pichuliru | CC0 1.0 | https://poly.pizza/m/pNHeIJFHcQ |
| `pistol_compact_east` | guns/pistol_compact_east.glb | Pistol Compact East | Pichuliru | CC0 1.0 | https://poly.pizza/m/dx0oQNXWz0 |
| `shotgun_pump` | guns/shotgun_pump.glb | Shotgun Pump West | Pichuliru | CC0 1.0 | https://poly.pizza/m/NfQETBKOiw |
| `shotgun_auto` | guns/shotgun_auto.glb | Shotgun Auto West | Pichuliru | CC0 1.0 | https://poly.pizza/m/f0USjc13vj |
| `sniper_west` | guns/sniper_west.glb | Sniper Rifle West | Pichuliru | CC0 1.0 | https://poly.pizza/m/kwJawENuvA |
| `sniper_east` | guns/sniper_east.glb | Sniper Rifle East | Pichuliru | CC0 1.0 | https://poly.pizza/m/mqhnsEX5VJ |
| `sniper_50cal_west` | guns/sniper_50cal_west.glb | Sniper Material West | Pichuliru | CC0 1.0 | https://poly.pizza/m/hcB4it4UpA |
| `sniper_50cal_east` | guns/sniper_50cal_east.glb | Sniper Material East | Pichuliru | CC0 1.0 | https://poly.pizza/m/R1qESvHtZH |
| `launcher_rpg` | guns/launcher_rpg.glb |  | CreativeTrio | CC0 1.0 | https://poly.pizza/m/eJNzLpBsEt |
| `att_suppressor` | attachments/suppressor.glb | Suppressor | Pichuliru | CC0 1.0 | https://poly.pizza/m/VLiLj3j1tS |
| `att_red_dot` | attachments/red_dot_sight.glb | Red Dot Sight | Pichuliru | CC0 1.0 | https://poly.pizza/m/S9sDv7SZRm |
| `att_holo` | attachments/holographic_sight.glb | Holographic Sight | Pichuliru | CC0 1.0 | https://poly.pizza/m/9rPJxvm9sw |
| `att_scope` | attachments/rifle_scope.glb | Rifle Scope | Pichuliru | CC0 1.0 | https://poly.pizza/m/98ocxnqLFf |
| `frag_west` | attachments/frag_grenade_west.glb | Frag Grenade West | Pichuliru | CC0 1.0 | https://poly.pizza/m/1aIZys4mhg |
| `frag_east` | attachments/frag_grenade_east.glb | Frag Grenade East | Pichuliru | CC0 1.0 | https://poly.pizza/m/C4ZrgKsmLq |
| `ammo_can` | props/ammo_can.glb | Ammo Can | Pichuliru | CC0 1.0 | https://poly.pizza/m/9xeB2FkEYr |
| `loose_ammo` | props/loose_ammo.glb | Loose Ammo | Pichuliru | CC0 1.0 | https://poly.pizza/m/sWyJu6XMpY |
| `ammo_pack_sniper` | props/ammo_pack_sniper.glb | Ammo Pack Sniper | Pichuliru | CC0 1.0 | https://poly.pizza/m/HaZi9tki43 |
| `backpack` | props/backpack.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/2g9Jm7kvIU |
| `barrel_explode` | props/barrel_explode.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/1orHe0kCc1 |
| `oil_drum` | props/oil_drum.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/MraIiFnpAY |
| `jersey_barrier` | props/jersey_barrier.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/wCUxgt2jSP |
| `barrier_fence` | props/barrier_fence.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/gLbBiYwt7l |
| `broken_car` | props/broken_car.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/Y67erogmR9 |
| `pickup_truck` | props/pickup_truck.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/qn4grQgHm8 |
| `suv` | props/suv.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/xsMtZhBkxL |
| `container_green` | props/container_green.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/h5RUr3vlcS |
| `container_red` | props/container_red.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/vzzCNUB6Zn |
| `crate_wood_large` | props/crate_wood_large.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/SfJtdV8GDr |
| `crate_wood` | props/crate_wood.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/3VGWnZPXmG |
| `supply_box` | props/supply_box.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/LNQWE3LzNf |
| `jerry_can` | props/jerry_can.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/eS1OXGo51c |
| `pallet` | props/pallet.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/MwOFAOgOhg |
| `sandbags` | props/sandbags.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/LW3jwpPfiN |
| `sandbags_small` | props/sandbags_small.glb |  | Quaternius | CC0 1.0 | https://poly.pizza/m/iHyRewQQcN |
| `ar_m4_hd` | guns/ar_m4_hd.glb | M4A1 Assault Rifle | nisu | CC0 1.0 | https://opengameart.org/content/m4a1-assault-rifle |
| `ar_ak_hd` | guns/ar_ak_hd.glb | AK | loafbrr_1 | CC0 1.0 | https://opengameart.org/content/ak |
| `ar_scar_hd` | guns/ar_scar_hd.glb | Scar-H | Kristian (Google Poly) | CC-BY 3.0 | https://poly.pizza/m/9A4jh0k82NZ |
| `dmr_ebr` | guns/dmr_ebr.glb | MK14 | austincford | CC-BY 3.0 | https://poly.pizza/m/lNGPW2NGPZ |
| `ar_bullpup` | guns/ar_bullpup.glb | MDR | austincford | CC-BY 3.0 | https://poly.pizza/m/DdK4yHu7fi |
| `sniper_bullpup` | guns/sniper_bullpup.glb | SRSA1 | austincford | CC-BY 3.0 | https://poly.pizza/m/4FyY7r5sjB |
| `rifle_bolt_wood` | guns/rifle_bolt_wood.glb | Bolt action Rifle: Lee Enfield | Lucian Pavel | CC0 1.0 | https://opengameart.org/content/bolt-action-rifle-lee-enfield |
| `smg_mp5sd` | guns/smg_mp5sd.glb | Mpsd | austincford | CC-BY 3.0 | https://poly.pizza/m/Wj8MhwBVF5 |
| `smg_mp7_hd` | guns/smg_mp7_hd.glb | MP7 | Dark | CC-BY 3.0 | https://poly.pizza/m/goyOzONDIr |
| `smg_mpx` | guns/smg_mpx.glb | MPX | austincford | CC-BY 3.0 | https://poly.pizza/m/p7sAqeuUWR |
| `pistol_glock` | guns/pistol_glock.glb | Rigged Glock 19 | PuKkBuMXDD | CC-BY 3.0 | https://poly.pizza/m/gDhOo5jkNX |
| `pistol_deagle` | guns/pistol_deagle.glb | Desert Eagle | SirDraco65 | CC0 1.0 | https://opengameart.org/content/desert-eagle-0 |
| `revolver_357` | guns/revolver_357.glb | Revolver Game Asset | loafbrr_1 | CC0 1.0 | https://opengameart.org/content/revolver-game-asset |
| `launcher_rpg7` | guns/launcher_rpg7.glb | Low poly RPG7 | Lucian Pavel | CC0 1.0 | https://opengameart.org/content/low-poly-rpg7 |
