// Real-place maps: fetch centre, race loop waypoints and building style per city.
// Coordinates are local metres from the fetch centre: +x east, +z south (see scripts/osm-map.mjs).
// A waypoint snaps to the nearest routable OSM node (optionally only on a street with that name);
// consecutive waypoints are joined by the shortest path over the street graph.
export const MAPS = {
  shchyolkovo: {
    // node scripts/osm-fetch.mjs shchyolkovo 55.9230 37.9930 1000
    style: 'shch',
    roadWidth: 14,
    cornerRadius: 26,
    floorH: 3.0,
    // Serafim Sarovsky embankment → Proletarsky bridge (the pink one) → 1st Sovetsky lane to the museum and the
    // entrance stela with the coat of arms → Sovetskaya → Shmidta street along the south bank → footbridge → hotel Premium
    waypoints: [
      { near: [40, -99], free: true },
      { near: [283, -40] },
      { near: [383, -45], on: 'Пролетарский проспект', free: true },
      { near: [300, 380], on: 'Пролетарский проспект' },
      { near: [120, 359], on: '1-й Советский переулок' },
      { near: [-40, 300] },
      { near: [-30, 180], on: 'Советская улица' },
      { near: [-150, 45], on: 'улица Шмидта' },
      { near: [-262, 16], on: 'улица Шмидта' },
      // footbridge by the hotel (way 377226856), then along the north bank south of the tower
      { near: [-272, -126], free: true },
      { near: [-262, -160], free: true },
      { near: [-175, -148], free: true },
      { near: [-98, -150], free: true },
      { near: [-12, -121] },
    ],
    start: [170, -100],
    classes: { primary: 1, secondary: 1, tertiary: 1, unclassified: 1.2, residential: 1.2, living_street: 1.4, service: 2, pedestrian: 1.3, footway: 1.4, path: 1.8, cycleway: 1.6, steps: 4 },
    bridgeHump: 1.6,
    landmarks: {
      // apart-hotel «Premium», Talsinskaya 9/2: ~26 floors, terracotta brick, blue glass, round crown (Commons photos)
      156871327: { height: 92, style: 'premium' },
      87408632: { height: 9, style: 'chapel' },
    },
  },
  ligovsky: {
    // node scripts/osm-fetch.mjs ligovsky 59.9255 30.3620 1300
    style: 'spb',
    roadWidth: 16,
    cornerRadius: 30,
    floorH: 3.7,
    // Nevsky → Vosstaniya Square (obelisk, Moskovsky station) → Ligovsky past Galeria and Ligovsky 50 (club 1703)
    // → Svechnoy lane → Marata street back to Nevsky
    waypoints: [
      { near: [-300, -680], on: 'Невский проспект' },
      { near: [-70, -612] },
      { near: [-127, -351], on: 'Лиговский проспект' },
      { near: [-253, 46], on: 'Лиговский проспект' },
      { near: [-318, 200], on: 'Лиговский проспект' },
      { near: [-440, 150], on: 'Свечной переулок' },
      { near: [-560, 95], on: 'улица Марата' },
      { near: [-460, -300], on: 'улица Марата' },
      { near: [-365, -676], on: 'улица Марата' },
    ],
    start: [-200, -655],
    classes: { primary: 1, primary_link: 1.1, secondary: 1, secondary_link: 1.1, tertiary: 1, residential: 1.2, unclassified: 1.2 },
    bridgeHump: 1.2,
    landmarks: {},
  },
  warsaw: {
    // node scripts/osm-fetch.mjs warsaw 52.2318 21.0060 1100
    style: 'waw',
    roadWidth: 18,
    cornerRadius: 40,
    floorH: 3.3,
    // Marszałkowska past the Palace of Culture → Aleje Jerozolimskie past Złote Tarasy and Warszawa Centralna
    // → Jana Pawła II past Varso, Złota 44, InterContinental → Rondo ONZ → Świętokrzyska
    waypoints: [
      { near: [250, -200], on: 'Marszałkowska' },
      { near: [320, 180], on: 'Marszałkowska' },
      { near: [0, 300], on: 'Aleje Jerozolimskie' },
      { near: [-270, 420], on: 'Aleja Jana Pawła II' },
      { near: [-400, 60], on: 'Aleja Jana Pawła II' },
      { near: [-470, -150], on: 'Świętokrzyska' },
      { near: [-200, -230], on: 'Świętokrzyska' },
    ],
    start: [280, -60],
    classes: { trunk: 1, primary: 1, primary_link: 1.2, secondary: 1, secondary_link: 1.2, tertiary: 1.1, residential: 1.4, unclassified: 1.4 },
    bridgeHump: 1.2,
    landmarks: {},
  },
};
