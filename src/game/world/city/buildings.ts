import type { CellName } from './atlas';
import type { GeoBuilder, LampSpace } from './kit';

/**
 * Building archetypes of the kit. A lot is a rectangle whose local +z side faces the street:
 * centre (cx, cz), rotation, length along the street, depth into the block.
 * Facades are built from strips — one quad per run of identical modules — so a nine-storey
 * panel block is ~30 quads, not 400.
 */
export interface Lot {
  cx: number;
  cz: number;
  y0: number;
  rot: number;
  len: number;
  depth: number;
  seed: number;
  /** street lamps in front: which world axis runs along the street, distance of the facade from the lamp line */
  lamp?: { axis: 'x' | 'z'; perp: number; spacing: number; height: number };
}

export type Archetype = 'panel9' | 'brick5' | 'stalinka' | 'tower' | 'warehouse' | 'garages';

type Rnd = () => number;

const SHOPS: CellName[] = ['shopFood', 'shopPharmacy', 'shopShawarma', 'shopFlowers', 'shopOptics', 'shopKeys', 'shopHardware', 'shopCafe'];

/** local → world helpers bound to a lot */
function frame(lot: Lot) {
  const cs = Math.cos(lot.rot), sn = Math.sin(lot.rot);
  const P = (lx: number, ly: number, lz: number) => ({ x: lot.cx + lx * cs + lz * sn, y: lot.y0 + ly, z: lot.cz - lx * sn + lz * cs });
  return P;
}

/** a strip on the front face (local z = +depth/2 + out): from local x a→b, heights y0→y1 */
function frontStrip(g: GeoBuilder, lot: Lot, a: number, b: number, y0: number, y1: number, cell: CellName, tiles: [number, number], out = 0, start: [number, number] = [0, 0]): void {
  const P = frame(lot);
  const z = lot.depth / 2 + out;
  const p0 = P(a, y0, z), p1 = P(b, y0, z);
  const L = lot.lamp;
  const lamp: LampSpace | undefined = L && { s0: L.axis === 'x' ? p0.x : p0.z, s1: L.axis === 'x' ? p1.x : p1.z, perp0: L.perp, perp1: L.perp, spacing: L.spacing, height: L.height, k: 0.55 };
  g.quad(p0, p1, P(b, y1, z), P(a, y1, z), cell, tiles, lot.seed, start, lamp);
}

function backStrip(g: GeoBuilder, lot: Lot, a: number, b: number, y0: number, y1: number, cell: CellName, tiles: [number, number]): void {
  const P = frame(lot);
  const z = -lot.depth / 2;
  g.quad(P(b, y0, z), P(a, y0, z), P(a, y1, z), P(b, y1, z), cell, tiles, lot.seed + 0.37);
}

function ends(g: GeoBuilder, lot: Lot, h: number, cell: CellName, tileW: number, tileH: number): void {
  const P = frame(lot);
  const hw = lot.len / 2, hd = lot.depth / 2;
  const tw = Math.max(1, Math.round(lot.depth / tileW)), th = Math.max(1, Math.round(h / tileH));
  g.quad(P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), cell, [tw, th], lot.seed + 0.61);
  g.quad(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), cell, [tw, th], lot.seed + 0.83);
}

function roof(g: GeoBuilder, lot: Lot, h: number, cell: CellName): void {
  g.box(lot.cx, lot.cz, lot.y0, lot.len, lot.depth, h, lot.rot, { top: { cell, tile: [Math.max(1, Math.round(lot.len / 6)), Math.max(1, Math.round(lot.depth / 6))] } }, lot.seed);
}

/** column groups along the facade: returns [from, to, kind] runs */
function runs(bays: number, pattern: string[], bay: number, len: number): [number, number, string][] {
  const out: [number, number, string][] = [];
  const x0 = -len / 2;
  let i = 0;
  while (i < bays) {
    const kind = pattern[i % pattern.length];
    let j = i + 1;
    while (j < bays && pattern[j % pattern.length] === kind) j++;
    out.push([x0 + i * bay, x0 + j * bay, kind]);
    i = j;
  }
  return out;
}

