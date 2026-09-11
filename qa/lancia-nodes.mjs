import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('src/assets/cars-src/lancia_037_stradale_1978.glb');
const sb = getBounds(doc.getRoot().listScenes()[0]);
console.log('scene', sb.min.map(v=>v.toFixed(1)), sb.max.map(v=>v.toFixed(1)));
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m) continue;
  const b = getBounds(n); const s = b.max.map((v,i)=>v-b.min[i]); const c = b.max.map((v,i)=>(v+b.min[i])/2);
  const mats = [...new Set(m.listPrimitives().map(p=>p.getMaterial()?.getName()))].join(',');
  console.log(`${n.getName().padEnd(14)} c=[${c.map(v=>v.toFixed(1))}] s=[${s.map(v=>v.toFixed(1))}] ${mats}`);
}
