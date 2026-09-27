/**
 * One description of every gun as a list of primitive parts (gun-local metres, -z = muzzle).
 * The first-person model, the 3D loot model and the HUD's 2D silhouette are all built from it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WeaponDef, RARITY_COLORS } from '../data/weapons';

export interface GunPart { kind: 'box' | 'cyl' | 'cone' | 'disc'; x: number; y: number; z: number; w: number; h: number; d: number; rx?: number; color: number }
export interface GunDesc { parts: GunPart[]; muzzle: number; sight: number; scope: boolean; optic: boolean }

const METAL = 0x4a4e52, DARK = 0x2e3032, POLY = 0x46483f, WOOD = 0x7b5a3a, TAN = 0x7d7458;

export function describeGun(def: WeaponDef, rarity: number): GunDesc {
  const P: GunPart[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0) => P.push({ kind: 'box', x, y, z, w, h, d, rx, color });
  const cyl = (r: number, len: number, x: number, y: number, z: number, color: number) => P.push({ kind: 'cyl', x, y, z, w: r * 2, h: r * 2, d: len, color });
  const lk = def.look;
  const tint = rarity === 5 ? 0x4a3040 : rarity >= 4 ? 0x5a4a2a : rarity >= 3 ? 0x3a3448 : rarity >= 2 ? 0x34404a : METAL;
  if (lk.knife) {
    box(0.03, 0.035, 0.12, 0, -0.02, 0.06, 0x1e1e1e); box(0.006, 0.03, 0.2, 0, -0.01, -0.1, 0xb8bcc0); box(0.05, 0.012, 0.012, 0, -0.01, 0.0, 0x333333);
    return { parts: P, muzzle: 0.2, sight: 0.05, scope: false, optic: false };
  }
  if (lk.slide) {
    if (lk.revolver) {
      box(lk.slide * 0.8, 0.035, 0.08, 0, 0.02, 0.03, tint); cyl(0.028, 0.05, 0, 0.005, -0.015, DARK); cyl(0.011, 0.14, 0, 0.022, -0.1, tint);
      box(lk.slide * 0.8, 0.1, 0.045, 0, -0.06, 0.07, WOOD, -0.3);
      return { parts: P, muzzle: 0.18, sight: 0.045, scope: false, optic: false };
    }
    box(lk.slide, 0.045, lk.recv, 0, 0.022, -0.03, tint);
    box(lk.slide * 0.9, 0.03, lk.recv * 0.8, 0, -0.012, -0.04, DARK);
    box(lk.slide * 0.85, 0.11, 0.05, 0, -0.07, 0.045, POLY, -0.22);
    box(0.008, 0.012, 0.012, 0, 0.05, -0.12, DARK); box(lk.slide, 0.01, 0.012, 0, 0.05, 0.05, DARK);
    return { parts: P, muzzle: lk.recv * 0.6 + 0.02, sight: 0.05, scope: false, optic: false };
  }
  if (lk.tubeDia) {
    // launchers: a tube with grips (RPG gets its warhead cone)
    cyl(lk.tubeDia, lk.barrel, 0, 0.02, -lk.barrel * 0.35, def.id === 'rpg' ? 0x3d4a2e : 0x4a4e44);
    if (def.id === 'rpg') P.push({ kind: 'cone', x: 0, y: 0.02, z: -lk.barrel * 0.85 - 0.05, w: 0.12, h: 0.12, d: 0.2, color: 0x4a5a3a });
    if (lk.mag === 'drum') cyl(0.06, 0.12, 0, -0.02, -0.02, DARK);
    box(0.03, 0.1, 0.04, 0, -0.06, 0.05, POLY, -0.2); box(0.03, 0.09, 0.04, 0, -0.06, -0.2, POLY, -0.2);
    if (lk.stock === 'wood') box(0.045, 0.08, 0.24, 0, -0.03, 0.22, WOOD);
    return { parts: P, muzzle: lk.barrel * 0.85 + 0.05, sight: 0.09, scope: false, optic: false };
  }
  const furn = lk.wood ? WOOD : POLY;
  const guardW = lk.guardW ?? 0.058;
  const zf = lk.bull ? -lk.recv * 0.45 : -lk.recv * 0.55;
  box(0.055, 0.07, lk.recv, 0, 0, lk.bull ? 0.06 : -0.05, tint);
  if (lk.guard > 0) box(guardW, guardW, lk.guard, 0, 0.003, zf - lk.guard / 2 + 0.05, lk.wood ? WOOD : POLY);
  const bz = zf - lk.guard + 0.05;
  if (lk.barrel > 0) {
    cyl(lk.jacket ? 0.022 : 0.012, lk.barrel, 0, 0.012, bz - lk.barrel / 2, DARK);
    if (lk.jacket) for (let i = 0; i < 5; i++) cyl(0.024, 0.02, 0, 0.012, bz - 0.05 - i * Math.min(0.07, lk.barrel / 6), METAL);
    cyl(0.017, 0.05, 0, 0.012, bz - lk.barrel - 0.02, DARK);
  }
  const muzzle = -(bz - lk.barrel - 0.045);
  const mz = lk.bull ? 0.16 : zf + 0.1, ml = lk.magLen ?? 0.14;
  switch (lk.mag) {
    case 'curve': for (let i = 0; i < 3; i++) box(0.032, ml / 3 + 0.01, 0.06, 0, -0.05 - (i + 0.5) * ml / 3, mz + i * 0.018, DARK, 0.12 + i * 0.12); break;
    case 'straight': box(0.032, ml, 0.055, 0, -0.04 - ml / 2, mz, DARK, 0.08); break;
    case 'box': box(0.1, 0.11, 0.13, -0.025, -0.08, mz, POLY); break;
    case 'drum': P.push({ kind: 'disc', x: -0.03, y: -0.08, z: mz, w: 0.05, h: 0.15, d: 0.15, color: DARK }); break;
    case 'grip': box(0.03, ml, 0.045, 0, -0.04 - ml / 2, 0.08, DARK, -0.25); break;
    case 'tube': cyl(0.013, lk.barrel * 0.85, 0, -0.018, bz - lk.barrel * 0.42, DARK); box(0.055, 0.05, 0.14, 0, -0.02, bz - 0.12, furn); break;
    case 'top': box(0.05, 0.03, 0.3, 0, 0.05, -0.02, TAN); break;
    case 'helical': cyl(0.03, 0.26, 0, -0.045, zf - 0.08, DARK); break;
    case 'pan': P.push({ kind: 'disc', x: 0, y: 0.06, z: -0.02, w: 0.02, h: 0.18, d: 0.18, color: DARK }); break;
  }
  const gz = lk.bull ? -0.1 : 0.1;
  box(0.034, 0.09, 0.042, 0, -0.075, gz, furn, -0.3);
  box(0.01, 0.01, 0.07, 0, -0.045, gz - 0.05, DARK);
  switch (lk.stock) {
    case 'full': box(0.045, 0.075, 0.22, 0, -0.02, 0.27, furn); break;
    case 'wood': box(0.045, 0.085, 0.26, 0, -0.03, 0.29, WOOD, 0.08); break;
    case 'thumbhole': box(0.045, 0.1, 0.24, 0, -0.03, 0.28, furn); box(0.046, 0.03, 0.12, 0, 0.0, 0.27, 0x111111); break;
    case 'tube': cyl(0.014, 0.16, 0, -0.005, 0.2, DARK); box(0.042, 0.07, 0.07, 0, -0.02, 0.3, POLY); break;
    case 'fold': box(0.012, 0.05, 0.2, 0.02, -0.01, 0.22, DARK); box(0.04, 0.06, 0.03, 0.02, -0.02, 0.33, DARK); break;
  }
  if (lk.bipod) { box(0.01, 0.12, 0.01, 0.025, -0.07, bz + 0.02, DARK, 0.35); box(0.01, 0.12, 0.01, -0.025, -0.07, bz + 0.02, DARK, 0.35); }
  box(0.045, 0.01, lk.recv * 0.8, 0, 0.04, -0.05, DARK);
  let sight = 0.06, scope = !!def.scope, optic = false;
  if (lk.scope === 'aug') { cyl(0.02, 0.18, 0, 0.075, -0.02, DARK); box(0.03, 0.03, 0.05, 0, 0.05, -0.02, DARK); sight = 0.075; optic = true; }
  else if (lk.scope === 'tube' || scope) {
    cyl(0.022, 0.3, 0, 0.078, -0.05, DARK); cyl(0.03, 0.06, 0, 0.078, -0.22, DARK); cyl(0.027, 0.05, 0, 0.078, 0.1, DARK);
    box(0.015, 0.03, 0.02, 0, 0.055, -0.12, DARK); box(0.015, 0.03, 0.02, 0, 0.055, 0.02, DARK);
    sight = 0.078; scope = true;
  } else if (rarity >= 1 && def.cls !== 'shotgun') {
    box(0.04, 0.012, 0.07, 0, 0.051, -0.05, DARK);
    box(0.005, 0.042, 0.05, -0.019, 0.078, -0.05, DARK); box(0.005, 0.042, 0.05, 0.019, 0.078, -0.05, DARK);
    box(0.043, 0.005, 0.05, 0, 0.101, -0.05, DARK);
    sight = 0.078; optic = true;
  } else { box(0.008, 0.03, 0.01, 0, 0.055, bz + 0.02, DARK); box(0.03, 0.02, 0.01, 0, 0.05, 0.08, DARK); sight = 0.062; }
  if (rarity >= 2 && rarity <= 5) box(0.057, 0.012, 0.12, 0, 0.028, 0.02, parseInt(RARITY_COLORS[rarity].slice(1), 16));
  return { parts: P, muzzle, sight, scope, optic };
}

function colored(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex).convertSRGBToLinear(), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}

export function gunGeometry(desc: GunDesc): THREE.BufferGeometry {
  const geos = desc.parts.map((p) => {
    let g: THREE.BufferGeometry;
    if (p.kind === 'box') g = new THREE.BoxGeometry(p.w, p.h, p.d);
    else if (p.kind === 'cyl') g = new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.d, 10).rotateX(Math.PI / 2);
    else if (p.kind === 'cone') g = new THREE.ConeGeometry(p.w / 2, p.d, 8).rotateX(-Math.PI / 2);
    else g = new THREE.CylinderGeometry(p.h / 2, p.h / 2, p.w, 14).rotateZ(Math.PI / 2);
    if (p.rx) g.rotateX(p.rx);
    g.translate(p.x, p.y, p.z);
    g.deleteAttribute('uv');
    return colored(g, p.color);
  });
  return mergeGeometries(geos)!;
}

/** Side-view silhouette as an SVG string (muzzle to the left), for HUD and item cards. */
export function gunSilhouette(desc: GunDesc, fill = '#fff'): string {
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of desc.parts) { z0 = Math.min(z0, p.z - p.d / 2); z1 = Math.max(z1, p.z + p.d / 2); y0 = Math.min(y0, p.y - p.h / 2); y1 = Math.max(y1, p.y + p.h / 2); }
  const pad = 0.01, W = z1 - z0 + pad * 2, H = y1 - y0 + pad * 2;
  const els = desc.parts.map((p) => {
    const cx = p.z - z0 + pad, cy = y1 - p.y + pad;
    if (p.kind === 'disc') return `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${(p.h / 2).toFixed(3)}"/>`;
    const rot = p.rx ? ` transform="rotate(${((-p.rx * 180) / Math.PI).toFixed(1)} ${cx.toFixed(3)} ${cy.toFixed(3)})"` : '';
    return `<rect x="${(cx - p.d / 2).toFixed(3)}" y="${(cy - p.h / 2).toFixed(3)}" width="${p.d.toFixed(3)}" height="${p.h.toFixed(3)}" rx="0.004"${rot}/>`;
  });
  return `<svg viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}" xmlns="http://www.w3.org/2000/svg" fill="${fill}">${els.join('')}</svg>`;
}
