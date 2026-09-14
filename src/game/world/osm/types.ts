/**
 * Real-place map data produced by scripts/osm-map.mjs from OpenStreetMap (© OpenStreetMap contributors,
 * ODbL). Local frame: +x east, +z south, metres from the extract centre. Coordinates are stored as
 * decimetre integers, flat [x0, z0, x1, z1, …].
 */
export type Flat = number[];

/** [height dm, min height dm, kind, colour, name index, levels, landmark style, OSM id, outer ring, ...holes] */
export type OsmBuilding = [number, number, number, string, number, number, string, number, Flat, ...Flat[]];

export const BUILDING_KIND = { residential: 0, house: 1, commercial: 2, industrial: 3, religious: 4, civic: 5, station: 6, small: 7 } as const;

/** [kind (0 primary … 3 residential, 4 service, 5 pedestrian, 6 footway), width dm, flags (1 = bridge), polyline] */
export type OsmRoad = [number, number, number, Flat];

/** [kind (1 green, 2 plaza, 3 railway land), outer ring, ...holes] */
export type OsmArea = [number, Flat, ...Flat[]];

/** [kind (0 rail, 1 tram), bridge, polyline] */
export type OsmRail = [number, number, Flat];

/** [sector x, sector z, polygons [outer, ...holes]] */
export type OsmSectorPolys = [number, number, Flat[][]];

export type OsmStyle = 'shch' | 'spb' | 'waw';

export interface OsmWorld {
  v: 1;
  id: string;
  origin: [number, number];
  osmBase: string;
  style: OsmStyle;
  sector: number;
  bounds: [number, number, number, number];
  roadWidth: number;
  names: string[];
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  areas: OsmArea[];
  rails: OsmRail[];
  /** land pieces of sectors that touch water (other sectors are solid ground) */
  ground: OsmSectorPolys[];
  water: OsmSectorPolys[];
  trees: Flat;
  signals: Flat;
  stops: Flat;
}

export interface OsmRoute {
  id: string;
  length: number;
  /** [x, z, y] metres */
  points: [number, number, number][];
}
