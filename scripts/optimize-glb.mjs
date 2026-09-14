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

// usage: node scripts/optimize-glb.mjs [outDir] [simplifyRatio] [textureSize]
//        node scripts/optimize-glb.mjs --intermediate <outDir>   (wheel-tagged, joined, uncompressed: input for scripts/bake-cars.py)
const INTERMEDIATE = process.argv.includes('--intermediate');
const args = process.argv.slice(2).filter((a) => a !== '--intermediate');
const src = 'src/assets/cars-src';
const out = args[0] ?? 'src/assets/cars';
const RATIO = Number(args[1] ?? 0.55);
const TEX = Number(args[2] ?? 1024);
mkdirSync(out, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const WHEEL_NAME = /^3DWheel (Front|Rear) [LR]|^WHEEL_[FR][LR]$|Combined3DWheel_3DWheel_Front_L Instance/;
// models where all four wheels live in ONE mesh: split that mesh by quadrant into 4 wheel nodes
const SPLIT_BY_MATERIAL = { 'lancia_037_stradale_1978.glb': /^SsrFormulaSpf1Mtl$/ };

/** Splits primitives of nodes whose material matches into 4 quadrant primitives → 4 new nodes. */
function splitWheelsByQuadrant(doc, re) {
  const root = doc.getRoot();
  const made = [];
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const prims = mesh.listPrimitives().filter((p) => re.test(p.getMaterial()?.getName() ?? ''));
    if (!prims.length) continue;
    const parent = n.getParentNode() ?? root.listScenes()[0];
    for (const prim of prims) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const raw = pos.getArray();
      const I = idx ? idx.getArray() : Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
      // bucket in WORLD space (the node may be rotated so local x/z are not left/right, front/back)
      const M = n.getWorldMatrix();
      const P = new Float32Array(raw.length);
      for (let i = 0; i < pos.getCount(); i++) {
        const x = raw[i * 3], y = raw[i * 3 + 1], z = raw[i * 3 + 2];
        P[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
        P[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        P[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < pos.getCount(); i++) {
        minX = Math.min(minX, P[i * 3]); maxX = Math.max(maxX, P[i * 3]);
        minZ = Math.min(minZ, P[i * 3 + 2]); maxZ = Math.max(maxZ, P[i * 3 + 2]);
      }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const buckets = [[], [], [], []];
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], b = I[t + 1], c = I[t + 2];
        const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        buckets[(x < cx ? 0 : 1) + (z < cz ? 0 : 2)].push(a, b, c);
      }
      const buffer = root.listBuffers()[0];
      buckets.forEach((tris, k) => {
        if (!tris.length) return;
        const acc = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(tris)).setBuffer(buffer);
        const np = doc.createPrimitive().setMode(prim.getMode()).setMaterial(prim.getMaterial()).setIndices(acc);
        for (const sem of prim.listSemantics()) np.setAttribute(sem, prim.getAttribute(sem));
        const nm = doc.createMesh(`SPLITWHEEL_${k}`).addPrimitive(np);
        const nn = doc.createNode(`SPLITWHEEL_${k}`).setMesh(nm).setTranslation(n.getTranslation()).setRotation(n.getRotation()).setScale(n.getScale());
        parent.addChild(nn);
        made.push(nn);
      });
      mesh.removePrimitive(prim);
    }
  }
  return made;
}

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
  const splitRe = SPLIT_BY_MATERIAL[f];
  const wheels = splitRe ? splitWheelsByQuadrant(doc, splitRe) : findWheelNodes(doc);
  console.log(f, 'wheel nodes:', wheels.length, wheels.map((w) => w.getName()).join(' | ').slice(0, 120));
  // give each wheel subtree its own material copies; meshes shared between wheel nodes
  // (instanced wheels) are made unique first, otherwise all wheels would collapse into one
  const meshUsers = new Map();
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh();
    if (m) meshUsers.set(m, (meshUsers.get(m) ?? 0) + 1);
  }
  wheels.forEach((w, wi) => {
    const nodes = [w];
    w.traverse((n) => nodes.push(n));
    const matMap = new Map();
    for (const n of nodes) {
      let mesh = n.getMesh();
      if (!mesh) continue;
      if ((meshUsers.get(mesh) ?? 0) > 1) {
        const copy = doc.createMesh(mesh.getName());
        for (const prim of mesh.listPrimitives()) copy.addPrimitive(prim.clone());
        n.setMesh(copy);
        meshUsers.set(mesh, meshUsers.get(mesh) - 1);
        mesh = copy;
      }
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
  if (INTERMEDIATE) {
    await doc.transform(flatten(), join({ keepNamed: false, keepMeshes: false }), weld(), prune());
  } else {
    await doc.transform(
      flatten(),
      join({ keepNamed: false, keepMeshes: false }),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: RATIO < 0.4 ? 0.003 : 0.0008 }),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX] }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
  }
  const meshes = doc.getRoot().listMeshes().length;
  const prims = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
  await io.write(o, doc);
  console.log(`  ${(statSync(i).size / 1e6).toFixed(1)} MB -> ${(statSync(o).size / 1e6).toFixed(1)} MB, meshes ${meshes}, prims ${prims}, tris ${Math.round(tris)}`);
}
