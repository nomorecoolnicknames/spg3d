import * as THREE from 'three';

export interface WeatherRig {
  group: THREE.Group;
  /** call every frame with the camera position and velocity of the follow target */
  update(dt: number, cam: THREE.Vector3, vel: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Rain streaks or snow flakes in a box that follows the camera. Everything moves in the vertex
 * shader (fall, wind, wrap around the camera), so the CPU only updates two uniforms per frame.
 * Flakes are capped in screen size and fade out right in front of the lens.
 */
export function createWeather(kind: 'rain' | 'snow', count = 1600): WeatherRig {
  const group = new THREE.Group();
  const box = new THREE.Vector3(90, 40, 90);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * box.x;
    pos[i * 3 + 1] = Math.random() * box.y;
    pos[i * 3 + 2] = Math.random() * box.z;
    seed[i * 2] = kind === 'rain' ? 22 + Math.random() * 12 : 2.2 + Math.random() * 2.2;
    seed[i * 2 + 1] = Math.random() * 100;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const uniforms = {
    color: { value: new THREE.Color(kind === 'rain' ? '#9fc4ff' : '#ffffff') },
    size: { value: kind === 'rain' ? 0.48 : 0.27 },
    maxPx: { value: kind === 'rain' ? 7 : 3 },
    stretch: { value: kind === 'rain' ? 7.0 : 1.0 },
    fogDensity: { value: 0.003 },
    time: { value: 0 },
    origin: { value: new THREE.Vector3() },
    box: { value: box },
    wind: { value: kind === 'rain' ? 3 : 1.2 },
    sway: { value: kind === 'snow' ? 0.8 : 0 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aSeed;
      uniform float size, maxPx, fogDensity, time, wind, sway;
      uniform vec3 origin, box;
      varying float vFade;
      void main() {
        vec3 p = position + vec3(wind * time + sin(time * 1.3 + aSeed.y) * sway, -aSeed.x * time, 0.0);
        p = mod(p - origin, box) + origin;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float z = -mv.z;
        gl_PointSize = min(maxPx, size * 220.0 / max(z, 0.1));
        gl_Position = projectionMatrix * mv;
        float fog = 1.0 - exp(-fogDensity * fogDensity * z * z);
        vFade = (1.0 - fog) * smoothstep(1.5, 7.0, z);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float stretch; varying float vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5; c.x *= stretch; float d = length(c);
        if (d > 0.5) discard;
        gl_FragColor = vec4(color, (1.0 - d * 2.0) * vFade * 0.38);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  group.add(points);

  return {
    group,
    update(dt, cam) {
      uniforms.time.value += dt;
      // the wrap box is centred on the camera, a little below it
      uniforms.origin.value.set(cam.x - box.x / 2, cam.y - 8, cam.z - box.z / 2);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
