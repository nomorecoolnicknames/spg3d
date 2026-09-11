import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of ['BMW_2018','toyota_supra_mk4_a80','2020_bmw_m8','ford_gt40','bugatti_bolide_2024','lancia_037_stradale_1978']) {
  const doc = await io.read(`src/assets/cars/${f}.glb`);
  const root = doc.getRoot();
  const sb = getBounds(root.listScenes()[0]);
  const out = [];
  for (const n of root.listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    const mats = new Set(m.listPrimitives().map(p => p.getMaterial()?.getName() ?? ''));
    const wm = [...mats].filter(x => x.startsWith('spgwheel'));
    if (!wm.length) continue;
    const b = getBounds(n);
    const c = b.max.map((v,i)=>((v+b.min[i])/2).toFixed(2)); const s = b.max.map((v,i)=>(v-b.min[i]).toFixed(2));
    out.push(`${wm.join('+')} c=[${c}] s=[${s}]`);
  }
  console.log(f, 'scene size', sb.max.map((v,i)=>(v-sb.min[i]).toFixed(1)).join('x'), '\n  ' + out.join('\n  '));
}
