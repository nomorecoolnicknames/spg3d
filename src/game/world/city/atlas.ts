import * as THREE from 'three';

/**
 * Facade atlas for the city kit, drawn once on canvas at load. Every cell is ONE repeatable module
 * (a bay × a floor): the building shader tiles it with fract() inside the cell, so a whole district
 * is one material and one texture pair.
 *   albedo   RGB colour
 *   emissive R = window glass (lit at random at night, glossy), G = always-on sign / shop / LED mask
 */
export const CELL = 256;
export const COLS = 8;
export const PAD = 10;

export type CellName =
  // panel 9-storey
  | 'panelWin' | 'panelLoggia' | 'panelBlank' | 'panelDoor' | 'panelWinB' | 'panelLoggiaB' | 'panelStripe' | 'panelTop'
  // stalinka
  | 'stalWin' | 'stalWinPed' | 'stalPilaster' | 'stalCornice' | 'stalShop' | 'stalRustic' | 'stalWinPink' | 'stalPink'
  // towers
  | 'glassBlue' | 'glassDark' | 'glassSpandrel' | 'glassLobby' | 'towerWin' | 'towerBlank' | 'towerLed' | 'towerCrown'
  // brick 5-storey
  | 'brickWin' | 'brickBalcony' | 'brickBlank' | 'brickDoor' | 'redWin' | 'redBlank' | 'redDoor' | 'brickTop'
  // industrial
  | 'corrGrey' | 'corrBlue' | 'wareWin' | 'rollerDoor' | 'garageRust' | 'garageGreen' | 'factoryArch' | 'fencePanel'
  // shop fronts
  | 'shopFood' | 'shopPharmacy' | 'shopShawarma' | 'shopFlowers' | 'shopOptics' | 'shopKeys' | 'shopHardware' | 'shopCafe'
  // roofs and street objects
  | 'roofBitumen' | 'roofGravel' | 'kioskWall' | 'adStop' | 'adRival1' | 'adRival2' | 'metalVent' | 'concrete'
  // ground
  | 'pavement' | 'courtyard' | 'grass' | 'ballast' | 'granite' | 'water' | 'tunnelWall' | 'tunnelCeil';

const ORDER: CellName[] = [
  'panelWin', 'panelLoggia', 'panelBlank', 'panelDoor', 'panelWinB', 'panelLoggiaB', 'panelStripe', 'panelTop',
  'stalWin', 'stalWinPed', 'stalPilaster', 'stalCornice', 'stalShop', 'stalRustic', 'stalWinPink', 'stalPink',
  'glassBlue', 'glassDark', 'glassSpandrel', 'glassLobby', 'towerWin', 'towerBlank', 'towerLed', 'towerCrown',
  'brickWin', 'brickBalcony', 'brickBlank', 'brickDoor', 'redWin', 'redBlank', 'redDoor', 'brickTop',
  'corrGrey', 'corrBlue', 'wareWin', 'rollerDoor', 'garageRust', 'garageGreen', 'factoryArch', 'fencePanel',
  'shopFood', 'shopPharmacy', 'shopShawarma', 'shopFlowers', 'shopOptics', 'shopKeys', 'shopHardware', 'shopCafe',
  'roofBitumen', 'roofGravel', 'kioskWall', 'adStop', 'adRival1', 'adRival2', 'metalVent', 'concrete',
  'pavement', 'courtyard', 'grass', 'ballast', 'granite', 'water', 'tunnelWall', 'tunnelCeil',
];

export interface CityAtlas {
  albedo: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  size: number;
  /** [offsetU, offsetV, scaleU, scaleV] of the drawable (unpadded) area, in texture UV (flipY = false) */
  cell(name: CellName): [number, number, number, number];
}

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

type Ctx = CanvasRenderingContext2D;

function noise(ctx: Ctx, x: number, y: number, w: number, h: number, amount: number, grain = 2): void {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let py = 0; py < h; py += grain) {
    for (let px = 0; px < w; px += grain) {
      const n = (rnd() - 0.5) * amount;
      for (let gy = 0; gy < grain && py + gy < h; gy++) {
        for (let gx = 0; gx < grain && px + gx < w; gx++) {
          const i = ((py + gy) * w + px + gx) * 4;
          d[i] += n;
          d[i + 1] += n;
          d[i + 2] += n;
        }
      }
    }
  }
  ctx.putImageData(img, x, y);
}

