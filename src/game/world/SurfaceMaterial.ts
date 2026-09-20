import * as THREE from 'three';
import albedoUrl from '@/assets/materials/surfaces_albedo.webp';
import nrUrl from '@/assets/materials/surfaces_nr.png';
import manifest from '@/assets/materials/surfaces.json';

/** Shared, lifetime-cached arrays: 16 independently mipmapped layers, no atlas bleeding. */
const albedo = new THREE.DataArrayTexture();
const nr = new THREE.DataArrayTexture();
export const citySurfaceTextures = { albedo, nr };
let loading: Promise<void> | undefined;
export const SURFACE: Record<string, number> = Object.fromEntries(manifest.tiles.map(t => [t.name, t.index]));
export function loadCitySurfaces(): Promise<void> {
  return loading ??= Promise.all([[albedoUrl, albedo, true], [nrUrl, nr, false]].map(async ([url, target, color]) => {
    const img = await new THREE.ImageLoader().loadAsync(url as string);
    const canvas = document.createElement('canvas');
    const size = manifest.size;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const data = new Uint8Array(size * size * 4 * manifest.tiles.length);
    for (const t of manifest.tiles) {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, t.index % 4 * size, Math.floor(t.index / 4) * size, size, size, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      // DataArrayTexture ignores flipY: explicitly store bottom-up rows (Blender tangent +Y).
      for (let y = 0; y < size; y++) data.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), (t.index * size * size + (size - 1 - y) * size) * 4);
    }
    const tex = target as THREE.DataArrayTexture;
    tex.image = { data, width: size, height: size, depth: manifest.tiles.length };
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  })).then(() => {});
}

/** Zero means leave the existing material intact; GPU attribute stores index + 1. */
const CELL_SURFACE: Record<string, string> = {
    roofBitumen: 'roof_bitumen', roofGravel: 'gravel', roofRed: 'roof_tiles',
    pavement: 'pavement_slabs', courtyard: 'tarmac_yard', grass: 'grass', ballast: 'gravel', granite: 'granite',
    concrete: 'panel_concrete', tunnelWall: 'panel_concrete', tunnelCeil: 'plaster_rough',
    metalVent: 'metal_cladding', woodWall: 'wood_planks', woodWin: 'wood_planks',
  };
export function cellSurface(name: string): number {
  const key = CELL_SURFACE[name] ?? (/^(panel|fence)/.test(name) ? 'panel_concrete' : /^(brick|red|factory)/.test(name) ? 'brick_red'
    : /^(stal|pl|tower)/.test(name) ? 'plaster_smooth' : /^(corr|roller|garage)/.test(name) ? 'metal_cladding' : undefined);
  return key ? SURFACE[key] + 1 : 0;
}

export function kitSurface(kind: number, style: string, r: number, g: number, b: number): number {
  if (kind === 6) return SURFACE[r > g * 1.5 ? 'roof_tiles' : 'roof_metal'] + 1;
  if (kind === 2) return SURFACE.plaster_smooth + 1;
  if (kind > 1) return 0; // glass, lettering and painted metal keep their physical response
  const key = style === 'panel' ? 'panel_concrete' : style === 'brick' ? (r > g * 1.35 ? 'brick_red' : 'brick_silicate')
    : style === 'modern' ? 'metal_cladding' : style === 'classic' ? 'plaster_smooth'
    : r > g * 1.7 && r > b * 1.9 ? 'brick_red' : kind === 1 ? 'plaster_rough' : 'plaster_smooth';
  return SURFACE[key] + 1;
}

