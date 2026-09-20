import * as THREE from 'three';
import type { TrackEnv } from '../types';
import { getTexture } from '../assets';
import { citySurfaceTextures } from './SurfaceMaterial';
import { wetStreetUniforms } from '../render/WetStreetReflection';
import { LAMP_GLSL, lampUniforms } from '../render/LampField';

/**
 * Asphalt for the track ribbon. Scanned CC0 asphalt (ambientCG Asphalt031) is sampled in world
 * space so it never stretches along the spline; paint markings come from a small mask in ribbon UV
 * (u across the road, v along it). Wet tracks get puddles: darker albedo, near-mirror roughness and
 * no micro-normal, so the HDRI and neon reflect in them.
 */
export interface RoadMaterialOptions {
  /** 0 dry … 1 soaked */
  wetness: number;
  lineColor: string;
  /** skip the normal map (phones) */
  low: boolean;
  /** street-lamp pools and stretched wet reflections from the LampField slots (night, medium/high) */
  lamps?: boolean;
}

let marksTex: THREE.CanvasTexture | null = null;

/** clock for the rain ripples in the puddles (RaceScene advances it) */
export const roadTime = { value: 0 };
/** the player's low beams on the road at night: lamp position (w = on) and the car's forward direction */
export const roadHeadlights = { pos: { value: new THREE.Vector4() }, dir: { value: new THREE.Vector3(0, 0, 1) } };

/** R = paint mask, G = paint wear. 256×1024 across one road width, tiles along v (one repeat ≈ road width). */
function markingsTexture(): THREE.CanvasTexture {
  if (marksTex) return marksTex;
  const W = 256, H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f00';
  // ~0.15 m lines: edges inset ~0.5 m, dashed centre 3 m on / 4 m off
  ctx.fillRect(9, 0, 3, H);
  ctx.fillRect(W - 12, 0, 3, H);
  for (let y = 0; y < H; y += 512) ctx.fillRect(W / 2 - 1.5, y + 40, 3, 220);
  // wear: speckles that eat into the paint
  const img = ctx.getImageData(0, 0, W, H);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 1] = Math.floor(160 + rnd() * 95);
  ctx.putImageData(img, 0, 0);
  marksTex = new THREE.CanvasTexture(c);
  marksTex.wrapS = THREE.ClampToEdgeWrapping;
  marksTex.wrapT = THREE.RepeatWrapping;
  marksTex.colorSpace = THREE.NoColorSpace;
  marksTex.anisotropy = 8;
  return marksTex;
}

export function createRoadMaterial(env: TrackEnv, opts: RoadMaterialOptions): THREE.MeshStandardMaterial {
  const albedo = getTexture('asphaltAlbedo');
  const normal = getTexture('asphaltNormal');
  const rough = getTexture('asphaltRough');
  const puddles = getTexture('puddles');
  // at night the HDRI is far brighter than the lit street: a wet road mirroring it turns beige, so keep it faint
  const mat = new THREE.MeshStandardMaterial({ color: env.roadColor, roughness: 0.85, metalness: 0, envMapIntensity: env.headlights ? 0.3 : 0.4 });
  if (!albedo || !rough || !puddles) return mat; // assets missing: plain tinted road

  const uniforms = {
    tAlbedo: { value: albedo },
    tNormal: { value: normal ?? null },
    tRough: { value: rough },
    tPuddle: { value: puddles },
    tMarks: { value: markingsTexture() },
    roadScan: { value: citySurfaceTextures.albedo },
    roadTint: { value: new THREE.Color(env.roadColor) },
    lineColor: { value: new THREE.Color(opts.lineColor) },
    wetness: { value: opts.wetness },
  };
  const useNormal = !opts.low && !!normal;
  const rain = env.rain && opts.wetness > 0;
  mat.defines = { ...(mat.defines ?? {}), USE_UV: '', ...(useNormal ? { ROAD_NORMAL: '' } : {}), ...(opts.lamps ? { ROAD_LAMPS: '' } : {}), ...(rain ? { ROAD_RAIN: '' } : {}) };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, lampUniforms, wetStreetUniforms, { spgRoadTime: roadTime, spgHeadPos: roadHeadlights.pos, spgHeadDir: roadHeadlights.dir });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadW;\nvarying vec3 vRoadP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvRoadP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n\tvRoadW = vRoadP.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vRoadW;
