import type * as THREE from 'three';
/** Drop the JS-side copies of a static geometry's buffers once they are on the GPU. */
export function releaseAfterUpload(g: THREE.BufferGeometry) {
  const free = function (this: THREE.BufferAttribute) { (this as any).array = null; };
  for (const k of Object.keys(g.attributes)) (g.attributes[k] as THREE.BufferAttribute).onUpload(free);
  g.index?.onUpload(free);
}
