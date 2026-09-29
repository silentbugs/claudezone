/** Sky dome, sun/hemisphere lights, fog, sea and river water. */
import * as THREE from 'three';
import type { RiverDef } from '../world/terrain';
import { RIVER_DEPTH } from '../world/terrain';
import { SHADER_NOISE } from './terrainMesh';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, -0.35).normalize();
export const FOG_COLOR = new THREE.Color(0xbcc6cc);

/**
 * Aerial perspective for every fogged material: exponential haze that thins with altitude (valleys and
 * the far side of the map sink into haze, the view from a rooftop or the plane stays clearer) and
 * warms toward the sun. Replaces three's plain FogExp2 chunks; scene.fog.density is the ground density.
 */
const FOG_BASE = 20, FOG_FALLOFF = 0.0045;
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogWorld;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogWorld = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 vdFog_fd = vFogWorld; float vdFog_fdist = length(vdFog_fd);
    float vdFog_fk = ${FOG_FALLOFF.toFixed(5)}, vdFog_fh0 = max(cameraPosition.y - ${FOG_BASE.toFixed(1)}, 0.0);
    float vdFog_fdy = vdFog_fd.y * vdFog_fk;
    float vdFog_fint = abs(vdFog_fdy) > 1e-4 ? (1.0 - exp(-vdFog_fdy)) / vdFog_fdy : 1.0;
    float fogFactor = 1.0 - exp(-fogDensity * exp(-vdFog_fk * vdFog_fh0) * vdFog_fdist * vdFog_fint);
    float vdFog_fsun = pow(max(dot(vdFog_fd / max(vdFog_fdist, 1e-3), vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)})), 0.0), 6.0);
    vec3 vdFog_fcol = mix(fogColor, vec3(1.0, 0.9, 0.74), vdFog_fsun * 0.55);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, length(vFogWorld));
    vec3 vdFog_fcol = fogColor;
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vdFog_fcol, clamp(fogFactor, 0.0, 1.0));
#endif`;

/**
 * Interior lighting for every MeshStandardMaterial: a top-down map of roof heights (built from the
 * buildings when the world loads) tells the shader whether a surface is under a roof. Under a roof the
 * sky/ambient light mostly can't reach, so it's cut down and replaced by a dim warm fill (lamps);
 * sunlight still comes in through windows and doors via the shadow maps.
 */
export const INDOOR = {
  map: new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(-1000)]), 1, 1, THREE.RedFormat, THREE.HalfFloatType),
  info: new THREE.Vector4(3240, 1, 0, 0), // x: world size, y: strength
};
INDOOR.map.minFilter = INDOOR.map.magFilter = THREE.NearestFilter; INDOOR.map.needsUpdate = true;
{
  const L = THREE.ShaderLib.physical;
  L.uniforms.indoorMap = { value: INDOOR.map };
  L.uniforms.indoorInfo = { value: INDOOR.info };
  L.vertexShader = '#define USE_INDOOR\nvarying vec3 vIndoorW;\n' + L.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n\tvIndoorW = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;');
  L.fragmentShader = '#define USE_INDOOR\nuniform sampler2D indoorMap; uniform vec4 indoorInfo; varying vec3 vIndoorW;\n' + L.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
	#ifndef NO_INDOOR
	{
		float roofY = texture2D(indoorMap, vIndoorW.xz / indoorInfo.x).r;
		float ind = smoothstep(roofY - 0.3, roofY - 1.0, vIndoorW.y) * indoorInfo.y;
		reflectedLight.indirectDiffuse *= mix(1.0, 0.3, ind);
		reflectedLight.indirectSpecular *= mix(1.0, 0.15, ind);
		reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.85, 0.66) * 0.16 * ind;
		#ifndef USE_SHADOWMAP
		reflectedLight.directDiffuse *= mix(1.0, 0.12, ind); reflectedLight.directSpecular *= mix(1.0, 0.12, ind);
		#endif
	}
	#endif`);
}

/** Rasterise roof heights (half-float, 1.5 m cells) from building parts: wide parts only, inset from their edges. */
export function buildIndoorMap(structs: { kind: string; x: number; y: number; z: number; cos: number; sin: number; parts: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; noCollide?: boolean; shape?: string }[] }[], size: number) {
  const CELL = 1.5, n = Math.ceil(size / CELL), roof = new Float32Array(n * n).fill(-1000);
  const skip = new Set(['door', 'tree', 'lamp', 'pole', 'prop', 'train', 'lattice', 'crane', 'ferris', 'comms']);
  for (const s of structs) {
    if (skip.has(s.kind)) continue;
    for (const p of s.parts) {
      const w = p.x1 - p.x0, d = p.z1 - p.z0;
      if (w < 2.2 || d < 2.2) continue; // walls, columns, posts
      if (p.noCollide && p.shape !== 'gable') continue;
      if (p.y1 < 1.8 && p.shape !== 'gable') continue; // floors / plinths are not roofs
      const top = s.y + (p.shape === 'gable' ? p.y0 : p.y1);
      const ins = 0.6, x0 = p.x0 + ins, x1 = p.x1 - ins, z0 = p.z0 + ins, z1 = p.z1 - ins;
      // walk the part in local space, stamp world cells
      for (let lz = z0; lz <= z1; lz += CELL * 0.7) for (let lx = x0; lx <= x1; lx += CELL * 0.7) {
        const wx = s.x + lx * s.cos + lz * s.sin, wz = s.z - lx * s.sin + lz * s.cos;
        const i = Math.floor(wx / CELL), j = Math.floor(wz / CELL); if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const k = j * n + i; if (top > roof[k]) roof[k] = top;
      }
    }
  }
  const half = new Uint16Array(n * n); for (let k = 0; k < n * n; k++) half[k] = THREE.DataUtils.toHalfFloat(roof[k]);
  INDOOR.map.image = { data: half, width: n, height: n } as any; INDOOR.map.needsUpdate = true;
  INDOOR.info.x = n * CELL;
  return { roof, n, CELL };
}