/** 9-storey prefab panel block (series П-44 / 1-464 look) */
export function panel9(g: GeoBuilder, lot: Lot, rnd: Rnd): number {
  const FLOOR = 2.8, BAY = 3.2, floors = 9;
  const bays = Math.max(4, Math.round(lot.len / BAY));
  const len = bays * BAY;
  lot = { ...lot, len };
  const h = floors * FLOOR + 1.1;
  const beige = rnd() < 0.4;
  const win: CellName = beige ? 'panelWinB' : 'panelWin';
  const logg: CellName = beige ? 'panelLoggiaB' : 'panelLoggia';
  const stripe = rnd() < 0.35;
  // ground floor: an entrance every 8 bays, windows elsewhere
  for (const [a, b, k] of runs(bays, ['w', 'w', 'w', 'd', 'w', 'w', 'w', 'w'], BAY, len)) {
    frontStrip(g, lot, a, b, 0, FLOOR, k === 'd' ? 'panelDoor' : 'panelBlank', [Math.round((b - a) / BAY), 1]);
  }
  for (const [a, b, k] of runs(bays, ['w', 'l', 'l', 'w'], BAY, len)) {
    const n = Math.round((b - a) / BAY);
    if (k === 'l') frontStrip(g, lot, a, b, FLOOR, FLOOR * floors, logg, [n / 2, floors - 1]);
    else frontStrip(g, lot, a, b, FLOOR, FLOOR * floors, stripe ? 'panelStripe' : win, [n, floors - 1]);
  }
  frontStrip(g, lot, -len / 2, len / 2, FLOOR * floors, h, 'panelTop', [bays, 1]);
  // courtyard side: plain windows + loggias
  for (const [a, b, k] of runs(bays, ['w', 'w', 'l', 'l'], BAY, len)) {
    const n = Math.round((b - a) / BAY);
    backStrip(g, lot, a, b, 0, FLOOR * floors, k === 'l' ? logg : win, [k === 'l' ? n / 2 : n, floors]);
  }
  backStrip(g, lot, -len / 2, len / 2, FLOOR * floors, h, 'panelTop', [bays, 1]);
  ends(g, lot, h, 'panelBlank', BAY, FLOOR);
  roof(g, lot, h, 'roofBitumen');
  // lift machine rooms on the roof
  const P = frame(lot);
  for (let k = -1; k <= 1; k += 2) {
    const c = P(k * len * 0.28, 0, 0);
    g.box(c.x, c.z, lot.y0 + h, 4.2, 5, 2.8, lot.rot, {
      front: { cell: 'concrete', tile: [1, 1] }, back: { cell: 'concrete', tile: [1, 1] }, left: { cell: 'concrete', tile: [1, 1] }, right: { cell: 'concrete', tile: [1, 1] }, top: { cell: 'roofBitumen', tile: [1, 1] },
    }, lot.seed);
  }
  return h;
}

/** 5-storey brick "khrushchevka" */
export function brick5(g: GeoBuilder, lot: Lot, rnd: Rnd): number {
  const FLOOR = 2.7, BAY = 3.4, floors = 5;
  const bays = Math.max(4, Math.round(lot.len / BAY));
  const len = bays * BAY;
  lot = { ...lot, len };
  const h = floors * FLOOR + 0.9;
  const red = rnd() < 0.45;
  const wn: CellName = red ? 'redWin' : 'brickWin';
  const door: CellName = red ? 'redDoor' : 'brickDoor';
  const blank: CellName = red ? 'redBlank' : 'brickBlank';
  for (const [a, b, k] of runs(bays, ['w', 'w', 'd', 'w', 'w', 'w'], BAY, len)) {
    frontStrip(g, lot, a, b, 0, FLOOR, k === 'd' ? door : wn, [Math.round((b - a) / BAY), 1]);
  }
  for (const [a, b, k] of runs(bays, ['w', 'b', 'w'], BAY, len)) {
    frontStrip(g, lot, a, b, FLOOR, FLOOR * floors, k === 'b' && !red ? 'brickBalcony' : wn, [Math.round((b - a) / BAY), floors - 1]);
  }
  frontStrip(g, lot, -len / 2, len / 2, FLOOR * floors, h, 'brickTop', [bays, 1]);
  backStrip(g, lot, -len / 2, len / 2, 0, FLOOR * floors, wn, [bays, floors]);
  backStrip(g, lot, -len / 2, len / 2, FLOOR * floors, h, 'brickTop', [bays, 1]);
  ends(g, lot, h, blank, BAY, FLOOR);
  roof(g, lot, h, 'roofGravel');
  return h;
}

