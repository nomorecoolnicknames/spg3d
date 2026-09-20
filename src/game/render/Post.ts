import * as THREE from 'three';

/**
 * Post-processing built for phones: the scene renders once into a half-float target, bloom works
 * on a quarter-resolution copy (bright pass + one separable blur), and a single composite pass does
 * bloom add, exposure, ACES, colour grading and vignette. Five cheap passes instead of
 * UnrealBloom's mip chain + OutputPass. On `full` (high tier) bloom starts at half resolution and
 * blurs twice for a wider, smoother glow.
 */
export interface Grade {
  exposure: number;
  contrast: number;
  saturation: number;
  /** added to shadows (display RGB) */
  lift: [number, number, number];
  /** multiplies highlights */
  gain: [number, number, number];
  vignette: number;
  bloom: number;
  bloomThreshold: number;
}

export const DEFAULT_GRADE: Grade = {
  exposure: 1,
  contrast: 1.05,
  saturation: 1.05,
  lift: [0, 0, 0],
  gain: [1, 1, 1],
  vignette: 0.35,
  bloom: 0.6,
  bloomThreshold: 0.9,
};

export type BloomMode = 'off' | 'cheap' | 'full';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
void main() {
  // 4 bilinear taps = 16-texel box: stable downsample without shimmering
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(threshold, threshold * 2.0, l);
  gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  // 9-tap Gaussian folded into 5 bilinear samples
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += (texture2D(tSrc, vUv + dir * 1.3846153846).rgb + texture2D(tSrc, vUv - dir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(tSrc, vUv + dir * 3.2307692308).rgb + texture2D(tSrc, vUv - dir * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 projectionInverse;
uniform vec2 sceneTexel;
uniform float contactAO;
vec3 viewPoint(vec2 uv, float depth) {
  vec4 p = projectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
// Small, deterministic view-space occlusion. Uses the actual colour pass depth, so facade LOD,
// alpha-tested leaves and moving cars agree; no override-material ghost geometry or noise history.
float contactShade(vec2 uv) {
  float depth = texture2D(tDepth, uv).r;
  vec3 p = viewPoint(uv, depth);
  vec3 dx = dFdx(p), dy = dFdy(p);
  vec3 n = normalize(cross(dx, dy));
  if (depth >= 0.99999 || -p.z > 100.0) return 1.0;
  float metresPerPixel = max(length(dx), 0.001);
  float radiusPx = clamp(0.85 / metresPerPixel, 2.0, 24.0);
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    float angle = float(i) * 2.39996323;
    float ring = 0.35 + float(i) * 0.08;
    vec2 suv = uv + vec2(cos(angle), sin(angle)) * sceneTexel * radiusPx * ring;
    float sd = texture2D(tDepth, clamp(suv, sceneTexel, 1.0 - sceneTexel)).r;
    vec3 v = viewPoint(suv, sd) - p;
    float d = length(v);
    float horizon = max(dot(n, v / max(d, 0.001)) - 0.12, 0.0);
    sum += horizon * (1.0 - smoothstep(0.15, 1.2, d)) * step(sd, 0.99999);
  }
  return 1.0 - min(0.38, sum * 0.15) * contactAO;
}
uniform sampler2D tBloom;
uniform sampler2D tBloom2;
uniform float bloom, useBloom2, exposure, contrast, saturation, vignette, aspect;
uniform vec3 lift, gain;
varying vec2 vUv;


void main() {
  vec3 c = texture2D(tScene, vUv).rgb * contactShade(vUv);
  vec3 b = texture2D(tBloom, vUv).rgb;
  if (useBloom2 > 0.5) b = b * 0.6 + texture2D(tBloom2, vUv).rgb * 0.8;
  c += b * bloom;
  // the renderer's own tone mapping (ACES) keeps parity with the no-post phone path
  gl_FragColor = vec4(c * exposure, 1.0);
  #include <tonemapping_fragment>
  // grade in display (sRGB) space — lift and a 0.5 contrast pivot in linear space crush and tint the darks
  c = sRGBTransferOETF(vec4(gl_FragColor.rgb, 1.0)).rgb;
  c = c * gain + lift * (1.0 - c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;
  vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
  c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(q));
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); // already encoded: no colorspace_fragment
}`;

function target(w: number, h: number, samples = 0): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType,
    depthBuffer: samples > 0,
    samples,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
}

export class Post {
  grade: Grade;
  private sceneRT: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private bloomC: THREE.WebGLRenderTarget | null = null;
  private bloomD: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private w = 1;
  private h = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private mode: BloomMode,
    grade: Partial<Grade> = {},
    /** MSAA samples for the scene target (the canvas' own antialias does not apply to it) */
    samples = 4,
  ) {
    this.grade = { ...DEFAULT_GRADE, ...grade };
    this.sceneRT = target(1, 1, samples);
    this.sceneRT.depthBuffer = true;
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.sceneRT.depthTexture.minFilter = this.sceneRT.depthTexture.magFilter = THREE.NearestFilter;
    this.bloomA = target(1, 1);
    this.bloomB = target(1, 1);
    if (mode === 'full') {
      this.bloomC = target(1, 1);
      this.bloomD = target(1, 1);
    }
    this.brightMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BRIGHT, uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 } }, depthTest: false, depthWrite: false });
    this.blurMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, uniforms: { tSrc: { value: null }, dir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tDepth: { value: this.sceneRT.depthTexture },
        projectionInverse: { value: new THREE.Matrix4() },
        sceneTexel: { value: new THREE.Vector2() },
        contactAO: { value: 1 },
        tBloom: { value: this.bloomA.texture },
        tBloom2: { value: this.bloomC?.texture ?? null },
        bloom: { value: 0 },
        useBloom2: { value: mode === 'full' ? 1 : 0 },
        exposure: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        vignette: { value: 0 },
        aspect: { value: 1 },
        lift: { value: new THREE.Vector3() },
        gain: { value: new THREE.Vector3(1, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    // one oversized triangle covers the screen without a diagonal seam
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g, this.compMat);
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    this.w = Math.max(1, Math.round(w * pr));
    this.h = Math.max(1, Math.round(h * pr));
    this.sceneRT.setSize(this.w, this.h);
    const first = this.mode === 'full' ? 2 : 4;
    this.bloomA.setSize(Math.ceil(this.w / first), Math.ceil(this.h / first));
    this.bloomB.setSize(Math.ceil(this.w / first), Math.ceil(this.h / first));
    this.bloomC?.setSize(Math.ceil(this.w / 4), Math.ceil(this.h / 4));
    this.bloomD?.setSize(Math.ceil(this.w / 4), Math.ceil(this.h / 4));
    this.compMat.uniforms.aspect.value = w / Math.max(1, h);
  }

  private pass(mat: THREE.ShaderMaterial, out: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.quad, this.cam);
  }

  private blur(src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget): void {
    const u = this.blurMat.uniforms;
    u.tSrc.value = src.texture;
    u.dir.value.set(1 / src.width, 0);
    this.pass(this.blurMat, tmp);
    u.tSrc.value = tmp.texture;
    u.dir.value.set(0, 1 / tmp.height);
    this.pass(this.blurMat, src);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    // the sizes follow the renderer's pixel ratio, which dynamic resolution changes
    const pr = r.getPixelRatio();
    const size = r.getSize(new THREE.Vector2());
    if (Math.round(size.x * pr) !== this.w || Math.round(size.y * pr) !== this.h) this.setSize(size.x, size.y);

    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    const gr = this.grade;
    const bloomOn = this.mode !== 'off' && gr.bloom > 0.001;
    if (bloomOn) {
      const bu = this.brightMat.uniforms;
      bu.tSrc.value = this.sceneRT.texture;
      bu.texel.value.set(1 / this.sceneRT.width, 1 / this.sceneRT.height);
      bu.threshold.value = gr.bloomThreshold;
      this.pass(this.brightMat, this.bloomA);
      this.blur(this.bloomA, this.bloomB);
      if (this.bloomC && this.bloomD) {
        bu.tSrc.value = this.bloomA.texture;
        bu.texel.value.set(1 / this.bloomA.width, 1 / this.bloomA.height);
        bu.threshold.value = 0;
        this.pass(this.brightMat, this.bloomC);
        this.blur(this.bloomC, this.bloomD);
        this.blur(this.bloomC, this.bloomD);
      }
    }
    const cu = this.compMat.uniforms;
    cu.projectionInverse.value.copy(camera.projectionMatrixInverse);
    cu.sceneTexel.value.set(1 / this.w, 1 / this.h);
    cu.bloom.value = bloomOn ? gr.bloom : 0;
    cu.exposure.value = gr.exposure;
    cu.contrast.value = gr.contrast;
    cu.saturation.value = gr.saturation;
    cu.vignette.value = gr.vignette;
    cu.lift.value.set(...gr.lift);
    cu.gain.value.set(...gr.gain);
    this.pass(this.compMat, null);
  }

  dispose(): void {
    for (const t of [this.sceneRT, this.bloomA, this.bloomB, this.bloomC, this.bloomD]) t?.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.quad.geometry.dispose();
  }
}

/**
 * Post for the current quality: none on low without bloom (direct render, renderer tone mapping —
 * the phone path); otherwise cheap quarter-res bloom, full bloom on high.
 */
export function createPost(vp: { renderer: THREE.WebGLRenderer; quality: { level: 'low' | 'medium' | 'high'; bloom: boolean } }, grade?: Partial<Grade>): Post | null {
  const q = vp.quality;
  if (q.level === 'low' && !q.bloom) return null;
  const qa = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (qa?.get('post') === '0') return null; // QA A/B
  if (qa?.get('grade') === '0') grade = { lift: [0, 0, 0], gain: [1, 1, 1], saturation: 1, contrast: 1, vignette: 0, exposure: 1 };
  const mode: BloomMode = !q.bloom ? 'off' : q.level === 'high' ? 'full' : 'cheap';
  return new Post(vp.renderer, mode, grade, q.level === 'high' ? 4 : 2);
}
