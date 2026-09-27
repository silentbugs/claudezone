import { build } from 'esbuild';
import fs from 'node:fs';
const entries = fs.readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => 'test/' + f);
fs.rmSync('.build', { recursive: true, force: true });
await build({ entryPoints: entries, outdir: '.build/test', bundle: true, platform: 'node', format: 'esm', target: 'node20', sourcemap: 'inline', logLevel: 'warning' });
