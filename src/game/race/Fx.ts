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

/**
 * Tyre marks: one continuous strip per wheel (each quad starts on the previous quad's end edge, so bends have
 * no wedges or doubled alpha), a soft rubber profile across the tyre, block tread and grain along it, darker
 * where the slip was harder, fading out over ~40 s. Ring buffer of quads in one geometry; `key` separates cars.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private data: Float32Array; // across (0|1), along (m), strength, birth time
  private head = 0;
  private strips = new Map<number, { p: THREE.Vector3; e0: THREE.Vector3; e1: THREE.Vector3; along: number; s: number }[]>();
  private time = 0;
  private uniforms = { time: { value: 0 }, color: { value: new THREE.Color('#09090b') } };
  private readonly half = 0.13;
  constructor(private max = 1400) {
    this.pos = new Float32Array(max * 4 * 3);
    this.data = new Float32Array(max * 4 * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('mark', new THREE.BufferAttribute(this.data, 4));
    const idx: number[] = [];
    for (let i = 0; i < max; i++) {
      const a = i * 4;
      idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 mark; varying vec4 vM;
        void main(){ vM = mark; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float time; varying vec4 vM;
        float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        void main(){
          float u = vM.x, v = vM.y;
          float profile = smoothstep(0.0, 0.22, u) * smoothstep(1.0, 0.78, u);
          float tread = 0.72 + 0.28 * step(0.45, fract(v * 5.0 + step(0.5, u) * 0.5)) * step(0.12, abs(u - 0.5));
          float grain = 0.8 + 0.2 * h(floor(vec2(u * 18.0, v * 40.0)));
          float age = clamp(1.0 - (time - vM.w) / 40.0, 0.0, 1.0);
          gl_FragColor = vec4(color, profile * tread * grain * age * (0.25 + 0.5 * vM.z));
        }`,
    });
    this.mat = mat;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  private mat: THREE.ShaderMaterial;
  /** advance the fade clock (seconds) */
  tick(dt: number): void {
    this.time += dt;
    this.uniforms.time.value = this.time;
  }
  /** add the current rear-wheel positions of car `key`; call with null to end its strips */
  add(l: THREE.Vector3 | null, r: THREE.Vector3 | null, strength = 1, key = 0): void {
    if (!l || !r) {
      this.strips.delete(key);
      return;
    }
    const prev = this.strips.get(key);
    const wheels = [l, r];
    if (!prev) {
      this.strips.set(key, wheels.map((p) => ({ p: p.clone(), e0: new THREE.Vector3(), e1: new THREE.Vector3(), along: 0, s: -1 })));
      return;
    }
    if (prev[0].p.distanceToSquared(l) < 0.12) return;
    let dirty = false;
    wheels.forEach((p, k) => {
      const w = prev[k];
      const dir = new THREE.Vector3().subVectors(p, w.p);
      const len = dir.length();
      if (len > 3) {
        // a jump (respawn, teleport): restart this strip
        w.p.copy(p);
        w.s = -1;
        return;
      }
      dir.divideScalar(len || 1);
      const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(this.half);
      const n0 = p.clone().add(side), n1 = p.clone().sub(side);
      if (w.s < 0) {
        w.e0.copy(w.p).add(side);
        w.e1.copy(w.p).sub(side);
        w.s = strength;
      }
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      const o = i * 12, d = i * 16;
      const put = (c: number, v: THREE.Vector3, across: number, along: number, st: number) => {
        this.pos[o + c * 3] = v.x;
        this.pos[o + c * 3 + 1] = v.y + 0.02;
        this.pos[o + c * 3 + 2] = v.z;
        this.data.set([across, along, st, this.time], d + c * 4);
      };
      put(0, w.e0, 0, w.along, w.s);
      put(1, w.e1, 1, w.along, w.s);
      put(2, n1, 1, w.along + len, strength);
      put(3, n0, 0, w.along + len, strength);
      w.e0.copy(n0);
      w.e1.copy(n1);
      w.p.copy(p);
      w.along += len;
      w.s = strength;
      dirty = true;
    });
    if (dirty) {
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.mark as THREE.BufferAttribute).needsUpdate = true;
    }
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