/** Stalinist 6-storey on the avenue: shops in a rusticated base, pediments, a heavy cornice */
export function stalinka(g: GeoBuilder, lot: Lot, rnd: Rnd): number {
  const GROUND = 4.6, FLOOR = 3.4, BAY = 4.2, floors = 6;
  const bays = Math.max(4, Math.round(lot.len / BAY));
  const len = bays * BAY;
  lot = { ...lot, len };
  const top = GROUND + FLOOR * (floors - 1);
  const h = top + 1.6;
  const pink = rnd() < 0.4;
  const win: CellName = pink ? 'stalWinPink' : 'stalWin';
  const plain: CellName = pink ? 'stalPink' : 'stalPilaster';
  // base: a shop every other bay, the rest arched windows
  let shop = Math.floor(rnd() * SHOPS.length);
  for (const [a, b, k] of runs(bays, ['s', 'a', 'a', 's', 'r'], BAY, len)) {
    const n = Math.round((b - a) / BAY);
    if (k === 's') {
      frontStrip(g, lot, a, b, 0, GROUND, SHOPS[shop++ % SHOPS.length], [n, 1], 0.02);
    } else frontStrip(g, lot, a, b, 0, GROUND, k === 'a' ? 'stalShop' : 'stalRustic', [n, 1]);
  }
  frontStrip(g, lot, -len / 2, len / 2, GROUND, GROUND + FLOOR, 'stalWinPed', [bays, 1]);
  frontStrip(g, lot, -len / 2, len / 2, GROUND + FLOOR, top, win, [bays, floors - 2]);
  // cornice: a real overhang
  const P = frame(lot);
  const c = P(0, 0, lot.depth / 2 + 0.45);
  g.box(c.x, c.z, lot.y0 + top, len + 0.9, 0.9, 1.6, lot.rot, {
    front: { cell: 'stalCornice', tile: [bays, 1] }, left: { cell: 'stalCornice', tile: [1, 1] }, right: { cell: 'stalCornice', tile: [1, 1] }, top: { cell: 'roofBitumen', tile: [bays, 1] },
  }, lot.seed);
  backStrip(g, lot, -len / 2, len / 2, 0, h, plain, [bays, floors]);
  ends(g, lot, h, plain, BAY, FLOOR);
  roof(g, lot, h, 'roofBitumen');
  return h;
}

