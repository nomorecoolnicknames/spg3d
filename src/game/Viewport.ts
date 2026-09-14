import * as THREE from 'three';
import type { QualitySettings, SpgSnapshot } from './types';

/**
 * A scene controller owns a THREE.Scene + camera and is driven by the Viewport.
 * Exactly one controller is active at a time; the renderer/canvas persists.
 */
export interface SceneController {
  /** called once after being attached; renderer is ready */
  start(vp: Viewport): void;
  /** simulation + visuals, dt already scaled and clamped */
  update(dt: number, elapsed: number): void;
  /** draw; use vp.renderer (or a composer built on it) */
  render(vp: Viewport): void;
  resize(width: number, height: number): void;
  dispose(): void;
  /** optional QA snapshot contribution */
  snapshot?(): Partial<SpgSnapshot>;
  setPaused?(p: boolean): void;
  /**
   * Preferred frame rate for the current state: undefined = the global cap,
   * a number = lower cap (menus run at 30), 0 = nothing moves, draw once and sleep.
   */
  targetFps?(): number | undefined;
}

export interface FrameStats {
  /** rendered frames per second over the last second */
  fps: number;
  /** interval between rendered frames, ms */
  frameP50: number;
  frameP95: number;
  /** JS time spent in update + render submission, ms */
  cpuP50: number;
  cpuP95: number;
  /** frames that took longer than 50 ms during the last 10 s */
  hitches: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** current dynamic resolution multiplier (0.5..1) */
  resScale: number;
  /** drawing buffer size in device pixels */
  bufferW: number;
  bufferH: number;
  cap: number;
}