/** vertical stains under windows / from the roof — the thing that makes concrete look old */
function streaks(ctx: Ctx, w: number, h: number, alpha: number): void {
  for (let i = 0; i < 14; i++) {
    const x = rnd() * w;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(0,0,0,${alpha * (0.4 + rnd())})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 2 + rnd() * 6, h * (0.3 + rnd() * 0.7));
  }
}

interface Paint {
  a: Ctx; // albedo
  e: Ctx; // emissive
  w: number;
  h: number;
}

function wall(p: Paint, color: string, grain = 22): void {
  p.a.fillStyle = color;
  p.a.fillRect(0, 0, p.w, p.h);
  noise(p.a, 0, 0, p.w, p.h, grain, 2);
}

/** window: frame, glass, emissive window mask */
function window_(p: Paint, x: number, y: number, w: number, h: number, frame = '#d9d6cf', bars = 2): void {
  const { a, e } = p;
  a.fillStyle = 'rgba(0,0,0,0.35)'; // reveal shadow
  a.fillRect(x - 3, y - 3, w + 6, h + 8);
  a.fillStyle = frame;
  a.fillRect(x, y, w, h);
  const gx = x + 5, gy = y + 5, gw = w - 10, gh = h - 10;
  const g = a.createLinearGradient(gx, gy, gx + gw, gy + gh);
  g.addColorStop(0, '#2c3440');
  g.addColorStop(0.55, '#141920');
  g.addColorStop(1, '#232a33');
  a.fillStyle = g;
  a.fillRect(gx, gy, gw, gh);
  e.fillStyle = '#ff0000';
  e.fillRect(gx, gy, gw, gh);
  a.fillStyle = frame;
  for (let i = 1; i < bars; i++) a.fillRect(gx + (gw * i) / bars - 2, gy, 4, gh);
  a.fillRect(gx, gy + gh * 0.32, gw, 4);
  // curtains on some panes, visible when lit
  if (rnd() < 0.6) {
    e.fillStyle = 'rgba(255,0,0,0.55)';
    e.fillRect(gx, gy, gw * (0.2 + rnd() * 0.25), gh);
  }
  a.fillStyle = 'rgba(255,255,255,0.12)'; // sill
  a.fillRect(x - 4, y + h, w + 8, 5);
}

function sign(p: Paint, text: string, bg: string, fg: string, y: number, h: number): void {
  const { a, e } = p;
  a.fillStyle = bg;
  a.fillRect(8, y, p.w - 16, h);
  a.fillStyle = fg;
  a.font = `bold ${Math.round(h * 0.62)}px "Arial Narrow", Arial, sans-serif`;
  a.textAlign = 'center';
  a.textBaseline = 'middle';
  const m = a.measureText(text).width;
  const sx = Math.min(1, (p.w - 30) / m);
  a.save();
  a.translate(p.w / 2, y + h / 2 + 2);
  a.scale(sx, 1);
  a.fillText(text, 0, 0);
  a.restore();
  e.fillStyle = '#00ff00';
  e.fillRect(8, y, p.w - 16, h);
}

function shopFront(p: Paint, wallColor: string, text: string, bg: string, fg: string): void {
  wall(p, wallColor, 18);
  sign(p, text, bg, fg, 26, 52);
  // display window + door
  const { a, e } = p;
  a.fillStyle = '#1a1d22';
  a.fillRect(14, 96, 150, 140);
  const g = a.createLinearGradient(14, 96, 164, 236);
  g.addColorStop(0, 'rgba(255,240,200,0.35)');
  g.addColorStop(1, 'rgba(255,200,120,0.15)');
  a.fillStyle = g;
  a.fillRect(18, 100, 142, 132);
  e.fillStyle = '#00b000'; // shop interiors are lit all night
  e.fillRect(18, 100, 142, 132);
  a.fillStyle = '#3b3f46';
  a.fillRect(176, 110, 66, 126);
  a.fillStyle = '#9aa1a9';
  a.fillRect(184, 120, 50, 96);
  e.fillStyle = '#006000';
  e.fillRect(184, 120, 50, 96);
}

