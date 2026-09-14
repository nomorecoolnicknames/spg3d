import type { OsmWorld } from '@/game/world/osm/types';
import { loadLandmarks } from '@/game/assets';

/**
 * Real-place world data (scripts/osm-map.mjs) is a few hundred KB per map, so each file is its own
 * chunk, fetched when a race on that map starts. Routes are small and bundled with the track list.
 */
const WORLDS = import.meta.glob<OsmWorld>('./*.world.json', { import: 'default' });
const cache = new Map<string, OsmWorld>();

export function getMapWorld(id: string): OsmWorld | undefined {
  return cache.get(id);
}

export async function loadMapWorld(id: string): Promise<OsmWorld> {
  const hit = cache.get(id);
  if (hit) return hit;
  const load = WORLDS[`./${id}.world.json`];
  if (!load) throw new Error(`no map data for ${id}`);
  const world = await load();
  if (world.models.length) await loadLandmarks();
  cache.set(id, world);
  return world;
}