varying vec3 vRoadP;
${LAMP_GLSL}
uniform sampler2D tAlbedo, tRough, tPuddle, tMarks;
precision highp sampler2DArray;
uniform sampler2DArray roadScan;
uniform sampler2D streetReflection;
uniform mat4 streetReflectionMatrix;
uniform vec2 streetReflectionTexel;
uniform float streetReflectionGain;
#ifdef ROAD_NORMAL
uniform sampler2D tNormal;
#endif
uniform vec3 roadTint, lineColor;
uniform float wetness, spgRoadTime;
uniform vec4 spgHeadPos;
uniform vec3 spgHeadDir;
float roadPuddle;
float roadPaint;
float roadRough;
vec2 roadRipple = vec2(0.0);
#ifdef ROAD_RAIN
float rHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// raindrops hitting the puddles: in each ~0.5 m cell a ring grows and fades at its own rate; returns the slope
vec2 rainRipples(vec2 w) {
	vec2 g = vec2(0.0);
	for (int k = 0; k < 2; k++) {
		vec2 p = w * 2.1 + float(k) * vec2(0.5, 0.37);
		vec2 cell = floor(p);
		vec2 f = fract(p);
		float r = rHash(cell + float(k) * 11.0);
		float life = fract(spgRoadTime * (0.8 + 0.7 * r) + r * 5.3);
		vec2 c = vec2(0.25) + 0.5 * vec2(rHash(cell + 3.1), rHash(cell + 7.7));
		vec2 d = f - c;
		float dist = length(d);
		float ring = exp(-pow((dist - life * 0.42) * 30.0, 2.0)) * (1.0 - life) * (1.0 - life);
		g += d / (dist + 1e-3) * ring;
	}
	return g;
}
#endif`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 wuv = vRoadW / 5.5;
	float alb = texture2D(tAlbedo, wuv).r;
	vec4 mk = texture2D(tMarks, vUv);
	roadPaint = mk.r * smoothstep(0.35, 0.75, mk.g);
	roadPuddle = smoothstep(0.62, 0.8, texture2D(tPuddle, vRoadW / 46.0).r) * wetness;
	float roadPatch = dot(texture(roadScan, vec3(vRoadW / 7.0, 12.0)).rgb, vec3(0.2126, 0.7152, 0.0722));
	// A second, metre-scale scan carries repaired seams/cracks; the original scan retains fine aggregate.
	vec3 base = roadTint * (0.25 + 1.7 * alb) * clamp(roadPatch / 0.12, 0.32, 1.65);
	base = mix(base, lineColor * (0.75 + 0.25 * alb), roadPaint);
	base *= mix(1.0 - 0.25 * wetness, 0.45, roadPuddle);
	diffuseColor.rgb = base;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `roadRough = texture2D(tRough, wuv).r;
	float roughnessFactor = 0.62 + 0.3 * roadRough;
	roughnessFactor = mix(roughnessFactor, 0.5, roadPaint);
	roughnessFactor *= 1.0 - 0.3 * wetness;
	roughnessFactor = mix(roughnessFactor, 0.14, roadPuddle);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef ROAD_NORMAL
	{
		// world-planar tangent frame (the road is close to horizontal): texture u → +X, v → −Z
		vec3 tn = texture2D(tNormal, wuv).xyz * 2.0 - 1.0;
		float k = (1.0 - roadPuddle) * 0.8;
		vec3 nW = normalize(vec3(tn.x * k, 1.0, -tn.y * k));
		normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
	}
#endif
#ifdef ROAD_RAIN
	{
		// rings smaller than a pixel alias into grain: they fade out between 6 and 22 m from the camera
		roadRipple = rainRipples(vRoadW) * roadPuddle * (1.0 - smoothstep(6.0, 22.0, length(cameraPosition - vRoadP)));
		vec3 nR = normalize(vec3(roadRipple.x * 0.5, 1.0, -roadRipple.y * 0.5));
		normal = normalize(mix(normal, (viewMatrix * vec4(nR, 0.0)).xyz, roadPuddle));
	}
#endif`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
#ifdef ROAD_LAMPS
	{
		// NFS-style night asphalt: each nearby lamp lights a pool and leaves a reflection that is
		// narrow sideways and long toward the viewer (glossy wet surface, anisotropic lobe)
		// the moon's specular on a glossy wet road reads as a beige sheet when driving toward it:
		// at night the reflections should come from the lamps, not from the directional light
		reflectedLight.directSpecular *= 0.15;
		// same for the HDRI: its bright skyline is not what this street reflects (A/B: lights and env off
		// left a black road with only lamp streaks — the brown sheet was mostly env specular at grazing angles)
		reflectedLight.indirectSpecular *= 0.12;
		vec3 V = normalize(cameraPosition - vRoadP);
		// (raindrop rings in the puddles shake the lamp streaks too)
		vec3 R = reflect(-V, normalize(vec3(roadRipple.x * 0.8, 1.0, -roadRipple.y * 0.8)));
		vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(R.x, 0.0, R.z) + vec3(1e-4, 0.0, 0.0)));
		float wet = mix(0.1, 1.0, max(wetness * 0.6, roadPuddle));
		float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
		for (int i = 0; i < SPG_LAMPS; i++) {
			if (spgLampPos[i].w <= 0.0) continue;
			vec3 Lw = spgLampPos[i].xyz - vRoadP;
			float dist = length(Lw);
			vec3 L = Lw / dist;
			float dh = dot(L - R, side);
			float dv = L.y - R.y;
			// a clean streak only in puddles; on wet asphalt the reflection spreads wider and breaks up on the grain
			float lobeW = mix(0.005, 0.0012, roadPuddle), lobeL = mix(0.035, 0.08, roadPuddle);
			float lobe = exp(-dh * dh / lobeW - dv * dv / lobeL) * mix(0.25 + 0.75 * smoothstep(0.35, 0.65, 1.0 - roadRough), 1.0, roadPuddle) * mix(0.45, 1.0, roadPuddle);
			float near = 1.0 / (1.0 + dist * dist * 0.0009);
			float pool = 1.0 - smoothstep(0.0, spgLampPos[i].w * 0.5, length(Lw.xz));
			reflectedLight.directSpecular += spgLampCol[i] * lobe * wet * (0.3 + fres) * near * 1.6;
			reflectedLight.directDiffuse += diffuseColor.rgb * spgLampCol[i] * pool * pool * max(L.y, 0.0) * 0.8;
		}
		// the player's low beams: a warm cone on the asphalt from a few metres to ~45 m ahead
		if (spgHeadPos.w > 0.0) {
			vec3 toP = vRoadP - spgHeadPos.xyz;
			float along = dot(toP.xz, spgHeadDir.xz);
			float lat = length(toP.xz - spgHeadDir.xz * along);
			float cone = exp(-lat * lat / (0.035 * along * along + 1.2));
			float reach = smoothstep(1.5, 7.0, along) * (1.0 - smoothstep(22.0, 48.0, along));
			reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.93, 0.8) * cone * reach * spgHeadPos.w * 2.2;
			reflectedLight.directSpecular += vec3(1.0, 0.93, 0.8) * cone * reach * spgHeadPos.w * wet * 0.35 * (1.0 - roadRough * 0.6);
		}
	}
