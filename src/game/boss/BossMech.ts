import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * МЭДКИД — the mafioso mech. ~14 m tall, procedural but built from many bevelled,
 * layered parts with panel textures, gold trims, emissive seams, a visor head that
 * echoes the bull-terrier-in-shades logo, a fedora, a cigar and a gold chain.
 * Exposes a small animation API used by BossScene.
 */
export interface MechAnchors {
  core: THREE.Object3D;
  eye: THREE.Object3D;
  rocketPod: THREE.Object3D[];
  shoulderRack: THREE.Object3D[];
  gatling: THREE.Object3D;
  cigar: THREE.Object3D;
  feet: [THREE.Object3D, THREE.Object3D];
  chest: THREE.Object3D;
  hat: THREE.Object3D;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function panelTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const W = 512, H = 512;
  const [c, ctx] = canvas(W, H);
  const [r, rctx] = canvas(W, H);
  ctx.fillStyle = '#4a4e5a';
  ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = '#7a7a7a';
  rctx.fillRect(0, 0, W, H);
  // panels
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, w = 60 + rnd() * 160, h = 40 + rnd() * 120;
    const v = 58 + rnd() * 26;
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    const rv = 90 + rnd() * 70;
    rctx.fillStyle = `rgb(${rv},${rv},${rv})`;
    rctx.fillRect(x, y, w, h);
    // rivets
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x + 8 + rnd() * (w - 16), y + 8 + rnd() * (h - 16), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // scratches
  ctx.strokeStyle = 'rgba(180,185,200,0.22)';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = 1 + rnd() * 1.5;
    ctx.beginPath();
    const x = rnd() * W, y = rnd() * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 30);
    ctx.stroke();
  }
  // grime
  for (let i = 0; i < 20; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rnd() * W, rnd() * H);
    ctx.scale(30 + rnd() * 60, 20 + rnd() * 50);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(r);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, rough };
}

function hazardTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#1a1a1e';
  ctx.fillRect(0, 0, 256, 64);
  for (let x = -64; x < 256 + 64; x += 64) {
    ctx.fillStyle = '#f5c542';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 64, 64);
    ctx.lineTo(x + 32, 64);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function dollarTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#f5c542';
  ctx.font = '900 110px "Russo One", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BossMech {
  readonly root = new THREE.Group();
  readonly anchors: MechAnchors;
  private torso = new THREE.Group();
  private pelvis = new THREE.Group();
  private head = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private ankleL = new THREE.Group();
  private ankleR = new THREE.Group();
  private shoulderL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private eye: THREE.Mesh;
  private eyeMat: THREE.MeshBasicMaterial;
  private shutterL: THREE.Mesh;
  private shutterR: THREE.Mesh;
  private coreMat: THREE.MeshStandardMaterial;
  private coreLight: THREE.PointLight;
  private seamMat: THREE.MeshBasicMaterial;
  private emberLight: THREE.PointLight;
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private coreOpen = 0;
  private walkPhase = 0;
  private stagger = 0;
  private collapse = 0;
  private torsoYaw = 0;
  private headYaw = 0;
  private headPitch = 0;
  readonly height = 14;

  constructor(faceTex: THREE.Texture | undefined, shadows: boolean) {
    const tex = panelTextures();
    this.textures.push(tex.map, tex.rough);
    const gun = new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.7, color: '#e6e9f2', envMapIntensity: 1.0 });
    const gunDark = new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.8, color: '#8a8e9c', envMapIntensity: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 1, roughness: 0.22, envMapIntensity: 1.4 });
    const black = new THREE.MeshStandardMaterial({ color: '#0b0b0e', metalness: 0.6, roughness: 0.25 });
    const felt = new THREE.MeshStandardMaterial({ color: '#17141a', roughness: 0.95, metalness: 0 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.9, metalness: 0.1 });
    const hz = hazardTexture();
    hz.repeat.set(3, 1);
    this.textures.push(hz);
    const hazard = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.6, metalness: 0.4 });
    this.seamMat = new THREE.MeshBasicMaterial({ color: '#ff2038', toneMapped: false });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: '#ff1a2e', toneMapped: false });
    this.coreMat = new THREE.MeshStandardMaterial({ color: '#0b3c4a', emissive: '#2ee6ff', emissiveIntensity: 2.5, roughness: 0.2, metalness: 0.2 });
    this.materials.push(gun, gunDark, gold, black, felt, rubber, hazard, this.seamMat, this.eyeMat, this.coreMat);

    const box = (w: number, h: number, d: number, r = 0.08, seg = 3) => {
      const g = new RoundedBoxGeometry(w, h, d, seg, r);
      this.geometries.push(g);
      return g;
    };
    const cyl = (rt: number, rb: number, h: number, seg = 16) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg);
      this.geometries.push(g);
      return g;
    };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const me = new THREE.Mesh(g, m);
      me.position.set(x, y, z);
      me.castShadow = shadows;
      me.receiveShadow = true;
      return me;
    };
    const seam = (w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.geometries.push(g);
      const s = new THREE.Mesh(g, this.seamMat);
      s.position.set(x, y, z);
      parent.add(s);
    };

    // ---------------- legs ----------------
    const buildLeg = (side: 1 | -1): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group; foot: THREE.Object3D } => {
      const hip = new THREE.Group();
      hip.position.set(side * 1.7, 0, 0);
      // hip actuator housing
      hip.add(mesh(cyl(0.9, 0.9, 1.4, 20), gunDark, 0, 0, 0).rotateZ(Math.PI / 2));
      // upper leg: layered plates
      const upper = new THREE.Group();
      upper.add(mesh(box(1.5, 3.4, 1.7, 0.12), gun, 0, -1.9, 0));
      upper.add(mesh(box(1.7, 1.2, 1.9, 0.1), gunDark, 0, -0.9, 0));
      upper.add(mesh(box(0.5, 2.4, 0.35, 0.06), hazard, side * 0.85, -2.0, 0.55));
      seam(0.06, 2.6, 0.06, side * 0.79, -2.0, 0.9, upper);
      hip.add(upper);
      // knee
      const knee = new THREE.Group();
      knee.position.set(0, -3.6, 0);
      knee.add(mesh(cyl(0.75, 0.75, 1.9, 20), gunDark).rotateZ(Math.PI / 2));
      knee.add(mesh(cyl(0.5, 0.5, 2.0, 12), gold).rotateZ(Math.PI / 2));
      // piston behind the knee
      const piston = mesh(cyl(0.16, 0.16, 2.6, 10), black, 0, 0.9, -0.85);
      piston.rotation.x = 0.35;
      knee.add(piston);
      const pistonRod = mesh(cyl(0.1, 0.1, 2.2, 8), gold, 0, -0.9, -0.9);
      pistonRod.rotation.x = -0.15;
      knee.add(pistonRod);
      // lower leg
      const lower = new THREE.Group();
      lower.add(mesh(box(1.25, 3.0, 1.45, 0.1), gun, 0, -1.7, 0));
      lower.add(mesh(box(1.45, 0.9, 1.65, 0.08), gunDark, 0, -0.6, 0));
      lower.add(mesh(box(0.9, 1.6, 0.3, 0.05), gunDark, 0, -2.0, 0.75));
      seam(0.8, 0.05, 0.05, 0, -1.2, 0.92, lower);
      knee.add(lower);
      // ankle + foot
      const ankle = new THREE.Group();
      ankle.position.set(0, -3.3, 0);
      const foot = new THREE.Group();
      foot.add(mesh(box(2.0, 0.7, 3.2, 0.12), gunDark, 0, -0.35, 0.3));
      foot.add(mesh(box(2.2, 0.45, 1.3, 0.1), gun, 0, -0.5, 1.5)); // toe plate
      foot.add(mesh(box(1.6, 0.5, 0.9, 0.08), gun, 0, -0.45, -1.2)); // heel
      foot.add(mesh(box(2.1, 0.25, 3.3, 0.06), rubber, 0, -0.65, 0.3)); // sole
      ankle.add(foot);
      knee.add(ankle);
      hip.add(knee);
      return { hip, knee, ankle, foot };
    };
    const legL = buildLeg(1);
    const legR = buildLeg(-1);
    this.hipL = legL.hip;
    this.hipR = legR.hip;
    this.kneeL = legL.knee;
    this.kneeR = legR.knee;
    this.ankleL = legL.ankle;
    this.ankleR = legR.ankle;

    // ---------------- pelvis ----------------
    this.pelvis.position.y = 7.6;
    this.pelvis.add(mesh(box(4.2, 1.6, 2.4, 0.15), gunDark, 0, 0, 0));
    this.pelvis.add(mesh(box(2.4, 0.9, 2.8, 0.1), gun, 0, -0.5, 0));
    // belt with gold buckle
    this.pelvis.add(mesh(box(4.4, 0.35, 2.6, 0.05), black, 0, 0.55, 0));
    this.pelvis.add(mesh(box(0.9, 0.5, 0.2, 0.04), gold, 0, 0.55, 1.35));
    this.pelvis.add(this.hipL, this.hipR);
    this.root.add(this.pelvis);

    // ---------------- torso ----------------
    this.torso.position.y = 0.9;
    const chest = new THREE.Group();
    chest.position.y = 2.2;
    // core body, layered
    chest.add(mesh(box(5.4, 3.8, 3.0, 0.22, 4), gun, 0, 0, 0));
    chest.add(mesh(box(4.4, 3.2, 3.4, 0.18, 4), gunDark, 0, 0.1, 0.05));
    // pectoral plates (angled)
    for (const s of [-1, 1] as const) {
      const pl = mesh(box(2.2, 1.9, 0.5, 0.12), gun, s * 1.35, 0.85, 1.7);
      pl.rotation.y = -s * 0.18;
      pl.rotation.x = -0.12;
      chest.add(pl);
      seam(1.6, 0.05, 0.05, s * 1.35, 1.75, 1.95, chest);
    }
    // abdomen segments
    for (let i = 0; i < 3; i++) chest.add(mesh(box(3.0 - i * 0.2, 0.55, 2.2 - i * 0.15, 0.08), i % 2 ? gunDark : gun, 0, -2.2 - i * 0.62, 0.1));
    // emblem plate with the bull-terrier logo
    const emblemFrame = mesh(box(2.0, 2.0, 0.25, 0.08), gold, 0, -0.55, 1.78);
    chest.add(emblemFrame);
    if (faceTex) {
      const fg = new THREE.PlaneGeometry(1.7, 1.7);
      this.geometries.push(fg);
      const fm = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.5, metalness: 0.1, emissive: '#ffffff', emissiveMap: faceTex, emissiveIntensity: 0.15 });
      this.materials.push(fm);
      const face = new THREE.Mesh(fg, fm);
      face.position.set(0, -0.55, 1.92);
      chest.add(face);
    }
    // core recess + shutters
    const coreHolder = new THREE.Group();
    coreHolder.position.set(0, 0.3, 1.55);
    const recess = mesh(cyl(0.95, 0.95, 0.5, 24), black);
    recess.rotation.x = Math.PI / 2;
    coreHolder.add(recess);
    const coreG = new THREE.IcosahedronGeometry(0.62, 2);
    this.geometries.push(coreG);
    const core = new THREE.Mesh(coreG, this.coreMat);
    core.position.z = 0.1;
    coreHolder.add(core);
    this.coreLight = new THREE.PointLight('#2ee6ff', 0, 30, 1.8);
    this.coreLight.position.z = 1.2;
    coreHolder.add(this.coreLight);
    this.shutterL = mesh(box(1.05, 2.1, 0.22, 0.05), gun, -0.5, 0, 0.36);
    this.shutterR = mesh(box(1.05, 2.1, 0.22, 0.05), gun, 0.5, 0, 0.36);
    coreHolder.add(this.shutterL, this.shutterR);
    chest.add(coreHolder);
    // back: exhaust stacks
    for (const s of [-1, 1] as const) {
      const st = mesh(cyl(0.35, 0.42, 2.6, 12), gunDark, s * 1.4, 1.8, -1.6);
      st.rotation.x = -0.25;
      chest.add(st);
      const stTop = mesh(cyl(0.42, 0.35, 0.3, 12), black, s * 1.4, 3.1, -1.95);
      chest.add(stTop);
    }
    // shoulders: pauldrons
    const buildArm = (side: 1 | -1): { shoulder: THREE.Group; elbow: THREE.Group; tip: THREE.Object3D; rack: THREE.Object3D[] } => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 3.5, 1.5, 0);
      const pauldron = mesh(box(2.4, 2.0, 2.6, 0.25, 4), gun, side * 0.2, 0.6, 0);
      shoulder.add(pauldron);
      shoulder.add(mesh(box(1.4, 0.4, 2.0, 0.08), gold, side * 0.55, 1.62, 0));
      seam(0.05, 0.05, 2.0, side * 1.3, 0.6, 0, shoulder);
      const rack: THREE.Object3D[] = [];
      if (side === -1) {
        // rocket rack on the left pauldron: 2×3 tubes
        const rackBox = mesh(box(1.7, 1.2, 2.2, 0.08), gunDark, side * 0.3, 1.95, 0);
        rackBox.rotation.x = -0.35;
        shoulder.add(rackBox);
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            const tube = mesh(cyl(0.2, 0.2, 2.3, 10), black, side * 0.3 + (c - 1) * 0.5, 1.95 + (r - 0.5) * 0.5, 0);
            tube.rotation.x = Math.PI / 2 - 0.35;
            shoulder.add(tube);
            const muzzle = new THREE.Object3D();
            muzzle.position.set(side * 0.3 + (c - 1) * 0.5, 1.95 + (r - 0.5) * 0.5 + Math.sin(0.35) * 1.2, Math.cos(0.35) * 1.2);
            shoulder.add(muzzle);
            rack.push(muzzle);
          }
        }
      } else {
        const ant = mesh(cyl(0.05, 0.08, 2.6, 6), black, side * 0.6, 2.7, -0.6);
        shoulder.add(ant);
        const antTip = mesh(new THREE.SphereGeometry(0.12, 8, 8), this.seamMat, side * 0.6, 4.0, -0.6);
        this.geometries.push(antTip.geometry);
        shoulder.add(antTip);
      }
      // upper arm
      const upper = new THREE.Group();
      upper.position.set(side * 0.3, -0.3, 0);
      upper.add(mesh(cyl(0.62, 0.55, 2.8, 14), gunDark, 0, -1.4, 0));
      upper.add(mesh(box(0.9, 1.4, 1.1, 0.08), gun, side * 0.2, -1.4, 0));
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.set(0, -2.9, 0);
      elbow.add(mesh(cyl(0.6, 0.6, 1.5, 16), gold).rotateZ(Math.PI / 2));
      let tip: THREE.Object3D;
      if (side === 1) {
        // right: rocket pod (6 tubes) — the main volley weapon
        const pod = new THREE.Group();
        pod.position.set(0, -1.7, 0.2);
        pod.add(mesh(box(1.6, 1.6, 3.4, 0.14, 4), gun, 0, 0, 0));
        pod.add(mesh(box(1.8, 0.5, 0.9, 0.06), hazard, 0, 0.95, 0.4));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const t = mesh(cyl(0.22, 0.22, 0.5, 10), black, Math.cos(a) * 0.48, Math.sin(a) * 0.48, 1.6);
          t.rotation.x = Math.PI / 2;
          pod.add(t);
        }
        const glow = mesh(cyl(0.7, 0.7, 0.08, 6), this.seamMat, 0, 0, 1.7);
        glow.rotation.x = Math.PI / 2;
        glow.scale.setScalar(0.25);
        pod.add(glow);
        elbow.add(pod);
        tip = new THREE.Object3D();
        tip.position.set(0, -1.7, 2.1);
        elbow.add(tip);
      } else {
        // left: gatling cluster
        const gat = new THREE.Group();
        gat.position.set(0, -1.6, 0.3);
        gat.add(mesh(box(1.3, 1.3, 1.6, 0.12), gunDark, 0, 0, -0.5));
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const b = mesh(cyl(0.11, 0.11, 2.6, 8), black, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 1.3);
          b.rotation.x = Math.PI / 2;
          gat.add(b);
        }
        gat.add(mesh(cyl(0.45, 0.45, 0.35, 12), gold, 0, 0, 0.6).rotateX(Math.PI / 2));
        elbow.add(gat);
        tip = new THREE.Object3D();
        tip.position.set(0, -1.6, 2.6);
        elbow.add(tip);
      }
      // forearm hazard band
      elbow.add(mesh(box(1.1, 0.6, 1.0, 0.05), hazard, 0, -0.9, -0.2));
      upper.add(elbow);
      return { shoulder, elbow, tip, rack };
    };
    const armR = buildArm(1);
    const armL = buildArm(-1);
    this.shoulderL = armL.shoulder;
    this.shoulderR = armR.shoulder;
    this.elbowL = armL.elbow;
    this.elbowR = armR.elbow;
    chest.add(this.shoulderL, this.shoulderR);

    // gold chain across the chest (catenary of torus links) + $ pendant
    const linkG = new THREE.TorusGeometry(0.19, 0.06, 8, 14);
    this.geometries.push(linkG);
    const links: THREE.BufferGeometry[] = [];
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = (u - 0.5) * 4.6;
      const y = 1.9 - Math.cosh((u - 0.5) * 3.2) * 0.75 + 0.4;
      const lg = linkG.clone();
      lg.rotateY(i % 2 ? Math.PI / 2 : 0);
      lg.rotateZ((u - 0.5) * 0.9);
      lg.translate(x, y, 1.95 + 0.05 * Math.cos((u - 0.5) * Math.PI));
      links.push(lg);
    }
    const chainGeo = mergeGeometries(links)!;
    links.forEach((g) => g.dispose());
    this.geometries.push(chainGeo);
    chest.add(mesh(chainGeo, gold));
    const pendant = mesh(box(1.0, 1.15, 0.18, 0.06), gold, 0, 0.55 - 0.9 + 0.4, 2.02);
    chest.add(pendant);
    const dt = dollarTexture();
    this.textures.push(dt);
    const dm = new THREE.MeshBasicMaterial({ map: dt, transparent: true, color: '#3a2a08' });
    this.materials.push(dm);
    const dg = new THREE.PlaneGeometry(0.8, 0.9);
    this.geometries.push(dg);
    const dollar = new THREE.Mesh(dg, dm);
    dollar.position.set(0, 0.05, 2.12);
    chest.add(dollar);

    // ---------------- head ----------------
    this.head.position.set(0, 4.35, 0.2);
    const neck = mesh(cyl(0.7, 0.9, 0.9, 16), black, 0, -0.35, 0);
    this.head.add(neck);
    // skull: wide angular block with a chamfered muzzle (the "dog" read)
    const skull = new THREE.Group();
    skull.add(mesh(box(2.6, 1.5, 2.2, 0.2, 4), gun, 0, 0.75, -0.1));
    skull.add(mesh(box(1.9, 0.9, 1.4, 0.15, 4), gunDark, 0, 0.35, 1.1)); // muzzle
    skull.add(mesh(box(2.8, 0.35, 1.1, 0.08), gunDark, 0, 1.55, -0.1)); // brow plate
    // ears
    for (const s of [-1, 1] as const) {
      const ear = mesh(box(0.55, 1.2, 0.8, 0.08), gun, s * 1.1, 1.95, -0.5);
      ear.rotation.z = -s * 0.28;
      ear.rotation.x = -0.15;
      skull.add(ear);
      const earIn = mesh(box(0.3, 0.8, 0.5, 0.05), black, s * 1.1, 1.95, -0.45);
      earIn.rotation.z = -s * 0.28;
      earIn.rotation.x = -0.15;
      skull.add(earIn);
    }
    // visor band (the sunglasses)
    const visor = mesh(box(2.75, 0.62, 0.55, 0.12, 4), black, 0, 0.95, 0.95);
    skull.add(visor);
    // scanning eye inside the visor
    const eyeG = new THREE.BoxGeometry(0.5, 0.16, 0.08);
    this.geometries.push(eyeG);
    this.eye = new THREE.Mesh(eyeG, this.eyeMat);
    this.eye.position.set(0, 0.95, 1.26);
    skull.add(this.eye);
    const eyeLight = new THREE.PointLight('#ff2038', 6, 8, 1.6);
    eyeLight.position.set(0, 0.95, 1.6);
    skull.add(eyeLight);
    // jaw + cigar
    skull.add(mesh(box(1.5, 0.45, 1.2, 0.08), gunDark, 0, -0.15, 0.95));
    const cigar = mesh(cyl(0.09, 0.11, 1.4, 8), new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.9 }), 0.55, 0.0, 1.9);
    this.materials.push(cigar.material as THREE.Material);
    cigar.rotation.x = Math.PI / 2 + 0.25;
    cigar.rotation.z = -0.2;
    skull.add(cigar);
    const ember = mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color: '#ff6a1a', toneMapped: false }), 0.68, -0.15, 2.55);
    this.geometries.push(ember.geometry);
    this.materials.push(ember.material as THREE.Material);
    skull.add(ember);
    this.emberLight = new THREE.PointLight('#ff6a1a', 4, 6, 1.8);
    this.emberLight.position.copy(ember.position);
    skull.add(this.emberLight);
    // fedora
    const hat = new THREE.Group();
    hat.position.set(0, 1.95, -0.2);
    hat.rotation.z = 0.08;
    hat.rotation.x = -0.1;
    const brim = mesh(cyl(2.4, 2.45, 0.14, 40), felt, 0, 0.05, 0);
    const crown = mesh(cyl(1.35, 1.6, 1.15, 32), felt, 0, 0.65, 0);
    const crownTop = mesh(cyl(1.1, 1.35, 0.3, 32), felt, 0, 1.35, 0);
    const band = mesh(cyl(1.62, 1.62, 0.28, 32), gold, 0, 0.32, 0);
    hat.add(brim, crown, crownTop, band);
    skull.add(hat);
    this.head.add(skull);
    chest.add(this.head);
    this.torso.add(chest);
    this.pelvis.add(this.torso);

    // seams on the torso back and pelvis
    seam(3.6, 0.05, 0.05, 0, 1.0, -1.55, chest);
    seam(0.05, 1.8, 0.05, 0, 0.5, -1.6, chest);

    this.anchors = {
      core,
      eye: this.eye,
      rocketPod: [armR.tip],
      shoulderRack: armL.rack,
      gatling: armL.tip,
      cigar: ember,
      feet: [legL.foot, legR.foot],
      chest,
      hat,
    };
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = shadows;
        o.receiveShadow = true;
      }
    });
    this.setCore(false);
    this.pose(0, 0, 0);
  }

  /** Core exposure 0..1 (shutters slide open, light up). */
  setCore(open: boolean): void {
    this.coreOpenTarget = open ? 1 : 0;
  }
  private coreOpenTarget = 0;

  /** Aim torso and head toward a world-space target. */
  aim(target: THREE.Vector3, dt: number): void {
    const local = this.root.worldToLocal(target.clone());
    const yaw = Math.atan2(local.x, local.z);
    const wantTorso = THREE.MathUtils.clamp(yaw, -0.6, 0.6);
    this.torsoYaw += (wantTorso - this.torsoYaw) * Math.min(1, dt * 3);
    const headLocal = this.head.parent!.worldToLocal(target.clone());
    const hy = Math.atan2(headLocal.x, headLocal.z);
    const hp = Math.atan2(headLocal.y - 4.3, Math.hypot(headLocal.x, headLocal.z));
    this.headYaw += (THREE.MathUtils.clamp(hy, -0.9, 0.9) - this.headYaw) * Math.min(1, dt * 6);
    this.headPitch += (THREE.MathUtils.clamp(hp, -0.5, 0.35) - this.headPitch) * Math.min(1, dt * 6);
  }

  /** Called each frame: walk phase advances with speed; idle when speed ~0. */
  pose(dt: number, speed: number, t: number, opts: { stagger?: number; collapse?: number; aimArmR?: number } = {}): void {
    this.walkPhase += dt * (1.4 + speed * 0.55);
    this.stagger = opts.stagger ?? 0;
    this.collapse = opts.collapse ?? 0;
    const w = Math.min(1, speed / 1.5);
    const ph = this.walkPhase;
    // legs: hip swing, knee bend on the swing leg, ankle compensation
    const leg = (hip: THREE.Group, knee: THREE.Group, ankle: THREE.Group, phase: number) => {
      const s = Math.sin(phase);
      const lift = Math.max(0, Math.sin(phase + 0.6));
      hip.rotation.x = -s * 0.55 * w;
      knee.rotation.x = lift * 0.95 * w + 0.08;
      ankle.rotation.x = -(hip.rotation.x + knee.rotation.x) * 0.9 + 0.02;
    };
    leg(this.hipL, this.kneeL, this.ankleL, ph);
    leg(this.hipR, this.kneeR, this.ankleR, ph + Math.PI);
    // body bob + sway
    const bob = Math.abs(Math.sin(ph)) * 0.35 * w;
    this.pelvis.position.y = 7.6 - 0.25 + bob - this.collapse * 3.2;
    this.pelvis.rotation.z = Math.sin(ph) * 0.05 * w;
    this.pelvis.rotation.y = Math.sin(ph) * 0.12 * w;
    // torso: breathing, aim yaw, stagger lean, collapse fall
    this.torso.rotation.y = this.torsoYaw - this.pelvis.rotation.y;
    this.torso.rotation.x = -this.stagger * 0.45 + this.collapse * 1.1 + Math.sin(t * 1.1) * 0.015;
    this.torso.rotation.z = Math.sin(t * 0.7) * 0.01 + this.stagger * 0.12;
    this.torso.position.y = 0.9 + Math.sin(t * 1.1) * 0.03;
    // arms: counter-swing while walking, right arm aims forward when requested
    const aimR = opts.aimArmR ?? 0;
    this.shoulderR.rotation.x = -Math.sin(ph) * 0.35 * w * (1 - aimR) - 0.25 - aimR * 1.2;
    this.shoulderR.rotation.z = -0.15;
    this.elbowR.rotation.x = -0.5 - aimR * 0.4;
    this.shoulderL.rotation.x = Math.sin(ph) * 0.35 * w - 0.35;
    this.shoulderL.rotation.z = 0.15;
    this.elbowL.rotation.x = -0.6;
    // head
    this.head.rotation.y = this.headYaw;
    this.head.rotation.x = -this.headPitch;
    // eye scan
    this.eye.position.x = Math.sin(t * 2.2) * 0.9;
    this.eyeMat.color.setHSL(0.99, 1, 0.5 + 0.1 * Math.sin(t * 9));
    // core shutters
    this.coreOpen += (this.coreOpenTarget - this.coreOpen) * Math.min(1, dt * 4);
    this.shutterL.position.x = -0.5 - this.coreOpen * 0.75;
    this.shutterR.position.x = 0.5 + this.coreOpen * 0.75;
    this.coreMat.emissiveIntensity = 0.8 + this.coreOpen * 3.5 + Math.sin(t * 6) * 0.4 * this.coreOpen;
    this.coreLight.intensity = this.coreOpen * 60;
    this.emberLight.intensity = 3 + Math.sin(t * 5.3) * 1.5;
  }

  /** world position helper */
  worldPos(o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
    return o.getWorldPosition(out);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
