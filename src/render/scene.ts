/** Owns the renderer, scene, world meshes and the camera. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }

  buildWorld(w: WorldData) {
    const mats = materialArray(), terr = terrainArray();
    this.terrain = new TerrainMesh(w.hf, w.extra, terr);
    this.scene.add(this.terrain.group);
    this.structures = new StructureMesh(w.col.structures, mats, w.hf.size);
    this.scene.add(this.structures.group);
    this.scene.add(makeTrees(w.trees));
    this.scene.add(makeSky());
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    const { sun } = makeLights(this.scene);
    this.sun = sun;
    this.water = waterMaterial();
    this.scene.add(makeWater(w.extra.rivers, this.water));
  }

  render() {
    const cam = this.camera.position;
    this.terrain.update(cam);
    this.structures.update(cam);
    followSun(this.sun, cam);
    const sh = (this.water as any).userData.shader; if (sh) sh.uniforms.uTime.value = (performance.now() - this.t0) / 1000;
    this.renderer.render(this.scene, this.camera);
  }
}
