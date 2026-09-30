/**
 * Gun HUD icons, drawn off the main thread: the baked gun projected side-on (muzzle to the left) into a white
 * silhouette, faces shaded by how square-on they are so rails, magazines and stocks read like the 2020 icons.
 * In: { key, pos: Float32Array (xyz triangles) }. Out: { key, blob }.
 */
self.onmessage = async (ev: MessageEvent<{ key: string; pos: Float32Array }>) => {
  const { key, pos } = ev.data, n = pos.length / 3;
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2], y = pos[i * 3 + 1]; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const W = 256, pad = 3, s = (W - pad * 2) / (z1 - z0), H = Math.max(8, Math.ceil((y1 - y0) * s + pad * 2));
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d')!;
  // triangles far side first so the near face wins
  const tris: { d: number; k: number; o: number }[] = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const o = i * 3;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2], bx = pos[o + 3] - ax, by = pos[o + 4] - ay, bz = pos[o + 5] - az, cx = pos[o + 6] - ax, cy = pos[o + 7] - ay, cz = pos[o + 8] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx, len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    tris.push({ d: (ax * 3 + bx + cx) / 3, k: Math.abs(nx / len), o });
  }
  tris.sort((u, v) => u.d - v.d);
  g.lineWidth = 0.4;
  for (const t of tris) {
    const lv = Math.round(150 + 105 * Math.pow(t.k, 0.6));
    g.fillStyle = g.strokeStyle = `rgb(${lv},${lv},${lv})`;
    g.beginPath();
    for (let j = 0; j < 3; j++) { const X = pad + (pos[t.o + j * 3 + 2] - z0) * s, Y = pad + (y1 - pos[t.o + j * 3 + 1]) * s; if (j) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.closePath(); g.fill(); g.stroke();
  }
  const blob = await c.convertToBlob({ type: 'image/png' });
  (self as unknown as Worker).postMessage({ key, blob });
};
