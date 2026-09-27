import test from 'node:test';
import assert from 'node:assert';
import { loadMasksNode } from './util';
import { buildTerrain } from '../src/world/terrain';
import { poi } from '../src/world/mapdata';

test('terrain builds with sane elevations at POIs', () => {
  const t0 = Date.now();
  const { hf } = buildTerrain(loadMasksNode());
  const ms = Date.now() - t0;
  const at = (id: string) => hf.at(poi(id).x, poi(id).z);
  console.log('terrain ms', ms, 'downtown', at('downtown').toFixed(1), 'mil', at('military_base').toFixed(1), 'prison', at('prison').toFixed(1), 'stadium', at('stadium').toFixed(1));
  assert.ok(at('downtown') > 0 && at('downtown') < 30);
  assert.ok(at('military_base') > at('downtown'));
  assert.ok(hf.at(1600, 3200) < 0, 'south is sea');
  assert.ok(hf.at(50, 1500) > 100, 'west rim is mountains');
});
