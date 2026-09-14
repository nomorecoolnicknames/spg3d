#!/usr/bin/env node
// OpenStreetMap extract (scripts/osm-fetch.mjs) → game map data for one real place:
//   src/data/maps/<id>.route.json  race centreline [x, z, y] in metres, lap starts on a straight
//   src/data/maps/<id>.world.json  buildings, streets, water, parks, rails and trees near the route
//
//   node scripts/osm-map.mjs <mapId> [--raw /mnt/ramdisk/spg3d-osm/<mapId>.raw.json]
//
// Local frame: origin = fetch centre, +x east, +z south, y up. The world file stores decimetre integers.
// Data © OpenStreetMap contributors, ODbL 1.0 — credited in CREDITS.md and the in-game credits.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pc from 'polygon-clipping';
import { MAPS } from './osm-maps.config.mjs';

const id = process.argv[2];
const cfg = MAPS[id];
if (!cfg) {
  console.error(`usage: osm-map.mjs <${Object.keys(MAPS).join('|')}>`);
  process.exit(1);
}
const rawPath = process.argv.includes('--raw') ? process.argv[process.argv.indexOf('--raw') + 1] : `/mnt/ramdisk/spg3d-osm/${id}.raw.json`;
const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const [lat0, lon0] = raw.center;
const KX = Math.cos((lat0 * Math.PI) / 180) * 111320;
const KZ = 110540;
const proj = (p) => [(p.lon - lon0) * KX, -(p.lat - lat0) * KZ];

/** metres around the route that get buildings, streets and trees */
const RADIUS = cfg.radius ?? 400;
/** buildings at least this tall are kept anywhere in the extract (skyline landmarks) */
const TALL = 45;
/** world sector size, must match world/osm/OsmCity.ts */
const SECTOR = 192;
const HALF = cfg.roadWidth / 2;
const PAVEMENT = 5;
/** facades are pushed out of the race corridor to this distance from the centreline */
const CLEAR = HALF + PAVEMENT + 0.4;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const log = (...a) => console.log(`[${id}]`, ...a);

// ───────────────────────────── street graph and the race route ─────────────────────────────

const nodes = new Map(); // node id → [x, z]
const adj = new Map(); // node id → [{ to, len, cost }]
const ways = raw.elements.filter((e) => e.type === 'way');
for (const w of ways) {
  const hw = w.tags?.highway;
  const k = hw && cfg.classes[hw];
  if (!k || !w.nodes || !w.geometry || w.tags.area === 'yes' || w.tags.tunnel === 'yes') continue;
  for (let i = 0; i < w.nodes.length; i++) {
    if (!w.geometry[i]) continue;
    nodes.set(w.nodes[i], proj(w.geometry[i]));
  }
  for (let i = 0; i + 1 < w.nodes.length; i++) {
    const a = w.nodes[i], b = w.nodes[i + 1];
    if (!nodes.has(a) || !nodes.has(b)) continue;
    const len = dist(nodes.get(a), nodes.get(b));
    for (const [u, v] of [[a, b], [b, a]]) {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push({ to: v, len, cost: len * k, name: w.tags.name ?? '' });
    }
  }
}

function snap(wp) {
  let best = null, bd = Infinity;
  for (const [nid, edges] of adj) {
    if (wp.on && !edges.some((e) => e.name === wp.on)) continue;
    const d = dist(nodes.get(nid), wp.near);
    if (d < bd) {
      bd = d;
      best = nid;
    }
  }
  if (best === null) throw new Error(`waypoint ${JSON.stringify(wp)} snaps to nothing`);
  if (bd > 40) log(`warning: waypoint ${JSON.stringify(wp.near)} is ${bd.toFixed(0)} m from the graph`);
  return best;
}

/** shortest path; nodes already used by earlier legs cost 25× so the loop does not run back along itself */
function shortest(from, to, used) {
  const distTo = new Map([[from, 0]]);
  const prev = new Map();
  const heap = [[0, from]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === to) break;
    if (d > distTo.get(u)) continue;
    for (const e of adj.get(u) ?? []) {
      const nd = d + e.cost * (used.has(e.to) && e.to !== to ? 25 : 1);
      if (nd < (distTo.get(e.to) ?? Infinity)) {
        distTo.set(e.to, nd);
        prev.set(e.to, u);
        push([nd, e.to]);
      }
    }
  }
  if (!prev.has(to)) throw new Error(`no path ${from} → ${to}`);
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]));
  return path.reverse();
}

