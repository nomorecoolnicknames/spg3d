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
}

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private container: HTMLElement | null = null;
  private controller: SceneController | null = null;
  private raf = 0;
  private clock = new THREE.Clock(false);
  private elapsed = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  fps = 0;
  timeScale = 1;
  quality: QualitySettings = { level: 'high', shadows: true, bloom: true, reflections: true, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) };
  width = 1;
  height = 1;
  private resizeObs: ResizeObserver | null = null;
  private visible = true;

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
    document.addEventListener('visibilitychange', () => {
      this.visible = document.visibilityState === 'visible';
      if (this.visible) this.clock.getDelta();
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
    if (!this.raf) {
      this.clock.start();
      this.loop();
    }
  }

  setQuality(q: Partial<QualitySettings>): void {
    this.quality = { ...this.quality, ...q };
    this.renderer.shadowMap.enabled = this.quality.shadows;
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
    this.clock.getDelta();
  }

  getController(): SceneController | null {
    return this.controller;
  }

  private onResize(): void {
    if (!this.container) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.controller?.resize(w, h);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const raw = Math.min(this.clock.getDelta(), 0.1);
    if (!this.visible) return;
    const dt = raw * this.timeScale;
    this.elapsed += dt;
    this.fpsAcc += raw;
    this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    const c = this.controller;
    if (!c) return;
    c.update(dt, this.elapsed);
    c.render(this);
  };

  snapshot(): SpgSnapshot {
    const info = this.renderer.info;
    return {
      screen: 'boot',
      hud: null,
      fps: Math.round(this.fps),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      ...(this.controller?.snapshot?.() ?? {}),
    };
  }
}

export const viewport: Viewport = new Viewport();
