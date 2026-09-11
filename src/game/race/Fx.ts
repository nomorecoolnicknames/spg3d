import * as THREE from 'three';
import { softSpriteTexture } from '../world/textures';

/**
 * Pooled particle effects for races: tire smoke, sparks, dust, skid marks.
 * No per-frame allocations after construction.
 */
export class Smoke {
  readonly mesh: THREE.InstancedMesh;
  private pos: THREE.Vector3[] = [];
  private vel: THREE.Vector3[] = [];
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private head = 0;
  private dummy = new THREE.Object3D();
  private mat: THREE.MeshBasicMaterial;
  private cam: THREE.Camera | null = null;
  constructor(private max = 220, color = '#9a9aa2') {
    const tex = softSpriteTexture(0.9, 0);
    this.mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0.22, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.age = new Float32Array(max).fill(99);
    this.life = new Float32Array(max).fill(1);
    this.size = new Float32Array(max).fill(1);
    for (let i = 0; i < max; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
    }
    this.mesh.count = 0;
  }
  setCamera(c: THREE.Camera): void {
    this.cam = c;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, size = 0.6, life = 1.2): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i].copy(p);
    this.vel[i].copy(v);
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
  }
  update(dt: number): void {
    let n = 0;
    const q = this.cam ? this.cam.quaternion : null;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      this.vel[i].multiplyScalar(1 - dt * 1.6);
      this.vel[i].y += dt * 0.8;
      this.pos[i].addScaledVector(this.vel[i], dt);
      this.dummy.position.copy(this.pos[i]);
      if (q) this.dummy.quaternion.copy(q);
      const s = this.size[i] * (0.5 + t * 1.8);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

export class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private head = 0;
  private mat: THREE.PointsMaterial;
  constructor(private max = 300) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(9);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color: '#ffcc66', size: 0.14, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }
  burst(p: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = dir.x * speed + (Math.random() - 0.5) * speed;
      this.vel[i * 3 + 1] = Math.random() * speed * 0.7;
      this.vel[i * 3 + 2] = dir.z * speed + (Math.random() - 0.5) * speed;
      this.age[i] = 0;
    }
  }
  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > 0.6) {
        this.pos[i * 3 + 1] = -100;
        continue;
      }
      this.age[i] += dt;
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/** Skid marks as a ring buffer of quads in one geometry (per wheel pair). */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private alpha: Float32Array;
  private head = 0;
  private last: { l: THREE.Vector3; r: THREE.Vector3 } | null = null;
  private mat: THREE.ShaderMaterial;
  constructor(private max = 600) {
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < max; i++) {
      const a = i * 4;
      idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: { color: { value: new THREE.Color('#0a0a0c') } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA * 0.55); }',
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  /** add a segment between the current rear-wheel positions; call with null to break the strip */
  add(l: THREE.Vector3 | null, r: THREE.Vector3 | null, strength = 1): void {
    if (!l || !r) {
      this.last = null;
      return;
    }
    if (!this.last) {
      this.last = { l: l.clone(), r: r.clone() };
      return;
    }
    if (this.last.l.distanceToSquared(l) < 0.16) return;
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const p = this.pos, o = i * 12;
    const w = 0.13;
    const put = (k: number, v: THREE.Vector3, side: THREE.Vector3) => {
      p[o + k * 3] = v.x + side.x;
      p[o + k * 3 + 1] = v.y + 0.02;
      p[o + k * 3 + 2] = v.z + side.z;
    };
    const dir = new THREE.Vector3().subVectors(l, this.last.l).normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(w);
    put(0, this.last.l, side);
    put(1, this.last.l, side.clone().negate());
    put(2, l, side.clone().negate());
    put(3, l, side);
    for (let k = 0; k < 4; k++) this.alpha[i * 4 + k] = strength;
    const j = this.head;
    this.head = (this.head + 1) % this.max;
    const o2 = j * 12;
    const put2 = (k: number, v: THREE.Vector3, sd: THREE.Vector3) => {
      p[o2 + k * 3] = v.x + sd.x;
      p[o2 + k * 3 + 1] = v.y + 0.02;
      p[o2 + k * 3 + 2] = v.z + sd.z;
    };
    put2(0, this.last.r, side);
    put2(1, this.last.r, side.clone().negate());
    put2(2, r, side.clone().negate());
    put2(3, r, side);
    for (let k = 0; k < 4; k++) this.alpha[j * 4 + k] = strength;
    this.last.l.copy(l);
    this.last.r.copy(r);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