const RING = 180;

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private container: HTMLElement | null = null;
  private controller: SceneController | null = null;
  private raf = 0;
  private elapsed = 0;
  private lastT = -1;
  private lastRenderT = -1;
  private sleeping = false;
  private invalidated = true;
  timeScale = 1;
  /** max simulated seconds per frame (raised by QA to keep sim time flowing on slow renderers) */
  maxDt = 0.1;
  /** global frame cap: 60 by default, 30 = battery saver, 0 = display refresh rate */
  fpsCap = 60;
  /** dynamic resolution on/off */
  dynamicRes = true;
  quality: QualitySettings = { level: 'high', shadows: true, bloom: true, reflections: true, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) };
  width = 1;
  height = 1;
  private resizeObs: ResizeObserver | null = null;
  private visible = true;
  // stats
  private frameMs = new Float32Array(RING);
  private cpuMs = new Float32Array(RING);
  private ringI = 0;
  private ringN = 0;
  private hitchTimes: number[] = [];
  private framesThisSecond = 0;
  private secondStart = 0;
  private scale = 1;
  private sizeDirty = false;
  private scaleCheckT = 0;
  private lastInfo = { calls: 0, triangles: 0 };
  readonly stats: FrameStats = { fps: 0, frameP50: 0, frameP95: 0, cpuP50: 0, cpuP95: 0, hitches: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, resScale: 1, bufferW: 0, bufferH: 0, cap: 60 };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'spg-canvas';
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor('#07070b', 1);
    // composers render several passes per frame: count the whole frame, reset manually
    this.renderer.info.autoReset = false;
    document.addEventListener('visibilitychange', () => {
      this.visible = document.visibilityState === 'visible';
      this.lastT = -1;
      if (this.visible) this.wake();
    });
  }

  mount(el: HTMLElement): void {
    if (this.container === el) return;
    this.container = el;
    el.appendChild(this.canvas);
    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(el);
    this.onResize();
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  setQuality(q: Partial<QualitySettings>): void {
    this.quality = { ...this.quality, ...q };
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.scale = 1;
    this.onResize();
  }

  setController(c: SceneController | null): void {
    if (this.controller) this.controller.dispose();
    this.controller = c;
    this.renderer.info.reset();
    if (c) {
      c.start(this);
      c.resize(this.width, this.height);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
    }
    this.lastT = -1;
    this.wake();
  }

  /**
   * Compile every material in the scene up front, including hidden objects (nitro flames,
   * LODs, pooled effects) — otherwise their first appearance stalls a frame on shader linking.
   */
  warmup(scene: THREE.Scene, camera: THREE.Camera): void {
    const hidden: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
    });
    try {
      this.renderer.compile(scene, camera);
      // one offscreen draw of everything uploads every vertex buffer now: a city sector seen for the first
      // time mid-race would otherwise stall that frame while its geometry goes to the GPU
      const rt = new THREE.WebGLRenderTarget(4, 4);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(rt);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(prev);
      rt.dispose();
    } finally {
      for (const o of hidden) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
    }
  }

  getController(): SceneController | null {
    return this.controller;
  }

  /** request at least one more frame (e.g. a sleeping scene changed) */
  wake(): void {
    this.invalidated = true;
    if (this.sleeping) {
      this.sleeping = false;
      this.lastT = -1;
    }
  }

  private minScale(): number {
    return this.quality.level === 'high' ? 0.7 : 0.55;
  }

  private applySize(): void {
    this.renderer.setPixelRatio(this.quality.pixelRatio * this.scale);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.controller?.resize(this.width, this.height);
    this.invalidated = true;
  }

  private onResize(): void {
    if (!this.container) return;
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.applySize();
  }

  private loop = (t: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible) return;
    const c = this.controller;
    const sceneFps = c?.targetFps?.();
    if (sceneFps === 0 && !this.invalidated) {
      this.sleeping = true;
      this.lastT = -1;
      return;
    }
    const cap = sceneFps && sceneFps > 0 ? (this.fpsCap > 0 ? Math.min(this.fpsCap, sceneFps) : sceneFps) : this.fpsCap;
    this.stats.cap = cap;
    if (cap > 0 && this.lastRenderT >= 0) {
      const interval = 1000 / cap;
      // 1.5 ms tolerance so a 120 Hz display renders exactly every other vsync
      if (t - this.lastRenderT < interval - 1.5) return;
    }
    if (this.lastT < 0) this.lastT = t - 16;
    const frameInterval = this.lastRenderT >= 0 ? t - this.lastRenderT : 16;
    this.lastRenderT = t;
    const raw = Math.min((t - this.lastT) / 1000, this.maxDt);
    this.lastT = t;
    const dt = sceneFps === 0 ? 0 : raw * this.timeScale;
    this.elapsed += dt;
    this.invalidated = false;
    if (!c) return;

    const c0 = performance.now();
    if (this.sizeDirty) {
      this.sizeDirty = false;
      this.applySize();
    }
    this.renderer.info.reset();
    c.update(dt, this.elapsed);
    c.render(this);
    const cpu = performance.now() - c0;
    this.lastInfo.calls = this.renderer.info.render.calls;
    this.lastInfo.triangles = this.renderer.info.render.triangles;
    this.record(t, frameInterval, cpu, cap);
  };

  private record(t: number, frameInterval: number, cpu: number, cap: number): void {
    this.frameMs[this.ringI] = frameInterval;
    this.cpuMs[this.ringI] = cpu;
    this.ringI = (this.ringI + 1) % RING;
    this.ringN = Math.min(RING, this.ringN + 1);
    if (frameInterval > 50) this.hitchTimes.push(t);
    this.framesThisSecond++;
    if (t - this.secondStart >= 1000) {
      const s = this.stats;
      s.fps = (this.framesThisSecond * 1000) / (t - this.secondStart);
      this.framesThisSecond = 0;
      this.secondStart = t;
      const f = Array.from(this.frameMs.subarray(0, this.ringN)).sort((a, b) => a - b);
      const cp = Array.from(this.cpuMs.subarray(0, this.ringN)).sort((a, b) => a - b);
      const pick = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] ?? 0;
      s.frameP50 = pick(f, 0.5);
      s.frameP95 = pick(f, 0.95);
      s.cpuP50 = pick(cp, 0.5);
      s.cpuP95 = pick(cp, 0.95);
      while (this.hitchTimes.length && t - this.hitchTimes[0] > 10000) this.hitchTimes.shift();
      s.hitches = this.hitchTimes.length;
      s.drawCalls = this.lastInfo.calls;
      s.triangles = this.lastInfo.triangles;
      s.geometries = this.renderer.info.memory.geometries;
      s.textures = this.renderer.info.memory.textures;
      s.resScale = this.scale;
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      s.bufferW = size.x;
      s.bufferH = size.y;
      this.adaptResolution(t, cap, s);
    }
  }

  /** Lower the render resolution when frames miss the cap, raise it back slowly. */
  private adaptResolution(t: number, cap: number, s: FrameStats): void {
    if (!this.dynamicRes || t - this.scaleCheckT < 1500 || this.ringN < 60) return;
    // menus / pause run a scene-set cap: resizing the canvas there only flickers behind the UI
    if (this.controller?.targetFps?.() !== undefined) {
      if (this.scale !== 1) {
        this.scale = 1;
        this.sizeDirty = true;
      }
      return;
    }
    const target = 1000 / (cap > 0 ? cap : 60);
    let next = this.scale;
    if (s.frameP95 > target * 1.3 || s.fps < (cap > 0 ? cap : 60) * 0.85) next = Math.max(this.minScale(), this.scale - 0.1);
    else if (s.frameP95 < target * 1.1 && s.fps > (cap > 0 ? cap : 60) * 0.95 && s.cpuP95 < target * 0.6) next = Math.min(1, this.scale + 0.05);
    if (Math.abs(next - this.scale) > 0.001) {
      this.scale = next;
      this.scaleCheckT = t;
      // resizing clears the drawing buffer: never do it between render and presentation
      // (that shows a black frame) — apply right before the next frame renders
      this.sizeDirty = true;
    }
  }

  snapshot(): SpgSnapshot {
    const s = this.stats;
    return {
      screen: 'boot',
      hud: null,
      fps: Math.round(s.fps),
      drawCalls: this.lastInfo.calls,
      triangles: this.lastInfo.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      extra2: { frameP50: s.frameP50, frameP95: s.frameP95, cpuP50: s.cpuP50, cpuP95: s.cpuP95, hitches: s.hitches, resScale: s.resScale, buffer: [s.bufferW, s.bufferH], cap: s.cap },
      ...(this.controller?.snapshot?.() ?? {}),
    };
  }
}

export const viewport: Viewport = new Viewport();