#endif`,
      );
  };
  const compile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      if (streetReflectionGain > 0.0 && wetness > 0.0 && abs(vRoadP.y) < 0.2) {
        vec4 mirrorP = streetReflectionMatrix * vec4(vRoadP, 1.0);
        vec2 mirrorUV = mirrorP.xy / mirrorP.w + roadRipple * 0.002;
        vec2 blur = streetReflectionTexel * mix(2.8, 0.7, roadPuddle);
        vec3 reflected = (texture2D(streetReflection, mirrorUV + blur).rgb + texture2D(streetReflection, mirrorUV - blur).rgb
          + texture2D(streetReflection, mirrorUV + vec2(blur.x, -blur.y)).rgb + texture2D(streetReflection, mirrorUV + vec2(-blur.x, blur.y)).rgb) * 0.25;
        vec3 V = normalize(cameraPosition - vRoadP);
        float fresnel = 0.035 + 0.8 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
        float border = smoothstep(0.0, 0.015, min(min(mirrorUV.x, mirrorUV.y), min(1.0 - mirrorUV.x, 1.0 - mirrorUV.y)));
        reflectedLight.indirectSpecular += reflected * fresnel * wetness * mix(0.18, 0.85, roadPuddle) * border * (1.0 - roadPaint * 0.7);
      }`);
  };
  mat.customProgramCacheKey = () => `spg-road-mirror${useNormal ? '-n' : ''}${opts.lamps ? '-l' : ''}${rain ? '-r' : ''}`;
  return mat;
}
