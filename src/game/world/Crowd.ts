import * as THREE from 'three';
import { getGLTF } from '../assets';
import type { TrackData } from './TrackData';

/**
 * Spectators behind the barriers: low-poly people from src/assets/crowd.glb (scripts/blender, three poses —
 * standing, arms up, filming) instanced in rows on the start straight and on the outside of the fastest
 * corners, each tinted a little and turned towards the track. One draw call per pose.
 */
export interface CrowdRig {
  group: THREE.Group;
  dispose(): void;
}

const TINTS = ['#e8e6e0', '#d8c4a8', '#b9c6d2', '#cfa9a9', '#a9c4b0', '#e2d2a0', '#c0b6d0', '#9fb0bd'];

export function buildCrowd(track: TrackData, opts: { count: number; shadows: boolean }): CrowdRig {
  const group = new THREE.Group();
  group.name = 'crowd';
  const gltf = getGLTF('crowd');
  const poses: THREE.Mesh[] = [];
  gltf?.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) poses.push(o);
  });
  if (!poses.length) return { group, dispose: () => {} };

  let seed = 20260916;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const n = track.count;
  // where people stand: the start straight, then the corners with the most bite, spread around the lap
  const zones: { i: number; side: number; len: number }[] = [{ i: 4, side: 1, len: 70 }, { i: 4, side: -1, len: 70 }];
  const corners = track.samples
    .map((s, i) => ({ i, c: Math.abs(s.curv), side: Math.sign(s.curv) || 1 }))
    .filter((c) => c.c > 0.012)
    .sort((a, b) => b.c - a.c);
  for (const c of corners) {
    if (zones.length >= 7) break;
    if (zones.some((z) => Math.abs(((z.i - c.i + n / 2 + n) % n) - n / 2) < 90)) continue;
    // the outside of the corner is where the view is
    zones.push({ i: c.i, side: c.side > 0 ? -1 : 1, len: 34 });
  }

  const spots: { x: number; y: number; z: number; rot: number; s: number; pose: number; zone: number }[] = [];
  const edge = track.halfW + track.runoff + 1.5;
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    const steps = Math.round(z.len / track.spacing);
    for (let k = 0; k < steps && spots.length < opts.count; k++) {
      const sm = track.samples[(z.i + k) % n];
      for (let row = 0; row < 3; row++) {
        if (rnd() < 0.45) continue;
        const lat = (edge + 0.7 + row * 0.85 + rnd() * 0.3) * z.side;
        const along = (rnd() - 0.5) * track.spacing;
        const x = sm.pos.x + sm.left.x * lat + sm.tan.x * along;
        const zz = sm.pos.z + sm.left.z * lat + sm.tan.z * along;
        const face = Math.atan2(-sm.left.x * z.side, -sm.left.z * z.side) + (rnd() - 0.5) * 0.7;
        spots.push({ x, y: sm.pos.y - 0.15, z: zz, rot: face, s: 0.94 + rnd() * 0.16, pose: Math.floor(rnd() * poses.length), zone: zi });
      }
    }
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  // one instanced mesh per pose per zone: only the stand you are driving past is drawn
  const groups: { pose: number; zone: number }[] = [];
  for (let zi = 0; zi < zones.length; zi++) for (let pi = 0; pi < poses.length; pi++) groups.push({ pose: pi, zone: zi });
  groups.forEach(({ pose: pi, zone: zi }) => {
    const src = poses[pi];
    const mine = spots.filter((s) => s.pose === pi && s.zone === zi);
    if (!mine.length) return;
    const inst = new THREE.InstancedMesh(src.geometry, mat, mine.length);
    inst.name = `crowd:${zi}:${pi}`;
    inst.castShadow = opts.shadows;
    mine.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rot);
      m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.s, s.s, s.s));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, col.set(TINTS[(i * 3 + pi) % TINTS.length]));
    });
    inst.computeBoundingSphere();
    group.add(inst);
  });

  return {
    group,
    dispose() {
      mat.dispose();
      group.clear();
    },
  };
}
