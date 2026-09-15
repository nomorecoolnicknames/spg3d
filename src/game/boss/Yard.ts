import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { YardWall } from '../world/osm/OsmCity';
import { CARS } from '@/data/cars';
import { createCarVisual, type CarVisual } from '../vehicle/CarVisual';

/**
 * Dressing of the Ligovsky 50 yard round the boss fight, after photos of the place (Wikimedia Commons:
 * «Saint Petersburg Ligovsky Avenue 50 … 2025-03», Artyom Svetlov, CC BY 4.0; «Zoccolo 2.0, St Petersburg,
 * 17.10.2018», CC BY-SA 2.0 — the club next door to 1703 in the same yard, at night):
 * on the dark-red brick warehouse walls — white floodlights on brackets, drainpipes, silver spiral
 * ventilation ducts, steel doors under roller-shutter canopies with gig posters, fire escapes, graffiti;
 * steel crowd barriers across the lanes that lead out of the yard; cars parked along the walls and in the
 * yard; the 1703 entrance with its sign and the МЭДКИД banner.
 * Everything is merged per material (a handful of draw calls).
 */
export interface YardDressing {
  group: THREE.Group;
  obstacles: { x: number; z: number; r: number }[];
  lights: THREE.PointLight[];
  /** the club door in arena space: base point on the wall, normal towards the yard, eaves height */
  door: { x: number; z: number; nx: number; nz: number; h: number };
  dispose(): void;
}

