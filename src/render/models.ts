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
  m4: 'ar_m4_hd', grau: 'ar_m4_hd', m13: 'ar_m4_hd', kilo: 'ar_m4_hd', xm4: 'ar_m4_hd', krig: 'ar_m4_hd', ffar: 'ar_m4_hd', m16: 'ar_m4_hd',
  ram7: 'ar_bullpup', fr556: 'ar_bullpup', qbz: 'ar_bullpup', augcw: 'ar_bullpup', aug: 'ar_bullpup', sa87: 'ar_bullpup',
  fal: 'ar_scar_hd', scar: 'ar_scar_hd', oden: 'ar_scar_hd', ebr: 'dmr_ebr', dmr14: 'dmr_ebr',
  ak47: 'ar_ak_hd', ak47cw: 'ar_ak_hd', an94: 'ar_ak_hd', amax: 'ar_ak', groza: 'ar_ak', type63: 'ar_ak_hd', asval: 'smg_east',
  mp5: 'smg_mp5sd', mp5cw: 'smg_mp5sd', mp7: 'smg_mp7_hd', iso: 'smg_mpx', fennec: 'smg_mpx', striker: 'smg_mpx', milano: 'smg_mpx', bullfrog: 'smg_east',
  p90: 'smg_compact_west', mac10: 'smg_compact_west', uzi: 'smg_compact_east', ak74u: 'smg_compact_east', bizon: 'smg_east', ksp: 'smg_mpx',
  pkm: 'lmg_rpk', m91: 'lmg_rpk', mg34: 'lmg_rpk', holger: 'ar_scar_hd', bruen: 'ar_m4_hd', finn: 'lmg_rpk', stoner: 'lmg_rpk', rpd: 'lmg_rpk', m60: 'lmg_rpk', turretgun: 'lmg_rpk',
  mk2: 'rifle_bolt_wood', kar98: 'rifle_bolt_wood', pelington: 'rifle_bolt_wood', sks: 'sniper_east', spr: 'sniper_west', dragunov: 'sniper_east',
  hdr: 'sniper_bullpup', ax50: 'sniper_west', tundra: 'sniper_west', rytec: 'sniper_50cal_west', m82: 'sniper_50cal_west',
  m680: 'shotgun_pump', r90: 'shotgun_pump', '725': 'shotgun_pump', hauer: 'shotgun_pump',
  origin: 'shotgun_auto', vlk: 'shotgun_auto', jak12: 'shotgun_auto', gallo: 'shotgun_auto', streetsweeper: 'shotgun_auto',
  x16: 'pistol_glock', m1911: 'pistol_west', m19: 'pistol_glock', renetti: 'pistol_glock', '1911cw': 'pistol_west', diamatti: 'pistol_glock',
  '357': 'revolver_357', magnum: 'revolver_357', deagle: 'pistol_deagle',
  rpg: 'launcher_rpg7', pila: 'launcher_rpg', strela: 'launcher_rpg', jokr: 'launcher_rpg', cigma: 'launcher_rpg', m79: 'launcher_rpg', mgl: 'launcher_rpg',
};

export interface GunModel { obj: THREE.Object3D; muzzle: number; sight: number; scope: boolean; optic: boolean; gripZ: number; guardZ: number; /** gun-local z of the optic's rear lens (red dot / holo) */ opticZ: number }

/**
 * Detailed models (2nd batch) are centred on their length instead of the receiver. For each we note
 * where the pistol grip and the support hand sit (fraction of the length from the muzzle) and re-anchor
 * the model so the grip lands where the hands / arm IK expect it and the bore sits at the usual height.
 */
