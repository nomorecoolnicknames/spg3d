// node scripts/pack-city-tree.mjs input.glb output.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(process.argv[2]);
for (const material of doc.getRoot().listMaterials()) material.setAlphaMode('OPAQUE').setDoubleSided(true).setRoughnessFactor(0.9);
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(process.argv[3], doc);
console.log(doc.getRoot().listMeshes().map(m => [m.getName(), m.listPrimitives().map(p => p.getIndices().getCount() / 3)]));
