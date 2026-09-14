// Minion LOD for the boss arena: Xbot (Mixamo) with simplified skinned meshes.
//   node scripts/simplify-xbot.mjs [ratio=0.08]  → src/assets/Xbot-lod.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

const ratio = Number(process.argv[2] ?? 0.08);
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('src/assets/Xbot.glb');
const count = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);
const before = count();
// clips stay in Xbot.glb (same bone names) — the LOD file only carries meshes + skin
for (const a of doc.getRoot().listAnimations()) {
  for (const smp of a.listSamplers()) {
    smp.getInput()?.dispose();
    smp.getOutput()?.dispose();
    smp.dispose();
  }
  for (const ch of a.listChannels()) ch.dispose();
  a.dispose();
}
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.03, lockBorder: false }), prune(), dedup());
await io.write('src/assets/Xbot-lod.glb', doc);
console.log(`Xbot tris ${before} → ${count()}`);
