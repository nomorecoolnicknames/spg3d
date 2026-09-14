import * as THREE from 'three';

/**
 * Pooled particles (THREE.Points with per-particle attributes, CPU-simulated),
 * pooled point lights, shockwave rings and a camera shaker. No per-frame allocations.
 */

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size0: number; size1: number;
  r: number; g: number; b: number;
  drag: number; gravity: number;
  fade: number; // alpha multiplier
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.25, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

export class ParticlePool {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pos: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private cursor = 0;

  constructor(readonly capacity: number, additive: boolean) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size0: 1, size1: 1, r: 1, g: 1, b: 1, drag: 0, gravity: 0, fade: 1 });
      this.pos[i * 3 + 1] = -9999;
    }
  }

  emit(o: { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; life: number; size0: number; size1?: number; color: THREE.Color | number; drag?: number; gravity?: number; fade?: number; spread?: number; speed?: number }): void {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    const spread = o.spread ?? 0;
    const speed = o.speed ?? 0;
    p.alive = true;
    p.x = o.x + (Math.random() - 0.5) * spread;
    p.y = o.y + (Math.random() - 0.5) * spread;
    p.z = o.z + (Math.random() - 0.5) * spread;
    p.vx = (o.vx ?? 0) + (Math.random() - 0.5) * speed;
    p.vy = (o.vy ?? 0) + (Math.random() - 0.5) * speed;
    p.vz = (o.vz ?? 0) + (Math.random() - 0.5) * speed;
    p.life = 0;
    p.maxLife = o.life * (0.8 + Math.random() * 0.4);
    p.size0 = o.size0;
    p.size1 = o.size1 ?? o.size0;
    const c = typeof o.color === 'number' ? new THREE.Color(o.color) : o.color;
    p.r = c.r; p.g = c.g; p.b = c.b;
    p.drag = o.drag ?? 0;
    p.gravity = o.gravity ?? 0;
    p.fade = o.fade ?? 1;
  }

  update(dt: number): void {
    const pos = this.pos, size = this.size, col = this.col;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.parts[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        pos[i * 3 + 1] = -9999;
        size[i] = 0;
        continue;
      }
      const t = p.life / p.maxLife;
      p.vy += p.gravity * dt;
      const d = 1 - Math.min(1, p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      size[i] = p.size0 + (p.size1 - p.size0) * t;
      const a = (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * p.fade;
      col[i * 4] = p.r; col[i * 4 + 1] = p.g; col[i * 4 + 2] = p.b; col[i * 4 + 3] = a;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.parts[i].alive = false;
      this.pos[i * 3 + 1] = -9999;
      this.size[i] = 0;
    }
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Fixed set of point lights for muzzle flashes / explosions. Lights stay in the scene with
 * intensity 0 when idle: toggling `visible` changes the light count and recompiles every
 * lit shader (a visible hitch on phones).
 */
export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private life: number[] = [];
  private max: number[] = [];
  private base: number[] = [];
  private cursor = 0;
  constructor(readonly group: THREE.Object3D, n = 6) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight('#ffb060', 0, 40, 1.6);
      group.add(l);
      this.lights.push(l);
      this.life.push(1);
      this.max.push(1);
      this.base.push(0);
    }
  }
  flash(p: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, seconds: number, distance = 40): void {
    if (!this.lights.length) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.lights.length;
    const l = this.lights[i];
    l.position.copy(p);
    l.color.set(color);
    l.intensity = intensity;
    l.distance = distance;
    this.life[i] = 0;
    this.max[i] = seconds;
    this.base[i] = intensity;
  }
  update(dt: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      if (this.life[i] >= this.max[i]) continue;
      const l = this.lights[i];
      this.life[i] += dt;
      const t = Math.min(1, this.life[i] / this.max[i]);
      l.intensity = this.base[i] * (1 - t) * (1 - t);
    }
  }
}

export class Shaker {
  private amp = 0;
  private t = 0;
  readonly offset = new THREE.Vector3();
  add(a: number): void {
    this.amp = Math.min(1.2, this.amp + a);
  }
  update(dt: number): void {
    this.t += dt * 37;
    this.amp = Math.max(0, this.amp - dt * (1.6 + this.amp * 2));
    const a = this.amp;
    this.offset.set(Math.sin(this.t * 1.3) * a * 0.35, Math.sin(this.t * 1.7 + 1) * a * 0.25, Math.sin(this.t * 0.9 + 2) * a * 0.3);
  }
}

/** Expanding ground ring (slam shockwave / telegraph). */
export class Ring {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  active = false;
  radius = 0;
  private speed = 0;
  private maxR = 1;
  constructor(color: THREE.ColorRepresentation, readonly thickness: number) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(1 - thickness, 1, 64), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
  }
  start(center: THREE.Vector3, r0: number, r1: number, speed: number): void {
    this.mesh.position.copy(center).setY(0.06);
    this.radius = r0;
    this.maxR = r1;
    this.speed = speed;
    this.active = true;
    this.mesh.visible = true;
  }
  stop(): void {
    this.active = false;
    this.mesh.visible = false;
  }
  update(dt: number): void {
    if (!this.active) return;
    this.radius += this.speed * dt;
    if (this.radius >= this.maxR) {
      this.stop();
      return;
    }
    const s = Math.max(0.01, this.radius);
    this.mesh.scale.set(s, s, 1);
    this.mat.opacity = 0.95 * (1 - this.radius / this.maxR) + 0.05;
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => disposeMaterial(x));
    else if (mat) disposeMaterial(mat);
  });
}

function disposeMaterial(m: THREE.Material): void {
  const mm = m as THREE.MeshStandardMaterial;
  for (const k of ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'alphaMap'] as const) {
    const t = mm[k] as THREE.Texture | null | undefined;
    if (t && !t.userData.shared) t.dispose();
  }
  m.dispose();
}
