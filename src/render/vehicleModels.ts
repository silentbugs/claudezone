/**
 * Vehicle models built in code (no licensed assets): extruded side profiles with bevels for the shells, tyres with
 * rims and hubs, glass, lamps, bumpers and trim, shaped after the 2020 Warzone vehicles. Forward is -z, wheels on
 * the ground at y = 0; sizes and seat positions match VEHICLES in the sim.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleType } from '../sim/vehicles';

type G = THREE.BufferGeometry;
function col(geo: G, hex: number): G {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number, rx = 0, ry = 0, rz = 0) =>
  col(new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z), c);
/** a straight tube / bar between two points */
function bar(a: [number, number, number], b: [number, number, number], r: number, c: number, seg = 6): G {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return col(g, c);
}
/** side profile (z, y) extruded across the width, edges bevelled */
function profile(pts: [number, number][], width: number, c: number, bevel = 0.06, x = 0): G {
  const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y))); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - 2 * bevel) / 2).rotateY(-Math.PI / 2).translate(x, 0, 0);
  return col(g, c);
}
/** tyre + rim + hub (+ knobby tread ring for off-road tyres) */
function wheel(P: G[], r: number, w: number, x: number, y: number, z: number, rim = 0x7d8084, knobby = false) {
  P.push(col(new THREE.CylinderGeometry(r, r, w, 22).rotateZ(Math.PI / 2).translate(x, y, z), 0x1b1b1a));
  if (knobby) P.push(col(new THREE.CylinderGeometry(r * 1.02, r * 1.02, w * 0.7, 11).rotateZ(Math.PI / 2).translate(x, y, z), 0x222220));
  const side = Math.sign(x) || 1;
  P.push(col(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.04, 16).rotateZ(Math.PI / 2).translate(x + side * (w / 2 + 0.005), y, z), rim));
  P.push(col(new THREE.CylinderGeometry(r * 0.18, r * 0.22, 0.08, 8).rotateZ(Math.PI / 2).translate(x + side * (w / 2 + 0.03), y, z), 0x3a3c3e));
}
const LAMP = 0xf4f1e2, TAIL = 0xa8160e, BLACK = 0x161718, TRIM = 0x2b2c2d;

/** paint variants: 2020 SUVs came in many civilian colours, military vehicles in olive / tan */
export const VARIANTS: Record<VehicleType, number[]> = {
  suv: [0xc4c4bd, 0x1d1f21, 0x6e1a16, 0x8e9498, 0x2b3e57, 0x585c48],
  rover: [0x8a7b5c, 0x5b5f43, 0x6e6a58],
  atv: [0x5a6040, 0x7a2a22, 0x6a6458],
  truck: [0x4f5638, 0x5e5a46],
  heli: [0x4a5236, 0x3c4036],
};

