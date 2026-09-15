import * as THREE from 'three';
import type { TrackEnv } from '../types';

export interface SkyRig {
  group: THREE.Group;
  update(t: number): void;
  dispose(): void;
}

/** Gradient dome with horizon glow, stars, optional aurora and a sun/moon disc with halo. */
export function createSky(env: TrackEnv, radius = 2400): SkyRig {
  const group = new THREE.Group();
  const uniforms = {
    topColor: { value: new THREE.Color(env.skyTop) },
    bottomColor: { value: new THREE.Color(env.skyBottom) },
    horizonColor: { value: new THREE.Color(env.horizon) },
    time: { value: 0 },
    aurora: { value: env.aurora ? 1 : 0 },
    neonA: { value: new THREE.Color(env.neonA) },
    neonB: { value: new THREE.Color(env.neonB) },
    sunDir: { value: new THREE.Vector3(...env.sunDir).normalize() },
    sunColor: { value: new THREE.Color(env.sunColor) },
    skyline: { value: env.skyline ? 1 : 0 },
  };
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor, bottomColor, horizonColor, neonA, neonB, sunColor, sunDir;
      uniform float time, aurora, skyline;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = vDir.y;
        vec3 col = mix(bottomColor, topColor, smoothstep(0.0, 0.55, h));
        // horizon band
        float hz = exp(-abs(h) * 9.0);
        col = mix(col, horizonColor, hz * 0.85);
        // sun / moon halo
        float sd = max(0.0, dot(vDir, sunDir));
        col += sunColor * (pow(sd, 380.0) * 2.5 + pow(sd, 18.0) * 0.28 + pow(sd, 4.0) * 0.06);
        // aurora curtains
        if (aurora > 0.5 && h > 0.05) {
          float x = atan(vDir.x, vDir.z) * 3.0;
          float band1 = sin(x * 1.7 + time * 0.35 + sin(h * 12.0 + time * 0.2) * 2.0);
          float band2 = sin(x * 1.1 - time * 0.25 + h * 9.0);
          float glow = smoothstep(0.12, 0.45, h) * (1.0 - smoothstep(0.5, 0.9, h));
          float a1 = smoothstep(0.55, 0.95, band1) * glow;
          float a2 = smoothstep(0.6, 0.98, band2) * glow * 0.7;
          col += neonA * a1 * 0.6 + neonB * a2 * 0.45;
        }
        // distant city: two silhouette layers along the horizon with lit windows (fog hides real geometry there)
        if (skyline > 0.5 && h < 0.2) {
          float u = atan(vDir.x, vDir.z) / 6.2831853 + 0.5;
          for (int layer = 0; layer < 2; layer++) {
            float fl = float(layer);
            float n = mix(260.0, 120.0, fl);
            float i = floor(u * n);
            float f = fract(u * n);
            float r = hash(vec2(i, 3.1 + fl));
            float top = mix(0.012, 0.045, fl) + mix(0.03, 0.1, fl) * r * r + step(0.93, r) * mix(0.03, 0.07, fl);
            float gap = step(0.06 + 0.1 * hash(vec2(i, 9.0)), f) * step(f, 0.97);
            if (h < top && gap > 0.5) {
              vec3 body = mix(horizonColor * 0.32, topColor * 0.9, fl * 0.6 + 0.2);
              // window grid in the silhouette
              vec2 w = vec2(floor(f * mix(6.0, 9.0, fl)), floor(h * mix(900.0, 700.0, fl)));
              float lit = step(0.82, hash(w + vec2(i * 7.0, fl * 13.0))) * step(0.004, top - h);
              vec3 winCol = mix(vec3(1.0, 0.72, 0.4), vec3(0.6, 0.8, 1.0), step(0.7, hash(w + i)));
              col = body + winCol * lit * mix(0.35, 0.6, fl);
              // beacons on the tallest towers
              if (r > 0.93 && top - h < 0.0025 && abs(f - 0.5) < 0.08) col = vec3(1.0, 0.1, 0.08) * (0.5 + 0.5 * step(0.5, fract(time * 0.8 + i * 0.37)));
            }
          }
          // haze where the skyline meets the glow
          col = mix(col, horizonColor, smoothstep(0.03, -0.01, h) * 0.5);
        }
        // subtle dithering to avoid banding
        col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), domeMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  let stars: THREE.Points | null = null;
  if (env.stars) {
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.92 + 0.06;
      v.normalize().multiplyScalar(radius * 0.96);
      verts.push(v.x, v.y, v.z);
      sizes.push(1 + Math.random() * 2.2);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { time: uniforms.time },
      vertexShader: /* glsl */ `
        attribute float size; varying float vA; uniform float time;
        // points under ~2.5 px pop in and out as the camera moves (they read as flicker): keep them at least
        // 2.5 px wide with a soft edge, dim the small ones instead, and let them breathe slowly
        void main(){ vA = (0.8 + 0.2 * sin(time * 0.6 + position.x * 0.01 + position.z * 0.013)) * min(1.0, size * 0.45);
          vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(2.5, size * 1.4); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying float vA; void main(){ float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(0.82, 0.88, 1.0, smoothstep(0.5, 0.0, d) * vA); }`,
    });
    stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    group.add(stars);
  }

  return {
    group,
    update(t) {
      uniforms.time.value = t;
    },
    dispose() {
      dome.geometry.dispose();
      domeMat.dispose();
      if (stars) {
        stars.geometry.dispose();
        (stars.material as THREE.Material).dispose();
      }
    },
  };
}
