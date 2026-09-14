import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collapse sibling meshes that never move relative to their parent into one mesh per material.
 * Parents keep animating (a mech's forearm group still rotates) — only the draw calls go away.
 * Skipped: meshes in `keep`, meshes with children, skinned / instanced meshes, multi-material
 * meshes and mirrored transforms (baking a negative scale would flip the winding).
 * Source geometries no longer used anywhere under `root` are disposed.
 * Returns the merged geometries so the caller can dispose them.
 */
export function mergeStaticMeshes(root: THREE.Object3D, keep: ReadonlySet<THREE.Object3D> = new Set()): THREE.BufferGeometry[] {
  const created: THREE.BufferGeometry[] = [];
  const removed = new Set<THREE.BufferGeometry>();
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => parents.push(o));
  for (const parent of parents) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const c of parent.children) {
      if (!(c instanceof THREE.Mesh) || c instanceof THREE.SkinnedMesh || c instanceof THREE.InstancedMesh) continue;
      if (c.children.length || keep.has(c) || Array.isArray(c.material) || !c.visible) continue;
      const g = c.geometry as THREE.BufferGeometry;
      // (geometry groups are ignored: with a single material they are just BoxGeometry's per-face ranges)
      if (Object.keys(g.morphAttributes).length) continue;
      c.updateMatrix();
      if (c.matrix.determinant() < 0) continue;
      const attrs = Object.entries(g.attributes)
        .map(([k, a]) => `${k}:${a.itemSize}:${a.normalized}`)
        .sort()
        .join(',');
      const key = `${(c.material as THREE.Material).uuid}|${attrs}|${g.index ? 'i' : 'n'}|${c.renderOrder}|${c.frustumCulled}`;
      const list = buckets.get(key);
      if (list) list.push(c);
      else buckets.set(key, [c]);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const baked = list.map((m) => m.geometry.clone().applyMatrix4(m.matrix));
      const merged = mergeGeometries(baked, false);
      for (const b of baked) b.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.name = `merged:${list[0].name || (list[0].material as THREE.Material).type}`;
      mesh.castShadow = list.some((m) => m.castShadow);
      mesh.receiveShadow = list.some((m) => m.receiveShadow);
      mesh.renderOrder = list[0].renderOrder;
      mesh.frustumCulled = list[0].frustumCulled;
      for (const m of list) {
        parent.remove(m);
        removed.add(m.geometry);
      }
      parent.add(mesh);
      created.push(merged);
    }
  }
  const inUse = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    if ((o as THREE.Mesh).geometry) inUse.add((o as THREE.Mesh).geometry);
  });
  for (const g of removed) if (!inUse.has(g)) g.dispose();
  return created;
}
