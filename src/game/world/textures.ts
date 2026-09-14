import * as THREE from 'three';

/** Procedural canvas textures shared by the world builders. All sRGB unless noted. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** hash noise for deterministic grain */
let seed = 1;
export function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
export function reseed(s: number): void {
  seed = s;
}

/** Curb stripes (two colours), tiles along V. */
export function curbTexture(a: string, b: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(32, 128);
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 32, 64);
  ctx.fillStyle = b;
  ctx.fillRect(0, 64, 32, 64);
  return finish(c);
}

/** Concrete barrier with hazard stripes near the top edge. */
export function barrierTexture(base: string, stripeA: string, stripeB: string): THREE.CanvasTexture {
  reseed(23);
  const W = 256, H = 128;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 20;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // diagonal hazard stripes band
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 10, W, 26);
  ctx.clip();
  for (let x = -40; x < W + 40; x += 32) {
    ctx.fillStyle = (x / 32) % 2 === 0 ? stripeA : stripeB;
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x + 16, 10);
    ctx.lineTo(x + 32, 36);
    ctx.lineTo(x + 16, 36);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // grime at the bottom
  const g = ctx.createLinearGradient(0, H - 40, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 40, W, 40);
  return finish(c);
}

/** Soft radial sprite (smoke / glow). */
export function softSpriteTexture(inner = 1, outer = 0): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(255,255,255,${inner})`);
  g.addColorStop(0.5, `rgba(255,255,255,${inner * 0.45})`);
  g.addColorStop(1, `rgba(255,255,255,${outer})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(c, false);
}

/** Checker start line. */
export function checkerTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 32);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  return finish(c, false);
}

/** Ground: dirt / sand / snow with grain. */
export function groundTexture(base: string, grain: number): THREE.CanvasTexture {
  reseed(41);
  const W = 256, H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * grain;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return finish(c);
}

