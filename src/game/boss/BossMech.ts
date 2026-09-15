import * as THREE from 'three';
import { mergeStaticMeshes } from '../world/merge';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * МЭДКИД — the final boss: a ~16 m giant of the rapper himself, dressed as on stage (reference photo:
 * Wikimedia Commons «Madkid 2026.jpg», JessePinkman, CC BY 4.0 — nothing of it is copied, the look is
 * modelled): platinum-blond bob with bangs, pale face with sleepy eyes and a septum ring, black oversized
 * knit sweater, grey patterned scarf with a long end down the left side, wide black trousers, chunky
 * sneakers. Armed: a rocket launcher in the right fist, a gatling in the left, a rocket rack strapped on
 * the left shoulder; a reactor hatch on the chest is the weak spot. Exposes a small animation API used by
 * BossScene.
 */
export interface MechAnchors {
  core: THREE.Object3D;
  eye: THREE.Object3D;
  rocketPod: THREE.Object3D[];
  shoulderRack: THREE.Object3D[];
  gatling: THREE.Object3D;
  mouth: THREE.Object3D;
  feet: [THREE.Object3D, THREE.Object3D];
  chest: THREE.Object3D;
}

/** head radius (width / 2); the head is 1.25× taller than wide */
const HEAD_R = 1.1;
/** head centre above the neck pivot */
const HEAD_C = 1.55;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function lcg(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

function canvasTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function panelTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const W = 512, H = 512;
  const [c, ctx] = canvas(W, H);
  const [r, rctx] = canvas(W, H);
  ctx.fillStyle = '#4a4e5a';
  ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = '#7a7a7a';
  rctx.fillRect(0, 0, W, H);
  const rnd = lcg(3);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, w = 60 + rnd() * 160, h = 40 + rnd() * 120;
    const v = 58 + rnd() * 26;
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    const rv = 90 + rnd() * 70;
    rctx.fillStyle = `rgb(${rv},${rv},${rv})`;
    rctx.fillRect(x, y, w, h);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x + 8 + rnd() * (w - 16), y + 8 + rnd() * (h - 16), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(180,185,200,0.22)';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = 1 + rnd() * 1.5;
    ctx.beginPath();
    const x = rnd() * W, y = rnd() * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 30);
    ctx.stroke();
  }
  const map = canvasTexture(c, true);
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(r);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, rough };
}

/** black rib knit: columns of V stitches with purl gaps, a little pilling */
function knitTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#2a2a31';
  ctx.fillRect(0, 0, S, S);
  const col = 16, row = 12;
  for (let x = 0; x < S; x += col) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, 0, 3, S);
    for (let y = 0; y < S; y += row) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 1);
      ctx.lineTo(x + col / 2 + 1, y + row - 1);
      ctx.lineTo(x + col - 1, y + 1);
      ctx.stroke();
    }
  }
  const rnd = lcg(11);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return canvasTexture(c, true);
}