function panel(p: Paint, color: string, kind: 'win' | 'loggia' | 'blank' | 'door' | 'stripe' | 'top', stripe = '#b5452f'): void {
  wall(p, color, 16);
  const { a } = p;
  a.strokeStyle = 'rgba(0,0,0,0.35)'; // panel joints
  a.lineWidth = 3;
  a.strokeRect(1.5, 1.5, p.w - 3, p.h - 3);
  streaks(a, p.w, p.h, 0.08);
  if (kind === 'win') window_(p, 58, 70, 140, 120, '#e4e1da', 2);
  if (kind === 'stripe') {
    a.fillStyle = stripe;
    a.fillRect(0, 206, p.w, 30);
    window_(p, 58, 60, 140, 118, '#e4e1da', 2);
  }
  if (kind === 'loggia') {
    // glazed loggia with a ribbed parapet
    a.fillStyle = 'rgba(0,0,0,0.45)';
    a.fillRect(14, 30, 228, 210);
    window_(p, 22, 38, 212, 110, '#cfd2d4', 4);
    a.fillStyle = '#a9aca8';
    a.fillRect(14, 152, 228, 86);
    for (let x = 20; x < 240; x += 12) {
      a.fillStyle = 'rgba(0,0,0,0.18)';
      a.fillRect(x, 156, 4, 78);
    }
  }
  if (kind === 'door') {
    a.fillStyle = '#6e7076';
    a.fillRect(40, 40, 176, 14); // canopy
    a.fillStyle = '#3a2f28';
    a.fillRect(84, 66, 88, 190);
    a.fillStyle = '#58473b';
    a.fillRect(92, 74, 72, 176);
    p.e.fillStyle = '#00c000'; // lamp over the entrance
    p.e.fillRect(116, 58, 24, 6);
    a.fillStyle = '#ffe9b0';
    a.fillRect(116, 58, 24, 6);
  }
  if (kind === 'top') {
    a.fillStyle = 'rgba(0,0,0,0.25)';
    a.fillRect(0, 0, p.w, 36);
  }
}

function plaster(p: Paint, color: string, kind: 'win' | 'ped' | 'pilaster' | 'cornice' | 'shop' | 'rustic'): void {
  wall(p, color, 14);
  const { a } = p;
  streaks(a, p.w, p.h, 0.06);
  const light = 'rgba(255,255,255,0.22)';
  const dark = 'rgba(0,0,0,0.25)';
  if (kind === 'win' || kind === 'ped') {
    a.fillStyle = light;
    a.fillRect(62, 46, 132, 168); // architrave
    window_(p, 72, 58, 112, 150, '#f0ebe0', 2);
    if (kind === 'ped') {
      a.fillStyle = light;
      a.beginPath();
      a.moveTo(52, 44);
      a.lineTo(128, 14);
      a.lineTo(204, 44);
      a.fill();
      a.fillStyle = dark;
      a.fillRect(52, 44, 152, 5);
    }
  }
  if (kind === 'pilaster') {
    a.fillStyle = light;
    a.fillRect(96, 0, 64, p.h);
    a.fillStyle = dark;
    a.fillRect(156, 0, 6, p.h);
  }
  if (kind === 'cornice') {
    a.fillStyle = light;
    a.fillRect(0, 40, p.w, 40);
    a.fillStyle = dark;
    a.fillRect(0, 80, p.w, 14);
    for (let x = 6; x < p.w; x += 26) {
      a.fillStyle = light;
      a.fillRect(x, 94, 14, 22); // dentils
    }
  }
  if (kind === 'rustic' || kind === 'shop') {
    for (let y = 0; y < p.h; y += 32) {
      a.fillStyle = dark;
      a.fillRect(0, y, p.w, 3);
    }
  }
  if (kind === 'shop') {
    a.fillStyle = '#1b1c20';
    a.beginPath();
    a.moveTo(40, 250);
    a.lineTo(40, 110);
    a.arc(128, 110, 88, Math.PI, 0);
    a.lineTo(216, 250);
    a.fill();
    a.fillStyle = 'rgba(255,220,160,0.28)';
    a.fillRect(50, 110, 156, 136);
    p.e.fillStyle = '#009000';
    p.e.fillRect(50, 110, 156, 136);
  }
}

