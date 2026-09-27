import { loadMasksNode } from '../test/util';
import { generateWorld } from '../src/world/mapgen';
const w = generateWorld(loadMasksNode(), 1);
for (const s of w.col.near(870.5, 1302, 2, [])) console.log(s.kind, s.x.toFixed(1), s.z.toFixed(1), s.parts.length, JSON.stringify(s.parts[0]));