export function vehicleModel(t: VehicleType, paint: number): { body: G; glass: G | null } {
  const P: G[] = [], Gl: G[] = [];
  switch (t) {
    case 'suv': {
      // lower body to the beltline (bonnet included), then a dark glazed cabin with painted pillars and roof
      P.push(profile([[-2.4, 0.42], [-2.44, 0.8], [-2.37, 1.05], [-2.12, 1.2], [-1.02, 1.3], [2.36, 1.32], [2.41, 1.3], [2.42, 0.5], [2.3, 0.38], [-2.28, 0.38]], 1.98, paint, 0.07));
      P.push(profile([[-1.02, 1.29], [-0.6, 1.86], [-0.44, 1.9], [2.14, 1.9], [2.34, 1.82], [2.38, 1.31]], 1.86, BLACK, 0.04)); // glasshouse (tinted)
      P.push(profile([[-0.5, 1.88], [-0.4, 1.97], [2.15, 1.98], [2.3, 1.9], [2.2, 1.86], [-0.42, 1.86]], 1.9, paint, 0.04)); // roof cap
      P.push(box(2.02, 0.17, 4.5, 0, 0.47, 0, TRIM)); // black lower cladding
      for (const z of [-1.5, 1.5]) for (const x of [-1, 1]) P.push(col(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).translate(x * 1.0, 0.42, z), TRIM)); // wheel arch flares
      Gl.push(box(1.72, 0.03, 0.72, 0, 1.6, -0.8, 0, -0.94)); // windscreen
      for (const x of [-1, 1]) Gl.push(box(0.02, 0.46, 2.45, x * 0.945, 1.6, 0.86, 0));
      Gl.push(box(1.62, 0.44, 0.02, 0, 1.6, 2.39, 0));
      for (const z of [-0.5, 0.45, 1.4, 2.28]) for (const x of [-1, 1]) P.push(box(0.05, 0.58, 0.1, x * 0.93, 1.6, z, paint)); // A / B / C / D pillars
      // front: grille, lamps, bumper; back: bumper, tail lamps, plate
      P.push(box(1.36, 0.3, 0.05, 0, 0.96, -2.44, BLACK), box(2.0, 0.22, 0.2, 0, 0.52, -2.42, TRIM), box(2.0, 0.22, 0.2, 0, 0.52, 2.43, TRIM));
      for (const x of [-1, 1]) { P.push(box(0.36, 0.13, 0.05, x * 0.72, 1.08, -2.43, LAMP), box(0.12, 0.3, 0.05, x * 0.9, 1.1, 2.43, TAIL), box(0.2, 0.13, 0.09, x * 1.06, 1.38, -0.82, paint)); }
      P.push(box(0.5, 0.12, 0.02, 0, 0.66, 2.45, 0xe7e6de));
      for (const x of [-1, 1]) P.push(box(0.05, 0.05, 2.3, x * 0.76, 2.02, 0.86, BLACK)); // roof rails
      for (const z of [-0.45, 0.55, 1.5]) for (const x of [-1, 1]) P.push(box(0.008, 0.72, 0.012, x * 1.0, 0.96, z, 0x0e0e0e)); // door shut lines
      for (const z of [-1.5, 1.5]) for (const x of [-1, 1]) wheel(P, 0.4, 0.3, x * 0.88, 0.4, z, 0x9a9da0);
      break;
    }
    case 'rover': {
      // open military buggy: tub with a short bonnet, roll cage, four seats, big knobby tyres, spare on the back
      P.push(profile([[-1.82, 0.52], [-1.86, 0.84], [-1.56, 1.0], [-0.62, 1.05], [-0.46, 0.95], [1.6, 0.95], [1.8, 0.88], [1.8, 0.52], [1.58, 0.42], [-1.6, 0.42]], 1.72, paint, 0.05));
      P.push(box(1.6, 0.06, 2.0, 0, 0.98, 0.55, TRIM)); // floor of the tub
      for (const [x, z, y] of [[-0.45, -0.2, 0.98], [0.45, -0.2, 0.98], [-0.45, 0.9, 1.15], [0.45, 0.9, 1.15]]) P.push(box(0.5, 0.12, 0.48, x, y + 0.06, z, 0x2a2a26), box(0.5, 0.62, 0.1, x, y + 0.36, z + 0.26, 0x2a2a26));
      if (true) { const rc = 0x2a2b2a, r = 0.035;
        for (const x of [-0.82, 0.82]) { P.push(bar([x, 0.95, -0.55], [x, 2.02, -0.42], r, rc), bar([x, 0.95, 1.55], [x, 2.02, 1.5], r, rc), bar([x, 2.02, -0.42], [x, 2.02, 1.5], r, rc), bar([x, 0.95, -1.0], [x, 2.02, -0.42], r, rc)); }
        P.push(bar([-0.82, 2.02, -0.42], [0.82, 2.02, -0.42], r, rc), bar([-0.82, 2.02, 1.5], [0.82, 2.02, 1.5], r, rc), bar([-0.82, 2.02, 0.55], [0.82, 2.02, 0.55], r, rc), bar([-0.82, 1.2, 1.55], [0.82, 1.2, 1.55], r, rc)); }
      P.push(box(1.5, 0.08, 0.12, 0, 0.62, -1.9, TRIM), box(0.06, 0.4, 0.06, -0.6, 0.85, -1.92, TRIM), box(0.06, 0.4, 0.06, 0.6, 0.85, -1.92, TRIM)); // brush bar
      for (const x of [-1, 1]) P.push(box(0.2, 0.12, 0.05, x * 0.6, 0.9, -1.87, LAMP), box(0.1, 0.12, 0.04, x * 0.78, 0.8, 1.81, TAIL));
      P.push(col(new THREE.CylinderGeometry(0.4, 0.4, 0.26, 18).rotateX(Math.PI / 2).translate(0, 1.15, 1.92), 0x1b1b1a), col(new THREE.CylinderGeometry(0.24, 0.24, 0.28, 12).rotateX(Math.PI / 2).translate(0, 1.15, 1.92), 0x5a5c58)); // spare
      P.push(box(0.36, 0.05, 0.05, -0.45, 1.5, -0.62, BLACK)); // steering wheel
      for (const z of [-1.2, 1.25]) for (const x of [-1, 1]) wheel(P, 0.45, 0.38, x * 0.95, 0.45, z, 0x5e605a, true);
      break;
    }
    case 'atv': {
      P.push(box(0.55, 0.32, 1.5, 0, 0.62, 0, TRIM)); // frame + engine
      P.push(profile([[-1.05, 0.72], [-1.08, 0.86], [-0.85, 0.98], [-0.35, 0.98], [-0.28, 0.78]], 1.12, paint, 0.04)); // front fenders
      P.push(profile([[0.35, 0.78], [0.42, 0.98], [0.9, 0.98], [1.08, 0.86], [1.05, 0.72]], 1.12, paint, 0.04)); // rear fenders
      P.push(profile([[-0.42, 0.95], [-0.3, 1.08], [0.42, 1.08], [0.5, 0.95]], 0.42, 0x1f1f1d, 0.04)); // seat
      P.push(box(0.5, 0.3, 0.4, 0, 0.98, -0.5, paint)); // tank / nose
      P.push(bar([-0.38, 1.22, -0.62], [0.38, 1.22, -0.62], 0.025, BLACK), bar([0, 1.0, -0.56], [0, 1.22, -0.62], 0.03, BLACK)); // handlebars
      for (const zr of [-0.85, 0.8]) for (let i = -2; i <= 2; i++) P.push(box(0.03, 0.03, 0.42, i * 0.2, 1.04, zr, TRIM)); // racks
      for (const zr of [-0.85, 0.8]) P.push(box(0.9, 0.03, 0.03, 0, 1.04, zr - 0.2, TRIM), box(0.9, 0.03, 0.03, 0, 1.04, zr + 0.2, TRIM));
      P.push(box(0.16, 0.08, 0.05, 0, 0.92, -1.1, LAMP));
      for (const z of [-0.72, 0.72]) for (const x of [-1, 1]) wheel(P, 0.33, 0.3, x * 0.5, 0.33, z, 0x55575a, true);
      break;
    }
    case 'truck': {
      // military cargo truck: flat-front cab, open bed with drop sides and benches, dual rear axles
      P.push(profile([[-3.75, 1.0], [-3.78, 1.9], [-3.55, 2.12], [-3.2, 2.92], [-1.55, 2.98], [-1.5, 1.0]], 2.38, paint, 0.07));
      P.push(box(2.0, 0.5, 0.06, 0, 1.45, -3.79, BLACK), box(2.4, 0.3, 0.3, 0, 0.95, -3.78, TRIM)); // grille, bumper
      for (const x of [-1, 1]) P.push(box(0.26, 0.2, 0.05, x * 0.92, 1.85, -3.79, LAMP), box(0.12, 0.14, 0.05, x * 1.1, 1.5, 3.76, TAIL), box(0.1, 0.32, 0.08, x * 1.3, 2.4, -3.0, BLACK));
      Gl.push(box(2.1, 0.03, 0.82, 0, 2.52, -3.38, 0, -1.13)); // windscreen
      for (const x of [-1, 1]) Gl.push(box(0.02, 0.55, 1.3, x * 1.2, 2.42, -2.35, 0));
      P.push(box(2.45, 0.32, 6.6, 0, 0.82, 0.4, 0x2a2b28)); // chassis rails
      P.push(box(2.42, 0.18, 5.2, 0, 1.4, 1.1, 0x3b3a33)); // bed floor
      for (const x of [-1, 1]) P.push(box(0.08, 0.6, 5.2, x * 1.17, 1.78, 1.1, paint), box(0.4, 0.08, 4.6, x * 0.82, 1.78, 1.15, 0x4a4434)); // drop sides + benches
      P.push(box(2.42, 0.6, 0.08, 0, 1.78, 3.68, paint), box(2.42, 0.9, 0.1, 0, 1.95, -1.45, paint)); // tailgate, headboard
      for (const z of [-0.4, 1.1, 2.6]) for (const x of [-1, 1]) P.push(box(0.05, 0.9, 0.05, x * 1.17, 2.3, z, TRIM)); // hoop posts
      P.push(box(0.5, 0.5, 1.2, -1.0, 0.9, -0.8, 0x353530)); // fuel tank
      for (const x of [-1, 1]) { wheel(P, 0.55, 0.42, x * 1.06, 0.55, -2.7, 0x55584a, true); for (const z of [1.25, 2.55]) wheel(P, 0.55, 0.42, x * 1.06, 0.55, z, 0x55584a, true); }
      break;
    }
    case 'heli': {
      // light utility helicopter: egg cabin with a big glass nose, open rear seats, tapered boom, fin, skids
      const cab = (thetaS: number, thetaL: number, phiS: number, phiL: number, c: number, r = 1.2) => col(new THREE.SphereGeometry(r, 20, 14, phiS, phiL, thetaS, thetaL).scale(1.0, 0.95, 1.75).translate(0, 1.5, -0.45), c);
      P.push(cab(Math.PI * 0.5, Math.PI * 0.5, 0, Math.PI * 2, paint)); // belly
      P.push(cab(0, Math.PI * 0.5, Math.PI * 0.15, Math.PI * 0.7, paint, 1.21)); // roof + rear upper, leaving the nose glazed
      Gl.push(cab(Math.PI * 0.12, Math.PI * 0.48, Math.PI * 0.85, Math.PI * 1.3, 0, 1.19)); // canopy glass
      P.push(box(0.9, 0.42, 1.4, 0, 2.48, 0.25, paint), box(0.22, 0.22, 0.6, 0, 2.5, 1.0, 0x2a2a28)); // engine fairing + exhaust
      P.push(col(new THREE.CylinderGeometry(0.12, 0.12, 0.45, 10).translate(0, 2.9, 0), 0x2a2a28)); // mast
      P.push(col(new THREE.CylinderGeometry(0.16, 0.36, 4.6, 12).rotateX(Math.PI / 2).translate(0, 1.85, 3.55), paint)); // tail boom
      P.push(box(0.08, 1.25, 0.75, 0.05, 2.3, 5.7, paint, -0.25), box(1.5, 0.05, 0.42, 0, 1.92, 5.0, paint)); // fin, stabiliser
      for (const x of [-1, 1]) {
        P.push(bar([x * 0.95, 0.07, -2.1], [x * 0.95, 0.07, 1.3], 0.045, 0x2a2b2a), bar([x * 0.95, 0.07, -2.1], [x * 0.95, 0.22, -2.4], 0.045, 0x2a2b2a));
        for (const z of [-1.1, 0.6]) P.push(bar([x * 0.95, 0.07, z], [x * 0.55, 0.85, z], 0.04, 0x2a2b2a));
      }
      for (const [x, z] of [[-0.45, 0.4], [0.45, 0.4]]) P.push(box(0.55, 0.1, 0.5, x, 0.85, z, 0x2a2a26), box(0.55, 0.55, 0.08, x, 1.15, z + 0.28, 0x2a2a26)); // rear seats
      P.push(box(0.08, 0.1, 0.06, 0, 0.92, -2.55, LAMP), box(0.05, 0.05, 0.05, 0, 2.95, 6.05, TAIL));
      break;
    }
  }
  return { body: mergeGeometries(P)!, glass: Gl.length ? mergeGeometries(Gl)! : null };
}