function glass(p: Paint, tint: string, kind: 'curtain' | 'spandrel' | 'lobby' | 'led' | 'crown'): void {
  const { a, e } = p;
  const g = a.createLinearGradient(0, 0, p.w, p.h);
  g.addColorStop(0, tint);
  g.addColorStop(1, '#0a0e14');
  a.fillStyle = g;
  a.fillRect(0, 0, p.w, p.h);
  if (kind === 'curtain' || kind === 'lobby') {
    // curtain wall: random lit floors; lobby: a softly lit entrance hall (always on)
    e.fillStyle = kind === 'lobby' ? '#003800' : '#ff0000';
    e.fillRect(0, 0, p.w, p.h);
    a.fillStyle = '#5b6470';
    a.fillRect(0, 0, 6, p.h);
    a.fillRect(0, 0, p.w, 6);
    a.fillRect(p.w / 2 - 2, 0, 4, p.h);
  }
  if (kind === 'spandrel') {
    a.fillStyle = '#39414c';
    a.fillRect(0, 0, p.w, p.h);
    noise(a, 0, 0, p.w, p.h, 10, 4);
  }
  if (kind === 'led' || kind === 'crown') {
    a.fillStyle = '#20252c';
    a.fillRect(0, 0, p.w, p.h);
    const c = kind === 'led' ? '#35e0ff' : '#ff3b8d';
    a.fillStyle = c;
    a.fillRect(0, 108, p.w, 40);
    e.fillStyle = '#00ff00';
    e.fillRect(0, 108, p.w, 40);
  }
}

function brick(p: Paint, color: string, mortar: string): void {
  const { a } = p;
  a.fillStyle = mortar;
  a.fillRect(0, 0, p.w, p.h);
  for (let y = 0, row = 0; y < p.h; y += 16, row++) {
    for (let x = (row % 2) * -24; x < p.w; x += 48) {
      const v = (rnd() - 0.5) * 30;
      const c = new THREE.Color(color).offsetHSL(0, 0, v / 255);
      a.fillStyle = `#${c.getHexString()}`;
      a.fillRect(x + 2, y + 2, 44, 12);
    }
  }
  streaks(a, p.w, p.h, 0.1);
}

function corrugated(p: Paint, color: string): void {
  const { a } = p;
  a.fillStyle = color;
  a.fillRect(0, 0, p.w, p.h);
  for (let x = 0; x < p.w; x += 16) {
    const g = a.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0.18)');
    a.fillStyle = g;
    a.fillRect(x, 0, 16, p.h);
  }
  noise(a, 0, 0, p.w, p.h, 14, 3);
  for (let i = 0; i < 6; i++) {
    a.fillStyle = `rgba(110,60,30,${0.15 + rnd() * 0.2})`; // rust
    a.fillRect(rnd() * p.w, p.h * (0.6 + rnd() * 0.4), 20 + rnd() * 40, 40);
  }
}

function garage(p: Paint, door: string): void {
  brick(p, '#8b8378', '#6e675e');
  const { a } = p;
  a.fillStyle = '#2b2b2b';
  a.fillRect(26, 60, 204, 196);
  a.fillStyle = door;
  a.fillRect(32, 66, 94, 190);
  a.fillRect(130, 66, 94, 190);
  noise(a, 32, 66, 192, 190, 26, 3);
  a.fillStyle = 'rgba(0,0,0,0.3)';
  for (let y = 80; y < 250; y += 34) a.fillRect(32, y, 192, 3);
  a.fillStyle = `rgba(120,70,35,0.35)`;
  a.fillRect(32, 200, 192, 56);
}

