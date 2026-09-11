import * as THREE from 'three';

export interface WeatherRig {
  group: THREE.Group;
  /** call every frame with the camera position and velocity of the follow target */
  update(dt: number, cam: THREE.Vector3, vel: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Rain streaks or snow flakes in a box that follows the camera. Rain uses stretched
 * line-ish points (custom shader elongates along fall direction).
 */
export function createWeather(kind: 'rain' | 'snow', count = 1600): WeatherRig {
  const group = new THREE.Group();
  const box = new THREE.Vector3(90, 40, 90);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const spd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * box.x;
    pos[i * 3 + 1] = Math.random() * box.y;
    pos[i * 3 + 2] = (Math.random() - 0.5) * box.z;
    spd[i] = kind === 'rain' ? 22 + Math.random() * 12 : 2.2 + Math.random() * 2.2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      color: { value: new THREE.Color(kind === 'rain' ? '#9fc4ff' : '#ffffff') },
      size: { value: kind === 'rain' ? 0.9 : 1.1 },
      stretch: { value: kind === 'rain' ? 6.0 : 1.0 },
      fogColor: { value: new THREE.Color('#000000') },
      fogDensity: { value: 0.003 },
    },
    vertexShader: /* glsl */ `
      uniform float size; varying float vFog; uniform float fogDensity;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (220.0 / -mv.z); gl_Position = projectionMatrix * mv;
        vFog = 1.0 - exp(-fogDensity * fogDensity * mv.z * mv.z); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float stretch; varying float vFog;
      void main(){ vec2 c = gl_PointCoord - 0.5; c.x *= stretch; float d = length(c);
        if (d > 0.5) discard; float a = (1.0 - d * 2.0) * (1.0 - vFog) * 0.7;
        gl_FragColor = vec4(color, a); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  group.add(points);
  const wind = kind === 'rain' ? 3 : 1.2;
  let phase = 0;

  return {
    group,
    update(dt, cam, vel) {
      phase += dt;
      const arr = geo.attributes.position.array as Float32Array;
      const ox = cam.x - box.x / 2, oz = cam.z - box.z / 2, oy = cam.y - 8;
      for (let i = 0; i < count; i++) {
        let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
        y -= spd[i] * dt;
        x += (wind + (kind === 'snow' ? Math.sin(phase * 1.3 + i) * 0.8 : 0)) * dt - vel.x * dt * 0.15;
        z -= vel.z * dt * 0.15;
        // wrap into the camera box
        if (y < oy) y += box.y;
        if (x < ox) x += box.x;
        else if (x > ox + box.x) x -= box.x;
        if (z < oz) z += box.z;
        else if (z > oz + box.z) z -= box.z;
        arr[i * 3] = x;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z;
      }
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
