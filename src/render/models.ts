/**
 * CC0 glTF models (Quaternius soldier + animation library, Pichuliru guns/attachments, props).
 * Loaded once at boot; everything else asks this module for clones / baked geometry.
 */
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { WEAPON, isSuppressed } from '../data/weapons';

interface ManEntry { file: string; kind: string; sockets?: Record<string, [number, number, number]>; bbox?: number[]; bboxMin?: number[] }

/** weapon id → gun model key */
const GUN_MODEL: Record<string, string> = {
  m4: 'ar_m4', grau: 'ar_m4', m13: 'ar_m4', ram7: 'ar_m4', kilo: 'ar_m4', xm4: 'ar_m4', krig: 'ar_m4', qbz: 'ar_m4', ffar: 'ar_m4', m16: 'ar_m4', augcw: 'ar_m4', fr556: 'ar_m4',
  fal: 'dmr_west', scar: 'dmr_west', oden: 'dmr_west', dmr14: 'dmr_west', ebr: 'dmr_west',
  ak47: 'ar_ak', ak47cw: 'ar_ak', an94: 'ar_ak', amax: 'ar_ak', groza: 'ar_ak', type63: 'ar_ak',
  asval: 'smg_east', aug: 'smg_east', striker: 'smg_east', milano: 'smg_east', ksp: 'smg_east', bullfrog: 'smg_east', bizon: 'smg_east',
  mp5: 'smg_mp5', mp5cw: 'smg_mp5',
  mp7: 'smg_compact_west', fennec: 'smg_compact_west', iso: 'smg_compact_west', mac10: 'smg_compact_west', p90: 'smg_compact_west',
  uzi: 'smg_compact_east', ak74u: 'smg_compact_east',
  pkm: 'lmg_rpk', sa87: 'lmg_rpk', m91: 'lmg_rpk', mg34: 'lmg_rpk', holger: 'lmg_rpk', bruen: 'lmg_rpk', finn: 'lmg_rpk', stoner: 'lmg_rpk', rpd: 'lmg_rpk', m60: 'lmg_rpk', turretgun: 'lmg_rpk',
  mk2: 'sniper_east', kar98: 'sniper_east', sks: 'sniper_east', pelington: 'sniper_east', dragunov: 'sniper_east',
  spr: 'sniper_west', hdr: 'sniper_west', ax50: 'sniper_west', tundra: 'sniper_west',
  rytec: 'sniper_50cal_west', m82: 'sniper_50cal_west',
  m680: 'shotgun_pump', r90: 'shotgun_pump', '725': 'shotgun_pump', hauer: 'shotgun_pump',
  origin: 'shotgun_auto', vlk: 'shotgun_auto', jak12: 'shotgun_auto', gallo: 'shotgun_auto', streetsweeper: 'shotgun_auto',
  x16: 'pistol_west', m1911: 'pistol_west', m19: 'pistol_west', renetti: 'pistol_west', '1911cw': 'pistol_west', diamatti: 'pistol_west',
  '357': 'pistol_east', magnum: 'pistol_east', deagle: 'pistol_east',
  rpg: 'launcher_rpg', pila: 'launcher_rpg', strela: 'launcher_rpg', jokr: 'launcher_rpg', cigma: 'launcher_rpg', m79: 'launcher_rpg', mgl: 'launcher_rpg',
};

export interface GunModel { obj: THREE.Object3D; muzzle: number; sight: number; scope: boolean; optic: boolean }

class Models {
  man: Record<string, ManEntry> = {};
  gltf = new Map<string, GLTF>();
  ready = false;
  private bakeCache = new Map<string, THREE.BufferGeometry>();

  async load(base = 'models/') {
    try {
      const r = await fetch(base + 'manifest.json'); if (!r.ok) return;
      this.man = await r.json();
      const loader = new GLTFLoader();
      const want = new Set<string>(['soldier_swat', 'att_suppressor', 'att_red_dot', 'att_holo', 'att_scope', ...Object.values(GUN_MODEL)]);
      await Promise.all([...want].map(async (k) => {
        const e = this.man[k]; if (!e) return;
        try { const g = await loader.loadAsync(e.file.startsWith('models/') ? e.file : base + e.file); this.gltf.set(k, g); } catch (err) { console.warn('model failed', k, err); }
      }));
      // RPG is authored ~3x real size
      const rpg = this.gltf.get('launcher_rpg'); if (rpg) rpg.scene.scale.setScalar(0.31);
      this.ready = this.gltf.size > 0;
    } catch (e) { console.warn('models unavailable', e); }
  }

  hasGun(id: string) { return this.ready && !!GUN_MODEL[id] && this.gltf.has(GUN_MODEL[id]); }

