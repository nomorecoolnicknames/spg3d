// Optimizes the raw Sketchfab car GLBs (src/assets/cars-src) into src/assets/cars.
// - wheels are detected (by node name or geometry) and given their own materials named
//   `spgwheel_<i>` so that joining keeps each wheel a separate mesh (CarVisual spins them)
// - everything else is flattened + joined by material (draw calls: ~900 → ~20)
// - weld + simplify, meshopt compression, webp textures capped at 1024 px
// Run: npm run assets:optimize
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, simplify, prune, textureCompress, getBounds, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join as pjoin } from 'node:path';

const src = 'src/assets/cars-src';
const out = 'src/assets/cars';
mkdirSync(out, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const WHEEL_NAME = /^3DWheel (Front|Rear) [LR]|^WHEEL_[FR][LR]$|Combined3DWheel_3DWheel_Front_L Instance/;

function findWheelNodes(doc) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const named = root.listNodes().filter((n) => WHEEL_NAME.test(n.getName()));
  // keep top-most matches
  const top = named.filter((n) => {
    let p = n.getParentNode();
    while (p) {
      if (named.includes(p)) return false;
      p = p.getParentNode();
    }
    return true;
  });
  if (top.length === 4) return top;
  // geometric detection: bounds of every node with a mesh
  const sb = getBounds(scene);
  const size = sb.max.map((v, i) => v - sb.min[i]);
  const length = Math.max(size[0], size[2]);
  const hits = [];
  for (const n of root.listNodes()) {
    if (!n.getMesh()) continue;
    const b = getBounds(n);
    const s = b.max.map((v, i) => v - b.min[i]);
    const c = b.max.map((v, i) => (v + b.min[i]) / 2);
    const dia = Math.max(s[1], Math.max(s[0], s[2]) === s[0] ? s[2] : s[0]);
    const axes = [s[0], s[1], s[2]].sort((a, b) => a - b);
    // two large equal-ish axes, one small
    if (axes[2] < length * 0.12 || axes[2] > length * 0.24) continue;
    if (Math.abs(axes[2] - axes[1]) > axes[2] * 0.22) continue;
    if (axes[0] > axes[2] * 0.75) continue;
    if (c[1] - sb.min[1] > axes[2] * 0.8) continue;
    hits.push({ n, c, dia });
  }
  return hits.map((h) => h.n);
}

for (const f of readdirSync(src).filter((x) => x.endsWith('.glb'))) {
  const i = pjoin(src, f), o = pjoin(out, f);
  const doc = await io.read(i);
  await doc.transform(dedup());
  const wheels = findWheelNodes(doc);
  console.log(f, 'wheel nodes:', wheels.length, wheels.map((w) => w.getName()).join(' | ').slice(0, 120));
  // give each wheel subtree its own material copies
  wheels.forEach((w, wi) => {
    const nodes = [w];
    w.traverse((n) => nodes.push(n));
    const matMap = new Map();
    for (const n of nodes) {
      const mesh = n.getMesh();
      if (!mesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const m = prim.getMaterial();
        if (!m) continue;
        let c = matMap.get(m);
        if (!c) {
          c = m.clone().setName(`spgwheel_${wi}`);
          // distinct content so dedup never merges wheel materials back
          c.setEmissiveFactor([0, 0, 0.0001 * (wi + 1)]);
          matMap.set(m, c);
        }
        prim.setMaterial(c);
      }
    }
  });
  await doc.transform(
    flatten(),
    join({ keepNamed: false, keepMeshes: false }),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.0008 }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const meshes = doc.getRoot().listMeshes().length;
  const prims = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
  await io.write(o, doc);
  console.log(`  ${(statSync(i).size / 1e6).toFixed(1)} MB -> ${(statSync(o).size / 1e6).toFixed(1)} MB, meshes ${meshes}, prims ${prims}, tris ${Math.round(tris)}`);
}
