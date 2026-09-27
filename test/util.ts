import fs from 'node:fs';
import zlib from 'node:zlib';
import { MapMasks } from '../src/world/mapdata';
export function loadMasksNode(): MapMasks { return new MapMasks(new Uint8Array(zlib.inflateSync(fs.readFileSync('public/map/masks.bin')))); }
