# Blender building kits and hero buildings — contract

Every building in the three real-place maps is generated from its OpenStreetMap footprint
(`src/game/world/osm/OsmCity.ts`). Today its walls are flat quads with a painted facade texture. This contract
replaces that with real 3D facades built in Blender:

- **kits** — reusable facade modules (a window bay, a balcony bay, an entrance, a cornice …) per architectural
  style; the game lays them along every wall of every footprint, floor by floor;
- **heroes** — whole modelled buildings for the recognisable places on and near the race routes; the game puts
  them on their OSM footprint instead of an extrusion.

Both are authored by headless Blender scripts committed to the repo and exported as GLB. The game converts
them into its own vertex format and merges them per map sector (one draw call per sector), so the rules below
exist to make that conversion possible — follow them exactly.

Blender: `/home/n8n/tools/blender-4.5.13-linux-x64/blender -b --factory-startup -P <script> -- <args>`.
Scratch output only on `/mnt/ramdisk/kits-<name>/`. Do not start the MCP server (port 9876), do not run
npm/vite/QA, do not commit, do not touch files outside the ones listed for your task.

## 1. Materials (both kits and heroes)

Materials are identified **by name only** (lowercase, exact). The Principled BSDF *Base Color* is the albedo
(linear); roughness/metallic are read too. Vertex colours, if present, multiply the base colour. **No textures.**