export function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(9000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR }, uHorizon: { value: new THREE.Color(0xc9d0d2) }, uZenith: { value: new THREE.Color(0x6f8fae) }, uGround: { value: new THREE.Color(0x9a9c96) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uSun, uHorizon, uZenith, uGround; varying vec3 vDir;
      ${SHADER_NOISE}
      void main(){
        float y = vDir.y;
        vec3 c = mix(uHorizon, uZenith, pow(clamp(y,0.0,1.0), 0.55));
        c = mix(c, uGround, smoothstep(0.0, -0.08, y));
        float s = max(dot(vDir, uSun), 0.0);
        c += vec3(1.0,0.93,0.8) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.18);
        // soft high cloud streaks
        vec2 cp = vDir.xz / max(y, 0.08) * 1.4;
        float cl = smoothstep(0.55, 0.85, fbm3(cp * 1.3 + vec2(3.0, 1.0))) * smoothstep(0.02, 0.25, y);
        c = mix(c, vec3(0.93, 0.94, 0.95), cl * 0.5);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

export function makeLights(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight(0xbdd0e6, 0x6b5f4c, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2bf, 3.5);
  sun.position.copy(SUN_DIR).multiplyScalar(200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera as THREE.OrthographicCamera;
  c.left = -90; c.right = 90; c.top = 90; c.bottom = -90; c.near = 1; c.far = 700;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun); scene.add(sun.target);
  return { hemi, sun };
}

/** Keep the shadow frustum centred on the camera, snapped to texels to avoid shimmer. */
export function followSun(sun: THREE.DirectionalLight, focus: THREE.Vector3) {
  const texel = 180 / 2048;
  const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
  sun.target.position.set(fx, focus.y, fz);
  sun.position.set(fx + SUN_DIR.x * 300, focus.y + SUN_DIR.y * 300, fz + SUN_DIR.z * 300);
  sun.target.updateMatrixWorld();
}

export function waterMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x2c4a58, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    (m as any).userData.shader = sh;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWP;\n' + SHADER_NOISE)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 p = vWP.xz;
        float e = 0.6;
        float h0 = fbm3(p * 0.08 + uTime * vec2(0.05, 0.03)) + fbm3(p * 0.31 - uTime * vec2(0.09, 0.06)) * 0.4;
        float hx = fbm3((p + vec2(e,0.0)) * 0.08 + uTime * vec2(0.05, 0.03)) + fbm3((p + vec2(e,0.0)) * 0.31 - uTime * vec2(0.09, 0.06)) * 0.4;
        float hz = fbm3((p + vec2(0.0,e)) * 0.08 + uTime * vec2(0.05, 0.03)) + fbm3((p + vec2(0.0,e)) * 0.31 - uTime * vec2(0.09, 0.06)) * 0.4;
        vec3 wn = normalize(vec3((h0 - hx) * 2.2, 1.0, (h0 - hz) * 2.2));
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        vec3 V = normalize(cameraPosition - vWP);
        float fres = pow(1.0 - clamp(dot(V, vec3(0.0,1.0,0.0)), 0.0, 1.0), 4.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.72, 0.78, 0.82), fres * 0.6);`);
  };
  return m;
}

export function makeWater(rivers: RiverDef[], mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000, 1, 1).rotateX(-Math.PI / 2), mat);
  sea.position.set(1620, 0, 1620);
  sea.receiveShadow = true;
  g.add(sea);
  // rivers: ribbons along the unfrozen stretch at the surface profile
  for (const rv of rivers) {
    const pos: number[] = [], idx: number[] = [];
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const s = rv.frozenUntil + (1 - rv.frozenUntil) * (i / steps);
      const L = s * rv.len;
      let k = 0; while (k < rv.cum.length - 2 && rv.cum[k + 1] < L) k++;
      const t = (L - rv.cum[k]) / Math.max(1e-6, rv.cum[k + 1] - rv.cum[k]);
      const [ax, az] = rv.pts[k], [bx, bz] = rv.pts[k + 1];
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const surf = rv.surf[k] + ((rv.surf[k + 1] ?? 0) - rv.surf[k]) * t;
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l, w = rv.halfW + 3;
      pos.push(x + nx * w, surf + 0.02, z + nz * w, x - nx * w, surf + 0.02, z - nz * w);
      if (i > 0) { const b = (i - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 1;
    (m.material as THREE.Material).side = THREE.DoubleSide;
    g.add(m);
  }
  void RIVER_DEPTH;
  return g;
}