type Shader = Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0];
/** Apply after the caller's shader patches. mix mode retains the facade's window / sign masks. */
export function patchSurfaces(sh: Shader, mode: 'kit' | 'city', wetness: { value: number }, snow = { value: 0 }): void {
  Object.assign(sh.uniforms, {
    surfaceWet: wetness, surfaceSnow: snow,
    surfaceAlbedo: { value: albedo }, surfaceNR: { value: nr },
    surfaceMetres: { value: manifest.tiles.map(t => t.metres) },
    surfaceMean: { value: manifest.tiles.map(t => new THREE.Vector3(...t.meanLinear as [number, number, number])) },
  });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float aSurface;\nvarying float vSurface;\nvarying vec3 vSurfacePos;\nvarying vec3 vSurfaceNormal;`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vSurface = aSurface;
      vSurfacePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vSurfaceNormal = inverseTransformDirection(transformedNormal, viewMatrix);`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    precision highp sampler2DArray;
    uniform sampler2DArray surfaceAlbedo, surfaceNR;
    uniform float surfaceMetres[16];
    uniform float surfaceWet, surfaceSnow;
    uniform vec3 surfaceMean[16];
    varying float vSurface;
    varying vec3 vSurfacePos, vSurfaceNormal;
    vec3 surfaceT, surfaceB;
    vec3 surfaceN;
    float surfaceWeight, surfaceDamp, surfaceMetal, snowCover;
    vec4 surfacePacked;
    vec3 surfaceColor;
    float surfaceNoise(vec2 p) {
      vec2 cell = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      vec4 q = vec4(dot(cell, vec2(127.1, 311.7)), dot(cell + vec2(1, 0), vec2(127.1, 311.7)),
                    dot(cell + vec2(0, 1), vec2(127.1, 311.7)), dot(cell + vec2(1, 1), vec2(127.1, 311.7)));
      vec4 h = fract(sin(q) * 43758.5453);
      return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
    }
    void sampleSurface(float mask) {
      int layer = clamp(int(floor(vSurface + 0.5)) - 1, 0, 15);
      surfaceN = normalize(vSurfaceNormal);
      vec3 an = abs(surfaceN);
      // Dominant-axis projection: two samples per pixel, correctly handed on all six sides.
      if (an.y > max(an.x, an.z)) {
        surfaceT = vec3(1., 0., 0.); surfaceB = vec3(0., 0., -sign(surfaceN.y));
      } else if (an.x > an.z) {
        surfaceT = vec3(0., 0., -sign(surfaceN.x)); surfaceB = vec3(0., 1., 0.);
      } else {
        surfaceT = vec3(sign(surfaceN.z), 0., 0.); surfaceB = vec3(0., 1., 0.);
      }
      // The brick scan's catalog dimensions describe a larger patch; calibrate the game to ~75 mm courses.
      float metres = surfaceMetres[layer] * (layer == 0 ? 0.4 : layer == 1 ? 0.67 : 1.0);
      vec2 st = vec2(dot(vSurfacePos, surfaceT), dot(vSurfacePos, surfaceB)) / metres;
      surfacePacked = texture(surfaceNR, vec3(st, float(layer)));
      surfaceColor = texture(surfaceAlbedo, vec3(st, float(layer))).rgb;
      surfaceWeight = step(0.5, vSurface) * mask;
      surfaceMetal = (layer == 6 || layer == 8) ? 0.55 : 0.0;
      bool collectsWater = layer == 5 || layer == 7 || layer == 10 || layer == 11 || layer == 12;
      float drift = surfaceNoise(vSurfacePos.xz * 0.11) * 0.7 + surfaceNoise(vSurfacePos.xz * 0.29) * 0.3;
      snowCover = surfaceSnow * surfaceWeight * smoothstep(0.58, 0.9, surfaceN.y) * (layer == 12 ? 0.14 : 0.78 + drift * 0.18);
      surfaceDamp = collectsWater ? surfaceWet * smoothstep(0.6, 0.95, surfaceN.y) * surfaceWeight : 0.0;
    }`);
  // map_fragment has already been replaced by the city shader. Insert just before alpha testing.
  sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', `
    sampleSurface(${mode === 'city' ? '1.0 - max(cityEmis.r, cityEmis.g)' : '1.0'});
    ${mode === 'kit'
      ? `int kitSurfaceIndex = clamp(int(floor(vSurface + 0.5)) - 1, 0, 15);
         vec3 kitDetail = clamp(surfaceColor / max(surfaceMean[kitSurfaceIndex], vec3(0.025)), vec3(0.25), vec3(2.2));
         // Brick has its own measured colour: multiplying saturated legacy red by it doubles the tint.
         vec3 kitTarget = kitSurfaceIndex <= 1 ? surfaceColor * clamp(dot(diffuseColor.rgb, vec3(0.6667)), 0.75, 1.15) : diffuseColor.rgb * kitDetail;
         diffuseColor.rgb = mix(diffuseColor.rgb, kitTarget, surfaceWeight);`
      : `int surfaceIndex = clamp(int(floor(vSurface + 0.5)) - 1, 0, 15);
         // Facades retain authored colours / window rhythm; ground uses the actual baked albedo.
         bool groundSurface = surfaceIndex >= 7 || surfaceIndex == 5;
         vec3 surfaceTarget = groundSurface ? surfaceColor * vTint : diffuseColor.rgb * clamp(surfaceColor / max(surfaceMean[surfaceIndex], vec3(0.025)), vec3(0.25), vec3(2.2));
         diffuseColor.rgb = mix(diffuseColor.rgb, surfaceTarget, surfaceWeight);`}
    diffuseColor.rgb *= 1.0 - 0.28 * surfaceDamp;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.68, 0.72, 0.76), snowCover);
    // Damp splash zone anchors walls to the pavement instead of leaving a clean floating edge.
    float plinth = (1.0 - smoothstep(-0.2, 1.1, vSurfacePos.y)) * (1.0 - abs(surfaceN.y));
    diffuseColor.rgb *= 1.0 - plinth * surfaceWeight * 0.24;
    #include <alphamap_fragment>`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
    float surfAO = mix(1.0, surfacePacked.a, surfaceWeight * 0.7);
    reflectedLight.indirectDiffuse *= surfAO;
    reflectedLight.indirectSpecular *= surfAO;`);
  // Insert after the complete roughness block (the caller may replace its include entirely).
  sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `
    roughnessFactor = mix(roughnessFactor, surfacePacked.b, surfaceWeight);
    roughnessFactor = mix(roughnessFactor, max(0.19, surfacePacked.b * 0.38), surfaceDamp);
    metalnessFactor = mix(metalnessFactor, surfaceMetal, surfaceWeight);
    metalnessFactor *= 1.0 - snowCover;
    roughnessFactor = mix(roughnessFactor, 0.92, snowCover);
    #include <normal_fragment_begin>`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    vec2 surfaceXY = (surfacePacked.rg * 2.0 - 1.0) * 0.5 * surfaceWeight * (1.0 - snowCover * 0.85);
    // Reproject the texture frame to the interpolated normal for sloped roofs and cornices.
    vec3 surfT = normalize(surfaceT - surfaceN * dot(surfaceN, surfaceT));
    vec3 surfB = normalize(cross(surfaceN, surfT));
    vec3 surfPerturbed = normalize(surfT * surfaceXY.x + surfB * surfaceXY.y + surfaceN * sqrt(max(0.01, 1.0 - dot(surfaceXY, surfaceXY))));
    normal = normalize(mix(normal, (viewMatrix * vec4(surfPerturbed, 0.0)).xyz, surfaceWeight));`);
}