/** glass office tower on a podium */
export function tower(g: GeoBuilder, lot: Lot, rnd: Rnd): number {
  const PODIUM = 7, FLOOR = 3.6, BAY = 3;
  const floors = 14 + Math.floor(rnd() * 16);
  const w = Math.max(18, Math.min(lot.len, 30)), d = Math.max(16, Math.min(lot.depth, 26));
  const h = PODIUM + floors * FLOOR;
  const cell: CellName = rnd() < 0.5 ? 'glassBlue' : 'glassDark';
  const bw = Math.round(w / BAY), bd = Math.round(d / BAY);
  // podium spans the lot, tower sits back
  g.box(lot.cx, lot.cz, lot.y0, lot.len, lot.depth, PODIUM, lot.rot, {
    front: { cell: 'glassLobby', tile: [Math.round(lot.len / 6), 1] }, back: { cell: 'towerBlank', tile: [4, 1] },
    left: { cell: 'towerBlank', tile: [2, 1] }, right: { cell: 'towerBlank', tile: [2, 1] }, top: { cell: 'roofGravel', tile: [4, 4] },
  }, lot.seed);
  const P = frame(lot);
  const c = P(0, 0, -(lot.depth - d) / 2);
  g.box(c.x, c.z, lot.y0 + PODIUM, w, d, floors * FLOOR, lot.rot, {
    front: { cell, tile: [bw, floors] }, back: { cell, tile: [bw, floors] }, left: { cell, tile: [bd, floors] }, right: { cell, tile: [bd, floors] }, top: { cell: 'roofGravel', tile: [2, 2] },
  }, lot.seed);
  g.box(c.x, c.z, lot.y0 + h, w - 2, d - 2, 2.4, lot.rot, {
    front: { cell: rnd() < 0.5 ? 'towerLed' : 'towerCrown', tile: [bw, 1] }, back: { cell: 'towerLed', tile: [bw, 1] },
    left: { cell: 'towerLed', tile: [bd, 1] }, right: { cell: 'towerLed', tile: [bd, 1] }, top: { cell: 'roofBitumen', tile: [2, 2] },
  }, lot.seed);
  return h + 2.4;
}

/** corrugated warehouse with a window band and roller doors */
export function warehouse(g: GeoBuilder, lot: Lot, rnd: Rnd): number {
  const h = 7 + rnd() * 3;
  const blue = rnd() < 0.4;
  const wall: CellName = blue ? 'corrBlue' : 'corrGrey';
  const bays = Math.max(2, Math.round(lot.len / 6));
  const len = bays * 6;
  lot = { ...lot, len };
  for (const [a, b, k] of runs(bays, ['w', 'd', 'w', 'w'], 6, len)) {
    const n = Math.round((b - a) / 6);
    frontStrip(g, lot, a, b, 0, 5, k === 'd' ? 'rollerDoor' : wall, [n, 1]);
  }
  frontStrip(g, lot, -len / 2, len / 2, 5, h, 'wareWin', [bays, 1]);
  backStrip(g, lot, -len / 2, len / 2, 0, h, wall, [bays, 1]);
  ends(g, lot, h, wall, 6, h);
  roof(g, lot, h, 'metalVent');
  return h;
}

/** a row of brick lock-up garages */
export function garages(g: GeoBuilder, lot: Lot, rnd: Rnd): number {
  const h = 2.9;
  const n = Math.max(2, Math.round(lot.len / 6.4));
  const len = n * 6.4;
  lot = { ...lot, len, depth: Math.min(lot.depth, 6.5) };
  for (const [a, b, k] of runs(n, rnd() < 0.5 ? ['r', 'g'] : ['g', 'r', 'r'], 6.4, len)) {
    frontStrip(g, lot, a, b, 0, h, k === 'r' ? 'garageRust' : 'garageGreen', [Math.round((b - a) / 6.4), 1]);
  }
  backStrip(g, lot, -len / 2, len / 2, 0, h, 'redBlank', [n * 2, 1]);
  ends(g, lot, h, 'redBlank', 3, h);
  roof(g, lot, h, 'roofBitumen');
  return h;
}

export const BUILD: Record<Archetype, (g: GeoBuilder, lot: Lot, rnd: Rnd) => number> = { panel9, brick5, stalinka, tower, warehouse, garages };

/** typical lot sizes per archetype: [min length, max length, depth] */
export const LOT_SIZE: Record<Archetype, [number, number, number]> = {
  panel9: [38, 64, 12.5],
  brick5: [30, 52, 11.5],
  stalinka: [42, 76, 17],
  tower: [26, 40, 26],
  warehouse: [24, 48, 18],
  garages: [26, 52, 6.5],
};
