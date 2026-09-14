// Packs a rigged car (scripts/bake-cars.py output) into one material per body LOD.
//
//   node scripts/atlas-cars.mjs <in.rig.glb> <out.glb> '<spec json>'
//   spec: { model, paint: [name fragments], atlas: 1024 | 2048, lods: [0,1,2] }
//
// For every original material of the body:
//   • textured, UVs within [0,1] (±tolerance) → the texture gets a rectangle in the atlas, sized by
//     the surface area it covers (texel density solved by binary search so everything fits)
//   • textured but tiling (UVs far outside [0,1]) → average colour of the texture, flat palette cell
//   • untextured → flat palette cell with its base colour / metallic / roughness
//   • paint → near-white cell (colour is applied at runtime through the COLOR_0 paint mask)
// UVs are rewritten, all primitives of a LOD are joined → ONE draw call per body LOD.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { joinPrimitives, prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [IN, OUT, SPEC_JSON] = process.argv.slice(2);
const SPEC = JSON.parse(SPEC_JSON);
const A = SPEC.atlas ?? 1024;
const KEEP = new Set(SPEC.lods ?? [0, 1, 2]);
const PAINT = (SPEC.paint ?? []).map((p) => p.toLowerCase());
// gutter around every cell: mip levels 0–3 must not sample the neighbour
const PAD = A >= 2048 ? 12 : 6;
const UV_TOL = 0.25;

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN);
const root = doc.getRoot();

// drop LODs we don't want in this file
for (const n of root.listNodes()) {
  const m = /_LOD(\d)$/.exec(n.getName());
  if (m && !KEEP.has(Number(m[1]))) {
    const mesh = n.getMesh();
    n.dispose();
    if (mesh && mesh.listParents().filter((p) => p.propertyType === 'Node').length === 0) mesh.dispose();
  }
}

const bodyMeshes = root.listMeshes().filter((m) => m.getName().startsWith('body_LOD'));
const lod0 = bodyMeshes.find((m) => m.getName() === 'body_LOD0') ?? bodyMeshes[0];

// ───────────────────────────────────────────── classify materials into atlas entries
function triArea(pos, idx) {
  let a = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
    const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
    const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    a += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return a;
}
function uvRange(prim) {
  const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
  if (!uv) return null;
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  for (let i = 0; i < uv.length; i += 2) {
    umin = Math.min(umin, uv[i]); umax = Math.max(umax, uv[i]);
    vmin = Math.min(vmin, uv[i + 1]); vmax = Math.max(vmax, uv[i + 1]);
  }
  return { umin, umax, vmin, vmax };
}

const texStats = new Map(); // texture → { mean rgba }
async function meanColor(tex) {
  if (texStats.has(tex)) return texStats.get(tex);
  const st = await sharp(Buffer.from(tex.getImage())).stats();
  const m = st.channels.map((c) => c.mean / 255);
  // grey / grey+alpha images have 1–2 channels
  const v = m.length >= 3 ? [m[0], m[1], m[2], m[3] ?? 1] : [m[0], m[0], m[0], m[1] ?? 1];
  texStats.set(tex, v);
  return v;
}

// Converted FBX materials are BLEND with alpha copied from luminance, or invisible overlays
// (white RGB, alpha≈0). Decide from the texels: mostly under the cutoff → hidden, almost none → opaque.
async function alphaClass(tex, factorA) {
  const { data } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const thr = 127.5 / Math.max(factorA, 1e-3);
  let below = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < thr) below++;
  const f = below / data.length;
  return f >= 0.97 ? 'hidden' : f <= 0.01 ? 'opaque' : 'cutout';
}
// Most sources carry metallicFactor 1 by default; only keep real metal (named, or bright untextured trim).
const METAL_RE = /chrome|metal|steel|alu|mirror|exhaust|rim|disc|disk|caliper|silver|gold/;
function realMetal(metal, name, tex, base) {
  if (METAL_RE.test(name)) return metal;
  if (!tex && 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2] > 0.45) return metal;
  return Math.min(metal, 0.3);
}

