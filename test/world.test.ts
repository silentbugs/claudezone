import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { generateWorld } from '../src/world/mapgen';

test('world generation', () => {
  const t0 = Date.now();
  const w = generateWorld(loadMasksNode(), 1);
  const ms = Date.now() - t0;
  const kinds: Record<string, number> = {};
  let parts = 0;
  for (const s of w.col.structures) { kinds[s.kind] = (kinds[s.kind] ?? 0) + 1; parts += s.parts.length; }
  console.log('gen ms', ms, 'structures', w.col.structures.length, 'parts', parts, 'trees', w.trees.length, 'loot', w.groundLoot.length, 'chests', w.chests.length);
  console.log(JSON.stringify(kinds));
  assert.ok(w.col.structures.length > 1000);
});
