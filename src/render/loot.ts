/**
 * Ground loot as it looked in 2020 Warzone: real models lying flat on the floor (guns on their side),
 * a soft rarity-coloured glow under weapons, a white rim on the item you're looking at, and
 * footlocker supply boxes with a glowing yellow seam (orange for legendary).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Sim } from '../sim/sim';
import { ItemKind, Item } from '../sim/types';
import { WEAPON, RARITY_COLORS } from '../data/weapons';
import { describeGun, gunGeometry } from './gunModel';
import { models } from './models';

function colored(geo: THREE.BufferGeometry, hex: number, emissive = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3), em = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; em[i] = emissive; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const B = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const withEmit = (g: THREE.BufferGeometry) => { if (!g.attributes.aEmit) g.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1)); return g; };

/** Item models, pivot at the floor. */
function itemModel(kind: string): THREE.BufferGeometry {
  switch (kind) {
    case 'plate': { // black ceramic plate, both top corners cut, lying flat
      const s = new THREE.Shape(); s.moveTo(-0.13, -0.17); s.lineTo(0.13, -0.17); s.lineTo(0.13, 0.12); s.lineTo(0.08, 0.17); s.lineTo(-0.08, 0.17); s.lineTo(-0.13, 0.12); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 1 }).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
      return mergeGeometries([colored(g, 0x2a2b2c), colored(B(0.1, 0.004, 0.05, 0, 0.045, 0.05), 0xd8d8d0)])!;
    }
    case 'heavy': case 'light': case 'sniper': case 'shotgun': case 'rocket': {
      const col = kind === 'heavy' ? 0x5f6a3a : kind === 'light' ? 0x7a6a3a : kind === 'sniper' ? 0x3a4a5a : kind === 'shotgun' ? 0x8a3a2a : 0x4a5a3a;
      return mergeGeometries([colored(B(0.26, 0.15, 0.13, 0, 0.075, 0), col), colored(B(0.27, 0.02, 0.14, 0, 0.12, 0), 0x2a2a2a), colored(B(0.07, 0.025, 0.02, 0, 0.16, 0), 0x2a2a2a), colored(B(0.1, 0.05, 0.002, 0, 0.07, 0.066), 0xe0d8a0)])!;
    }
    case 'cash': { // bricks of banknotes
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) { const x = (i % 3) * 0.17 - 0.17, z = Math.floor(i / 3) * 0.09 - 0.04; parts.push(colored(B(0.16, 0.06, 0.075, x, 0.03, z), 0x7a9a78)); parts.push(colored(B(0.02, 0.062, 0.078, x, 0.03, z), 0xd8d8c0)); }
      parts.push(colored(B(0.16, 0.06, 0.075, -0.08, 0.09, 0), 0x6a8a6a));
      return mergeGeometries(parts)!;
    }
    case 'lethal': return mergeGeometries([colored(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 1.15, 1).translate(0, 0.065, 0), 0x5f6a45), colored(B(0.03, 0.03, 0.03, 0, 0.14, 0), 0x3a3a3a), colored(B(0.015, 0.06, 0.012, 0.03, 0.12, 0), 0x9a9a9a)])!;
    case 'tactical': return mergeGeometries([colored(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10).rotateZ(Math.PI / 2).translate(0, 0.035, 0), 0x7a7e82), colored(B(0.03, 0.03, 0.03, 0.085, 0.035, 0), 0x3a3a3a)])!;
    case 'killstreak': return mergeGeometries([colored(B(0.24, 0.025, 0.17, 0, 0.012, 0), 0x2a2c2e), colored(B(0.2, 0.004, 0.13, 0, 0.027, 0), 0xe04a3a, 1.2)])!; // tablet with glowing screen
    case 'selfRevive': return mergeGeometries([colored(B(0.24, 0.09, 0.14, 0, 0.045, 0), 0x6a7058), colored(B(0.06, 0.002, 0.06, 0, 0.091, 0), 0xeeeeee), colored(B(0.1, 0.02, 0.03, 0, 0.1, 0), 0x3a3a3a)])!;
    case 'gasMask': return mergeGeometries([colored(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1.2), 0x2c2e30), colored(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0.03, 0.12), 0x4a4e52), colored(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 10).translate(-0.04, 0.055, -0.03), 0x7a9aaa), colored(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 10).translate(0.04, 0.055, -0.03), 0x7a9aaa)])!;
    case 'satchel': return mergeGeometries([colored(B(0.3, 0.14, 0.24, 0, 0.07, 0), 0x6e7274), colored(B(0.22, 0.1, 0.03, 0, 0.07, 0.13), 0x5a5e60), colored(B(0.04, 0.01, 0.28, -0.1, 0.145, 0), 0x3a3a3a), colored(B(0.04, 0.01, 0.28, 0.1, 0.145, 0), 0x3a3a3a)])!;
  }
  return colored(B(0.2, 0.1, 0.2, 0, 0.05, 0), 0x888888);
}

function lootMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEmit;\nvarying float vEmit;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEmit;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vEmit;');
  };
  m.customProgramCacheKey = () => 'loot';
  return m;
}

function glowTexture(): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

const KIND_KEY = (it: Item): string => {
  switch (it.kind) {
    case ItemKind.Weapon: return `w:${it.weapon}:${Math.min(it.rarity ?? 0, 4)}`;
    case ItemKind.Ammo: return it.ammo!;
    case ItemKind.Plate: return 'plate';
    case ItemKind.Cash: return 'cash';
    case ItemKind.Lethal: return 'lethal';
    case ItemKind.Tactical: return 'tactical';
    case ItemKind.Killstreak: return 'killstreak';
    case ItemKind.SelfRevive: return 'selfRevive';
    case ItemKind.GasMask: return 'gasMask';
    case ItemKind.Satchel: return 'satchel';
  }
};

export class LootMeshes {
  group = new THREE.Group();
  private mat = lootMaterial();
  private pools = new Map<string, THREE.InstancedMesh>();
  private glow: THREE.InstancedMesh;
  private chest: THREE.InstancedMesh; private chestOpen: THREE.InstancedMesh;
  private outline: THREE.Mesh;
  private outlineKey = '';
  private timer = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1); private c = new THREE.Color();

  constructor(private sim: Sim) {
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
    this.glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), glowMat, 800);
    this.glow.count = 0; this.glow.frustumCulled = false; this.glow.renderOrder = 2; this.group.add(this.glow);
    // footlocker supply box: olive steel body, lid, latches, glowing seam
    const box = mergeGeometries([
      colored(B(1.1, 0.42, 0.55, 0, 0.21, 0), 0x4c5238), colored(B(1.14, 0.1, 0.59, 0, 0.47, 0), 0x40462e),
      colored(B(1.12, 0.035, 0.57, 0, 0.415, 0), 0xffc050, 1.6),
      colored(B(0.08, 0.1, 0.02, -0.3, 0.38, 0.285), 0x2a2a2a), colored(B(0.08, 0.1, 0.02, 0.3, 0.38, 0.285), 0x2a2a2a),
      colored(B(0.14, 0.03, 0.03, -0.62, 0.3, 0), 0x2a2a2a), colored(B(0.14, 0.03, 0.03, 0.62, 0.3, 0), 0x2a2a2a),
    ].map(withEmit))!;
    this.chest = new THREE.InstancedMesh(box, this.mat, 2000); this.chest.count = 0; this.chest.frustumCulled = false; this.chest.castShadow = true; this.chest.receiveShadow = true; this.group.add(this.chest);
    const open = mergeGeometries([colored(B(1.1, 0.42, 0.55, 0, 0.21, 0), 0x3c4230), colored(B(1.14, 0.59, 0.1, 0, 0.72, -0.32), 0x343a28)].map(withEmit))!;
    this.chestOpen = new THREE.InstancedMesh(open, this.mat, 2000); this.chestOpen.count = 0; this.chestOpen.frustumCulled = false; this.chestOpen.receiveShadow = true; this.group.add(this.chestOpen);
    this.outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false }));
    this.outline.visible = false; this.outline.renderOrder = 3; this.group.add(this.outline);
  }

  private pool(key: string): THREE.InstancedMesh {
    let im = this.pools.get(key);
    if (!im) {
      let geo: THREE.BufferGeometry;
      if (key.startsWith('w:')) {
        const [, id, r] = key.split(':');
        const g = models.bakedGun(id, +r, true)?.clone() ?? gunGeometry(describeGun(WEAPON[id], +r));
        g.rotateZ(Math.PI / 2); // lying on its side
        g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0);
        geo = withEmit(g);
      } else geo = itemModel(key);
      im = new THREE.InstancedMesh(geo, this.mat, 128);
      im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
      this.pools.set(key, im); this.group.add(im);
    }
    return im;
  }

  update(dt: number, cam: THREE.Vector3, time: number, focusItem: number) {
    this.timer -= dt;
    const pulse = 0.75 + 0.25 * Math.sin(time * 3);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = pulse;
    if (this.timer <= 0) { this.timer = 0.2; this.rebuild(cam); }
    // outline on the focused item (inverted hull)
    const it = focusItem >= 0 ? this.sim.itemById.get(focusItem) : undefined;
    if (it && it.alive) {
      const key = KIND_KEY(it);
      if (key !== this.outlineKey) { this.outlineKey = key; this.outline.geometry = this.pool(key).geometry; }
      this.pose(it); this.outline.matrixAutoUpdate = false;
      this.outline.matrix.copy(this.m).multiply(new THREE.Matrix4().makeScale(1.08, 1.25, 1.08));
      this.outline.visible = true;
    } else this.outline.visible = false;
  }

  private pose(it: Item) {
    this.e.set(0, (it.id * 1.7) % 6.28, 0); this.q.setFromEuler(this.e);
    this.p.set(it.x, it.y - 0.04, it.z);
    this.m.compose(this.p, this.q, this.s);
  }

  private rebuild(cam: THREE.Vector3) {
    const sim = this.sim;
    for (const im of this.pools.values()) im.count = 0;
    let ng = 0;
    for (const it of sim.itemsNear(cam.x, cam.z, 70)) {
      if (it.vy !== undefined) continue;
      const im = this.pool(KIND_KEY(it));
      if (im.count >= 128) continue;
      this.pose(it);
      im.setMatrixAt(im.count++, this.m);
      if (it.kind === ItemKind.Weapon && ng < 800) {
        const r = it.rarity ?? 0;
        this.c.set(RARITY_COLORS[r]).multiplyScalar(r === 0 ? 0.25 : 0.8);
        this.p.set(it.x, it.y + 0.02, it.z); this.m.compose(this.p, this.q, this.s.setScalar(0.8 + r * 0.12)); this.s.set(1, 1, 1);
        this.glow.setMatrixAt(ng, this.m); this.glow.setColorAt(ng, this.c); ng++;
      }
    }
    for (const im of this.pools.values()) im.instanceMatrix.needsUpdate = true;
    this.glow.count = ng; this.glow.instanceMatrix.needsUpdate = true; if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
    let n = 0, no = 0;
    for (const ch of sim.chests) {
      if (Math.abs(ch.x - cam.x) > 200 || Math.abs(ch.z - cam.z) > 200) continue;
      this.e.set(0, (ch.id * 2.3) % 6.28, 0); this.q.setFromEuler(this.e); this.p.set(ch.x, ch.y, ch.z); this.m.compose(this.p, this.q, this.s);
      if (ch.opened) { if (no < 2000) this.chestOpen.setMatrixAt(no++, this.m); continue; }
      if (n >= 2000) continue;
      this.chest.setMatrixAt(n, this.m);
      this.c.set(ch.legendary ? '#ff9a2e' : '#ffffff'); this.chest.setColorAt(n, this.c);
      n++;
    }
    this.chest.count = n; this.chestOpen.count = no;
    this.chest.instanceMatrix.needsUpdate = true; this.chestOpen.instanceMatrix.needsUpdate = true; if (this.chest.instanceColor) this.chest.instanceColor.needsUpdate = true;
  }
}