const entries = new Map(); // key → entry
const matEntry = new Map(); // material → entry
const matTiling = new Map();
// a material is "in range" only if ALL its primitives (across LODs) stay within the tolerance
for (const mesh of bodyMeshes) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    const r = uvRange(prim);
    const inRange = !!r && r.umin >= -UV_TOL && r.umax <= 1 + UV_TOL && r.vmin >= -UV_TOL && r.vmax <= 1 + UV_TOL;
    matTiling.set(mat, (matTiling.get(mat) ?? false) || !inRange);
  }
}
for (const mesh of bodyMeshes) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (matEntry.has(mat)) continue;
    const name = mat.getName().toLowerCase();
    const base = mat.getBaseColorFactor();
    const rough = mat.getRoughnessFactor();
    const tex = mat.getBaseColorTexture();
    const metal = realMetal(mat.getMetallicFactor(), name, tex, base);
    const mrTex = mat.getMetallicRoughnessTexture();
    const aClass = mat.getAlphaMode() !== 'OPAQUE' && tex ? await alphaClass(tex, base[3]) : 'opaque';
    const cutout = aClass === 'cutout';
    let e;
    if (aClass === 'hidden') {
      e = { kind: 'hidden' };
    } else if (PAINT.some((p) => name.includes(p))) {
      e = { kind: 'flat', color: [0.92, 0.92, 0.92, 1], metal: Math.max(metal, 0.4), rough: Math.min(rough, 0.35) };
    } else if (tex && !matTiling.get(mat)) {
      const size = tex.getSize() ?? [256, 256];
      e = { kind: 'tex', tex, mrTex, factor: base, metal, rough, cutout, srcW: size[0], srcH: size[1], area: 0 };
    } else if (tex) {
      const mc = await meanColor(tex);
      e = { kind: 'flat', color: [mc[0] * base[0], mc[1] * base[1], mc[2] * base[2], 1], metal, rough };
    } else {
      e = { kind: 'flat', color: [base[0], base[1], base[2], 1], metal, rough };
    }
    const key = e.kind === 'hidden' ? 'hidden' : e.kind === 'tex'
      ? `tex|${root.listTextures().indexOf(e.tex)}|${e.factor.map((v) => v.toFixed(3))}|${e.mrTex ? root.listTextures().indexOf(e.mrTex) : '-'}|${metal.toFixed(2)}|${rough.toFixed(2)}`
      : `flat|${e.color.map((v) => Math.round(v * 255))}|${Math.round(e.metal * 255)}|${Math.round(e.rough * 255)}`;
    // one cell per texture: an opaque and a cutout user of the same image share it (keeps alpha)
    if (!entries.has(key)) entries.set(key, { ...e, key });
    else if (e.cutout) entries.get(key).cutout = true;
    matEntry.set(mat, entries.get(key));
  }
}
// surface area from LOD0 drives the texel budget
for (const prim of lod0.listPrimitives()) {
  const e = matEntry.get(prim.getMaterial());
  if (e.kind === 'tex') e.area += triArea(prim.getAttribute('POSITION').getArray(), prim.getIndices().getArray());
}
const texEntries = [...entries.values()].filter((e) => e.kind === 'tex');
const flatEntries = [...entries.values()].filter((e) => e.kind === 'flat');

// ───────────────────────────────────────────── pack (shelf) with a solved texel density
const FLAT = 4 + PAD * 2;
function pack(density) {
  const items = [];
  for (const e of texEntries) {
    const aspect = e.srcW / e.srcH;
    let side = Math.sqrt(Math.max(e.area, 1e-4)) * density;
    side = Math.min(side, Math.max(e.srcW, e.srcH));
    const w = Math.max(12, Math.round(side * Math.sqrt(aspect))) + PAD * 2;
    const h = Math.max(12, Math.round(side / Math.sqrt(aspect))) + PAD * 2;
    items.push({ e, w: Math.min(w, A), h: Math.min(h, A) });
  }
  for (const e of flatEntries) items.push({ e, w: FLAT, h: FLAT });
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, shelf = 0;
  for (const it of items) {
    if (x + it.w > A) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    if (y + it.h > A) return null;
    it.x = x;
    it.y = y;
    x += it.w;
    shelf = Math.max(shelf, it.h);
  }
  return items;
}
let lo = 1, hi = 4096, best = pack(lo);
if (!best) throw new Error('atlas too small even at minimum density');
for (let i = 0; i < 20; i++) {
  const mid = (lo + hi) / 2;
  const r = pack(mid);
  if (r) {
    best = r;
    lo = mid;
  } else hi = mid;
}
const density = lo;
for (const it of best) Object.assign(it.e, { x: it.x, y: it.y, w: it.w, h: it.h });

