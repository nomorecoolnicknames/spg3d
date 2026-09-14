import * as THREE from 'three';
import { softSpriteTexture } from '../world/textures';

/**
 * Street lamps as a light source for materials that are not the city shader: every frame the few
 * lamps nearest to the point the camera looks at are copied into shared uniforms. Car paint gets
 * sweeping highlights from them, wet asphalt gets NFS-style stretched reflections, and every lamp
 * head gets a glow halo (one Points draw call for all of them).
 */
export const LAMP_SLOTS = 6;

export interface LampUniforms {
  /** xyz = head position, w = range (m); w = 0 → slot unused */
  spgLampPos: { value: THREE.Vector4[] };
  spgLampCol: { value: THREE.Vector3[] };
}

export const lampUniforms: LampUniforms = {
  spgLampPos: { value: Array.from({ length: LAMP_SLOTS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  spgLampCol: { value: Array.from({ length: LAMP_SLOTS }, () => new THREE.Vector3()) },
};

/** GLSL declarations shared by every material that reads the lamp slots */
export const LAMP_GLSL = /* glsl */ `
#define SPG_LAMPS ${LAMP_SLOTS}
uniform vec4 spgLampPos[SPG_LAMPS];
uniform vec3 spgLampCol[SPG_LAMPS];
`;

export interface Lamp {
  x: number;
  y: number;
  z: number;
  color?: THREE.ColorRepresentation;
  /** reach in metres */
  range?: number;
  intensity?: number;
}

export class LampField {
  readonly halos: THREE.Points | null = null;
  private pos: Float32Array;
  private col: Float32Array;
  private range: Float32Array;
  private readonly n: number;
  private grid = new Map<string, number[]>();
  private readonly cell = 40;
  private disposables: { dispose(): void }[] = [];
  private cand: number[] = [];

  constructor(lamps: Lamp[], opts: { halos?: boolean; haloSize?: number } = {}) {
    this.n = lamps.length;
    this.pos = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.range = new Float32Array(this.n);
    const c = new THREE.Color();
    lamps.forEach((l, i) => {
      this.pos.set([l.x, l.y, l.z], i * 3);
      c.set(l.color ?? '#ffc58a').multiplyScalar(l.intensity ?? 1);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.range[i] = l.range ?? 24;
      const k = `${Math.floor(l.x / this.cell)},${Math.floor(l.z / this.cell)}`;
      const list = this.grid.get(k);
      if (list) list.push(i);
      else this.grid.set(k, [i]);
    });
    if (opts.halos !== false && this.n) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      const tex = softSpriteTexture(1, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, size: { value: opts.haloSize ?? 5 }, scale: { value: 600 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        vertexShader: /* glsl */ `
          uniform float size, scale;
          varying vec3 vCol;
          varying float vFade;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float z = max(0.5, -mv.z);
            gl_PointSize = clamp(size * scale / z, 2.0, 180.0);
            gl_Position = projectionMatrix * mv;
            vCol = color;
            // halos read strongest at mid distance, vanish far away in the haze
            vFade = smoothstep(2.0, 10.0, z) * (1.0 - smoothstep(180.0, 420.0, z));
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          varying vec3 vCol;
          varying float vFade;
          void main() {
            float a = texture2D(map, gl_PointCoord).a;
            gl_FragColor = vec4(vCol * a * a * 0.55 * vFade, 1.0);
          }`,
      });
      const points = new THREE.Points(g, mat);
      points.frustumCulled = false;
      points.name = 'lamp-halos';
      points.renderOrder = 4;
      (this as { halos: THREE.Points | null }).halos = points;
      this.disposables.push(g, mat, tex);
    }
  }

  /** fill the uniform slots with the lamps nearest to `focus` (usually ~25 m ahead of the camera) */
  update(focus: THREE.Vector3): void {
    const slots = lampUniforms;
    const cand = this.cand;
    cand.length = 0;
    const cx = Math.floor(focus.x / this.cell), cz = Math.floor(focus.z / this.cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = this.grid.get(`${cx + dx},${cz + dz}`);
      if (list) for (const i of list) cand.push(i);
    }
    const d2 = (i: number) => (this.pos[i * 3] - focus.x) ** 2 + (this.pos[i * 3 + 2] - focus.z) ** 2;
    cand.sort((a, b) => d2(a) - d2(b));
    for (let s = 0; s < LAMP_SLOTS; s++) {
      const i = cand[s];
      if (i === undefined) {
        slots.spgLampPos.value[s].set(0, -1000, 0, 0);
        continue;
      }
      slots.spgLampPos.value[s].set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], this.range[i]);
      slots.spgLampCol.value[s].set(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]);
    }
  }

  static clear(): void {
    for (const p of lampUniforms.spgLampPos.value) p.set(0, -1000, 0, 0);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    LampField.clear();
  }
}
