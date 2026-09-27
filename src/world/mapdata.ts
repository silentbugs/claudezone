import { VERDANSK } from '../data/verdansk';

export const MAP_SIZE = VERDANSK.size; // metres
export const MASK_RES = 1080;
export const MASK_PX = MAP_SIZE / MASK_RES; // 3 m
export const M_ROAD = 1, M_BUILT = 2, M_SNOW = 4, M_SEA = 8;

export type V2 = readonly [number, number];
export interface Poi { id: string; name: string; tier: string; x: number; z: number; r: number }
export const POIS: readonly Poi[] = VERDANSK.pois as any;
export const poi = (id: string) => POIS.find((p) => p.id === id)!;

/** Masks are a deflated 1080x1080 byte raster (bit flags above). Loaded by the caller (fetch or fs). */
export class MapMasks {
  constructor(readonly m: Uint8Array) {}
  at(x: number, z: number): number {
    const px = Math.floor(x / MASK_PX), pz = Math.floor(z / MASK_PX);
    if (px < 0 || pz < 0 || px >= MASK_RES || pz >= MASK_RES) return 0;
    return this.m[pz * MASK_RES + px];
  }
  has(x: number, z: number, bit: number) { return (this.at(x, z) & bit) !== 0; }
  /** Fraction of pixels in a square window with the bit set. */
  density(x: number, z: number, radius: number, bit: number): number {
    const r = Math.max(1, Math.round(radius / MASK_PX));
    const cx = Math.floor(x / MASK_PX), cz = Math.floor(z / MASK_PX);
    let n = 0, t = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const px = cx + dx, pz = cz + dz; if (px < 0 || pz < 0 || px >= MASK_RES || pz >= MASK_RES) continue;
      t++; if (this.m[pz * MASK_RES + px] & bit) n++;
    }
    return t ? n / t : 0;
  }
}

export async function loadMasksBrowser(url = 'map/masks.bin'): Promise<MapMasks> {
  const res = await fetch(url);
  const ds = res.body!.pipeThrough(new DecompressionStream('deflate'));
  const buf = new Uint8Array(await new Response(ds).arrayBuffer());
  return new MapMasks(buf);
}
