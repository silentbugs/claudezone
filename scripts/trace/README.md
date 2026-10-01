# Map tracing (2025 Verdansk tac map -> world)

Reference: the 5574 px Verdansk tac map from Verdansk's 2025 return (BO6 Season 3 Reloaded), which kept the 2020
layout. It is fetched from callofduty.fandom.com through the harness Chromium (the CDN is Cloudflare-protected)
and is a reference only: it is never shipped. Products in the repo are derived data (footprints, road/built bits).

1. `field.ts`  - displacement field (200 m grid) aligning the image's building outlines to the 2020 built-up mask,
                 on top of a landmark similarity fit. Output: `.harness/ref/vd2025_field.json`.
2. `warp.ts`   - warps the image into world metres at 0.75 m/px: `.harness/ref/vd2025_world.rgb` (4320^2 RGB).
3. `footprints.ts` - building outlines -> enclosed regions -> minimum-area rectangles; L/U/T shapes split into
                 disjoint rectangles; round tanks flagged. Output: `src/data/footprints.ts`.
4. `masks.ts`  - road bit (smooth light ribbons minus footprints, widened, despeckled, kept near the 2020 trace in
                 the snowy north) and built-up bit (5 m round footprints) in `public/map/masks.bin`.

Each is a TS file bundled with esbuild and run with node (`--max-old-space-size=8000`); paths assume the repo root
and `S=<dir with vd2025.rgb>` for steps 1-2.