// ───────────────────────────────────────────── compose atlases
const hiddenCount = [...matEntry.values()].filter((e) => e.kind === 'hidden').length;
const baseLayers = [];
const ormLayers = [];
const to255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
for (const e of entries.values()) {
  if (e.kind === 'hidden') continue;
  if (e.kind === 'flat') {
    baseLayers.push({ input: { create: { width: e.w, height: e.h, channels: 4, background: { r: to255(e.color[0]), g: to255(e.color[1]), b: to255(e.color[2]), alpha: 1 } } }, left: e.x, top: e.y });
    ormLayers.push({ input: { create: { width: e.w, height: e.h, channels: 4, background: { r: 255, g: to255(e.rough), b: to255(e.metal), alpha: 1 } } }, left: e.x, top: e.y });
    continue;
  }
  const iw = e.w - PAD * 2, ih = e.h - PAD * 2;
  let img = sharp(Buffer.from(e.tex.getImage())).ensureAlpha().resize(iw, ih, { fit: 'fill' });
  img = img.recomb([[e.factor[0], 0, 0], [0, e.factor[1], 0], [0, 0, e.factor[2]]]);
  const raw = await img.raw().toBuffer({ resolveWithObject: true });
  if (!e.cutout) for (let i = 3; i < raw.data.length; i += 4) raw.data[i] = 255;
  const tile = await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } })
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
    .png()
    .toBuffer();
  baseLayers.push({ input: tile, left: e.x, top: e.y });
  if (e.mrTex) {
    const mr = await sharp(Buffer.from(e.mrTex.getImage())).removeAlpha().resize(iw, ih, { fit: 'fill' })
      .linear([0, e.rough, e.metal], [255, 0, 0])
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
      .png()
      .toBuffer();
    ormLayers.push({ input: mr, left: e.x, top: e.y });
  } else {
    ormLayers.push({ input: { create: { width: e.w, height: e.h, channels: 4, background: { r: 255, g: to255(e.rough), b: to255(e.metal), alpha: 1 } } }, left: e.x, top: e.y });
  }
}
// transparent canvas: compositing 'over' an opaque background would flatten every cutout
const basePng = await sharp({ create: { width: A, height: A, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 0 } } }).composite(baseLayers).png().toBuffer();
const ormPng = await sharp({ create: { width: A, height: A, channels: 3, background: { r: 255, g: 180, b: 0 } } }).composite(ormLayers).png().toBuffer();
if (SPEC.debugDir) {
  await sharp(basePng).toFile(`${SPEC.debugDir}/${SPEC.model}-${A}-base.png`);
  await sharp(ormPng).toFile(`${SPEC.debugDir}/${SPEC.model}-${A}-orm.png`);
}

// ───────────────────────────────────────────── remap UVs, merge primitives
const hasCutout = texEntries.some((e) => e.cutout);
const baseTex = doc.createTexture(`${SPEC.model}_base`).setImage(new Uint8Array(basePng)).setMimeType('image/png');
const ormTex = doc.createTexture(`${SPEC.model}_orm`).setImage(new Uint8Array(ormPng)).setMimeType('image/png');
const bodyMat = doc.createMaterial('spg_body')
  .setBaseColorTexture(baseTex)
  .setMetallicRoughnessTexture(ormTex)
  .setMetallicFactor(1)
  .setRoughnessFactor(1)
  .setDoubleSided(true)
  .setAlphaMode(hasCutout ? 'MASK' : 'OPAQUE')
  .setAlphaCutoff(0.5);

for (const mesh of bodyMeshes) {
  if (mesh.isDisposed()) continue;
  for (const prim of mesh.listPrimitives()) {
    if (matEntry.get(prim.getMaterial()).kind === 'hidden') {
      mesh.removePrimitive(prim);
      prim.dispose();
    }
  }
  const prims = mesh.listPrimitives();
  for (const prim of prims) {
    const e = matEntry.get(prim.getMaterial());
    const acc = prim.getAttribute('TEXCOORD_0');
    const uv = acc.getArray();
    const out = new Float32Array(uv.length);
    if (e.kind === 'tex') {
      const iw = e.w - PAD * 2, ih = e.h - PAD * 2;
      for (let i = 0; i < uv.length; i += 2) {
        const u = Math.min(1, Math.max(0, uv[i])), v = Math.min(1, Math.max(0, uv[i + 1]));
        out[i] = (e.x + PAD + u * iw) / A;
        out[i + 1] = (e.y + PAD + v * ih) / A;
      }
    } else {
      const cu = (e.x + e.w / 2) / A, cv = (e.y + e.h / 2) / A;
      for (let i = 0; i < uv.length; i += 2) {
        out[i] = cu;
        out[i + 1] = cv;
      }
    }
    const newAcc = doc.createAccessor().setType('VEC2').setArray(out).setBuffer(acc.getBuffer());
    prim.setAttribute('TEXCOORD_0', newAcc);
    prim.setMaterial(bodyMat);
  }
  const joined = joinPrimitives(prims);
  for (const p of prims) {
    mesh.removePrimitive(p);
    p.dispose();
  }
  mesh.addPrimitive(joined);
}

await doc.transform(
  prune(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(OUT, doc);

const stats = bodyMeshes.filter((m) => !m.isDisposed()).map((m) => `${m.getName()}: ${m.listPrimitives().length} prim, ${(m.listPrimitives()[0].getIndices().getCount() / 3) | 0} tris`);
console.log(`ATLAS_OK ${SPEC.model} A=${A} density=${density.toFixed(1)} px/√m² tex=${texEntries.length} flat=${flatEntries.length} hidden=${hiddenCount} cutout=${hasCutout} | ${stats.join(' | ')}`);
