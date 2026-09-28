/** Owns the renderer, scene, world meshes and the camera. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { SUN_DIR } from './environment';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Warzone-ish grade in linear light: slight desaturation, warm highlights / cool shadows, vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 0.88 }, uVig: { value: 0.28 }, uGas: { value: 0 }, uLow: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uVig, uGas, uLow; varying vec2 vUv;
    void main(){ vec4 t = texture2D(tDiffuse, vUv); vec3 c = t.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // gentle filmic contrast around mid-grey
      c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, vec3(1.07));
      c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.05, 0.6, l));
      c = mix(c, c * vec3(1.25, 0.95, 0.55) + vec3(0.06, 0.04, 0.0), uGas * 0.6);
      c = mix(c, vec3(l) * vec3(1.0, 0.85, 0.85), uLow);
      vec2 d = vUv - 0.5; c *= 1.0 - uVig * dot(d, d) * 2.2;
      gl_FragColor = vec4(c, t.a); }`,
};
import type { WorldData } from '../world/mapgen';
import { materialArray, terrainArray, normalArrayFrom, photoArrays, BUILDING_PHOTOS, TERRAIN_PHOTOS } from './textures';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { TerrainMesh } from './terrainMesh';
import { StructureMesh } from './structureMesh';
import { Trees } from './trees';
import { Foliage } from './foliage';
import { makeSky, makeLights, followSun, makeWater, waterMaterial, FOG_COLOR } from './environment';

export class SceneMgr {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  terrain!: TerrainMesh;
  structures!: StructureMesh;
  sun!: THREE.DirectionalLight;
  water!: THREE.Material;
  private t0 = performance.now();
  composer: EffectComposer | null = null;
  grade: ShaderPass | null = null;
  private gtao: GTAOPass | null = null;
  quality: Quality = 'high';
  csm: CSM | null = null;
  private csmTimer = 0;
  private lastFov = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.1, 12000);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.00062);
    this.scene.background = FOG_COLOR.clone();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.csm?.updateFrustums();
    this.composer?.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }

  /** Photo-scanned materials + HDRI lighting; call before buildWorld. Falls back to procedural. */
  private photos: { b?: Awaited<ReturnType<typeof photoArrays>>; t?: Awaited<ReturnType<typeof photoArrays>> } = {};
  async loadPhotoMaterials() {
    try {
      const mats = materialArray(), terr = terrainArray();
      const [b, t] = await Promise.all([
        photoArrays(mats, normalArrayFrom(mats, [0.8, 3, 0.4, 1.6, 2.2, 0.1, 2.5, 1.2, 0.9, 2, 0.25, 0.6, 2, 1.6, 0.8, 1]), BUILDING_PHOTOS),
        photoArrays(terr, normalArrayFrom(terr, [2.5, 2.5, 3.5, 5, 1.5, 2.5, 2, 1.5, 3]), TERRAIN_PHOTOS),
      ]);
      this.photos = { b, t };
      const hdr = await new RGBELoader().loadAsync('tex/sky_1k.hdr');
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.hdrEnv = pm.fromEquirectangular(hdr).texture; hdr.dispose(); pm.dispose();
    } catch (e) { console.warn('photo materials unavailable', e); }
  }
  private hdrEnv: THREE.Texture | null = null;

  buildWorld(w: WorldData) {
    const mats = this.photos.b?.color ?? materialArray(), terr = this.photos.t?.color ?? terrainArray();
    this.terrain = new TerrainMesh(w.hf, w.extra, terr, this.photos.t?.normal);
    this.scene.add(this.terrain.group);
    this.structures = new StructureMesh(w.col.structures, mats, w.hf.size, this.photos.b?.normal, this.photos.b?.colored);
    this.scene.add(this.structures.group);
    this.trees = new Trees(w.trees); this.scene.add(this.trees.group);
    this.grass = new Foliage(w); this.grass.density = this.foliage; this.scene.add(this.grass.mesh);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(w.wires, 3));
    this.scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1e1e1e })));
    this.scene.add(makeSky());
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.hdrEnv ?? pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = this.hdrEnv ? 0.42 : 0.3;
    const { sun } = makeLights(this.scene);
    this.sun = sun;
    this.water = waterMaterial();
    this.scene.add(makeWater(w.extra.rivers, this.water));
  }

  renderScale = 1;
  setRenderScale(s: number) { this.renderScale = s; this.setQuality(this.quality); }
  foliage = 1;
  grass!: Foliage;
  trees!: Trees;
  setFoliage(f: number) { this.foliage = f; if (this.grass) { this.grass.density = f; (this.grass as any).lastCx = 1e9; } }
  setQuality(q: Quality) {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio((q === 'low' ? 1 : Math.min(devicePixelRatio, q === 'medium' ? 1.25 : 1.5)) * this.renderScale);
    r.shadowMap.enabled = q !== 'low';
    if (this.sun) { this.sun.castShadow = q !== 'low'; this.sun.shadow.mapSize.set(q === 'medium' ? 1024 : 2048, q === 'medium' ? 1024 : 2048); this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null; }
    if (this.structures) this.structures.detailDist = q === 'low' ? 260 : q === 'medium' ? 360 : 460;
    // cascaded shadows on high/ultra: long-range shadows from buildings, trees and players
    if (this.csm) { this.csm.remove(); this.csm.dispose(); this.csm = null; }
    if (this.sun && (q === 'high' || q === 'ultra')) {
      this.csm = new CSM({ maxFar: q === 'ultra' ? 1400 : 900, cascades: q === 'ultra' ? 4 : 3, mode: 'practical', parent: this.scene, shadowMapSize: q === 'ultra' ? 4096 : 2048, lightDirection: SUN_DIR.clone().negate(), camera: this.camera, lightIntensity: 2.5, lightFar: 3000, lightMargin: 250 });
      this.csm.fade = true;
      for (const l of this.csm.lights) { l.color.setHex(0xfff0dc); l.shadow.bias = -0.0003; l.shadow.normalBias = 0.5; }
      this.sun.intensity = 0; this.sun.castShadow = false;
      this.csmMaterials = new WeakSet();
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material; if (m) m.needsUpdate = true; });
      this.setupCsm();
    } else if (this.sun) {
      this.sun.intensity = 2.5;
      // undo CSM completely: original shader hook, default program cache key, no CSM defines
      this.scene.traverse((o) => {
        const mats = (o as THREE.Mesh).material; if (!mats) return;
        for (const m of (Array.isArray(mats) ? mats : [mats]) as any[]) {
          if (m.__ownHook) { m.onBeforeCompile = m.__ownHook; delete m.__ownHook; delete m.customProgramCacheKey; }
          if (m.defines) { delete m.defines.USE_CSM; delete m.defines.CSM_CASCADES; delete m.defines.CSM_FADE; }
        }
      });
      this.csmMaterials = new WeakSet();
    }
    // shadow / light setup changed: every material must recompile
    this.scene.traverse((o) => { const mats = (o as THREE.Mesh).material; if (mats) for (const m of Array.isArray(mats) ? mats : [mats]) m.needsUpdate = true; });
    this.composer = null; this.grade = null; this.gtao = null;
    if (q !== 'low') {
      const c = new EffectComposer(r);
      c.addPass(new RenderPass(this.scene, this.camera));
      if (q === 'ultra') { this.gtao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight); this.gtao.blendIntensity = 0.8; c.addPass(this.gtao); }
      if (q !== 'medium') c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 4, innerHeight / 4), 0.12, 0.3, 1.1));
      this.grade = new ShaderPass(GradeShader); c.addPass(this.grade);
      c.addPass(new OutputPass());
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    }
    this.resize();
  }

  private csmMaterials = new WeakSet<THREE.Material>();
  /** Flag every lit material for CSM, chaining its own shader patch after CSM's uniform hook. */
  setupCsm() {
    const csm = this.csm; if (!csm) return;
    this.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material; if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        if (!(m instanceof THREE.MeshStandardMaterial) || this.csmMaterials.has(m)) continue;
        this.csmMaterials.add(m);
        const prev = (m as any).__ownHook ?? m.onBeforeCompile; (m as any).__ownHook = prev;
        csm.setupMaterial(m);
        const csmHook = m.onBeforeCompile;
        m.onBeforeCompile = (sh, r) => { csmHook.call(m, sh, r); prev.call(m, sh, r); };
        const key = prev.toString();
        m.customProgramCacheKey = () => key + '|csm';
        m.needsUpdate = true;
      }
    });
  }

  render() {
    const cam = this.camera.position;
    this.terrain.update(cam);
    this.structures.update(cam);
    followSun(this.sun, cam);
    if (this.csm) { if (this.camera.fov !== this.lastFov) { this.lastFov = this.camera.fov; this.csm.updateFrustums(); } this.camera.updateMatrixWorld(); this.csm.update(); this.csmTimer -= 1 / 60; if (this.csmTimer <= 0) { this.csmTimer = 1; this.setupCsm(); } }
    this.grass?.update(cam, (performance.now() - this.t0) / 1000);
    this.trees?.update(cam, (performance.now() - this.t0) / 1000);
    const sh = (this.water as any).userData.shader; if (sh) sh.uniforms.uTime.value = (performance.now() - this.t0) / 1000;
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
}
