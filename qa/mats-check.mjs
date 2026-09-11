import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(`src/assets/cars/${f}.glb`);
  const tris = new Map();
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const mat = p.getMaterial(); const n = (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
    tris.set(mat, (tris.get(mat) ?? 0) + n);
  }
  console.log('==', f);
  [...tris.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([m, n]) => console.log(`  ${Math.round(n).toString().padStart(6)}  ${m.getName().padEnd(34)} base=[${m.getBaseColorFactor().map(v=>v.toFixed(2))}] tex=${!!m.getBaseColorTexture()} alpha=${m.getAlphaMode()} metal=${m.getMetallicFactor().toFixed(2)} rough=${m.getRoughnessFactor().toFixed(2)}`));
}
