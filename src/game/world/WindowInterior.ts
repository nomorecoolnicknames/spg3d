import * as THREE from 'three';
import roomsUrl from '@/assets/interiors/apartments-v1.png';

// Each room has its own mip chain. Sampling a conventional atlas would leak neighbours into distant windows.
export const roomTexture = new THREE.DataArrayTexture();
let loading: Promise<void> | undefined;
export function loadWindowInteriors(): Promise<void> {
  return loading ??= (async () => {
    const image = await new THREE.ImageLoader().loadAsync(roomsUrl);
    const size = 256, count = 16;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const pixels = new Uint8Array(size * size * 4 * count);
    for (let i = 0; i < count; i++) {
      ctx.drawImage(image, (i % 4) * image.width / 4, Math.floor(i / 4) * image.height / 4,
        image.width / 4, image.height / 4, 0, 0, size, size);
      const src = ctx.getImageData(0, 0, size, size).data;
      for (let y = 0; y < size; y++) pixels.set(src.subarray(y * size * 4, (y + 1) * size * 4), (i * size * size + (size - y - 1) * size) * 4);
    }
    roomTexture.image = { data: pixels, width: size, height: size, depth: count };
    roomTexture.colorSpace = THREE.SRGBColorSpace;
    roomTexture.wrapS = roomTexture.wrapT = THREE.ClampToEdgeWrapping;
    roomTexture.minFilter = THREE.LinearMipmapLinearFilter;
    roomTexture.magFilter = THREE.LinearFilter;
    roomTexture.generateMipmaps = true;
    roomTexture.anisotropy = 4;
    roomTexture.needsUpdate = true;
  })();
}

/** UVs for each connected glass surface, including triangle-soup and quantized GLBs. */
export function glassPanes(pos: Float32Array, normals: Float32Array, kinds: Float32Array, indices: Uint32Array): Float32Array {
  const n = kinds.length, parent = new Int32Array(n).fill(-1), panes = new Float32Array(n * 4);
  const find = (i: number): number => {
    let p = i;
    while (parent[p] !== p) p = parent[p];
    while (i !== p) { const next = parent[i]; parent[i] = p; i = next; }
    return p;
  };
  const weld = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (kinds[i] !== 3 && kinds[i] !== 10) continue;
    parent[i] = i;
    const key = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]].map(v => Math.round(v * 1000)).join(',') + '/' +
      [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]].map(v => Math.round(v * 100)).join(',');
    const previous = weld.get(key);
    if (previous !== undefined) parent[i] = find(previous);
    else weld.set(key, i);
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (parent[a] < 0 || parent[b] < 0 || parent[c] < 0) continue;
    parent[find(b)] = find(a); parent[find(c)] = find(a);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) if (parent[i] >= 0) {
    const root = find(i), list = groups.get(root) ?? [];
    list.push(i); groups.set(root, list);
  }
  for (const ids of groups.values()) {
    const first = ids[0] * 3;
    const nz = normals[first + 2], nx = normals[first], len = Math.hypot(nx, nz);
    if (len < 0.5) continue; // skylights retain their glass material
    const tx = nz / len, tz = -nx / len;
    let lo = Infinity, hi = -Infinity, bottom = Infinity, top = -Infinity;
    for (const i of ids) {
      const u = pos[i * 3] * tx + pos[i * 3 + 2] * tz, y = pos[i * 3 + 1];
      lo = Math.min(lo, u); hi = Math.max(hi, u); bottom = Math.min(bottom, y); top = Math.max(top, y);
    }
    const width = hi - lo, height = top - bottom;
    if (width < 0.03 || height < 0.03) continue;
    const seed = Math.sin(Math.round((lo + hi) * 100) * 12.9898 + Math.round((bottom + top) * 100) * 78.233) * 43758.5453;
    for (const i of ids) panes.set([(pos[i * 3] * tx + pos[i * 3 + 2] * tz - lo) / width,
      (pos[i * 3 + 1] - bottom) / height, seed - Math.floor(seed), Math.min(8, width / height)], i * 4);
  }
  return panes;
}

export const INTERIOR_GLSL = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray roomAtlas;
float roomHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 roomSample(vec2 uv, vec3 viewPosition, vec2 identity, float aspect) {
  // Reconstruct the aperture frame from derivatives: stable under rotated and mirrored facade modules.
  vec3 px = dFdx(viewPosition), py = dFdy(viewPosition);
  vec2 ux = dFdx(uv), uy = dFdy(uv);
  float det = ux.x * uy.y - ux.y * uy.x;
  vec3 T = normalize((px * uy.y - py * ux.y) * sign(det));
  vec3 B = normalize((py * ux.x - px * uy.x) * sign(det));
  vec3 N = normalize(cross(T, B));
  vec3 eye = normalize(-viewPosition);
  vec2 shift = vec2(dot(eye, T) / max(aspect, 0.3), dot(eye, B)) / max(abs(dot(eye, N)), 0.25);
  // Recessed back wall with a small view-dependent displacement; the frame remains actual geometry.
  vec2 crop = vec2(min(1.0, aspect), min(1.0, 1.0 / max(aspect, 0.1)));
  vec2 roomUV = clamp((uv - 0.5) * crop * 0.78 + 0.5 - shift * 0.095, vec2(0.005), vec2(0.995));
  float layer = floor(roomHash(identity) * 16.0);
  vec3 room = texture(roomAtlas, vec3(roomUV, layer)).rgb;
  float grazing = pow(1.0 - abs(dot(eye, N)), 5.0);
  float reveal = smoothstep(0.0, 0.055, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return room * (1.0 - 0.88 * grazing) * mix(0.45, 1.0, reveal);
}
`;