function ad(p: Paint, title: string, sub: string, c1: string, c2: string): void {
  const { a, e } = p;
  const g = a.createLinearGradient(0, 0, p.w, p.h);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  a.fillStyle = g;
  a.fillRect(0, 0, p.w, p.h);
  // simple poster figure: silhouette + light rays (original art, no photos)
  a.fillStyle = 'rgba(0,0,0,0.55)';
  a.beginPath();
  a.arc(78, 118, 34, 0, Math.PI * 2);
  a.fill();
  a.fillRect(38, 150, 80, 106);
  a.fillStyle = 'rgba(255,255,255,0.9)';
  a.font = 'bold 44px Arial, sans-serif';
  a.textAlign = 'left';
  a.fillText(title, 128, 120);
  a.font = 'bold 22px Arial, sans-serif';
  a.fillText(sub, 130, 156);
  e.fillStyle = '#00d000';
  e.fillRect(0, 0, p.w, p.h);
}

function ground(p: Paint, kind: CellName): void {
  const { a } = p;
  switch (kind) {
    case 'pavement': {
      a.fillStyle = '#5d5d5f';
      a.fillRect(0, 0, p.w, p.h);
      for (let y = 0; y < p.h; y += 64) {
        for (let x = 0; x < p.w; x += 64) {
          const v = 80 + rnd() * 20;
          a.fillStyle = `rgb(${v},${v},${v + 2})`;
          a.fillRect(x + 2, y + 2, 60, 60);
        }
      }
      noise(a, 0, 0, p.w, p.h, 22, 2);
      break;
    }
    case 'courtyard':
      a.fillStyle = '#3a3b3f';
      a.fillRect(0, 0, p.w, p.h);
      noise(a, 0, 0, p.w, p.h, 30, 2);
      break;
    case 'grass':
      a.fillStyle = '#2f3a24';
      a.fillRect(0, 0, p.w, p.h);
      noise(a, 0, 0, p.w, p.h, 40, 3);
      break;
    case 'ballast':
      a.fillStyle = '#4a4540';
      a.fillRect(0, 0, p.w, p.h);
      noise(a, 0, 0, p.w, p.h, 70, 3);
      break;
    case 'granite':
      a.fillStyle = '#6d6560';
      a.fillRect(0, 0, p.w, p.h);
      for (let y = 0; y < p.h; y += 48) {
        a.fillStyle = 'rgba(0,0,0,0.35)';
        a.fillRect(0, y, p.w, 3);
      }
      noise(a, 0, 0, p.w, p.h, 34, 2);
      break;
    case 'water': {
      const g = a.createLinearGradient(0, 0, 0, p.h);
      g.addColorStop(0, '#0c1a24');
      g.addColorStop(1, '#081018');
      a.fillStyle = g;
      a.fillRect(0, 0, p.w, p.h);
      break;
    }
    case 'tunnelWall':
      a.fillStyle = '#c9c4b8';
      a.fillRect(0, 0, p.w, p.h);
      for (let y = 0; y < p.h; y += 32) for (let x = 0; x < p.w; x += 64) {
        a.fillStyle = 'rgba(0,0,0,0.12)';
        a.fillRect(x, y, 62, 30);
      }
      a.fillStyle = '#e0b400';
      a.fillRect(0, 222, p.w, 20);
      a.fillStyle = '#1c1c1c';
      for (let x = 0; x < p.w; x += 40) a.fillRect(x, 222, 20, 20);
      streaks(a, p.w, p.h, 0.12);
      break;
    case 'tunnelCeil':
      a.fillStyle = '#4a4a4e';
      a.fillRect(0, 0, p.w, p.h);
      noise(a, 0, 0, p.w, p.h, 20, 3);
      a.fillStyle = '#fff4d8';
      a.fillRect(112, 20, 32, 48);
      p.e.fillStyle = '#00c000';
      p.e.fillRect(112, 20, 32, 48);
      break;
    default:
      break;
  }
}

