#!/usr/bin/env node
// Downloads an OpenStreetMap area through Overpass and stores the raw elements on the ramdisk.
//   node scripts/osm-fetch.mjs <mapId> <lat> <lon> <radiusM>
// Output: /mnt/ramdisk/spg3d-osm/<mapId>.raw.json (ODbL data: credit "© OpenStreetMap contributors").
import { mkdirSync, writeFileSync } from 'node:fs';

const [id, latS, lonS, radS] = process.argv.slice(2);
if (!id || !latS || !lonS) {
  console.error('usage: osm-fetch.mjs <mapId> <lat> <lon> <radiusM>');
  process.exit(1);
}
const lat = Number(latS), lon = Number(lonS), r = Number(radS ?? 900);
const around = `(around:${r},${lat},${lon})`;
const query = `[out:json][timeout:180];
(
  way["highway"]${around};
  way["building"]${around};
  relation["building"]${around};
  way["building:part"]${around};
  way["natural"~"water|wood|scrub|grassland"]${around};
  relation["natural"="water"]${around};
  way["waterway"~"river|canal|stream|riverbank"]${around};
  relation["waterway"="riverbank"]${around};
  way["landuse"~"grass|forest|meadow|park|recreation_ground|railway|construction|commercial|retail|residential"]${around};
  way["leisure"~"park|garden|playground|pitch"]${around};
  way["railway"~"rail|tram|light_rail|subway|platform"]${around};
  way["man_made"~"bridge|pier"]${around};
  way["area:highway"]${around};
  node["highway"~"street_lamp|traffic_signals|bus_stop"]${around};
  node["natural"="tree"]${around};
  node["amenity"]${around};
  node["shop"]${around};
  node["tourism"]${around};
  node["historic"]${around};
);
out body geom;`;

const endpoints = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let json = null;
for (const ep of endpoints) {
  try {
    const res = await fetch(ep, {
      method: 'POST',
      headers: { 'User-Agent': 'spg3d-mapgen/1.0 (racing game map generator)', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(240000),
    });
    const text = await res.text();
    if (!text.startsWith('{')) {
      console.error(`${ep}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
      continue;
    }
    json = JSON.parse(text);
    console.log(`${ep}: ${json.elements.length} elements, base ${json.osm3s?.timestamp_osm_base}`);
    break;
  } catch (e) {
    console.error(`${ep}: ${e.message}`);
  }
}
if (!json) process.exit(2);
mkdirSync('/mnt/ramdisk/spg3d-osm', { recursive: true });
writeFileSync(`/mnt/ramdisk/spg3d-osm/${id}.raw.json`, JSON.stringify({ id, center: [lat, lon], radius: r, fetched: new Date().toISOString(), osm3s: json.osm3s, elements: json.elements }));
console.log(`saved /mnt/ramdisk/spg3d-osm/${id}.raw.json`);
