# Credits and third-party data

## Map data — OpenStreetMap (ODbL 1.0)

The real-place tracks (Щёлково, Лиговский проспект, Варшава · Центр) are generated from OpenStreetMap
data: street graph, building footprints and heights, water, parks, rails, trees.

© OpenStreetMap contributors. The data is available under the Open Database License (ODbL) 1.0:
https://www.openstreetmap.org/copyright

- extracts: `scripts/osm-fetch.mjs` (Overpass API), conversion: `scripts/osm-map.mjs`
- derived database files: `src/data/maps/*.world.json`, `src/data/maps/*.route.json` (ODbL; the snapshot
  timestamp is stored in each world file as `osmBase`)
- the attribution is shown in the game under the track description

## Reference photos

Landmarks are modelled after photographs on Wikimedia Commons (not redistributed with the game).