function paintCell(name: CellName, p: Paint): void {
  switch (name) {
    case 'panelWin': return panel(p, '#b9b6ad', 'win');
    case 'panelLoggia': return panel(p, '#b9b6ad', 'loggia');
    case 'panelBlank': return panel(p, '#b0ada4', 'blank');
    case 'panelDoor': return panel(p, '#a9a69d', 'door');
    case 'panelWinB': return panel(p, '#c9b89a', 'win');
    case 'panelLoggiaB': return panel(p, '#c9b89a', 'loggia');
    case 'panelStripe': return panel(p, '#bdbab2', 'stripe', ['#b5452f', '#2f6db5', '#3f8a4a'][Math.floor(rnd() * 3)]);
    case 'panelTop': return panel(p, '#a6a39a', 'top');
    case 'stalWin': return plaster(p, '#c79a5a', 'win');
    case 'stalWinPed': return plaster(p, '#c79a5a', 'ped');
    case 'stalPilaster': return plaster(p, '#c79a5a', 'pilaster');
    case 'stalCornice': return plaster(p, '#c79a5a', 'cornice');
    case 'stalShop': return plaster(p, '#8f7457', 'shop');
    case 'stalRustic': return plaster(p, '#8f7457', 'rustic');
    case 'stalWinPink': return plaster(p, '#c98a82', 'win');
    case 'stalPink': return plaster(p, '#c98a82', 'pilaster');
    case 'glassBlue': return glass(p, '#2f5b7c', 'curtain');
    case 'glassDark': return glass(p, '#24303a', 'curtain');
    case 'glassSpandrel': return glass(p, '#39414c', 'spandrel');
    case 'glassLobby': return glass(p, '#3a4a55', 'lobby');
    case 'towerWin': wall(p, '#8d9096', 12); return window_(p, 20, 30, 216, 170, '#5b5f66', 3);
    case 'towerBlank': return wall(p, '#8d9096', 12);
    case 'towerLed': return glass(p, '#20252c', 'led');
    case 'towerCrown': return glass(p, '#20252c', 'crown');
    case 'brickWin': brick(p, '#b8a99a', '#9c9082'); return window_(p, 70, 60, 116, 130, '#eae6dc', 2);
    case 'brickBalcony': {
      brick(p, '#b8a99a', '#9c9082');
      window_(p, 40, 40, 90, 170, '#eae6dc', 1);
      window_(p, 146, 60, 80, 110, '#eae6dc', 1);
      p.a.fillStyle = '#5a5f63';
      p.a.fillRect(20, 176, 220, 60);
      for (let x = 24; x < 236; x += 10) {
        p.a.fillStyle = 'rgba(0,0,0,0.35)';
        p.a.fillRect(x, 180, 3, 52);
      }
      return;
    }
    case 'brickBlank': return brick(p, '#b8a99a', '#9c9082');
    case 'brickDoor': brick(p, '#b8a99a', '#9c9082'); return panel({ ...p, a: p.a }, 'rgba(0,0,0,0)', 'door');
    case 'redWin': brick(p, '#8e4a38', '#6f5a4f'); return window_(p, 70, 60, 116, 130, '#e8e2d6', 2);
    case 'redBlank': return brick(p, '#8e4a38', '#6f5a4f');
    case 'redDoor': brick(p, '#8e4a38', '#6f5a4f'); return panel({ ...p, a: p.a }, 'rgba(0,0,0,0)', 'door');
    case 'brickTop': brick(p, '#a89a8b', '#8f8477'); p.a.fillStyle = 'rgba(0,0,0,0.3)'; p.a.fillRect(0, 0, p.w, 30); return;
    case 'corrGrey': return corrugated(p, '#8a8e92');
    case 'corrBlue': return corrugated(p, '#3f6a8f');
    case 'wareWin': corrugated(p, '#8a8e92'); return window_(p, 10, 70, 236, 70, '#6a6e72', 6);
    case 'rollerDoor': {
      corrugated(p, '#8a8e92');
      p.a.fillStyle = '#c7a43a';
      p.a.fillRect(20, 40, 216, 216);
      for (let y = 44; y < 256; y += 10) {
        p.a.fillStyle = 'rgba(0,0,0,0.25)';
        p.a.fillRect(20, y, 216, 3);
      }
      return;
    }
    case 'garageRust': return garage(p, '#6e4b35');
    case 'garageGreen': return garage(p, '#3f5a44');
    case 'factoryArch': {
      brick(p, '#8e4a38', '#6f5a4f');
      window_(p, 58, 50, 140, 180, '#3a3f44', 4);
      return;
    }
    case 'fencePanel': {
      wall(p, '#9c9a94', 18);
      for (let y = 0; y < p.h; y += 40) for (let x = 0; x < p.w; x += 40) {
        p.a.fillStyle = 'rgba(0,0,0,0.2)';
        p.a.beginPath();
        p.a.moveTo(x + 20, y + 4);
        p.a.lineTo(x + 36, y + 20);
        p.a.lineTo(x + 20, y + 36);
        p.a.lineTo(x + 4, y + 20);
        p.a.fill();
      }
      return;
    }
    case 'shopFood': return shopFront(p, '#6d6a66', 'ПРОДУКТЫ 24', '#0f5c2e', '#fff');
    case 'shopPharmacy': return shopFront(p, '#6d6a66', 'АПТЕКА', '#107a3d', '#e9fff0');
    case 'shopShawarma': return shopFront(p, '#6d6a66', 'ШАУРМА', '#b3261e', '#ffe082');
    case 'shopFlowers': return shopFront(p, '#6d6a66', 'ЦВЕТЫ', '#7b1f6a', '#fff');
    case 'shopOptics': return shopFront(p, '#6d6a66', 'ОПТИКА', '#1d3f8f', '#fff');
    case 'shopKeys': return shopFront(p, '#6d6a66', 'КЛЮЧИ · ОБУВЬ', '#2a2a2a', '#ffcc00');
    case 'shopHardware': return shopFront(p, '#6d6a66', 'ХОЗТОВАРЫ', '#c46200', '#fff');
    case 'shopCafe': return shopFront(p, '#6d6a66', 'КАФЕ «НОЧЬ»', '#141414', '#ff4fa3');
    case 'roofBitumen': wall(p, '#262626', 20); return;
    case 'roofGravel': wall(p, '#5a5852', 44); return;
    case 'kioskWall': {
      wall(p, '#d8d2c2', 10);
      sign(p, 'ПЕЧАТЬ', '#1d3f8f', '#fff', 20, 44);
      window_(p, 20, 80, 216, 120, '#dedede', 3);
      return;
    }
    case 'adStop': return ad(p, 'МЭДКИД', 'новый альбом', '#ff1e3c', '#2a0612');
    case 'adRival1': return ad(p, 'SQWORE', 'тур по районам', '#00c2ff', '#101d4a');
    case 'adRival2': return ad(p, 'ТЁМНЫЙ', 'ПРИНЦ · live', '#ffb000', '#3a1200');
    case 'metalVent': corrugated(p, '#7c8085'); return;
    case 'concrete': wall(p, '#8a8781', 24); streaks(p.a, p.w, p.h, 0.1); return;
    default: return ground(p, name);
  }
}