  /** A posed gun (muzzle -Z) with rarity attachments; sight = height of the sight line, muzzle = distance. */
  gun(id: string, rarity: number): GunModel | null {
    const key = GUN_MODEL[id]; const g = key && this.gltf.get(key); if (!g) return null;
    const def = WEAPON[id], sockets = this.man[key].sockets ?? {};
    const root = new THREE.Group();
    const body = skClone(g.scene); body.scale.copy(g.scene.scale); root.add(body);
    const sc = body.scale.x;
    const sk = (n: string) => (sockets[n] ? new THREE.Vector3(...sockets[n]).multiplyScalar(sc) : null);
    const top = sk('Attach_Scope') ?? new THREE.Vector3(0, 0.04, 0);
    let sight = top.y + 0.014, optic = false, scope = !!def.scope;
    const attach = (k: string, at: THREE.Vector3) => { const a = this.gltf.get(k); if (!a) return null; const o = skClone(a.scene); o.position.copy(at); root.add(o); return o; };
    const isSniper = def.cls === 'sniper' || (def.cls === 'marksman' && def.scope);
    if (scope || isSniper) { if (attach('att_scope', top)) { sight = top.y + 0.045; scope = true; } }
    else if (rarity >= 1 && def.cls !== 'shotgun' && def.cls !== 'launcher' && def.cls !== 'pistol') { if (attach(rarity >= 3 ? 'att_holo' : 'att_red_dot', top)) { sight = top.y + (rarity >= 3 ? 0.034 : 0.03); optic = true; } }
    const mz = sk('Attach_Muzzle');
    let muzzle = mz ? -mz.z : 0.4;
    if (isSuppressed(id, rarity) && mz) { if (attach('att_suppressor', mz)) muzzle += 0.14 * 1; }
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
    return { obj: root, muzzle, sight, scope, optic };
  }

  /** Whole gun (with attachments) merged into one vertex-coloured geometry, for instancing. */
  bakedGun(id: string, rarity: number): THREE.BufferGeometry | null {
    const ck = `${id}:${Math.min(rarity, 4)}`;
    if (this.bakeCache.has(ck)) return this.bakeCache.get(ck)!;
    const gm = this.gun(id, rarity); if (!gm) return null;
    const geo = bake(gm.obj); this.bakeCache.set(ck, geo); return geo;
  }
}

/** Pixels of a texture image, cached, for sampling palette colours per vertex. */
const pixCache = new WeakMap<object, { w: number; h: number; d: Uint8ClampedArray } | null>();
function pixels(tex: THREE.Texture) {
  const img = tex.image as any; if (!img) return null;
  if (pixCache.has(img)) return pixCache.get(img)!;
  let out: { w: number; h: number; d: Uint8ClampedArray } | null = null;
  try {
    const w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0); out = { w, h, d: x.getImageData(0, 0, w, h).data };
  } catch { out = null; }
  pixCache.set(img, out); return out;
}

/** Flatten an object tree (rigid or skinned-at-rest) into one geometry with vertex colours sampled from its textures. */
export function bake(obj: THREE.Object3D): THREE.BufferGeometry {
  obj.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3(), c = new THREE.Color();
  obj.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const sk = (m as any).isSkinnedMesh ? (m as THREE.SkinnedMesh) : null;
    if (sk) sk.skeleton.update();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const idx = m.geometry.index; // applyBoneTransform indexes the mesh's own (indexed) skin attributes
    const n = src.attributes.position.count, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const uv = src.attributes.uv;
    for (let i = 0; i < n; i++) {
      const vi = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(m.geometry.attributes.position, vi);
      if (sk) sk.applyBoneTransform(vi, v);
      v.applyMatrix4(m.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    const groups = src.groups.length ? src.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const base = (mat?.color ?? new THREE.Color(0x777777));
      const px = mat?.map && uv ? pixels(mat.map) : null;
      for (let i = gr.start; i < gr.start + gr.count && i < n; i++) {
        c.copy(base);
        if (px) {
          let u = uv.getX(i) % 1, t = uv.getY(i) % 1; if (u < 0) u += 1; if (t < 0) t += 1;
          const X = Math.min(px.w - 1, Math.floor(u * px.w)), Y = Math.min(px.h - 1, Math.floor((mat.map!.flipY ? 1 - t : t) * px.h)), o4 = (Y * px.w + X) * 4;
          const tc = new THREE.Color().setRGB(px.d[o4] / 255, px.d[o4 + 1] / 255, px.d[o4 + 2] / 255, THREE.SRGBColorSpace);
          c.multiply(tc);
        } else if (mat?.map) c.multiplyScalar(0.55);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeVertexNormals();
    parts.push(out);
  });
  return mergeGeometries(parts)!;
}

export const models = new Models();
