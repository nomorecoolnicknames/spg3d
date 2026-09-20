import * as THREE from 'three';
import { getGLTF, getTexture } from '../../assets';

type Spot = { x: number; y: number; z: number; s: number };

/** Place branch cards in the photographed tree's crown, preserving its asymmetric branching envelope. */
function crownCards(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = source.getAttribute('position');
  const cells = new Map<string, { center: THREE.Vector3; count: number }>();
  const step = 1.15;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${Math.floor(x / step)},${Math.floor(y / step)},${Math.floor(z / step)}`;
    const cell = cells.get(key) ?? { center: new THREE.Vector3(), count: 0 };
    cell.center.add(new THREE.Vector3(x, y, z)); cell.count++; cells.set(key, cell);
  }
  const pos: number[] = [], normals: number[] = [], uv: number[] = [], colors: number[] = [];
  const overall = new THREE.Vector3();
  source.computeBoundingBox(); source.boundingBox!.getCenter(overall);
  let index = 0;
  for (const cell of cells.values()) {
    if (cell.count < 6) continue;
    const center = cell.center.divideScalar(cell.count);
    for (let plane = 0; plane < 3; plane++) {
      const angle = index * 2.399963 + plane * Math.PI / 3;
      const right = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(1.05);
      const up = new THREE.Vector3(-Math.sin(angle) * 0.35, 0.92, Math.cos(angle) * 0.35).multiplyScalar(1.05);
      const corners = [center.clone().sub(right).sub(up), center.clone().add(right).sub(up), center.clone().add(right).add(up), center.clone().sub(right).add(up)];
      const tile = (index * 7 + plane * 3) % 12;
      const coords = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const vertex = corners[k]; pos.push(vertex.x, vertex.y, vertex.z);
        const normal = vertex.clone().sub(overall).normalize(); normals.push(normal.x, normal.y, normal.z);
        uv.push((tile % 4 + 0.012 + coords[k][0] * 0.976) / 4, 1 - (Math.floor(tile / 4) + 0.012 + (1 - coords[k][1]) * 0.976) / 3);
        const shade = 0.68 + 0.32 * THREE.MathUtils.clamp((vertex.y - overall.y + 2) / 4, 0, 1);
        colors.push(shade, shade, shade);
      }
    }
    index++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}
/** Only the nearest trees submit the detailed mesh; distant trees retain the cheap card canopy. */
export function createTreeLod(points: Spot[], quality: 'medium' | 'high', shadows: boolean, winter: boolean) {
  const source = getGLTF('streetTree')?.scene;
  if (!source) return null;
  const max = quality === 'high' ? 48 : 20, distance = quality === 'high' ? 75 : 45;
  const eye = { value: new THREE.Vector2(1e8, 1e8) }, radius = { value: 0 };
  const group = new THREE.Group(), meshes: THREE.InstancedMesh[] = [];
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  source.updateMatrixWorld(true);
  source.traverse(obj => {
    if (!(obj instanceof THREE.Mesh) || (winter && obj.name.includes('leaves'))) return;
    let geometry = obj.geometry.clone();
    // meshopt's normalized int16 position cannot store metre-space coordinates after a baked transform.
    const packed = geometry.getAttribute('position');
    const positions = new Float32Array(packed.count * 3);
    for (let i = 0; i < packed.count; i++) positions.set([packed.getX(i), packed.getY(i), packed.getZ(i)], i * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.applyMatrix4(obj.matrixWorld);
    const isLeaves = obj.name.includes('leaves');
    if (isLeaves) {
      const cards = crownCards(geometry); geometry.dispose(); geometry = cards;
    }
    const material = isLeaves ? new THREE.MeshStandardMaterial({
      color: '#a0b38c', map: getTexture('leaves'), normalMap: getTexture('leavesNormal'),
      normalScale: new THREE.Vector2(0.3, 0.3), vertexColors: true, alphaTest: 0.45,
      side: THREE.DoubleSide, roughness: 0.95,
    }) : (obj.material as THREE.MeshStandardMaterial).clone();
    material.transparent = false; material.depthWrite = true;
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = shadows;
    if (isLeaves) {
      const depth = new THREE.MeshDepthMaterial({ map: material.map, alphaTest: 0.45, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
      mesh.customDepthMaterial = depth; materials.push(depth);
    }
    mesh.name = `city:photo-tree:${obj.name}`;
    meshes.push(mesh); geometries.push(geometry); materials.push(material); group.add(mesh);
  });
  const quaternion = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), tint = new THREE.Color();
  let lastX = Infinity, lastZ = Infinity;
  return {
    group,
    /** Match colour and shadow LOD for the card-tree materials. */
    patch(material: THREE.Material) {
      const before = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        before.call(material, shader, renderer);
        Object.assign(shader.uniforms, { treeLodEye: eye, treeLodRadius: radius });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec2 treeLodEye; uniform float treeLodRadius;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            if (distance(instanceMatrix[3].xz, treeLodEye) < treeLodRadius) transformed = vec3(0.0);`);
      };
      const key = material.customProgramCacheKey();
      material.customProgramCacheKey = () => `${key}:photo-tree-lod`;
    },
    update(x: number, z: number) {
      if (Math.hypot(x - lastX, z - lastZ) < 5) return;
      lastX = x; lastZ = z;
      const selected = points.map(p => ({ p, d: Math.hypot(p.x - x, p.z - z) }))
        .filter(p => p.d < distance).sort((a, b) => a.d - b.d).slice(0, max);
      // The cutoff is shared with the far-tree shaders; no holes when a dense park fills the instance budget.
      radius.value = selected.length ? selected[selected.length - 1].d + 0.0001 : 0;
      eye.value.set(x, z);
      for (let i = 0; i < selected.length; i++) {
        const { p } = selected[i];
        quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.x * 0.37 + p.z * 0.11);
        position.set(p.x, p.y, p.z);
        scale.set(p.s, p.s * (0.92 + ((i * 7) % 5) * 0.04), p.s);
        matrix.compose(position, quaternion, scale);
        tint.setHSL(0.22 + (i % 3) * 0.012, 0.12, 0.91);
        for (const mesh of meshes) { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, tint); }
      }
      for (const mesh of meshes) {
        mesh.count = selected.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
    dispose() {
      for (const m of meshes) m.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
