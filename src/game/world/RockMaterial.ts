import * as THREE from 'three';
import { getTexture } from '../assets';

/**
 * Cliff rock (ambientCG Rock030, CC0) projected in world space from the two dominant axes, so any
 * extruded wall or arch gets undistorted strata without UVs. The scan is stored as luminance and
 * tinted per track; `snow` whitens faces that look up (alpine rock).
 */
export function createRockMaterial(tint: string, opts: { snow?: number; low?: boolean } = {}): THREE.MeshStandardMaterial {
  const albedo = getTexture('rockAlbedo');
  const normal = getTexture('rockNormal');
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.92, metalness: 0, flatShading: false });
  if (!albedo) return mat;
  const uniforms = { tRock: { value: albedo }, tRockN: { value: normal ?? null }, snow: { value: opts.snow ?? 0 } };
  const useNormal = !opts.low && !!normal;
  mat.defines = { ...(mat.defines ?? {}), ...(useNormal ? { ROCK_NORMAL: '' } : {}) };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockW;\nvarying vec3 vRockN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvRockW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n\tvRockN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tRock;
#ifdef ROCK_NORMAL
uniform sampler2D tRockN;
#endif
uniform float snow;
varying vec3 vRockW;
varying vec3 vRockN;
float rockSnow;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 an = abs(vRockN);
	// strata run horizontally: side projections use (along, y); the top uses xz
	vec2 uvX = vec2(vRockW.z, vRockW.y) / 11.0;
	vec2 uvZ = vec2(vRockW.x, vRockW.y) / 11.0;
	vec2 uvY = vRockW.xz / 14.0;
	vec3 w = pow(an, vec3(4.0));
	w /= (w.x + w.y + w.z + 1e-4);
	float lum = texture2D(tRock, uvX).r * w.x + texture2D(tRock, uvZ).r * w.z + texture2D(tRock, uvY).r * w.y;
	rockSnow = snow * smoothstep(0.55, 0.8, vRockN.y + (lum - 0.5) * 0.4);
	diffuseColor.rgb *= 0.35 + 1.3 * lum;
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.96), rockSnow);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
	roughnessFactor = mix(roughnessFactor, 0.6, rockSnow);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef ROCK_NORMAL
	{
		// dominant-axis normal map: one extra sample, good enough for cliffs seen at speed
		vec3 nW = normalize(vRockN);
		vec2 nuv = an.x > an.z ? uvX : uvZ;
		if (an.y > max(an.x, an.z)) nuv = uvY;
		vec3 tn = texture2D(tRockN, nuv).xyz * 2.0 - 1.0;
		vec3 t = normalize(cross(abs(nW.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), nW));
		vec3 b = cross(nW, t);
		vec3 pn = normalize(t * tn.x * 0.9 + b * tn.y * 0.9 + nW * tn.z);
		normal = normalize((viewMatrix * vec4(mix(pn, nW, rockSnow), 0.0)).xyz);
	}
#endif`,
      );
  };
  mat.customProgramCacheKey = () => `spg-rock${useNormal ? '-n' : ''}`;
  return mat;
}