const HD_GRIP: Record<string, [number, number]> = {
  ar_m4_hd: [0.59, 0.33], ar_ak_hd: [0.74, 0.4], ar_scar_hd: [0.66, 0.35], dmr_ebr: [0.71, 0.36], ar_bullpup: [0.52, 0.25],
  sniper_bullpup: [0.64, 0.4], rifle_bolt_wood: [0.72, 0.45], smg_mp5sd: [0.62, 0.42], smg_mp7_hd: [0.36, 0.14], smg_mpx: [0.61, 0.36],
  pistol_glock: [0.72, 0.72], pistol_deagle: [0.8, 0.8], revolver_357: [0.8, 0.8], launcher_rpg7: [0.47, 0.3],
};
/** low-poly stand-in for each detailed model */
const LOW_MODEL: Record<string, string> = {
  ar_m4_hd: 'ar_m4', ar_ak_hd: 'ar_ak', ar_scar_hd: 'dmr_west', dmr_ebr: 'dmr_west', ar_bullpup: 'smg_east', sniper_bullpup: 'sniper_west',
  rifle_bolt_wood: 'sniper_east', smg_mp5sd: 'smg_mp5', smg_mp7_hd: 'smg_compact_west', smg_mpx: 'smg_mp5', pistol_glock: 'pistol_west', pistol_deagle: 'pistol_east', revolver_357: 'pistol_east',
};
/** guns whose model already has a suppressor built in */
const BUILT_IN_SUPPRESSOR = new Set(['smg_mp5sd']);

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
      const want = new Set<string>(['soldier_swat', 'att_suppressor', 'att_red_dot', 'att_holo', 'att_scope', ...Object.values(GUN_MODEL), ...Object.values(LOW_MODEL), 'container_red', 'container_green']);
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
  /** low: prefer the original low-poly pack model (ground loot, far away / many instances) */
  gun(id: string, rarity: number, low = false): GunModel | null {
    const key = low && LOW_MODEL[GUN_MODEL[id]] && this.gltf.has(LOW_MODEL[GUN_MODEL[id]]) ? LOW_MODEL[GUN_MODEL[id]] : GUN_MODEL[id]; const g = key && this.gltf.get(key); if (!g) return null;
    const def = WEAPON[id], sockets = this.man[key].sockets ?? {};
    const root = new THREE.Group();
    const body = skClone(g.scene); body.scale.copy(g.scene.scale); root.add(body);
    const sc = body.scale.x;
    const pistolish = def.cls === 'pistol';
    let gripZ = pistolish ? 0.035 : 0.085, guardZ = pistolish ? 0.03 : -0.17;
    const off = new THREE.Vector3();
    const hd = HD_GRIP[key];
    if (hd) {
      const e = this.man[key], L = e.bbox![2], z0 = e.bboxMin![2];
      const bore = sockets.Attach_Muzzle?.[1] ?? 0.016;
      off.set(0, 0.016 - bore, gripZ - (z0 + hd[0] * L));
      body.position.add(off);
      guardZ = pistolish ? gripZ - 0.005 : z0 + hd[1] * L + off.z;
    }
    const sk = (n: string) => (sockets[n] ? new THREE.Vector3(...sockets[n]).multiplyScalar(sc).add(off) : null);
    const top = sk('Attach_Scope') ?? new THREE.Vector3(0, 0.04, 0);
    let sight = top.y + 0.014, optic = false, scope = !!def.scope, opticZ = 0;
    const attach = (k: string, at: THREE.Vector3) => {
      const a = this.gltf.get(k); if (!a) return null; const o = skClone(a.scene); o.position.copy(at); root.add(o);
      // lenses: the pack's "glass" is an opaque grey; make it (and the blue lens coating) see-through
      o.traverse((c) => {
        const m = c as THREE.Mesh; if (!m.isMesh) return;
        const fix = (mt: THREE.Material) => {
          if (!/Glass|Cerulean/.test(mt.name)) return mt;
          const g = (mt as THREE.MeshStandardMaterial).clone();
          g.transparent = true; g.opacity = /Glass/.test(mt.name) ? 0.08 : 0.18; g.depthWrite = false; g.color.setHex(/Glass/.test(mt.name) ? 0xb8d4e0 : 0x3a6a9a); g.roughness = 0.05; g.metalness = 0;
          g.userData.lens = true; return g;
        };
        m.material = Array.isArray(m.material) ? m.material.map(fix) : fix(m.material);
      });
      return o;
    };
    const isSniper = def.cls === 'sniper' || (def.cls === 'marksman' && def.scope);
    if (scope || isSniper) { if (attach('att_scope', top)) { sight = top.y + 0.045; scope = true; } }
    else if (rarity >= 1 && def.cls !== 'shotgun' && def.cls !== 'launcher' && def.cls !== 'pistol') {
      const holo = rarity >= 3;
      const o = attach(holo ? 'att_holo' : 'att_red_dot', top);
      if (o) {
        o.scale.setScalar(1.3); // a touch larger than the pack's so the sight picture reads
        sight = top.y + (holo ? 0.034 : 0.03) * 1.3; optic = true; opticZ = top.z + (holo ? 0.042 : 0.035) * 1.3;
        // illuminated reticle projected "at infinity": drawn on top, only switched on by the first-person view
        const r = new THREE.Mesh(new THREE.PlaneGeometry(0.0065, 0.0065), new THREE.MeshBasicMaterial({ map: reticleTex(false), // every optic shows a plain red dot
 transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
        r.position.set(0, sight, top.z - 0.01); r.renderOrder = 20; r.visible = false; r.userData.reticle = true; r.userData.noBake = true;
        root.add(r);
        // lens mask: a depth-only window drawn before the gun, so nothing of the gun beyond the lens (front
        // sight post, rail, barrel) shows through it; the sight picture is the reticle over the world only
        const bb = new THREE.Box3().setFromObject(o), sz = bb.getSize(new THREE.Vector3());
        const g = holo ? new THREE.PlaneGeometry(sz.x * 0.62, (bb.max.y - sight) * 1.5) : new THREE.CircleGeometry(Math.min(sz.x, bb.max.y - sight) * 0.54, 24);
        const mask = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
        mask.position.set(0, sight + (holo ? (bb.max.y - sight) * 0.05 : 0), (bb.min.z + bb.max.z) / 2); mask.renderOrder = -10; mask.visible = false;
        mask.userData.lensMask = true; mask.userData.noBake = true;
        root.add(mask);
      }
    }
    const mz = sk('Attach_Muzzle');
    let muzzle = mz ? -mz.z : 0.4;
    if (isSuppressed(id, rarity) && mz && !BUILT_IN_SUPPRESSOR.has(key)) { if (attach('att_suppressor', mz)) muzzle += 0.14 * 1; }
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
    return { obj: root, muzzle, sight, scope, optic, gripZ, guardZ, opticZ };
  }

  /**
   * HUD icon: the baked gun projected side-on (muzzle to the left) into a white silhouette, with faces
   * shaded by how square-on they are so rails, magazines and stocks read like the 2020 icons.
   */
  private iconCache = new Map<string, string>(); private iconPending = new Set<string>();
  private worker: Worker | null = null;
  private iconWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./iconWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ key: string; blob: Blob }>) => { this.iconCache.set(e.data.key, URL.createObjectURL(e.data.blob)); this.iconPending.delete(e.data.key); };
    return (this.worker = w);
  }
  /** returns the icon URL once it is ready (encoded off the main thread); null meanwhile, so callers draw a fallback */
  icon(id: string, rarity: number): string | null {
    const ck = `${id}:${Math.min(rarity, 4)}`;
    if (this.iconCache.has(ck)) return this.iconCache.get(ck)!;
    if (this.iconPending.has(ck)) return null;
    this.iconPending.add(ck);
    if (!this.inIdle) { this.iconWant.unshift([id, rarity]); this.pumpIcons(); return null; } // built in idle time, never mid-frame
    const geo = this.bakedGun(id, rarity); if (!geo) { this.iconPending.delete(ck); return null; }
    // drawn in a worker (thousands of canvas triangles per gun used to cost 100+ ms each on the main thread)
    const src = geo.attributes.position as THREE.BufferAttribute, pos = new Float32Array(src.count * 3);
    for (let v = 0; v < src.count; v++) { pos[v * 3] = src.getX(v); pos[v * 3 + 1] = src.getY(v); pos[v * 3 + 2] = src.getZ(v); }
    this.iconWorker().postMessage({ key: ck, pos }, [pos.buffer]);
    return null;
  }

  /**
   * Build every gun's HUD icon and baked loot mesh in idle time (a few per idle slot) so a kill-feed line,
   * loot card or new gun on the ground never stalls the game while it is drawn for the first time.
   */
  warmIcons(ids: string[]) {
    for (const id of ids) if (this.hasGun(id)) for (const r of [0, 1, 3, 4, 2]) this.iconWant.push([id, r]);
    this.pumpIcons();
  }
  private iconWant: [string, number][] = []; private inIdle = false; private pumping = false;
  private pumpIcons() {
    if (this.pumping) return; this.pumping = true;
    const step = (dl?: { timeRemaining(): number }) => {
      const t0 = performance.now(); this.inIdle = true;
      try {
        while (this.iconWant.length && (dl ? dl.timeRemaining() > 4 : performance.now() - t0 < 6)) {
          const [id, r] = this.iconWant.shift()!, ck = `${id}:${Math.min(r, 4)}`;
          if (!this.iconCache.has(ck)) { this.iconPending.delete(ck); this.icon(id, r); }
          this.bakedGun(id, r, true);
        }
      } finally { this.inIdle = false; }
      if (this.iconWant.length) schedule(); else this.pumping = false;
    };
    const schedule = () => { const ric = (window as any).requestIdleCallback; if (ric) ric(step, { timeout: 400 }); else setTimeout(() => step(), 30); };
    schedule();
  }

  /** Whole gun (with attachments) merged into one vertex-coloured geometry, for instancing. */
  bakedGun(id: string, rarity: number, low = false): THREE.BufferGeometry | null {
    const ck = `${id}:${Math.min(rarity, 4)}:${low}`;
    if (this.bakeCache.has(ck)) return this.bakeCache.get(ck)!;
    const gm = this.gun(id, rarity, low); if (!gm) return null;
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
    // a 256 px copy is plenty for per-vertex colours (reading full-size textures took ~1 s per gun)
    const k = Math.min(1, 256 / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k)), c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h); out = { w, h, d: x.getImageData(0, 0, w, h).data };
  } catch { out = null; }
  pixCache.set(img, out); return out;
}

/** Flatten an object tree (rigid or skinned-at-rest) into one geometry with vertex colours sampled from its textures. */
export function bake(obj: THREE.Object3D): THREE.BufferGeometry {
  obj.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3(), c = new THREE.Color();
  obj.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh || m.userData.noBake) return;
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

/** Red dot, or the EOTech-style ring-and-dot for the holographic sight. */
const retCache: THREE.Texture[] = [];
function reticleTex(holo: boolean): THREE.Texture {
  const k = +holo; if (retCache[k]) return retCache[k];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  g.shadowColor = '#ff2a1a'; g.shadowBlur = 6; g.fillStyle = g.strokeStyle = '#ff4a30';
  if (holo) { g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(32, 32, 3, 0, Math.PI * 2); g.fill(); }
  else { g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; retCache[k] = t; return t;
}

export const models = new Models();
