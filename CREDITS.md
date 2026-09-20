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

## Characters

- Boss-fight hero: «Deadpool MMD PORT FBX» (fan model) — Izann2842_o (https://sketchfab.com/Izann2842_o), CC BY 4.0
  (http://creativecommons.org/licenses/by/4.0/),
  https://sketchfab.com/3d-models/deadpool-mmd-port-fbx-11db756e1a694f3ca56cd57a994f7081. Changed: mesh decimated,
  shotguns and sai removed, textures downscaled, humanoid bones renamed (`scripts/blender/deadpool_mmd.py`); the
  animation is procedural (`src/game/boss/Fighter.ts`)

## City surfaces (2026-09-19)

Photographic PBR textures from Poly Haven, CC0-1.0 (https://polyhaven.com/license).
Downsampled to 512 px and packed into arrays. Source file URLs, MD5, authors and metre scale: `src/assets/materials/surfaces.json`.

- brick_red: https://polyhaven.com/a/brick_wall_001 — Rob Tuytel, Dimitrios Savva
- brick_silicate: https://polyhaven.com/a/painted_brick — Amal Kumar
- plaster_smooth: https://polyhaven.com/a/painted_plaster_wall — Amal Kumar
- plaster_rough: https://polyhaven.com/a/grey_plaster — Rob Tuytel
- granite: https://polyhaven.com/a/granite_tile — Charlotte Baglioni
- roof_tiles: https://polyhaven.com/a/clay_roof_tiles — Amal Kumar
- pavement_slabs: https://polyhaven.com/a/concrete_pavement — Charlotte Baglioni
- cobbles: https://polyhaven.com/a/cobblestone_pavement — Charlotte Baglioni
- tarmac_yard: https://polyhaven.com/a/asphalt_02 — Rob Tuytel
- grass: https://polyhaven.com/a/leafy_grass — Charlotte Baglioni
- gravel: https://polyhaven.com/a/gravel_floor — Jenelle van Heerden, Matterfield
- wood_planks: https://polyhaven.com/a/weathered_brown_planks — Dimitrios Savva, Rico Cilliers

Panel joints, metal cassettes, standing-seam roofing and bitumen: original procedural Cycles bakes (`scripts/blender/surfaces.py`).
Linden/poplar leaf clusters and bark: original Blender geometry/renders (`scripts/blender/trees.py`); no external tree imagery.

## City lighting and interiors — 2026-09-20

- Day sky: **Kloppenheim 03 (Pure Sky)**, Greg Zaal / Jarod Guest, CC0: https://polyhaven.com/a/kloppenheim_03_puresky
- Overcast sky: **Overcast Soil (Pure Sky)**, Sergej Majboroda / Jarod Guest, CC0: https://polyhaven.com/a/overcast_soil_puresky
- Near-tree trunk, branches and canopy distribution: **Tree Small 02**, Rico Cilliers, CC0: https://polyhaven.com/a/tree_small_02
  Reduced in Blender; runtime foliage cards use the project's existing generated branch atlas.
- Apartment interior atlas `src/assets/interiors/apartments-v1.png`: created for this project with OpenAI image generation; synthetic interiors, not photographs of the mapped buildings.
- Download URLs, authors and source hashes: `src/assets/env/sky-sources.json`, `src/assets/trees/street-tree-source.json`.
