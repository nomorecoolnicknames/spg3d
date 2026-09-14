import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
console.log('skins', root.listSkins().map((s) => s.listJoints().map((j) => j.getName())));
for (const n of root.listNodes()) if (n.getMesh()) console.log('node', n.getName(), 'skin', !!n.getSkin(), 'prims', n.getMesh().listPrimitives().length);
const m0 = root.listMeshes().find((m) => m.getName().startsWith('body_LOD0'));
const p0 = m0.listPrimitives()[0];
console.log('attrs', p0.listSemantics(), 'color itemSize', p0.getAttribute('COLOR_0')?.getElementSize(), p0.getAttribute('COLOR_0')?.getComponentType());
const col = p0.getAttribute('COLOR_0').getArray();
let aoMin = 9, aoMax = -9, aoSum = 0, n = 0;
for (let i = 3; i < col.length; i += 4) { aoMin = Math.min(aoMin, col[i]); aoMax = Math.max(aoMax, col[i]); aoSum += col[i]; n++; }
console.log('AO(alpha) min/max/avg', aoMin, aoMax, (aoSum / n).toFixed(3));
const rows = [];
for (const p of m0.listPrimitives()) {
  const uv = p.getAttribute('TEXCOORD_0')?.getArray();
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  if (uv) for (let i = 0; i < uv.length; i += 2) { umin = Math.min(umin, uv[i]); umax = Math.max(umax, uv[i]); vmin = Math.min(vmin, uv[i + 1]); vmax = Math.max(vmax, uv[i + 1]); }
  const mt = p.getMaterial();
  const tex = mt.getBaseColorTexture();
  rows.push(`${mt.getName().slice(0, 34).padEnd(34)} tris=${String((p.getIndices()?.getCount() ?? 0) / 3).padStart(6)} tex=${tex ? tex.getSize()?.join('x') : '-'} mr=${mt.getMetallicRoughnessTexture() ? 'tex' : '-'} alpha=${mt.getAlphaMode()} uv=[${umin.toFixed(2)},${umax.toFixed(2)}]x[${vmin.toFixed(2)},${vmax.toFixed(2)}]`);
}
console.log(rows.join('\n'));