interface Wall {
  ax: number;
  az: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  len: number;
  h: number;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** four gig posters side by side (128×256 each) */
function posterAtlas(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 256);
  const posters: [string, string, string, string][] = [
    ['#f2d21b', '#141414', 'МЭДКИД', '1703'],
    ['#e8e2d6', '#d81f3a', 'SEXY SWAG', 'LIVE'],
    ['#1b1f2a', '#2ee6ff', 'ТЁМНЫЙ ПРИНЦ', 'DJ SET'],
    ['#d81f3a', '#f5f0e6', 'VERSUS', 'BATTLE'],
  ];
  posters.forEach(([bg, fg, title, sub], i) => {
    const x = i * 128;
    ctx.fillStyle = bg;
    ctx.fillRect(x + 4, 4, 120, 248);
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.25;
    for (let k = 0; k < 5; k++) ctx.fillRect(x + 10 + k * 22, 60 + ((k * 37) % 50), 14, 110);
    ctx.globalAlpha = 1;
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.font = '900 26px "Russo One", Impact, sans-serif';
    const words = title.split(' ');
    words.forEach((w, k) => ctx.fillText(w, x + 64, 44 + k * 28, 112));
    ctx.font = '900 34px "Russo One", Impact, sans-serif';
    ctx.fillText(sub, x + 64, 228, 112);
    ctx.fillRect(x + 16, 190, 96, 4);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** four spray-paint tags (512×256 each) on transparent */
function graffitiAtlas(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  const tags: [string, string, string][] = [
    ['SEXYSWAG', '#ff3d8b', '#1a0a12'],
    ['ТЁМНЫЙ ПРИНЦ', '#35d6ff', '#06141c'],
    ['1703', '#f5f0e6', '#c0142a'],
    ['МЭДКИД', '#ffd23a', '#201600'],
  ];
  tags.forEach(([text, fill, line], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    ctx.save();
    ctx.translate(x + 256, y + 138);
    ctx.rotate(-0.06 + i * 0.03);
    ctx.font = `900 ${text.length > 8 ? 62 : 96}px "Russo One", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = line;
    ctx.lineWidth = 16;
    ctx.strokeText(text, 0, 0, 470);
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0, 470);
    // drips
    ctx.fillStyle = fill;
    for (let k = 0; k < 7; k++) {
      const dx = -200 + ((k * 73) % 400), len = 14 + ((k * 29) % 40);
      ctx.fillRect(dx, 26, 4, len);
      ctx.beginPath();
      ctx.arc(dx + 2, 26 + len, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** geometry pieces collected per material, merged at the end */
class Parts {
  private list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, m: THREE.Matrix4): void {
    this.list.push(g.clone().applyMatrix4(m));
  }
  mesh(mat: THREE.Material, name: string, shadows: boolean): THREE.Mesh | null {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    for (const x of this.list) x.dispose();
    this.list = [];
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = shadows;
    m.receiveShadow = true;
    return m;
  }
}

export function buildYardDressing(opts: {
  walls: YardWall[];
  /** world (map) point → arena space */
  toArena: (x: number, z: number) => THREE.Vector2;
  radius: number;
  doorHint: THREE.Vector2;
  shadows: boolean;
  low: boolean;
}): YardDressing {
  const { radius: R, shadows, low } = opts;
  let seed = 1703;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const group = new THREE.Group();
  group.name = 'arena:lig50-dressing';
  const disposables: { dispose(): void }[] = [];
  const obstacles: YardDressing['obstacles'] = [];
  const lights: THREE.PointLight[] = [];

  // walls in arena space, oriented so that (t, up, n) is right-handed (no mirrored pieces)
  const walls: Wall[] = [];
  for (const w of opts.walls) {
    let a = opts.toArena(w.ax, w.az), b = opts.toArena(w.bx, w.bz);
    const n0 = opts.toArena(w.ax + w.nx, w.az + w.nz).sub(a);
    let tx = b.x - a.x, tz = b.y - a.y;
    const len = Math.hypot(tx, tz);
    tx /= len;
    tz /= len;
    if (tx * n0.y - tz * n0.x < 0) {
      [a, b] = [b, a];
      tx = -tx;
      tz = -tz;
    }
    walls.push({ ax: a.x, az: a.y, tx, tz, nx: n0.x, nz: n0.y, len, h: w.h });
  }
  walls.sort((p, q) => q.len - p.len);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  disposables.push(unitBox, unitCyl, unitPlane);
  const m4 = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const wallMatrix = (w: Wall, u: number, y: number, s: number) =>
    m4.makeBasis(new THREE.Vector3(w.tx, 0, w.tz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(w.nx, 0, w.nz)).setPosition(w.ax + w.tx * u + w.nx * s, y, w.az + w.tz * u + w.nz * s);
  const put = (parts: Parts, g: THREE.BufferGeometry, w: Wall, u: number, y: number, s: number, size: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    local.compose(new THREE.Vector3(), q.setFromEuler(e.set(rot[0], rot[1], rot[2])), new THREE.Vector3(...size));
    parts.add(g, wallMatrix(w, u, y, s).clone().multiply(local));
  };
  const at = (w: Wall, u: number, s: number) => new THREE.Vector2(w.ax + w.tx * u + w.nx * s, w.az + w.tz * u + w.nz * s);

  const metal = new Parts(); // dark steel: brackets, doors, stairs, canopies
  const zinc = new Parts(); // drainpipes, ducts, barriers
  const glow = new Parts(); // floodlight lenses
  const posters = new Parts();
  const graffiti = new Parts();

  // ── the club door: the wall nearest to the hint
  let doorWall = walls[0];
  let doorU = walls[0] ? walls[0].len / 2 : 0;
  let best = Infinity;
  for (const w of walls) {
    const u = THREE.MathUtils.clamp((opts.doorHint.x - w.ax) * w.tx + (opts.doorHint.y - w.az) * w.tz, 4, w.len - 4);
    const d = at(w, u, 0).distanceTo(opts.doorHint);
    if (d < best && w.len > 10) {
      best = d;
      doorWall = w;
      doorU = u;
    }
  }
  const floodSpots: THREE.Vector3[] = [];
  const flood = (w: Wall, u: number, y: number) => {
    put(metal, unitBox, w, u, y + 0.05, 0.45, [0.1, 0.1, 0.9]);
    put(metal, unitBox, w, u, y - 0.25, 0.1, [0.3, 0.5, 0.12]);
    put(metal, unitBox, w, u, y - 0.05, 0.95, [0.72, 0.36, 0.46], [0.55, 0, 0]);
    put(glow, unitBox, w, u, y - 0.2, 1.02, [0.6, 0.06, 0.34], [0.55, 0, 0]);
    const p = at(w, u, 1.8);
    floodSpots.push(new THREE.Vector3(p.x, y - 0.8, p.y));
  };
  const posterAt = (w: Wall, u: number, y: number, k: number) => {
    const g = unitPlane.clone();
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / 4);
    put(posters, g, w, u, y, 0.04, [0.85, 1.6, 1]);
    g.dispose();
  };

  for (const w of walls) {
    if (w.len < 5) continue;
    const isDoor = w === doorWall;
    const busy = (u: number, pad: number) => isDoor && Math.abs(u - doorU) < pad;
    const top = Math.min(w.h - 1.1, 5.8);
    // floodlights
    // (short walls — the cut ones along the rim — get a lamp only now and then)
    const nf = w.len < 17 ? (rnd() < w.len / 22 ? 1 : 0) : Math.round(w.len / 17);
    for (let k = 0; k < nf; k++) {
      const u = ((k + 0.5) / nf) * w.len;
      if (!busy(u, 3)) flood(w, u, top);
    }
    // drainpipes with a funnel under the eaves
    const np = Math.max(1, Math.round(w.len / 13));
    for (let k = 0; k < np; k++) {
      const u = np === 1 ? w.len - 0.8 : 0.8 + (k / (np - 1)) * (w.len - 1.6);
      if (busy(u, 3.2)) continue;
      put(zinc, unitCyl, w, u, w.h / 2 - 0.2, 0.28, [0.1, w.h - 0.6, 0.1]);
      put(zinc, unitBox, w, u, w.h - 0.45, 0.3, [0.42, 0.4, 0.42]);
      put(zinc, unitBox, w, u, 0.25, 0.42, [0.24, 0.16, 0.44]);
    }
    // silver spiral ducts running along the wall and up over the roof
    if (w.len > 16 && rnd() < 0.45) {
      const dl = 7 + rnd() * 6;
      const u0 = 2 + rnd() * (w.len - dl - 4);
      if (!busy(u0 + dl / 2, dl / 2 + 3)) {
        const y = 4.3;
        put(zinc, unitCyl, w, u0 + dl / 2, y, 0.65, [0.4, dl, 0.4], [0, 0, Math.PI / 2]);
        for (let b = 0; b <= dl; b += 1.1) put(zinc, unitCyl, w, u0 + b, y, 0.65, [0.44, 0.07, 0.44], [0, 0, Math.PI / 2]);
        put(zinc, unitCyl, w, u0 + dl, (y + w.h + 0.9) / 2, 0.65, [0.4, w.h + 0.9 - y, 0.4]);
        put(zinc, unitBox, w, u0 + dl, y, 0.65, [0.8, 0.8, 0.8]);
        put(zinc, unitCyl, w, u0 + dl, w.h + 1.0, 0.65, [0.55, 0.22, 0.55]);
        for (let b = 1; b < dl; b += 3) put(metal, unitBox, w, u0 + b, y - 0.45, 0.35, [0.08, 0.5, 0.6]);
      }
    }
    // steel doors under roller-shutter canopies, gig posters beside them
    const nd = Math.floor(w.len / 26);
    for (let k = 0; k < nd; k++) {
      const u = ((k + 0.5) / nd) * w.len + (rnd() - 0.5) * 4;
      if (busy(u, 7)) continue;
      put(metal, unitBox, w, u, 1.3, 0.05, [1.7, 2.6, 0.1]);
      put(metal, unitBox, w, u, 3.0, 0.55, [3.0, 0.45, 1.1]);
      if (rnd() < 0.7) posterAt(w, u + 1.6, 1.6, Math.floor(rnd() * 4));
      if (rnd() < 0.5) posterAt(w, u - 1.6, 1.6, Math.floor(rnd() * 4));
    }
    // a fire escape on some long walls
    if (w.len > 36 && rnd() < 0.5) {
      const u = 6 + rnd() * (w.len - 18);
      if (!busy(u + 3, 10)) {
        const land = 4.1, run = 4.6, ang = Math.atan2(land, run);
        put(metal, unitBox, w, u, land, 0.8, [2.6, 0.12, 1.5]);
        for (const du of [-1.25, 1.25]) put(metal, unitBox, w, u + du, land / 2, 1.5, [0.08, land, 0.08]);
        put(metal, unitBox, w, u, land + 0.55, 1.52, [2.6, 0.06, 0.06]);
        put(metal, unitBox, w, u + 1.3 + run / 2, land / 2, 0.8, [Math.hypot(land, run), 0.1, 0.95], [0, 0, -ang]);
        put(metal, unitBox, w, u + 1.3 + run / 2, land / 2 + 0.55, 1.28, [Math.hypot(land, run), 0.05, 0.05], [0, 0, -ang]);
        put(metal, unitBox, w, u, 1.3, 0.05, [1.0, 2.2, 0.1]);
        put(metal, unitBox, w, u, land + 1.2, 0.05, [1.0, 2.2, 0.1]);
      }
    }
    // graffiti
    if (w.len > 12 && rnd() < 0.3) {
      const u = 4 + rnd() * (w.len - 8);
      if (!busy(u, 9)) {
        const k = Math.floor(rnd() * 4);
        const g = unitPlane.clone();
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, ((k % 2) + uv.getX(i)) / 2, (uv.getY(i) + 1 - Math.floor(k / 2)) / 2);
        put(graffiti, g, w, u, 1.7, 0.03, [6.4, 3.2, 1]);
        g.dispose();
      }
    }
  }

  // ── steel crowd barriers (one merged mesh)
  const barrierParts = new Parts();
  const barrierPiece = (m: THREE.Matrix4) => {
    const piece = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      local.compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(sx, sy, sz));
      barrierParts.add(unitBox, m.clone().multiply(local));
    };
    for (const x of [-1.12, 1.12]) {
      piece(0.06, 1.1, 0.06, x, 0.55, 0);
      piece(0.06, 0.04, 0.7, x, 0.02, 0);
    }
    piece(2.3, 0.06, 0.06, 0, 1.08, 0);
    piece(2.3, 0.05, 0.05, 0, 0.3, 0);
    for (let k = -5; k <= 5; k++) piece(0.03, 0.78, 0.03, k * 0.2, 0.69, 0);
  };
  /** a barrier parallel to a wall, s metres out */
  const wallBarrier = (w: Wall, u: number, s: number) => barrierPiece(wallMatrix(w, u, 0, s).clone());

  // ── the 1703 entrance
  const door = { x: 0, z: 0, nx: 0, nz: 1, h: 8 };
  if (doorWall) {
    const w = doorWall;
    put(metal, unitBox, w, doorU, 1.45, 0.08, [2.2, 2.9, 0.16]); // steel double door
    put(metal, unitBox, w, doorU, 1.45, 0.17, [0.04, 2.7, 0.02]);
    put(metal, unitBox, w, doorU, 3.35, 0.75, [4.4, 0.55, 1.5]); // roller-shutter canopy
    put(zinc, unitCyl, w, doorU, 3.62, 1.45, [0.2, 4.3, 0.2], [0, 0, Math.PI / 2]);
    put(zinc, unitBox, w, doorU, 0.12, 1.0, [3.6, 0.24, 2.0]); // concrete step
    posterAt(w, doorU - 2.4, 1.6, 0);
    posterAt(w, doorU + 2.4, 1.6, 2);
    posterAt(w, doorU + 3.3, 1.6, 1);
    flood(w, doorU - 3.2, Math.min(w.h - 1.2, 5.2));
    const p = at(w, doorU, 0);
    Object.assign(door, { x: p.x, z: p.y, nx: w.nx, nz: w.nz, h: w.h });
    // a queue lane of crowd barriers along the wall
    for (let k = 0; k < 3; k++) wallBarrier(w, doorU + 5 + k * 2.4, 2.6);
  }

  // ── crowd barriers across the lanes that leave the yard
  const covered = (x: number, z: number) => {
    for (const w of walls) {
      const u = THREE.MathUtils.clamp((x - w.ax) * w.tx + (z - w.az) * w.tz, 0, w.len);
      if (Math.hypot(x - (w.ax + w.tx * u), z - (w.az + w.tz * u)) < 5.5) return true;
    }
    return false;
  };
  const rb = R + 1.2;
  const step = 2.3 / rb;
  for (let a = 0; a < Math.PI * 2; a += step) {
    const x = Math.sin(a) * rb, z = Math.cos(a) * rb;
    if (covered(x, z)) continue;
    const m = new THREE.Matrix4().makeRotationY(a).setPosition(x, 0, z);
    barrierPiece(m);
  }

  // ── parked cars (the real models, the far LOD looks crushed this close): a few along the walls, a few in the yard as cover
  const spots: { x: number; z: number; rot: number }[] = [];
  for (const w of walls) {
    if (w.len < 14 || spots.length >= (low ? 1 : 3) || rnd() < 0.5) continue;
    const u = 3 + rnd() * (w.len - 6);
    const p = at(w, u, 2.4);
    if (Math.hypot(p.x - door.x, p.y - door.z) < 14) continue;
    spots.push({ x: p.x, z: p.y, rot: Math.atan2(w.tx, w.tz) + (rnd() < 0.5 ? Math.PI : 0) });
  }
  for (const [ang, r, rot] of ([[1.1, 38, 0.3], [-1.35, 34, 2.0], [2.35, 40, 1.2], [-2.5, 30, -0.6]] as const).slice(0, low ? 2 : 4)) {
    const x = Math.sin(ang) * r, z = Math.cos(ang) * r;
    spots.push({ x, z, rot });
    for (const s of [-1.2, 1.2]) obstacles.push({ x: x + Math.sin(rot) * s, z: z + Math.cos(rot) * s, r: 1.5 });
  }
  const parked = CARS.filter((c) => c.id === 'm5cs' || c.id === 'supra' || c.id === 'm8');
  const paints = ['#2b2e33', '#b8bcc2', '#e8e6e0', '#5a1a1e', '#1e2a3a'];
  const cars: CarVisual[] = spots.map((sp, i) => {
    const v = createCarVisual(parked[i % parked.length], paints[i % paints.length], { player: false, shadows, night: false, lod: low ? 2 : 1, opaqueGlass: true });
    v.root.position.set(sp.x, 0, sp.z);
    v.root.rotation.y = sp.rot;
    v.setHeadlights(false);
    group.add(v.root);
    return v;
  });
  disposables.push(...cars);

  // ── merge
  const posterTex = posterAtlas();
  const graffitiTex = graffitiAtlas();
  const mats = {
    metal: new THREE.MeshStandardMaterial({ color: '#2e3137', roughness: 0.55, metalness: 0.7 }),
    zinc: new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.38, metalness: 0.9, envMapIntensity: 1.1 }),
    glow: new THREE.MeshBasicMaterial({ color: '#f2f6ff' }),
    posters: new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
    graffiti: new THREE.MeshStandardMaterial({ map: graffitiTex, roughness: 0.8, metalness: 0, transparent: true, alphaTest: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    barrier: new THREE.MeshStandardMaterial({ color: '#a7adb5', roughness: 0.4, metalness: 0.85 }),
  };
  disposables.push(posterTex, graffitiTex, ...Object.values(mats));
  for (const [parts, mat, name] of [
    [metal, mats.metal, 'metal'],
    [zinc, mats.zinc, 'zinc'],
    [glow, mats.glow, 'glow'],
    [posters, mats.posters, 'posters'],
    [graffiti, mats.graffiti, 'graffiti'],
    [barrierParts, mats.barrier, 'barriers'],
  ] as const) {
    const mesh = parts.mesh(mat, `yard:${name}`, shadows && name !== 'graffiti' && name !== 'posters');
    if (mesh) {
      group.add(mesh);
      disposables.push(mesh.geometry);
    }
  }

  // ── floodlight lights: the ones nearest the middle of the yard, spread out
  if (!low) {
    const chosen: THREE.Vector3[] = [];
    for (const p of [...floodSpots].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))) {
      if (chosen.length >= 5) break;
      if (chosen.some((c) => c.distanceTo(p) < 30)) continue;
      chosen.push(p);
    }
    for (const p of chosen) {
      const l = new THREE.PointLight('#e6eeff', 38, 30, 1.7);
      l.position.copy(p);
      group.add(l);
      lights.push(l);
    }
  }

  return {
    group,
    obstacles,
    lights,
    door,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
