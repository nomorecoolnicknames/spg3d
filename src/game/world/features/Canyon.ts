import * as THREE from 'three';
import type { TrackData } from '../TrackData';
import type { PropsRig } from '../Props';
import { createRockMaterial } from '../RockMaterial';
import { GeoBuilder, createCityMaterial } from '../city/kit';
import type { CellName } from '../city/atlas';

/**
 * Canyon set pieces from TrackSpec.features: sandstone cliffs that squeeze the road, a rock arch,
 * a red truss bridge over a gorge (the terrain is carved in TrackMesh) and a roadside café with a
 * fuel station. Cliffs are chunked every ~60 m so the frustum culls them.
 */
type V = { x: number; y: number; z: number };

export function buildCanyonFeatures(track: TrackData, terrainHeight: (x: number, z: number) => number, quality: { level: 'low' | 'medium' | 'high' }): PropsRig {
  const group = new THREE.Group();
  group.name = 'canyon-features';
  const disposables: { dispose(): void }[] = [];
  const f = track.spec.features ?? {};
  const n = track.count;
  const halfW = track.halfW;
  const wallIn = halfW + track.runoff + 3;
  const rock = createRockMaterial('#c47a4a', { low: quality.level === 'low' });
  rock.side = THREE.DoubleSide;
  rock.vertexColors = true;
  disposables.push(rock);
  const idx = (u: number) => ((Math.round(u * n) % n) + n) % n;
  const noise = (a: number, b: number) => Math.sin(a * 0.031 + b) * 0.5 + Math.sin(a * 0.083 + b * 2.1) * 0.3 + Math.sin(a * 0.19 + b * 3.7) * 0.2;

  // ── cliffs: per cross-section [base, ledge, lip, plateau] on each side, chunked
  const inArch = (u: number) => !!f.arch && u >= f.arch[0] && u <= f.arch[1];
  for (const [u0, u1] of f.cliffs ?? []) {
    const i0 = idx(u0), i1 = idx(u1);
    const count = (i1 - i0 + n) % n;
    const step = Math.max(1, Math.round(5 / track.spacing));
    const len = count * track.spacing;
    for (const side of [-1, 1]) {
      let chunk: { pos: number[]; col: number[] } = { pos: [], col: [] };
      let rows = 0;
      const flush = () => {
        if (rows < 2) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(chunk.pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(chunk.col, 3));
        const index: number[] = [];
        for (let r = 0; r < rows - 1; r++) {
          for (let c = 0; c < 3; c++) {
            const a = r * 4 + c, b = a + 1, cc = a + 4, d = a + 5;
            if (side > 0) index.push(a, cc, b, b, cc, d);
            else index.push(a, b, cc, b, d, cc);
          }
        }
        g.setIndex(index);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, rock);
        mesh.name = 'canyon:cliff';
        group.add(mesh);
        disposables.push(g);
      };
      for (let k = 0; k <= count; k += step) {
        const i = (i0 + k) % n;
        const s = track.samples[i];
        const along = k * track.spacing;
        const taper = Math.min(1, along / 45, (len - along) / 45);
        const H = (26 + 16 * noise(along, side * 1.7)) * (0.25 + 0.75 * Math.max(0, taper)) * (inArch(i / n) ? 1.2 : 1);
        const base = Math.min(s.pos.y, terrainHeight(s.pos.x + s.left.x * side * wallIn, s.pos.z + s.left.z * side * wallIn)) - 3;
        const top = s.pos.y + H;
        const jitter = 1.5 * noise(along * 1.9, side * 5.3);
        const prof: [number, number, number][] = [
          [wallIn + jitter * 0.3, base, 0.55],
          [wallIn + 1.2 + jitter, s.pos.y + H * 0.45, 0.8],
          [wallIn + 3.5 + jitter * 0.6, top, 1.0],
          [wallIn + 34, top - 4, 1.0],
        ];
        for (const [o, y, ao] of prof) {
          chunk.pos.push(s.pos.x + s.left.x * side * o, y, s.pos.z + s.left.z * side * o);
          chunk.col.push(ao, ao, ao);
        }
        rows++;
        if (rows >= 14 && k + step <= count) {
          const keep = chunk.pos.slice(-12), keepC = chunk.col.slice(-12);
          flush();
          chunk = { pos: keep, col: keepC };
          rows = 1;
        }
      }
      flush();
    }
  }

  // ── arch: an elliptic rock shell over the road
  if (f.arch) {
    const i0 = idx(f.arch[0]), i1 = idx(f.arch[1]);
    const count = (i1 - i0 + n) % n;
    const step = Math.max(1, Math.round(3 / track.spacing));
    const SEG = 9;
    const pos: number[] = [], col: number[] = [];
    let rows = 0;
    for (let k = 0; k <= count; k += step, rows++) {
      const s = track.samples[(i0 + k) % n];
      const along = k * track.spacing;
      const Ry = 9 + 1.5 * noise(along * 2.3, 0.4);
      for (let j = 0; j <= SEG; j++) {
        const th = (j / SEG) * Math.PI;
        const o = Math.cos(th) * (wallIn + 1.5);
        const y = s.pos.y + 5.5 + Math.sin(th) * Ry + noise(along * 3.1 + j, 1.1) * 0.8;
        pos.push(s.pos.x + s.left.x * o, y, s.pos.z + s.left.z * o);
        const ao = 0.32 + 0.15 * Math.abs(Math.cos(th)); // darker inside the shell
        col.push(ao, ao, ao * 0.95);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const index: number[] = [];
    const W = SEG + 1;
    for (let r = 0; r < rows - 1; r++) for (let j = 0; j < SEG; j++) {
      const a = r * W + j;
      index.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
    g.setIndex(index);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, rock);
    mesh.name = 'canyon:arch';
    group.add(mesh);
    disposables.push(g);
  }

  // ── structures with the city kit (daylight: no lit windows)
  const kit = new GeoBuilder();
  const all = (cell: CellName, tile: [number, number]) => ({ front: { cell, tile }, back: { cell, tile }, left: { cell, tile }, right: { cell, tile } });

  if (f.gorge) {
    const ic = idx(f.gorge.at);
    const half = f.gorge.half + 8;
    const steps = Math.round(half / track.spacing);
    const side = halfW + track.runoff + 1.4;
    for (let k = -steps; k < steps; k += 2) {
      const a = track.samples[(ic + k + n) % n], b = track.samples[(ic + k + 2 + n) % n];
      const q = (s: typeof a, o: number, dy: number): V => ({ x: s.pos.x + s.left.x * o, y: s.pos.y + dy, z: s.pos.z + s.left.z * o });
      // deck underside and edge faces
      kit.quadFacing({ x: 0, y: -1, z: 0 }, q(a, -side, -1.6), q(a, side, -1.6), q(b, side, -1.6), q(b, -side, -1.6), 'concrete', [2, 1]);
      for (const sgn of [-1, 1]) {
        const dir = { x: a.left.x * sgn, y: 0, z: a.left.z * sgn };
        // truss girders along both edges (seen from the road and from below)
        kit.quadFacing(dir, q(a, sgn * side, -1.6), q(b, sgn * side, -1.6), q(b, sgn * side, 2.2), q(a, sgn * side, 2.2), 'trussRed', [1, 1]);
        kit.quadFacing({ x: -dir.x, y: 0, z: -dir.z }, q(a, sgn * (side - 0.3), -1.6), q(b, sgn * (side - 0.3), -1.6), q(b, sgn * (side - 0.3), 2.2), q(a, sgn * (side - 0.3), 2.2), 'trussRed', [1, 1]);
        kit.quadFacing({ x: 0, y: 1, z: 0 }, q(a, sgn * (side - 0.3), 2.2), q(b, sgn * (side - 0.3), 2.2), q(b, sgn * side, 2.2), q(a, sgn * side, 2.2), 'trussRed', [1, 0.1]);
      }
    }
    // two piers down into the gorge
    for (const k of [-Math.round(steps * 0.45), Math.round(steps * 0.45)]) {
      const s = track.samples[(ic + k + n) % n];
      const h = f.gorge.depth + 6;
      kit.box(s.pos.x, s.pos.z, s.pos.y - 1.6 - h, 4, 3, h, Math.atan2(s.left.x, s.left.z), all('concrete', [1, h / 4]));
    }
  }

  if (f.stop !== undefined) {
    const s = track.samples[idx(f.stop)];
    const side = -1;
    const off = halfW + track.runoff + 26;
    const cx = s.pos.x + s.left.x * side * off, cz = s.pos.z + s.left.z * side * off;
    const y = terrainHeight(cx, cz) + 0.05;
    const rot = Math.atan2(s.left.x * -side, s.left.z * -side); // local +z faces the road
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (lx: number, lz: number) => ({ x: cx + lx * cs + lz * sn, z: cz - lx * sn + lz * cs });
    // forecourt
    const fc = [P(-34, 16), P(34, 16), P(34, -16), P(-34, -16)];
    kit.quadFacing({ x: 0, y: 1, z: 0 }, { x: fc[0].x, y, z: fc[0].z }, { x: fc[1].x, y, z: fc[1].z }, { x: fc[2].x, y, z: fc[2].z }, { x: fc[3].x, y, z: fc[3].z }, 'courtyard', [11, 5]);
    // fuel canopy on four columns + two pumps
    const canopy = P(-12, 4);
    kit.box(canopy.x, canopy.z, y + 5.2, 22, 12, 1.1, rot, { ...all('fuelFascia', [4, 1]), top: { cell: 'roofBitumen', tile: [3, 2] } });
    for (const [lx, lz] of [[-21, 9], [-3, 9], [-21, -1], [-3, -1]]) {
      const c = P(lx, lz);
      kit.box(c.x, c.z, y, 0.5, 0.5, 5.2, rot, all('fuelPump', [0.2, 1]));
    }
    for (const lx of [-16, -8]) {
      const c = P(lx, 4);
      kit.box(c.x, c.z, y, 1.2, 0.8, 1.9, rot, { ...all('fuelPump', [1, 1]), top: { cell: 'metalVent', tile: [1, 1] } });
    }
    // shop and café
    const shop = P(-12, -11);
    kit.box(shop.x, shop.z, y, 16, 8, 4.2, rot, { front: { cell: 'shopFuel', tile: [3, 1] }, back: { cell: 'corrGrey', tile: [3, 1] }, left: { cell: 'corrGrey', tile: [2, 1] }, right: { cell: 'corrGrey', tile: [2, 1] }, top: { cell: 'roofBitumen', tile: [3, 2] } });
    const cafe = P(16, -8);
    kit.box(cafe.x, cafe.z, y, 18, 10, 4.4, rot, { front: { cell: 'shopRoadCafe', tile: [3, 1] }, back: { cell: 'woodWall', tile: [4, 1] }, left: { cell: 'woodWin', tile: [2, 1] }, right: { cell: 'woodWall', tile: [2, 1] }, top: { cell: 'roofRed', tile: [4, 2] } });
    // price pylon by the road
    const pylon = P(-30, 13);
    kit.box(pylon.x, pylon.z, y, 0.5, 0.5, 7, rot, all('metalVent', [0.1, 2]));
    kit.box(pylon.x, pylon.z, y + 7, 3.2, 0.5, 3.2, rot, { ...all('shopFuel', [0.6, 0.6]), top: { cell: 'metalVent', tile: [1, 1] } });
  }

  if (kit.vertexCount) {
    const { material } = createCityMaterial(false);
    const g = kit.toGeometry();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'canyon:structures';
    group.add(mesh);
    disposables.push(g, material);
  }

  return {
    group,
    update() {},
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
