import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CARS } from '@/data/cars';

import bmw2018Url from '@/assets/cars/BMW_2018.glb';
import supraUrl from '@/assets/cars/toyota_supra_mk4_a80.glb';
import lanciaUrl from '@/assets/cars/lancia_037_stradale_1978.glb';
import bmwM8Url from '@/assets/cars/2020_bmw_m8.glb';
import gt40Url from '@/assets/cars/ford_gt40.glb';
import bolideUrl from '@/assets/cars/bugatti_bolide_2024.glb';
import bmw2018Lod from '@/assets/cars-lod/BMW_2018.glb';
import supraLod from '@/assets/cars-lod/toyota_supra_mk4_a80.glb';
import lanciaLod from '@/assets/cars-lod/lancia_037_stradale_1978.glb';
import bmwM8Lod from '@/assets/cars-lod/2020_bmw_m8.glb';
import gt40Lod from '@/assets/cars-lod/ford_gt40.glb';
import bolideLod from '@/assets/cars-lod/bugatti_bolide_2024.glb';
import xbotUrl from '@/assets/Xbot.glb';
import { getState } from '@/state/store';
import madkidFaceUrl from '@/assets/madk1d_face_big.jpg';

/**
 * Central asset registry. Everything heavy is loaded once, progress is byte-based
 * (no fake percentages). Consumers clone scenes; never mutate the cached originals.
 */
const MODEL_URLS_HI: Record<string, string> = {
  BMW_2018: bmw2018Url,
  toyota_supra_mk4_a80: supraUrl,
  lancia_037_stradale_1978: lanciaUrl,
  '2020_bmw_m8': bmwM8Url,
  ford_gt40: gt40Url,
  bugatti_bolide_2024: bolideUrl,
  Xbot: xbotUrl,
};
// low quality (phones): ~5x fewer triangles, 512 px textures
const MODEL_URLS_LOD: Record<string, string> = {
  BMW_2018: bmw2018Lod,
  toyota_supra_mk4_a80: supraLod,
  lancia_037_stradale_1978: lanciaLod,
  '2020_bmw_m8': bmwM8Lod,
  ford_gt40: gt40Lod,
  bugatti_bolide_2024: bolideLod,
  Xbot: xbotUrl,
};
const MODEL_URLS = getState().save.settings.quality === 'low' ? MODEL_URLS_LOD : MODEL_URLS_HI;

const gltfs = new Map<string, GLTF>();
const textures = new Map<string, THREE.Texture>();
const progressListeners = new Set<(p: number) => void>();
let progress = 0;
let loadingPromise: Promise<void> | null = null;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export function onAssetProgress(cb: (p: number) => void): () => void {
  progressListeners.add(cb);
  cb(progress);
  return () => {
    progressListeners.delete(cb);
  };
}

function setProgress(p: number): void {
  progress = Math.min(1, p);
  for (const l of progressListeners) l(progress);
}

export function assetsReady(): boolean {
  return progress >= 1;
}

export function getGLTF(key: string): GLTF | undefined {
  return gltfs.get(key);
}

export function getTexture(key: string): THREE.Texture | undefined {
  return textures.get(key);
}

/** Loads all models + textures. Safe to call multiple times. */
export function loadAllAssets(): Promise<void> {
  if (loadingPromise) return loadingPromise;
  const keys = Object.keys(MODEL_URLS);
  const loaded: Record<string, number> = {};
  const total: Record<string, number> = {};
  // rough size priors (bytes) so the bar moves sensibly before Content-Length arrives
  for (const k of keys) {
    loaded[k] = 0;
    total[k] = 3_000_000;
  }
  const bump = () => {
    let l = 0, t = 0;
    for (const k of keys) {
      l += loaded[k];
      t += total[k];
    }
    setProgress(t > 0 ? (l / t) * 0.98 : 0);
  };
  const tasks = keys.map(
    (k) =>
      new Promise<void>((resolve) => {
        loader.load(
          MODEL_URLS[k],
          (g) => {
            gltfs.set(k, g);
            loaded[k] = total[k];
            bump();
            resolve();
          },
          (ev) => {
            if (ev.total > 0) total[k] = ev.total;
            loaded[k] = Math.min(ev.loaded, total[k]);
            bump();
          },
          (err) => {
            console.error('asset load failed', k, err);
            loaded[k] = total[k];
            bump();
            resolve();
          },
        );
      }),
  );
  const tex = new Promise<void>((resolve) => {
    new THREE.TextureLoader().load(
      madkidFaceUrl,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        textures.set('madkidFace', t);
        resolve();
      },
      undefined,
      () => resolve(),
    );
  });
  loadingPromise = Promise.all([...tasks, tex]).then(() => setProgress(1));
  return loadingPromise;
}

/** Model asset keys referenced by the car roster (sanity for QA). */
export const CAR_MODEL_KEYS = CARS.map((c) => c.model);