let cached: CityAtlas | null = null;

export function cityAtlas(): CityAtlas {
  if (cached) return cached;
  seed = 424242;
  const size = CELL * COLS;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
  };
  const [ca, a] = mk();
  const [ce, e] = mk();
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);
  const inner = CELL - PAD * 2;
  // draw each module on a scratch canvas, then copy with edge-extended padding
  const [sa, sac] = (() => {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
  })();
  const [se, sec] = (() => {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
  })();
  ORDER.forEach((name, i) => {
    sac.clearRect(0, 0, CELL, CELL);
    sec.fillStyle = '#000';
    sec.fillRect(0, 0, CELL, CELL);
    paintCell(name, { a: sac, e: sec, w: CELL, h: CELL });
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    for (const [dst, src] of [[a, sa], [e, se]] as const) {
      // the module tiles with fract(): pad with its wrapped neighbours so filtering across a seam matches
      dst.save();
      dst.beginPath();
      dst.rect(cx, cy, CELL, CELL);
      dst.clip();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dst.drawImage(src, cx + PAD + dx * inner, cy + PAD + dy * inner, inner, inner);
      dst.restore();
    }
  });
  const albedo = new THREE.CanvasTexture(ca);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.flipY = false;
  albedo.anisotropy = 4;
  const emissive = new THREE.CanvasTexture(ce);
  emissive.colorSpace = THREE.NoColorSpace;
  emissive.flipY = false;
  cached = {
    albedo,
    emissive,
    size,
    cell(name) {
      const i = ORDER.indexOf(name);
      const s = inner / size;
      return [((i % COLS) * CELL + PAD) / size, (Math.floor(i / COLS) * CELL + PAD) / size, s, s];
    },
  };
  return cached;
}
