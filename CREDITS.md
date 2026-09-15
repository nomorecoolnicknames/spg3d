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

- Щёлково: «Въездной знак на фоне Историко-краеведческого музея» — Vzorets, CC BY-SA 4.0; embankment and
  bridge photos by Panoramio/Commons authors, CC BY / CC BY-SA
- Ligovsky 50 yard (warehouses, wall dressing): «Saint Petersburg Ligovsky Avenue 50 lit… 2025-03» — Artyom
  Svetlov, CC BY 4.0; «Zoccolo 2.0, St Petersburg, Russia, 17.10.2018» — CC BY-SA 2.0 (night entrance,
  floodlights, ducts, canopy with posters)
- Final boss look: «Madkid 2026.jpg» — JessePinkman, CC BY 4.0 (hair, face, sweater and scarf are modelled
  procedurally in `src/game/boss/BossMech.ts`; no pixels of the photo are used)