// a waypoint with `free: true` is reached by a straight line from the previous one (links a footpath to a
// carriageway, crosses a lawn); every other leg follows the street graph
const snapped = cfg.waypoints.map((wp) => (wp.free && !wp.on ? null : snap(wp)));
const posOf = (i) => (snapped[i] === null ? cfg.waypoints[i].near : nodes.get(snapped[i]));
const used = new Set();
let poly = [];
for (let i = 0; i < snapped.length; i++) {
  const j = (i + 1) % snapped.length;
  let leg;
  if (cfg.waypoints[j].free || cfg.waypoints[i].free || snapped[i] === null || snapped[j] === null) {
    leg = [posOf(i), posOf(j)];
  } else {
    try {
      const nodeLeg = shortest(snapped[i], snapped[j], used);
      if (process.env.DUMP_LEGS) {
        const streets = [];
        for (let k = 1; k < nodeLeg.length; k++) {
          const e = adj.get(nodeLeg[k - 1]).find((ed) => ed.to === nodeLeg[k]);
          if (streets[streets.length - 1]?.[0] !== e.name) streets.push([e.name, 0]);
          streets[streets.length - 1][1] += Math.round(e.len);
        }
        log(`leg ${i}→${j}: ${streets.map(([n, l]) => `${n || '?'} ${l}m`).join(' → ')}`);
      }
      leg = nodeLeg.map((n) => {
        used.add(n);
        return nodes.get(n);
      });
    } catch (err) {
      throw new Error(`leg ${i} ${JSON.stringify(cfg.waypoints[i].near)} → ${JSON.stringify(cfg.waypoints[j].near)}: ${err.message}`);
    }
  }
  poly.push(...(poly.length ? leg.slice(1) : leg));
}
poly.pop(); // closed: last = first
{
  const keys = poly.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`);
  const repeats = keys.length - new Set(keys).size;
  if (repeats) log(`warning: route revisits ${repeats} points`);
}
const graphPoints = poly.length;

/** Douglas–Peucker on an open polyline */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const L = Math.hypot(bx - ax, bz - az) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > eps) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
{
  // closed loop: split at the point farthest from the start so neither half is degenerate
  const far = poly.reduce((b, p, i) => (dist(p, poly[0]) > dist(poly[b], poly[0]) ? i : b), 0);
  const a = simplify(poly.slice(0, far + 1), 2.5);
  const b = simplify([...poly.slice(far), poly[0]], 2.5);
  poly = [...a, ...b.slice(1, -1)];
}

/** junctions leave clusters of corners a few metres apart: collapse every segment shorter than `minLen`
 *  into the intersection of its neighbours (a single corner the fillet can round properly) */
function mergeShort(pts, minLen) {
  let changed = true;
  while (changed && pts.length > 4) {
    changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (dist(a, b) >= minLen) continue;
      const p = pts[(i - 1 + n) % n], q = pts[(i + 2) % n];
      // intersect line p→a with line q→b
      const d1 = [a[0] - p[0], a[1] - p[1]], d2 = [b[0] - q[0], b[1] - q[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      let m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (Math.abs(den) > 1e-6) {
        const t = ((q[0] - p[0]) * d2[1] - (q[1] - p[1]) * d2[0]) / den;
        const x = [p[0] + d1[0] * t, p[1] + d1[1] * t];
        if (dist(x, m) < minLen * 2) m = x;
      }
      pts.splice(i, 2, m);
      if (i === n - 1) pts.shift(); // wrapped: b was pts[0]
      changed = true;
      break;
    }
  }
  return pts;
}
poly = mergeShort(poly, 20);
if (process.env.DUMP_CORNERS) log('corners', JSON.stringify(poly.map((p) => p.map(Math.round))));

/** fillet every corner with the largest radius (≤ cornerRadius) that fits half of each adjacent segment */
function fillet(pts, rMax) {
  const n = pts.length;
  const out = [];
  const corners = pts.map((c, i) => {
    const p = pts[(i - 1 + n) % n], q = pts[(i + 1) % n];
    const ux = p[0] - c[0], uz = p[1] - c[1], ul = Math.hypot(ux, uz);
    const vx = q[0] - c[0], vz = q[1] - c[1], vl = Math.hypot(vx, vz);
    const cos = (ux * vx + uz * vz) / (ul * vl);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos))); // interior angle
    const defl = Math.PI - ang;
    if (defl < (2 * Math.PI) / 180) return { c, straight: true };
    const r = Math.min(rMax, (Math.min(ul, vl) / 2) * Math.tan(ang / 2));
    const t = r / Math.tan(ang / 2);
    const inP = [c[0] + (ux / ul) * t, c[1] + (uz / ul) * t];
    const outP = [c[0] + (vx / vl) * t, c[1] + (vz / vl) * t];
    const bx = ux / ul + vx / vl, bz = uz / ul + vz / vl, bl = Math.hypot(bx, bz);
    const d = r / Math.sin(ang / 2);
    return { c, inP, outP, r, defl, center: [c[0] + (bx / bl) * d, c[1] + (bz / bl) * d] };
  });
  const tight = corners.filter((k) => !k.straight && k.r < 12 && k.defl > 0.5);
  if (tight.length) log(`tight corners: ${tight.map((k) => `r${k.r.toFixed(0)}@${k.c.map(Math.round)}`).join(' ')}`);
  for (let i = 0; i < n; i++) {
    const k = corners[i];
    const endOfCorner = k.straight ? k.c : k.outP;
    if (!k.straight) {
      const a0 = Math.atan2(k.inP[1] - k.center[1], k.inP[0] - k.center[0]);
      let da = Math.atan2(k.outP[1] - k.center[1], k.outP[0] - k.center[0]) - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(2, Math.ceil(Math.abs(da) / ((4 * Math.PI) / 180)));
      for (let j = 0; j < steps; j++) {
        const a = a0 + (da * j) / steps;
        out.push([k.center[0] + Math.cos(a) * k.r, k.center[1] + Math.sin(a) * k.r]);
      }
    } else out.push(k.c);
    const nx = corners[(i + 1) % n];
    const next = nx.straight ? nx.c : nx.inP;
    const len = dist(endOfCorner, next);
    const m = Math.max(1, Math.round(len / 5));
    for (let j = k.straight ? 1 : 0; j < m; j++) {
      const t = j / m;
      out.push([endOfCorner[0] + (next[0] - endOfCorner[0]) * t, endOfCorner[1] + (next[1] - endOfCorner[1]) * t]);
    }
  }
  // drop points closer than 1 m (a straight corner followed by a straight start)
  return out.filter((p, i) => i === 0 || dist(p, out[i - 1]) > 1);
}
let route = fillet(poly, cfg.cornerRadius);
{
  const s = route.reduce((b, p, i) => (dist(p, cfg.start) < dist(route[b], cfg.start) ? i : b), 0);
  route = [...route.slice(s), ...route.slice(0, s)];
}
let lapLength = 0;
for (let i = 0; i < route.length; i++) lapLength += dist(route[i], route[(i + 1) % route.length]);
log(`route: ${graphPoints} path points → ${poly.length} corners → ${route.length} points, lap ${lapLength.toFixed(0)} m`);

// the corridor must not touch itself (the barriers would cross)
{
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + dist(route[i], route[i - 1]));
  let worst = Infinity, where = null;
  for (let i = 0; i < route.length; i += 2) {
    for (let j = i + 2; j < route.length; j += 2) {
      const along = Math.min(cum[j] - cum[i], lapLength - (cum[j] - cum[i]));
      if (along < 80) continue;
      const d = dist(route[i], route[j]);
      if (d < worst) {
        worst = d;
        where = [route[i], route[j]];
      }
    }
  }
  log(`closest approach of distant route parts: ${worst.toFixed(1)} m at ${where?.map((p) => p.map(Math.round)).join(' / ')}`);
  if (worst < cfg.roadWidth + 8) log('WARNING: route corridor overlaps itself');
}

// ───────────────────────────── geometry helpers ─────────────────────────────

/** spatial hash over route points: distance to the centreline (±2.5 m, points are ≤5 m apart) */
const RH = 20;
const rhash = new Map();
route.forEach((p, i) => {
  const k = `${Math.floor(p[0] / RH)},${Math.floor(p[1] / RH)}`;
  if (!rhash.has(k)) rhash.set(k, []);
  rhash.get(k).push(i);
});
function nearestRoute(x, z, reach = 2) {
  const cx = Math.floor(x / RH), cz = Math.floor(z / RH);
  let best = -1, bd = Infinity;
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (const i of rhash.get(`${cx + dx},${cz + dz}`) ?? []) {
        const d = (route[i][0] - x) ** 2 + (route[i][1] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
  }
  if (best < 0) return { d: Infinity, i: -1 };
  // refine on the two adjacent segments
  let d = Math.sqrt(bd), foot = route[best];
  for (const j of [best - 1, best]) {
    const a = route[(j + route.length) % route.length], b = route[(j + 1) % route.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], el = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / el));
    const fx = a[0] + ex * t, fz = a[1] + ez * t;
    const dd = Math.hypot(x - fx, z - fz);
    if (dd < d) {
      d = dd;
      foot = [fx, fz];
    }
  }
  return { d, i: best, foot };
}

const minX0 = Math.min(...route.map((p) => p[0])) - RADIUS, maxX0 = Math.max(...route.map((p) => p[0])) + RADIUS;
const minZ0 = Math.min(...route.map((p) => p[1])) - RADIUS, maxZ0 = Math.max(...route.map((p) => p[1])) + RADIUS;
// align the world box to whole sectors
const bounds = [Math.floor(minX0 / SECTOR) * SECTOR, Math.floor(minZ0 / SECTOR) * SECTOR, Math.ceil(maxX0 / SECTOR) * SECTOR, Math.ceil(maxZ0 / SECTOR) * SECTOR];
const bboxPoly = [[[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]], [bounds[0], bounds[1]]]];

/** coarse mask: 25 m cells within RADIUS of the route */
const MC = 25;
const mask = new Set();
for (let x = bounds[0]; x < bounds[2]; x += MC) {
  for (let z = bounds[1]; z < bounds[3]; z += MC) {
    if (nearestRoute(x + MC / 2, z + MC / 2, Math.ceil(RADIUS / RH) + 1).d < RADIUS + MC) mask.add(`${Math.floor(x / MC)},${Math.floor(z / MC)}`);
  }
}
const inMask = (x, z) => mask.has(`${Math.floor(x / MC)},${Math.floor(z / MC)}`);

const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};
const centroid = (r) => {
  let x = 0, z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
};
function pointInRing(pt, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if (zi > pt[1] !== zj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** open ring (no repeated last point), metres */
const openRing = (pts) => (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 0.01 ? pts.slice(0, -1) : pts);

/** joins multipolygon member ways into closed rings */
function assembleRings(members) {
  const segs = members.filter((m) => m.geometry?.length > 1).map((m) => m.geometry.filter(Boolean).map(proj));
  const rings = [];
  const eq = (a, b) => dist(a, b) < 0.05;
  while (segs.length) {
    let ring = segs.shift();
    let grew = true;
    while (!eq(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = ring[ring.length - 1];
        if (eq(end, s[0])) ring = ring.concat(s.slice(1));
        else if (eq(end, s[s.length - 1])) ring = ring.concat([...s].reverse().slice(1));
        else if (eq(ring[0], s[s.length - 1])) ring = s.concat(ring.slice(1));
        else if (eq(ring[0], s[0])) ring = [...s].reverse().concat(ring.slice(1));
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (eq(ring[0], ring[ring.length - 1]) && ring.length > 3) rings.push(openRing(ring));
  }
  return rings;
}

/** element → list of polygons [outer, ...holes] (open rings, metres) */
function polygonsOf(e) {
  if (e.type === 'way') {
    if (!e.geometry || e.geometry.length < 4) return [];
    const r = e.geometry.filter(Boolean).map(proj);
    if (dist(r[0], r[r.length - 1]) > 0.05) return [];
    return [[openRing(r)]];
  }
  if (e.type === 'relation' && e.members) {
    const outers = assembleRings(e.members.filter((m) => m.role === 'outer' || m.role === ''));
    const inners = assembleRings(e.members.filter((m) => m.role === 'inner'));
    return outers.map((o) => [o, ...inners.filter((h) => pointInRing(h[0], o))]);
  }
  return [];
}

const dm = (v) => Math.round(v * 10);
const flat = (ring) => ring.flatMap((p) => [dm(p[0]), dm(p[1])]);
const num = (s) => {
  const v = parseFloat(String(s ?? '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// ───────────────────────────── water, land and bridges ─────────────────────────────

const waterPolys = [];
for (const e of raw.elements) {
  const t = e.tags ?? {};
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water === 'river') {
    for (const p of polygonsOf(e)) waterPolys.push(p.map((r) => [...r, r[0]]));
  }
}
let water = [];
if (waterPolys.length) {
  water = pc.intersection(pc.union(...waterPolys.map((p) => [p])), bboxPoly);
}
let land = water.length ? pc.difference(bboxPoly, water) : bboxPoly;
const inWater = (x, z) => water.some((poly) => pointInRing([x, z], poly[0]) && !poly.slice(1).some((h) => pointInRing([x, z], h)));
log(`water: ${water.length} polygons`);

// route elevation: humps over water (bridges), eased over 25 m on both sides
const routeY = route.map(() => 0);
{
  const bridgeWays = ways.filter((w) => w.tags?.bridge && w.tags.bridge !== 'no' && w.tags.highway && w.geometry).map((w) => w.geometry.filter(Boolean).map(proj));
  const onBridge = (x, z) => bridgeWays.some((pts) => pts.some((p, k) => {
    if (k === 0) return false;
    const a = pts[k - 1], ex = p[0] - a[0], ez = p[1] - a[1], el = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / el));
    return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) < 4;
  }));
  const wet = route.map((p) => inWater(p[0], p[1]) || onBridge(p[0], p[1]));
  const n = route.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(route[i], route[i - 1]));
  const spans = [];
  for (let i = 0; i < n; i++) {
    if (wet[i] && !wet[(i - 1 + n) % n]) {
      let j = i;
      while (wet[(j + 1) % n] && j - i < n) j++;
      spans.push([cum[i], cum[j % n] + (j >= n ? lapLength : 0)]);
    }
  }
  for (let k = spans.length - 1; k >= 0; k--) if (spans[k][1] - spans[k][0] < 20) spans.splice(k, 1);
  for (const [s0, s1] of spans) {
    for (let i = 0; i < n; i++) {
      for (const s of [cum[i], cum[i] + lapLength, cum[i] - lapLength]) {
        const mid = (s0 + s1) / 2, half = (s1 - s0) / 2 + 25;
        const u = Math.abs(s - mid) / half;
        if (u < 1) routeY[i] = Math.max(routeY[i], cfg.bridgeHump * (0.5 + 0.5 * Math.cos(Math.PI * u)) * Math.min(1, (1 - u) * 3 + 0.4));
      }
    }
  }
  if (spans.length) log(`bridges on the route: ${spans.map(([a, b]) => `${a.toFixed(0)}–${b.toFixed(0)} m`).join(', ')}`);
}

// where the route runs along a bank (not on a bridge) the bank grows to hold the road and its pavements
if (water.length) {
  const n = route.length;
  const W = HALF + PAVEMENT + 1.5;
  const quads = [];
  for (let i = 0; i < n; i++) {
    const a = route[i], b = route[(i + 1) % n];
    if (routeY[i] > 0.05 || routeY[(i + 1) % n] > 0.05) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * W, nz = (dx / l) * W, ex = (dx / l) * 1.5, ez = (dz / l) * 1.5;
    const q = [[a[0] + nx - ex, a[1] + nz - ez], [b[0] + nx + ex, b[1] + nz + ez], [b[0] - nx + ex, b[1] - nz + ez], [a[0] - nx - ex, a[1] - nz - ez]];
    if (!q.some((p) => inWater(p[0], p[1])) && !inWater((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
    if (ringArea(q) < 0) q.reverse();
    quads.push([[...q, q[0]]]);
  }
  if (quads.length) {
    const corridor = pc.union(...quads);
    water = pc.difference(water, corridor);
    land = pc.difference(bboxPoly, water);
    log(`banks widened along ${quads.length} route segments`);
  }
}

/** ground and water pieces per sector (only sectors that touch water; others are one full quad) */
const groundSectors = [];
const waterSectors = [];
if (water.length) {
  for (let sx = bounds[0]; sx < bounds[2]; sx += SECTOR) {
    for (let sz = bounds[1]; sz < bounds[3]; sz += SECTOR) {
      const rect = [[[sx, sz], [sx + SECTOR, sz], [sx + SECTOR, sz + SECTOR], [sx, sz + SECTOR], [sx, sz]]];
      const w = pc.intersection(water, rect);
      if (!w.length) continue;
      const g = pc.intersection(land, rect);
      const pack = (mp) => mp.map((poly) => poly.map((r) => flat(openRing(r))));
      groundSectors.push([sx / SECTOR, sz / SECTOR, pack(g)]);
      waterSectors.push([sx / SECTOR, sz / SECTOR, pack(w)]);
    }
  }
}

// ───────────────────────────── buildings ─────────────────────────────

const STYLE_DEFAULT_LEVELS = {
  shch: { yes: 3, apartments: 5, residential: 5, house: 2, detached: 2, commercial: 3, retail: 2, office: 4, industrial: 2, warehouse: 1, garages: 1, garage: 1, school: 3, kindergarten: 2, hospital: 4, church: 3, chapel: 2 },
  spb: { yes: 5, apartments: 5, residential: 5, house: 3, commercial: 5, retail: 3, office: 5, industrial: 3, warehouse: 2, garages: 1, garage: 1, school: 4, hospital: 5, church: 4, train_station: 4, service: 1 },
  waw: { yes: 5, apartments: 6, residential: 6, house: 3, commercial: 6, retail: 3, office: 8, industrial: 2, warehouse: 2, garages: 1, garage: 1, school: 4, hospital: 5, church: 4, train_station: 2, service: 1 },
}[cfg.style];

const KIND = { residential: 0, house: 1, commercial: 2, industrial: 3, religious: 4, civic: 5, station: 6, small: 7 };
function kindOf(t) {
  const b = t.building ?? t['building:part'] ?? 'yes';
  if (['church', 'chapel', 'cathedral', 'temple', 'mosque', 'synagogue'].includes(b) || t.amenity === 'place_of_worship') return KIND.religious;
  if (b === 'train_station' || t.railway === 'station') return KIND.station;
  if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(b)) return KIND.house;
  if (['commercial', 'retail', 'office', 'hotel', 'supermarket', 'mall'].includes(b) || t.shop || t.office || t.tourism === 'hotel') return KIND.commercial;
  if (['industrial', 'warehouse', 'garages', 'garage', 'service', 'shed', 'hangar', 'transformer_tower'].includes(b)) return b === 'garages' || b === 'garage' || b === 'shed' || b === 'service' ? KIND.small : KIND.industrial;
  if (['kiosk', 'toilets', 'hut', 'cabin'].includes(b)) return KIND.small;
  if (['school', 'kindergarten', 'hospital', 'civic', 'public', 'government', 'university', 'college', 'museum', 'theatre'].includes(b) || t.amenity) return KIND.civic;
  return KIND.residential;
}

const names = [];
const nameIdx = (s) => {
  if (!s) return -1;
  let i = names.indexOf(s);
  if (i < 0) i = names.push(s) - 1;
  return i;
};

const parts = [];
const outlines = [];
for (const e of raw.elements) {
  const t = e.tags ?? {};
  if (!t.building && !t['building:part']) continue;
  if (t.building === 'roof' || t['building:part'] === 'roof' || t.location === 'underground' || (num(t.layer) < 0 && t.location !== 'surface') || t.building === 'construction' || t.demolished) continue;
  for (const poly of polygonsOf(e)) (t['building:part'] && !t.building ? parts : outlines).push({ e, t, poly });
}
// OSM 3D convention: when parts describe a building its outline is not drawn — but only trust that when
// the parts actually cover most of the footprint (some malls have parts for one wing only)
const partHash = new Map();
for (const p of parts) {
  const c = centroid(p.poly[0]);
  const k = `${Math.floor(c[0] / 50)},${Math.floor(c[1] / 50)}`;
  if (!partHash.has(k)) partHash.set(k, []);
  partHash.get(k).push({ c, area: Math.abs(ringArea(p.poly[0])) });
}
const hasParts = (ring) => {
  const [minx, minz] = ring.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1])], [Infinity, Infinity]);
  const [maxx, maxz] = ring.reduce((m, p) => [Math.max(m[0], p[0]), Math.max(m[1], p[1])], [-Infinity, -Infinity]);
  let covered = 0;
  for (let gx = Math.floor(minx / 50); gx <= Math.floor(maxx / 50); gx++) {
    for (let gz = Math.floor(minz / 50); gz <= Math.floor(maxz / 50); gz++) {
      for (const p of partHash.get(`${gx},${gz}`) ?? []) if (pointInRing(p.c, ring)) covered += p.area;
    }
  }
  return covered > Math.abs(ringArea(ring)) * 0.6;
};

// a landmark style on an outline applies to the parts inside it (e.g. every tier of the Palace of Culture)
const partStyle = new Map();
for (const o of outlines) {
  const st = cfg.landmarks[o.e.id]?.style;
  if (!st) continue;
  for (const p of parts) if (pointInRing(centroid(p.poly[0]), o.poly[0])) partStyle.set(p, st);
}
const elementCentre = new Map();
for (const b of [...outlines, ...parts]) if (!elementCentre.has(b.e.id)) elementCentre.set(b.e.id, centroid(b.poly[0]));

const buildings = [];
let dropped = 0, pushed = 0;
for (const b of [...outlines.filter((o) => !hasParts(o.poly[0])), ...parts]) {
  const { e, t } = b;
  const lm = cfg.landmarks[e.id] ?? (partStyle.has(b) ? { style: partStyle.get(b) } : {});
  if (lm.style === 'skip') continue;
  const floorH = cfg.floorH;
  const levels = num(t['building:levels']);
  const roofLevels = num(t['roof:levels']) ?? 0;
  let h = lm.height ?? num(t.height);
  if (h === null) h = levels !== null ? levels * floorH + roofLevels * floorH * 0.6 + 0.8 : ((STYLE_DEFAULT_LEVELS[t.building ?? t['building:part']] ?? STYLE_DEFAULT_LEVELS.yes) * floorH + 0.8);
  let minH = num(t.min_height);
  if (minH === null) minH = num(t['building:min_level']) !== null ? num(t['building:min_level']) * floorH : 0;
  if (h - minH < 1.5) continue;
  let ring = b.poly[0];
  const c = centroid(ring);
  if (!inMask(c[0], c[1]) && h < TALL) continue;
  if (Math.abs(ringArea(ring)) < 12 && h < 20) continue;
  // keep the race corridor clear: vertices inside it slide out perpendicular to the route
  const nc = nearestRoute(c[0], c[1]);
  if (nc.d < CLEAR) {
    dropped++;
    continue;
  }
  let moved = false;
  ring = ring.map((p) => {
    const r = nearestRoute(p[0], p[1]);
    if (r.d >= CLEAR) return p;
    moved = true;
    const dx = p[0] - r.foot[0], dz = p[1] - r.foot[1], dl = Math.hypot(dx, dz) || 1;
    return [r.foot[0] + (dx / dl) * CLEAR, r.foot[1] + (dz / dl) * CLEAR];
  });
  if (moved) {
    const a0 = Math.abs(ringArea(b.poly[0])), a1 = Math.abs(ringArea(ring));
    if (a1 < a0 * 0.35 || a1 < 12) {
      dropped++;
      continue;
    }
    pushed++;
  }
  // counter-clockwise in x/z (positive area) so wall normals point outward consistently
  if (ringArea(ring) < 0) ring = [...ring].reverse();
  const holes = moved ? [] : b.poly.slice(1).map((hr) => (ringArea(hr) > 0 ? [...hr].reverse() : hr));
  const colour = t['building:colour'] ?? t['colour'] ?? '';
  buildings.push([dm(h), dm(minH), kindOf(t), colour, nameIdx(t.name), levels ?? -1, lm.style ?? '', e.id, flat(ring), ...holes.map(flat)]);
}
log(`buildings: ${buildings.length} (${parts.length} parts), ${pushed} pushed out of the corridor, ${dropped} dropped`);

// ───────────────────────────── streets, areas, rails, points ─────────────────────────────

const ROAD = { motorway: [0, 22], trunk: [0, 18], primary: [0, 15], secondary: [1, 13], tertiary: [2, 10], primary_link: [1, 8], secondary_link: [1, 7], tertiary_link: [2, 7], residential: [3, 7], unclassified: [3, 7], living_street: [3, 6], service: [4, 4.5], pedestrian: [5, 6], footway: [6, 2.6], path: [6, 2], cycleway: [6, 2.4], track: [4, 3.5] };
const roads = [];
for (const w of ways) {
  const t = w.tags ?? {};
  const r = ROAD[t.highway];
  if (!r || !w.geometry || t.area === 'yes' || t.tunnel === 'yes' || t.covered === 'yes' || num(t.layer) < 0 || t.indoor === 'yes') continue;
  if (t.footway === 'sidewalk' || t.footway === 'crossing' || t.cycleway === 'crossing') continue;
  const pts = w.geometry.filter(Boolean).map(proj);
  if (!pts.some((p) => inMask(p[0], p[1]))) continue;
  const lanes = num(t.lanes);
  let width = num(t.width) ?? (lanes && r[0] <= 3 ? Math.max(r[1] * 0.6, lanes * 3.4) : r[1]);
  if (t.oneway === 'yes' && r[0] <= 2 && !t.width) width *= 0.75;
  // split into pieces outside the race corridor (the race road covers the rest)
  let piece = [];
  const flush = () => {
    if (piece.length > 1) roads.push([r[0], dm(width), t.bridge && t.bridge !== 'no' ? 1 : 0, flat(piece)]);
    piece = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const inside = nearestRoute(pts[i][0], pts[i][1]).d < HALF - 1;
    const prevInside = i > 0 && nearestRoute(pts[i - 1][0], pts[i - 1][1]).d < HALF - 1;
    if (inside && prevInside) {
      flush();
      continue;
    }
    piece.push(pts[i]);
    if (inside) {
      flush();
      piece.push(pts[i]);
    }
  }
  flush();
}
log(`street pieces: ${roads.length}`);

const AREA = { water: 0, green: 1, plaza: 2, rail: 3 };
const areas = [];
for (const e of raw.elements) {
  const t = e.tags ?? {};
  let kind = -1;
  if (['park', 'garden'].includes(t.leisure) || ['grass', 'meadow', 'forest', 'recreation_ground', 'village_green', 'park'].includes(t.landuse) || ['wood', 'scrub', 'grassland'].includes(t.natural)) kind = AREA.green;
  else if ((t.highway === 'pedestrian' && t.area === 'yes') || ['pedestrian', 'footway'].includes(t['area:highway'])) kind = AREA.plaza;
  else if (t.landuse === 'railway') kind = AREA.rail;
  if (kind < 0) continue;
  for (const poly of polygonsOf(e)) {
    if (!poly[0].some((p) => inMask(p[0], p[1]))) continue;
    if (Math.abs(ringArea(poly[0])) < 30) continue;
    areas.push([kind, ...poly.map(flat)]);
  }
}
log(`areas: ${areas.length}`);

const rails = [];
for (const w of ways) {
  const t = w.tags ?? {};
  const kind = { rail: 0, light_rail: 0, tram: 1 }[t.railway];
  if (kind === undefined || !w.geometry || t.tunnel === 'yes' || t.service === 'yard' && kind === 0 && false) continue;
  const pts = w.geometry.filter(Boolean).map(proj);
  if (!pts.some((p) => inMask(p[0], p[1]))) continue;
  rails.push([kind, t.bridge === 'yes' ? 1 : 0, flat(pts)]);
}
log(`rails: ${rails.length}`);

const trees = [], signals = [], stops = [];
for (const e of raw.elements) {
  if (e.type !== 'node') continue;
  const t = e.tags ?? {};
  const [x, z] = proj(e);
  if (!inMask(x, z)) continue;
  const rd = nearestRoute(x, z).d;
  if (t.natural === 'tree' && rd > HALF + 2.5) trees.push(dm(x), dm(z));
  if (t.highway === 'traffic_signals' && rd < HALF + 25) signals.push(dm(x), dm(z));
  if ((t.highway === 'bus_stop' || t.public_transport === 'platform') && rd < HALF + 12 && rd > HALF) stops.push(dm(x), dm(z));
}
log(`trees ${trees.length / 2}, signals ${signals.length / 2}, stops ${stops.length / 2}`);

// ───────────────────────────── output ─────────────────────────────

const models = (cfg.models ?? []).map((m) => {
  if (m.facade) {
    // centre of the outline edge closest to `toward`, the model front (+z) along the outward normal
    const o = [...outlines, ...parts].find((b) => b.e.id === m.facade);
    if (!o) throw new Error(`model ${m.model}: facade ${m.facade} not in the extract`);
    let ring = o.poly[0];
    if (ringArea(ring) < 0) ring = [...ring].reverse();
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const len = dist(a, b);
      if (len < 12) continue;
      const d = dist(mid, m.toward);
      if (!best || d < best.d) best = { d, mid, nx: (b[1] - a[1]) / len, nz: -(b[0] - a[0]) / len };
    }
    return [m.model, dm(best.mid[0]), dm(best.mid[1]), Math.round((Math.atan2(best.nx, best.nz) * 180) / Math.PI)];
  }
  const at = m.at ?? elementCentre.get(m.osm);
  if (!at) throw new Error(`model ${m.model}: no position (osm ${m.osm})`);
  return [m.model, dm(at[0]), dm(at[1]), m.rot ?? 0];
});
// signs hang on the outline (a building described by parts keeps its outline for this)
const signs = (cfg.signs ?? []).map((sg) => {
  const o = [...outlines, ...parts].find((b) => b.e.id === sg.osm);
  if (!o) throw new Error(`sign «${sg.text}»: building ${sg.osm} not in the extract`);
  const built = buildings.filter((bl) => bl[7] === sg.osm)[0];
  const t = o.t;
  const h = built ? built[0] / 10 : num(t.height) ?? (num(t['building:levels']) ?? 4) * cfg.floorH;
  let ring = o.poly[0];
  if (ringArea(ring) < 0) ring = [...ring].reverse();
  return [sg.text, sg.color ?? '#ffffff', dm(Math.min(h, sg.maxY ?? 40)), flat(ring)];
});

const outDir = new URL('../src/data/maps/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const r1 = (v) => Math.round(v * 10) / 10;
const routeJson = {
  id,
  length: Math.round(lapLength),
  points: route.map((p, i) => [r1(p[0]), r1(p[1]), r1(routeY[i])]),
};
const world = {
  v: 1,
  id,
  origin: raw.center,
  osmBase: raw.osm3s?.timestamp_osm_base ?? raw.fetched,
  style: cfg.style,
  sector: SECTOR,
  bounds,
  roadWidth: cfg.roadWidth,
  names,
  buildings,
  roads,
  areas,
  rails,
  ground: groundSectors,
  water: waterSectors,
  trees,
  signals,
  stops,
  models,
  signs,
};
writeFileSync(new URL(`${id}.route.json`, outDir), JSON.stringify(routeJson));
const worldText = JSON.stringify(world);
writeFileSync(new URL(`${id}.world.json`, outDir), worldText);
log(`wrote ${id}.route.json (${route.length} pts) and ${id}.world.json (${(worldText.length / 1024).toFixed(0)} KB)`);