| name    | what it is                                          | game treatment                                           |
|---------|-----------------------------------------------------|----------------------------------------------------------|
| `wall`  | the main facade surface (plaster, brick, panel)     | tinted per building (the map's colour/palette)            |
| `wall2` | secondary facade colour (panel stripes, plinth)     | tinted per building, darker                               |
| `trim`  | white/stone details: surrounds, cornices, sills     | as is                                                     |
| `glass` | window glass                                        | sky reflection by day, some windows lit at night         |
| `frame` | window frames and mullions                          | as is                                                     |
| `metal` | railings, canopies, gutters, drainpipes, fences     | metallic                                                  |
| `roof`  | roof surfaces, parapet copings, roof hatches        | as is                                                     |
| `dark`  | door recesses, openings, voids, shadows             | as is, never lit                                          |
| `sign`  | shop sign panels and light boxes                    | emissive at night                                        |
| `gold`  | gilded domes, spires, stars (heroes only)           | metallic, bright                                         |

Keep colours realistic (plaster `#d9cdb4`, red brick `#8e4a38`, silicate brick `#c9c2b5`, panel concrete
`#bdb9ae`, glass `#3b4a57`, frames `#e8e6e0` or `#5a4632`, metal `#4d535a`, roof `#4a4c50`).

## 2. Kits

### Files

- script `scripts/blender/kits/<kit>.py` — builds every module and exports; run as
  `blender -b --factory-startup -P scripts/blender/kits/<kit>.py -- src/assets/kits/<kit>.glb`
- `src/assets/kits/<kit>.glb` — the modules (keep under 400 KB)
- `src/assets/kits/<kit>.json` — manifest (below)
- `docs/kits/<kit>.png` — preview render (≤ 1280×720): one assembled sample facade — at least 6 bays wide,
  ground floor + 4 typical floors + cap, with both corners — plus a second, closer 3/4 view of 2×2 bays.
  Use Workbench (flat, cavity + shadows) or Cycles CPU ≤ 32 samples.

### Module space

- One **root object per module**, named `<kit>__<module>` (two underscores), at the world origin, no rotation,
  scale 1. Child meshes are allowed (the game bakes the hierarchy). Nothing else at the top level.
- Blender axes: **X** along the facade, 0 … W, left to right as seen from the street; **Z** up, 0 … H;
  the wall plane is **Y = 0**, the street (outside) is **−Y**.
- Window reveals and loggias recess into **+Y** (≤ 0.45 m). Sills, surrounds, balconies, canopies, cornices stick
  out into **−Y** (≤ 1.6 m). The module must cover the whole W × H rectangle at Y ≤ 0 (no gaps between neighbours);
  the back (Y > 0.45) is never seen and needs no faces.
- Modules are stretched by the game by up to ±25 % in X and Z to fit a wall exactly, so avoid round shapes that
  look wrong when stretched (use an arch mesh that tolerates it).
- Outward normals, applied transforms, no modifiers left, flat or smooth shading as appropriate.

### Triangle budgets

typical bay ≤ 90 · ground-floor module ≤ 150 · cap ≤ 40 · corner ≤ 24. The game places tens of thousands.

### Manifest `<kit>.json`

```json
{
  "kit": "panel",
  "bay": 3.0, "floor": 2.8, "ground": 3.0, "cap": 0.9, "corner": 0.4,
  "modules": {
    "win":      { "w": 3.0, "h": 2.8, "role": "floor",    "weight": 3, "tris": 64 },
    "loggia":   { "w": 3.0, "h": 2.8, "role": "floor",    "weight": 2, "tris": 88 },
    "stair":    { "w": 3.0, "h": 2.8, "role": "stair",    "weight": 1, "tris": 40 },
    "blank":    { "w": 3.0, "h": 2.8, "role": "blank",    "weight": 1, "tris": 12 },
    "g_win":    { "w": 3.0, "h": 3.0, "role": "ground",   "weight": 3, "tris": 60 },
    "g_door":   { "w": 3.0, "h": 3.0, "role": "entrance", "weight": 1, "tris": 120 },
    "g_shop":   { "w": 3.0, "h": 3.0, "role": "shop",     "weight": 1, "tris": 110 },
    "cap":      { "w": 3.0, "h": 0.9, "role": "cap",      "weight": 1, "tris": 24 },
    "corner":   { "w": 0.4, "h": 2.8, "role": "corner",   "weight": 1, "tris": 16 }
  }
}
```

Roles the game understands: `floor` (typical upper-floor bay, picked by weight), `stair` (staircase bay, used in a
vertical column above an entrance), `blank` (for short walls and gable ends), `ground`, `entrance`, `shop`
(ground-floor bays; shops only on commercial buildings and main streets), `cap` (the top band / cornice /
parapet, one per bay), `corner` (a vertical strip at each wall end, repeated per floor; ground floor uses it
too). A kit may have several modules per role. `w` of every non-corner module equals `bay`; `h` of `floor`,
`stair`, `blank` equals `floor`; ground-floor roles use `ground`; caps use `cap`.

### The kits

| kit          | style (what it must look like)                                                                 | bay × floor, ground, cap |
|--------------|-----------------------------------------------------------------------------------------------|--------------------------|
| `panel`      | Soviet/Polish large-panel blocks 9–17 floors (П-44, П-3, 1-464, Wielka płyta): panel joints, loggias with ribbed or glazed parapets, staircase windows, entrance canopy slab with steps, plain parapet | 3.0 × 2.8, 3.0, 0.9 |
| `brick`      | brick 4–9 floor houses — khrushchyovka and later: silicate or red brick courses, windows with concrete lintels and sills, small balconies with metal railings, staircase windows, porch with canopy, corbelled brick cornice; plus **warehouse** variant modules (`wh_*`): red-brick 19th-century depot bays with segmental arched windows, pilasters, big doors, stepped cornice | 3.2 × 3.0, 3.3, 0.8 |
| `classic`    | pre-revolution Petersburg / Warsaw tenement and Stalinist plaster facades: windows with profiled surrounds, sills and keystones, triangular and segmental pediments, pilasters, wrought-iron balconies, rusticated ground floor, arched gateway, shopfront with sign band and awning, full entablature cornice with frieze and dentils, attic balustrade | 3.4 × 3.7, 4.4, 1.5 |
| `modern`     | 1990s–2020s offices and malls (Warsaw centre, business centres): glass curtain wall with mullions and transoms, spandrel panels, ribbon windows, vertical fins, double-height glass lobby, retail front with canopy, metal coping parapet, rooftop plant screen | 3.2 × 3.8, 4.8, 1.2 |

## 3. Heroes

### Files

- script `scripts/blender/heroes/<map>.py`, run as
  `blender -b --factory-startup -P scripts/blender/heroes/<map>.py -- src/assets/heroes/<map>.glb`
- `src/assets/heroes/<map>.glb` and `src/assets/heroes/<map>.json` (manifest)
- `docs/heroes/<map>-<osmId>.png` — one preview per building (3/4 view, ≤ 1280×720)

### Placement

- The footprint is in `src/data/maps/<map>.world.json` → `buildings[]`, record
  `[height dm, min height dm, kind, colour, name index, levels, landmark style, OSM id, outer ring, ...holes]`;
  rings are flat `[x0, z0, x1, z1, …]` in **decimetres**, local frame +x east, +z south; `names[name index]` is the name.
- Build the model **in map metres relative to the footprint centroid** (the average of the outer-ring vertices):
  Blender X = map x − cx, Blender Y = −(map z − cz), Z up from 0 (ground). The game places the root at the centroid
  with no rotation, so the model lines up with the streets. Stay within the footprint (±1 m for cornices/canopies);
  towers and domes may rise far above the OSM height when the real building does.
- One root object per building named `hero__<osmId>` (the first/main id); the game skips the extrusion of every
  OSM id listed for it in the manifest. Buildings mapped as several OSM parts (a tower and its wings) become one
  hero listing all part ids; the centroid is then the centroid of the main part's outer ring.
- What a way is: `curl -s -A 'spg3d-heroes/1.0' https://api.openstreetmap.org/api/0.6/way/<id>` gives its tags
  (name, address, building:levels, roof shape, colour); the map's geographic origin is `origin` in the world file.
- Budget ≤ 8 000 triangles per building (≤ 15 000 for a skyline tower such as the Palace of Culture).
- Research the real building (Wikimedia Commons / your knowledge): silhouette, number of floors, rhythm of the
  facade, materials, colours, roof shape, spires/domes, signage.

### Manifest `<map>.json`

```json
{ "map": "ligovsky", "heroes": [ { "id": 123456, "ids": [123456, 123457], "name": "Московский вокзал", "height": 32.5, "tris": 7400 } ] }
```
