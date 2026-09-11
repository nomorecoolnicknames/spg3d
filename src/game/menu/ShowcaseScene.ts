import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneController, Viewport } from '../Viewport';
import { createCarVisual, type CarVisual } from '../vehicle/CarVisual';
import { CAR_BY_ID, CARS } from '@/data/cars';
import { groundTexture } from '../world/textures';

/**
 * Menu / garage backdrop: a car on a dark studio floor with a light ring, slow turntable,
 * key + rim lights and a glossy floor. `show()` swaps the car with a short fade.
 */
export class ShowcaseScene implements SceneController {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private car: CarVisual | null = null;
  private carId = '';
  private color = '';
  private mode: 'menu' | 'garage' = 'menu';
  private t = 0;
  private ring!: THREE.Mesh;
  private pmrem: THREE.Texture | null = null;
  private floorTex: THREE.Texture | null = null;
  private disposables: (THREE.Material | THREE.BufferGeometry)[] = [];
  private fade = 1;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(7, 2.2, 7);

  start(vp: Viewport): void {
    const pm = new THREE.PMREMGenerator(vp.renderer);
    this.pmrem = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.pmrem;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#07070b');
    this.scene.fog = new THREE.Fog('#07070b', 14, 60);

    this.floorTex = groundTexture('#101116', 18);
    this.floorTex.repeat.set(12, 12);
    const floorMat = new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.28, metalness: 0.55, envMapIntensity: 1.2 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.disposables.push(floorMat, floor.geometry);

    const ringMat = new THREE.MeshBasicMaterial({ color: '#e5233a', toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(4.1, 4.22, 96), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.scene.add(this.ring);
    this.disposables.push(ringMat, this.ring.geometry);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: '#2ee6ff', toneMapped: false, transparent: true, opacity: 0.5 });
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.64, 96), ring2Mat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.012;
    this.scene.add(ring2);
    this.disposables.push(ring2Mat, ring2.geometry);

    const key = new THREE.SpotLight('#fff4e6', 900, 40, 0.5, 0.5, 1.6);
    key.position.set(6, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    const rim = new THREE.SpotLight('#2ee6ff', 500, 40, 0.6, 0.6, 1.6);
    rim.position.set(-7, 5, -6);
    const fill = new THREE.SpotLight('#e5233a', 260, 40, 0.8, 0.7, 1.6);
    fill.position.set(-3, 3, 7);
    for (const l of [key, rim, fill]) {
      l.target.position.set(0, 0.6, 0);
      this.scene.add(l, l.target);
    }
    this.scene.add(new THREE.AmbientLight('#404860', 0.5));
    // back wall with vertical light strips
    const stripMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.12 });
    for (let i = -4; i <= 4; i++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 8), stripMat);
      strip.position.set(i * 3.2, 4, -14);
      this.scene.add(strip);
      this.disposables.push(strip.geometry);
    }
    this.disposables.push(stripMat);
    this.camera.aspect = vp.width / vp.height;
    this.camera.updateProjectionMatrix();
  }

  show(carId: string, color: string, mode: 'menu' | 'garage'): void {
    const spec = CAR_BY_ID[carId] ?? CARS[0];
    const col = color || spec.colors[0];
    this.mode = mode;
    if (this.car && this.carId === carId) {
      if (this.color !== col) {
        this.car.setPaint(col);
        this.color = col;
      }
      return;
    }
    if (this.car) {
      this.scene.remove(this.car.root);
      this.car.dispose();
    }
    this.car = createCarVisual(spec, col, { player: false, shadows: true, night: false });
    this.car.setHeadlights(true);
    this.scene.add(this.car.root);
    this.carId = carId;
    this.color = col;
    this.fade = 0;
  }

  update(dt: number): void {
    this.t += dt;
    this.fade = Math.min(1, this.fade + dt * 2.5);
    if (this.car) {
      this.car.root.rotation.y = this.mode === 'garage' ? this.t * 0.35 : 0.65 + Math.sin(this.t * 0.25) * 0.12;
      this.car.root.position.y = (1 - this.fade) * -0.15;
    }
    this.ring.rotation.z = this.t * 0.2;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHSL(0.98, 0.85, 0.5 + 0.08 * Math.sin(this.t * 2));
    // camera: menu = car on the right side, low 3/4; garage = centered, orbiting slightly
    const target = this.mode === 'garage' ? this.camTarget.set(0, 0.7, 0) : this.camTarget.set(-1.6, 0.7, 0);
    const want = this.mode === 'garage' ? new THREE.Vector3(Math.sin(this.t * 0.12) * 6.8, 2.1, Math.cos(this.t * 0.12) * 6.8) : new THREE.Vector3(5.2, 1.6, 6.6);
    this.camPos.lerp(want, 1 - Math.exp(-dt * 2.5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(target);
  }

  render(vp: Viewport): void {
    vp.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.car) this.car.dispose();
    for (const d of this.disposables) d.dispose();
    this.pmrem?.dispose();
    this.floorTex?.dispose();
    this.scene.clear();
  }
}
