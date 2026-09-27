/** Owns the renderer, scene, world meshes and the camera. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Warzone-ish grade in linear light: slight desaturation, warm highlights / cool shadows, vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 0.88 }, uVig: { value: 0.28 }, uGas: { value: 0 }, uLow: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uVig, uGas, uLow; varying vec2 vUv;
    void main(){ vec4 t = texture2D(tDiffuse, vUv); vec3 c = t.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.05, 0.6, l));
      c = mix(c, c * vec3(1.25, 0.95, 0.55) + vec3(0.06, 0.04, 0.0), uGas * 0.6);
      c = mix(c, vec3(l) * vec3(1.0, 0.85, 0.85), uLow);
      vec2 d = vUv - 0.5; c *= 1.0 - uVig * dot(d, d) * 2.2;
      gl_FragColor = vec4(c, t.a); }`,
};
import type { WorldData } from '../world/mapgen';
import { materialArray, terrainArray } from './textures';
import { TerrainMesh } from './terrainMesh';
import { StructureMesh } from './structureMesh';
import { makeTrees } from './trees';
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
    this.scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.00032);
    this.scene.background = FOG_COLOR.clone();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer?.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }

  buildWorld(w: WorldData) {
    const mats = materialArray(), terr = terrainArray();
    this.terrain = new TerrainMesh(w.hf, w.extra, terr);
    this.scene.add(this.terrain.group);
    this.structures = new StructureMesh(w.col.structures, mats, w.hf.size);
    this.scene.add(this.structures.group);
    this.scene.add(makeTrees(w.trees));
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(w.wires, 3));
    this.scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1e1e1e })));
    this.scene.add(makeSky());
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    const { sun } = makeLights(this.scene);
    this.sun = sun;
    this.water = waterMaterial();
    this.scene.add(makeWater(w.extra.rivers, this.water));
  }

  setQuality(q: Quality) {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(q === 'low' ? 1 : Math.min(devicePixelRatio, q === 'medium' ? 1.25 : 1.5));
    r.shadowMap.enabled = q !== 'low';
    if (this.sun) { this.sun.castShadow = q !== 'low'; this.sun.shadow.mapSize.set(q === 'medium' ? 1024 : 2048, q === 'medium' ? 1024 : 2048); this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null; }
    if (this.structures) this.structures.detailDist = q === 'low' ? 260 : q === 'medium' ? 360 : 460;
    this.composer = null; this.grade = null; this.gtao = null;
    if (q !== 'low') {
      const c = new EffectComposer(r);
      c.addPass(new RenderPass(this.scene, this.camera));
      if (q === 'ultra') { this.gtao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight); this.gtao.blendIntensity = 0.8; c.addPass(this.gtao); }
      if (q !== 'medium') c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.22, 0.35, 0.92));
      this.grade = new ShaderPass(GradeShader); c.addPass(this.grade);
      c.addPass(new OutputPass());
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    }
    this.resize();
  }

  render() {
    const cam = this.camera.position;
    this.terrain.update(cam);
    this.structures.update(cam);
    followSun(this.sun, cam);
    const sh = (this.water as any).userData.shader; if (sh) sh.uniforms.uTime.value = (performance.now() - this.t0) / 1000;
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
}