/** platinum strands: solid roots, tips that end at different lengths — alphaTest turns them into a jagged hem */
function hairTexture(): THREE.CanvasTexture {
  const W = 256, H = 256;
  const [c, ctx] = canvas(W, H);
  const rnd = lcg(5);
  ctx.fillStyle = '#e4d9bc';
  ctx.fillRect(0, 0, W, H * 0.72);
  const tones = ['#efe7cf', '#ddd1b0', '#f8f3e4', '#d2c4a0', '#e9dfc4'];
  for (let i = 0; i < 150; i++) {
    const x = rnd() * W, w = 5 + rnd() * 9, len = H * (0.76 + rnd() * 0.24);
    ctx.fillStyle = tones[i % tones.length];
    for (const dx of [-W, 0, W]) {
      ctx.beginPath();
      ctx.moveTo(x + dx - w / 2, 0);
      ctx.lineTo(x + dx + w / 2, 0);
      ctx.lineTo(x + dx + (rnd() - 0.5) * 3, len);
      ctx.closePath();
      ctx.fill();
    }
  }
  // fine strand lines
  for (let i = 0; i < 120; i++) {
    const x = rnd() * W;
    ctx.strokeStyle = rnd() < 0.5 ? 'rgba(150,130,95,0.35)' : 'rgba(255,255,245,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rnd() - 0.5) * 6, H * (0.5 + rnd() * 0.3));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  g.addColorStop(0, 'rgba(120,98,66,0.4)');
  g.addColorStop(1, 'rgba(120,98,66,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.3);
  ctx.globalCompositeOperation = 'source-over';
  return canvasTexture(c, true);
}

/** grey scarf with a small light pattern (as on the photo) */
function scarfTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#6a727d';
  ctx.fillRect(0, 0, S, S);
  const rnd = lcg(21);
  const cell = 16;
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const ox = (y / cell) % 2 ? cell / 2 : 0;
      const cx = x + ox + cell / 2, cy = y + cell / 2;
      ctx.strokeStyle = 'rgba(170,178,190,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx + 4, cy);
      ctx.lineTo(cx, cy + 5);
      ctx.lineTo(cx - 4, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(52,58,68,0.7)';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(rnd() * S, rnd() * S, 2, 1);
  }
  return canvasTexture(c, true);
}

/**
 * Face paint in head-front projection: canvas (0.5 + x/2, 0.5 − y/2) ↔ head point (x·HEAD_R, y·1.25·HEAD_R).
 * Pale skin, sleepy half-lidded eyes, blond brows under the bangs, septum ring, pale slightly parted lips.
 */
function faceTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const P = (x: number, y: number): [number, number] => [(0.5 + x / 2) * S, (0.5 - y / 2) * S];
  const radial = (x: number, y: number, r: number, inner: string, outer: string) => {
    const [px, py] = P(x, y);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
  };
  ctx.fillStyle = '#eddacd';
  ctx.fillRect(0, 0, S, S);
  const rim = ctx.createRadialGradient(256, 250, 70, 256, 280, 320);
  rim.addColorStop(0, 'rgba(160,110,100,0)');
  rim.addColorStop(1, 'rgba(150,100,95,0.4)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, S, S);
  for (const s of [-1, 1]) {
    radial(s * 0.46, -0.36, 70, 'rgba(228,150,148,0.24)', 'rgba(228,150,148,0)');
    // smoky, shadowed eyes (as under stage light)
    radial(s * 0.36, 0.05, 74, 'rgba(96,62,72,0.42)', 'rgba(96,62,72,0)');
  }
  // eyes
  for (const s of [-1, 1]) {
    const [ex, ey] = P(s * 0.36, 0.02);
    const almond = () => {
      ctx.beginPath();
      ctx.moveTo(ex - 42, ey);
      ctx.quadraticCurveTo(ex, ey - 13, ex + 42, ey);
      ctx.quadraticCurveTo(ex, ey + 22, ex - 42, ey);
      ctx.closePath();
    };
    ctx.fillStyle = '#f3eeea';
    almond();
    ctx.fill();
    ctx.save();
    almond();
    ctx.clip();
    ctx.fillStyle = '#44525e';
    ctx.beginPath();
    ctx.arc(ex + s * 2, ey + 5, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#121216';
    ctx.beginPath();
    ctx.arc(ex + s * 2, ey + 5, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // heavy upper lid with lashes, crease above, faint lower lid
    ctx.strokeStyle = '#1e171b';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - 45, ey + 3);
    ctx.quadraticCurveTo(ex, ey - 16, ex + 45, ey + 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(100,64,70,0.6)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ex - 36, ey - 15);
    ctx.quadraticCurveTo(ex, ey - 33, ex + 36, ey - 15);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(80,50,58,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ex - 34, ey + 8);
    ctx.quadraticCurveTo(ex, ey + 25, ex + 34, ey + 8);
    ctx.stroke();
    // thin blond brow
    const [b0x, b0y] = P(s * 0.16, 0.3);
    const [b1x, b1y] = P(s * 0.36, 0.37);
    const [b2x, b2y] = P(s * 0.57, 0.28);
    ctx.strokeStyle = '#8f7a58';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(b0x, b0y);
    ctx.quadraticCurveTo(b1x, b1y, b2x, b2y);
    ctx.stroke();
  }
  // nose: side shadow, tip, nostrils, septum ring
  {
    ctx.strokeStyle = 'rgba(120,76,72,0.6)';
    ctx.lineWidth = 5;
    const [n0x, n0y] = P(0.07, -0.02);
    const [n1x, n1y] = P(0.11, -0.22);
    const [n2x, n2y] = P(0.07, -0.31);
    ctx.beginPath();
    ctx.moveTo(n0x, n0y);
    ctx.quadraticCurveTo(n1x, n1y, n2x, n2y);
    ctx.stroke();
    radial(0, -0.27, 20, 'rgba(255,246,240,0.35)', 'rgba(255,246,240,0)');
    ctx.fillStyle = '#6d4a4a';
    for (const s of [-1, 1]) {
      const [nx, ny] = P(s * 0.055, -0.34);
      ctx.beginPath();
      ctx.ellipse(nx, ny, 8, 4, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    const [rx, ry] = P(0, -0.35);
    ctx.strokeStyle = '#dfe3ea';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(rx, ry, 10, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
  }
  // lips
  {
    const [mx, my] = P(0, -0.56);
    ctx.fillStyle = '#b27e7e';
    ctx.beginPath();
    ctx.moveTo(mx - 46, my);
    ctx.quadraticCurveTo(mx - 20, my - 16, mx, my - 9);
    ctx.quadraticCurveTo(mx + 20, my - 16, mx + 46, my);
    ctx.quadraticCurveTo(mx, my + 3, mx - 46, my);
    ctx.fill();
    ctx.fillStyle = '#c48f8d';
    ctx.beginPath();
    ctx.moveTo(mx - 40, my + 3);
    ctx.quadraticCurveTo(mx, my + 30, mx + 40, my + 3);
    ctx.quadraticCurveTo(mx, my + 7, mx - 40, my + 3);
    ctx.fill();
    ctx.strokeStyle = '#5e3a3f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(mx - 44, my + 1);
    ctx.quadraticCurveTo(mx, my + 7, mx + 44, my + 1);
    ctx.stroke();
    radial(0, -0.8, 60, 'rgba(140,95,90,0.18)', 'rgba(140,95,90,0)');
  }
  return canvasTexture(c);
}

/** unit sphere point → head: taller than wide, deeper, narrowing to a pointed chin, flattened face, nose ridge */
function headShape(x: number, y: number, z: number): THREE.Vector3 {
  let X = x, Z = z;
  if (y < 0) {
    const t = -y;
    X *= 1 - 0.36 * Math.pow(t, 1.4);
    Z *= 1 - 0.12 * t * t;
  }
  Z *= 1.1;
  if (Z > 0.62) Z = 0.62 + (Z - 0.62) * 0.55;
  if (z > 0) Z += 0.09 * Math.exp(-(x * x) / 0.012 - (y + 0.2) ** 2 / 0.03);
  return new THREE.Vector3(X * HEAD_R, y * 1.25 * HEAD_R, Z * HEAD_R);
}

function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = headShape(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, v.x, v.y, v.z);
    // front projection of the face paint; the back of the head samples plain forehead skin (under the hair)
    if (v.z > -0.1) uv.setXY(i, 0.5 + v.x / (2 * HEAD_R), 0.5 + v.y / (2 * 1.25 * HEAD_R));
    else uv.setXY(i, 0.5 + v.x / (10 * HEAD_R), 0.96);
  }
  g.computeVertexNormals();
  return g;
}

export class BossMech {
  readonly root = new THREE.Group();
  readonly anchors: MechAnchors;
  private torso = new THREE.Group();
  private pelvis = new THREE.Group();
  private head = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private ankleL = new THREE.Group();
  private ankleR = new THREE.Group();
  private shoulderL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private eye: THREE.Mesh;
  private eyeMat: THREE.MeshBasicMaterial;
  private shutterL: THREE.Mesh;
  private shutterR: THREE.Mesh;
  private coreMat: THREE.MeshStandardMaterial;
  private coreLight: THREE.PointLight;
  private seamMat: THREE.MeshBasicMaterial;
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private coreOpen = 0;
  private walkPhase = 0;
  private stagger = 0;
  private collapse = 0;
  private torsoYaw = 0;
  private headYaw = 0;
  private headPitch = 0;
  readonly height = 16;

  constructor(shadows: boolean, low = false) {
    const tex = panelTextures();
    const knitTex = knitTexture();
    knitTex.repeat.set(3, 3);
    const hairTex = hairTexture();
    hairTex.repeat.set(3, 1);
    const scarfTex = scarfTexture();
    const faceTex = faceTexture();
    this.textures.push(tex.map, tex.rough, knitTex, hairTex, scarfTex, faceTex);
    const gun = new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.7, color: '#c8ccd6', envMapIntensity: 1.0 });
    const gunDark = new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.8, color: '#8a8e9c', envMapIntensity: 0.8 });
    const black = new THREE.MeshStandardMaterial({ color: '#0b0b0e', metalness: 0.6, roughness: 0.25 });
    // the yard is lit hard (sodium lamps, the core light): albedos stay low so black reads as black
    const knit = new THREE.MeshStandardMaterial({ map: knitTex, color: '#8c8c94', roughness: 0.95, metalness: 0, envMapIntensity: 0.25 });
    const cloth = new THREE.MeshStandardMaterial({ color: '#0f0f13', roughness: 0.85, metalness: 0, envMapIntensity: 0.25 });
    const skin = new THREE.MeshStandardMaterial({ color: '#c2aca0', roughness: 0.6, metalness: 0, envMapIntensity: 0.4 });
    const face = new THREE.MeshStandardMaterial({ map: faceTex, color: '#c8b6ad', roughness: 0.6, metalness: 0, envMapIntensity: 0.4 });
    const hair = new THREE.MeshStandardMaterial({ map: hairTex, color: '#b9b4a6', alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0, envMapIntensity: 0.6 });
    const scarf = new THREE.MeshStandardMaterial({ map: scarfTex, color: '#9ca2aa', roughness: 0.9, metalness: 0, envMapIntensity: 0.3 });
    const leather = new THREE.MeshStandardMaterial({ color: '#0f0f12', roughness: 0.45, metalness: 0.1 });
    const sole = new THREE.MeshStandardMaterial({ color: '#e9e7e2', roughness: 0.7, metalness: 0 });
    const silver = new THREE.MeshStandardMaterial({ color: '#dde1ea', roughness: 0.2, metalness: 1 });
    this.seamMat = new THREE.MeshBasicMaterial({ color: '#ff2038', toneMapped: false });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: '#ff1a2e', toneMapped: false });
    this.coreMat = new THREE.MeshStandardMaterial({ color: '#0b3c4a', emissive: '#2ee6ff', emissiveIntensity: 2.5, roughness: 0.2, metalness: 0.2 });
    this.materials.push(gun, gunDark, black, knit, cloth, skin, face, hair, scarf, leather, sole, silver, this.seamMat, this.eyeMat, this.coreMat);

    const geo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const box = (w: number, h: number, d: number, r = 0.08, seg = 3) => geo(new RoundedBoxGeometry(w, h, d, seg, r));
    const cyl = (rt: number, rb: number, h: number, seg = 16) => geo(new THREE.CylinderGeometry(rt, rb, h, seg));
    const sphere = (r: number, w = 20, h = 14) => geo(new THREE.SphereGeometry(r, w, h));
    const torus = (r: number, tube: number, rs = 8, ts = 24) => geo(new THREE.TorusGeometry(r, tube, rs, ts));
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const me = new THREE.Mesh(g, m);
      me.position.set(x, y, z);
      return me;
    };

    // ---------------- legs: wide black trousers, chunky sneakers ----------------
    const buildLeg = (side: 1 | -1): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group; foot: THREE.Object3D } => {
      const hip = new THREE.Group();
      hip.position.set(side * 1.7, 0, 0);
      hip.add(mesh(sphere(1.05), cloth));
      const upper = new THREE.Group();
      upper.add(mesh(cyl(1.08, 0.94, 3.6, 18), cloth, 0, -1.9, 0));
      upper.add(mesh(box(0.07, 3.3, 0.07, 0.03, 1), black, side * 1.0, -1.9, 0));
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.set(0, -3.6, 0);
      knee.add(mesh(sphere(0.95), cloth));
      const lower = new THREE.Group();
      lower.add(mesh(cyl(0.94, 1.06, 3.3, 18), cloth, 0, -1.65, 0));
      // the trousers pile up on the sneakers
      for (const [y, r] of [[-2.75, 1.03], [-3.1, 1.07]] as const) {
        const fold = mesh(torus(r, 0.09, 6, 22), cloth, 0, y, 0);
        fold.rotation.x = Math.PI / 2;
        lower.add(fold);
      }
      knee.add(lower);
      const ankle = new THREE.Group();
      ankle.position.set(0, -3.3, 0);
      const foot = new THREE.Group();
      foot.add(mesh(box(1.75, 0.95, 3.0, 0.42, 3), leather, 0, -0.1, 0.35));
      foot.add(mesh(box(1.95, 0.5, 3.35, 0.2, 3), sole, 0, -0.52, 0.38));
      foot.add(mesh(box(1.8, 0.1, 3.2, 0.04, 1), black, 0, -0.3, 0.38));
      ankle.add(foot);
      knee.add(ankle);
      hip.add(knee);
      return { hip, knee, ankle, foot };
    };
    const legL = buildLeg(1);
    const legR = buildLeg(-1);
    this.hipL = legL.hip;
    this.hipR = legR.hip;
    this.kneeL = legL.knee;
    this.kneeR = legR.knee;
    this.ankleL = legL.ankle;
    this.ankleR = legR.ankle;

    // ---------------- pelvis ----------------
    this.pelvis.position.y = 7.6;
    this.pelvis.add(mesh(box(4.3, 1.8, 2.7, 0.5, 3), cloth, 0, 0, 0));
    this.pelvis.add(this.hipL, this.hipR);
    this.root.add(this.pelvis);

    // ---------------- torso: the oversized knit sweater ----------------
    this.torso.position.y = 0.9;
    const chest = new THREE.Group();
    chest.position.y = 2.2;
    chest.add(mesh(box(5.0, 5.6, 3.1, 0.75, 4), knit, 0, -0.7, 0));
    chest.add(mesh(box(5.9, 1.5, 3.0, 0.7, 4), knit, 0, 1.45, -0.05)); // dropped shoulders
    chest.add(mesh(box(5.3, 0.8, 3.3, 0.38, 3), knit, 0, -3.55, 0)); // ribbed hem over the hips
    const collar = mesh(torus(0.82, 0.22, 8, 24), knit, 0, 2.15, 0.1);
    collar.rotation.x = Math.PI / 2;
    chest.add(collar);
    // reactor hatch — the weak spot
    const coreHolder = new THREE.Group();
    coreHolder.position.set(0, 0.3, 1.55);
    const recess = mesh(cyl(0.95, 0.95, 0.5, 24), black);
    recess.rotation.x = Math.PI / 2;
    coreHolder.add(recess);
    coreHolder.add(mesh(torus(1.1, 0.14, 8, 32), gunDark, 0, 0, 0.2));
    const coreG = geo(new THREE.IcosahedronGeometry(0.62, 2));
    const core = new THREE.Mesh(coreG, this.coreMat);
    core.position.z = 0.1;
    coreHolder.add(core);
    this.coreLight = new THREE.PointLight('#2ee6ff', 0, 30, 1.8);
    this.coreLight.position.z = 2.2;
    coreHolder.add(this.coreLight);
    this.shutterL = mesh(box(1.05, 2.1, 0.22, 0.05), gun, -0.5, 0, 0.36);
    this.shutterR = mesh(box(1.05, 2.1, 0.22, 0.05), gun, 0.5, 0, 0.36);
    coreHolder.add(this.shutterL, this.shutterR);
    chest.add(coreHolder);
    // grey scarf: wrapped round the neck, knot on the left, the long end hanging down to the hem
    const wrap = mesh(torus(0.95, 0.42, 10, 28), scarf, 0, 2.72, 0.2);
    wrap.rotation.x = Math.PI / 2 - 0.12;
    wrap.scale.set(1.08, 1, 0.72);
    chest.add(wrap);
    const knot = mesh(box(0.85, 0.7, 0.4, 0.18, 3), scarf, 1.15, 2.2, 1.5);
    knot.rotation.z = 0.25;
    chest.add(knot);
    for (let i = 0; i < 3; i++) {
      const seg = mesh(box(0.9, 1.95, 0.14, 0.06, 2), scarf, 2.12 + i * 0.06, 1.2 - i * 1.8, 1.66 - i * 0.08);
      seg.rotation.set(-0.03, 0.34, 0.03 + i * 0.02);
      chest.add(seg);
    }

    // ---------------- arms: sleeves, pale fists, weapons ----------------
    const buildArm = (side: 1 | -1): { shoulder: THREE.Group; elbow: THREE.Group; tip: THREE.Object3D; rack: THREE.Object3D[] } => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 3.3, 1.4, 0);
      shoulder.add(mesh(sphere(1.2), knit, side * 0.05, 0.1, 0));
      const rack: THREE.Object3D[] = [];
      if (side === -1) {
        // rocket rack strapped on the left shoulder: 2×3 tubes
        const rackBox = mesh(box(1.7, 1.2, 2.2, 0.08), gunDark, side * 0.3, 1.85, 0);
        rackBox.rotation.x = -0.35;
        shoulder.add(rackBox);
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            const tube = mesh(cyl(0.2, 0.2, 2.3, 10), black, side * 0.3 + (c - 1) * 0.5, 1.85 + (r - 0.5) * 0.5, 0);
            tube.rotation.x = Math.PI / 2 - 0.35;
            shoulder.add(tube);
            const muzzle = new THREE.Object3D();
            muzzle.position.set(side * 0.3 + (c - 1) * 0.5, 1.85 + (r - 0.5) * 0.5 + Math.sin(0.35) * 1.2, Math.cos(0.35) * 1.2);
            shoulder.add(muzzle);
            rack.push(muzzle);
          }
        }
        for (const z of [-0.7, 0.7]) shoulder.add(mesh(box(0.22, 2.2, 0.12, 0.04, 1), leather, side * 0.3, 0.55, z * 1.35));
      }
      const upper = new THREE.Group();
      upper.position.set(side * 0.2, -0.3, 0);
      upper.add(mesh(cyl(1.0, 0.86, 3.0, 18), knit, 0, -1.4, 0));
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.set(0, -2.9, 0);
      elbow.add(mesh(sphere(0.86), knit));
      // the sleeve droops over the wrist; a pale fist holds the weapon
      elbow.add(mesh(cyl(0.86, 0.98, 1.5, 18), knit, 0, -0.75, 0));
      elbow.add(mesh(cyl(0.98, 0.92, 0.35, 18), knit, 0, -1.55, 0));
      elbow.add(mesh(box(0.95, 1.0, 1.15, 0.4, 3), skin, 0, -1.95, 0.2));
      elbow.add(mesh(box(0.3, 0.55, 0.35, 0.14, 2), skin, -side * 0.5, -1.8, 0.55)); // thumb
      let tip: THREE.Object3D;
      if (side === 1) {
        // right: rocket launcher (6 tubes) — the main volley weapon
        const pod = new THREE.Group();
        pod.position.set(0, -2.6, 0.5);
        pod.add(mesh(box(1.5, 1.4, 3.4, 0.14, 4), gunDark, 0, 0, 0));
        pod.add(mesh(box(1.6, 0.3, 2.6, 0.08), black, 0, -0.75, -0.1));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const t = mesh(cyl(0.22, 0.22, 0.5, 10), black, Math.cos(a) * 0.45, Math.sin(a) * 0.45, 1.6);
          t.rotation.x = Math.PI / 2;
          pod.add(t);
        }
        const glow = mesh(cyl(0.7, 0.7, 0.08, 6), this.seamMat, 0, 0, 1.7);
        glow.rotation.x = Math.PI / 2;
        glow.scale.setScalar(0.25);
        pod.add(glow);
        elbow.add(pod);
        tip = new THREE.Object3D();
        tip.position.set(0, -2.6, 2.4);
        elbow.add(tip);
      } else {
        // left: gatling
        const gat = new THREE.Group();
        gat.position.set(0, -2.55, 0.4);
        gat.add(mesh(box(1.3, 1.3, 1.6, 0.12), gunDark, 0, 0, -0.5));
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const b = mesh(cyl(0.11, 0.11, 2.6, 8), black, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 1.3);
          b.rotation.x = Math.PI / 2;
          gat.add(b);
        }
        gat.add(mesh(cyl(0.45, 0.45, 0.35, 12), silver, 0, 0, 0.6).rotateX(Math.PI / 2));
        elbow.add(gat);
        tip = new THREE.Object3D();
        tip.position.set(0, -2.55, 3.0);
        elbow.add(tip);
      }
      upper.add(elbow);
      return { shoulder, elbow, tip, rack };
    };
    const armR = buildArm(1);
    const armL = buildArm(-1);
    this.shoulderL = armL.shoulder;
    this.shoulderR = armR.shoulder;
    this.elbowL = armL.elbow;
    this.elbowR = armR.elbow;
    chest.add(this.shoulderL, this.shoulderR);

    // ---------------- head ----------------
    this.head.position.set(0, 2.65, 0.15);
    this.head.add(mesh(cyl(0.52, 0.6, 1.6, 16), skin, 0, -0.1, 0));
    const skull = new THREE.Group();
    skull.position.y = HEAD_C;
    skull.add(mesh(geo(headGeometry()), face));
    // septum ring
    const nose = headShape(0, -0.35, Math.sqrt(1 - 0.35 * 0.35));
    skull.add(mesh(torus(0.05, 0.014, 6, 14), silver, 0, nose.y - 0.045, nose.z - 0.035));
    // glowing irises (the laser comes out of them); they glance left and right
    const eyeSurface = headShape(0.36, 0.02, Math.sqrt(1 - 0.36 * 0.36 - 0.02 * 0.02));
    const irisParts = [-1, 1].map((s) => new THREE.SphereGeometry(0.1, 10, 8).scale(1, 1, 0.3).translate(s * eyeSurface.x, 0, 0));
    const irisG = geo(mergeGeometries(irisParts)!);
    irisParts.forEach((g) => g.dispose());
    this.eye = new THREE.Mesh(irisG, this.eyeMat);
    this.eye.position.set(0, eyeSurface.y - 0.02, eyeSurface.z + 0.015);
    skull.add(this.eye);
    if (!low) {
      const eyeLight = new THREE.PointLight('#ff2038', 5, 7, 1.6);
      eyeLight.position.set(0, eyeSurface.y, 1.6);
      skull.add(eyeLight);
    }
    const mouth = new THREE.Object3D();
    mouth.position.set(0, -0.56 * 1.25 * HEAD_R, 1.05);
    skull.add(mouth);
    // platinum bob: crown, bangs down to the brows, curtains to the jaw that flare out a little
    const R = HEAD_R;
    // the crown cap reaches down to the brows at the front: its strand tips are the bangs
    const crown = mesh(geo(new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI * 0.47)), hair, 0, 0, -0.12 * R);
    crown.scale.set(1.08 * R, 1.34 * R, 1.1 * R);
    skull.add(crown);
    const curtain = mesh(geo(new THREE.CylinderGeometry(0.97 * R, 1.2 * R, 1.45 * R, 30, 1, true, 0.28 * Math.PI, 1.44 * Math.PI)), hair, 0, -0.275 * R, -0.12 * R);
    curtain.scale.z = 1.08;
    skull.add(curtain);
    this.head.add(skull);
    chest.add(this.head);
    this.torso.add(chest);
    this.pelvis.add(this.torso);

    this.anchors = {
      core,
      eye: this.eye,
      rocketPod: [armR.tip],
      shoulderRack: armL.rack,
      gatling: armL.tip,
      mouth,
      feet: [legL.foot, legR.foot],
      chest,
    };
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = shadows;
        o.receiveShadow = true;
      }
    });
    // ~90 part meshes → one mesh per material per rigid joint; anchors, eyes and shutters stay separate
    const a = this.anchors;
    const keep = new Set<THREE.Object3D>([this.eye, this.shutterL, this.shutterR, a.core, a.gatling, a.mouth, a.chest, ...a.rocketPod, ...a.shoulderRack, ...a.feet]);
    this.geometries.push(...mergeStaticMeshes(this.root, keep));
    this.setCore(false);
    this.pose(0, 0, 0);
  }

  /** Core exposure 0..1 (shutters slide open, light up). */
  setCore(open: boolean): void {
    this.coreOpenTarget = open ? 1 : 0;
  }
  private coreOpenTarget = 0;

  /** Aim torso and head toward a world-space target. */
  aim(target: THREE.Vector3, dt: number): void {
    const local = this.root.worldToLocal(target.clone());
    const yaw = Math.atan2(local.x, local.z);
    const wantTorso = THREE.MathUtils.clamp(yaw, -0.6, 0.6);
    this.torsoYaw += (wantTorso - this.torsoYaw) * Math.min(1, dt * 3);
    const headLocal = this.head.parent!.worldToLocal(target.clone());
    const hy = Math.atan2(headLocal.x, headLocal.z);
    const hp = Math.atan2(headLocal.y - this.head.position.y - HEAD_C, Math.hypot(headLocal.x, headLocal.z));
    this.headYaw += (THREE.MathUtils.clamp(hy, -0.9, 0.9) - this.headYaw) * Math.min(1, dt * 6);
    this.headPitch += (THREE.MathUtils.clamp(hp, -0.5, 0.35) - this.headPitch) * Math.min(1, dt * 6);
  }

  /** Called each frame: walk phase advances with speed; idle when speed ~0. */
  pose(dt: number, speed: number, t: number, opts: { stagger?: number; collapse?: number; aimArmR?: number } = {}): void {
    this.walkPhase += dt * (1.4 + speed * 0.55);
    this.stagger = opts.stagger ?? 0;
    this.collapse = opts.collapse ?? 0;
    const w = Math.min(1, speed / 1.5);
    const ph = this.walkPhase;
    // legs: hip swing, knee bend on the swing leg, ankle compensation
    const leg = (hip: THREE.Group, knee: THREE.Group, ankle: THREE.Group, phase: number) => {
      const s = Math.sin(phase);
      const lift = Math.max(0, Math.sin(phase + 0.6));
      hip.rotation.x = -s * 0.55 * w;
      knee.rotation.x = lift * 0.95 * w + 0.08;
      ankle.rotation.x = -(hip.rotation.x + knee.rotation.x) * 0.9 + 0.02;
    };
    leg(this.hipL, this.kneeL, this.ankleL, ph);
    leg(this.hipR, this.kneeR, this.ankleR, ph + Math.PI);
    // body bob + sway
    const bob = Math.abs(Math.sin(ph)) * 0.35 * w;
    this.pelvis.position.y = 7.6 - 0.25 + bob - this.collapse * 3.2;
    this.pelvis.rotation.z = Math.sin(ph) * 0.05 * w;
    this.pelvis.rotation.y = Math.sin(ph) * 0.12 * w;
    // torso: breathing, aim yaw, stagger lean, collapse fall
    this.torso.rotation.y = this.torsoYaw - this.pelvis.rotation.y;
    this.torso.rotation.x = -this.stagger * 0.45 + this.collapse * 1.1 + Math.sin(t * 1.1) * 0.015;
    this.torso.rotation.z = Math.sin(t * 0.7) * 0.01 + this.stagger * 0.12;
    this.torso.position.y = 0.9 + Math.sin(t * 1.1) * 0.03;
    // arms: counter-swing while walking, right arm aims forward when requested
    const aimR = opts.aimArmR ?? 0;
    this.shoulderR.rotation.x = -Math.sin(ph) * 0.35 * w * (1 - aimR) - 0.25 - aimR * 1.2;
    // arms hang slightly away from the wide sweater
    this.shoulderR.rotation.z = 0.12;
    this.elbowR.rotation.x = -0.5 - aimR * 0.4;
    this.shoulderL.rotation.x = Math.sin(ph) * 0.35 * w - 0.35;
    this.shoulderL.rotation.z = -0.12;
    this.elbowL.rotation.x = -0.6;
    // head
    this.head.rotation.y = this.headYaw;
    this.head.rotation.x = -this.headPitch;
    // eyes glance side to side
    this.eye.position.x = Math.sin(t * 2.2) * 0.03;
    this.eyeMat.color.setHSL(0.99, 1, 0.5 + 0.1 * Math.sin(t * 9));
    // core shutters
    this.coreOpen += (this.coreOpenTarget - this.coreOpen) * Math.min(1, dt * 4);
    this.shutterL.position.x = -0.5 - this.coreOpen * 0.75;
    this.shutterR.position.x = 0.5 + this.coreOpen * 0.75;
    this.coreMat.emissiveIntensity = 0.8 + this.coreOpen * 3.5 + Math.sin(t * 6) * 0.4 * this.coreOpen;
    this.coreLight.intensity = this.coreOpen * 60;
  }

  /** world position helper */
  worldPos(o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
    return o.getWorldPosition(out);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
