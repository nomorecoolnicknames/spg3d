import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CARS } from '@/data/cars';

import bmw2018Url from '@/assets/cars/BMW_2018.glb';
import supraUrl from '@/assets/cars/toyota_supra_mk4_a80.glb';
import lanciaUrl from '@/assets/cars/lancia_037_stradale_1978.glb';
import bmwM8Url from '@/assets/cars/2020_bmw_m8.glb';
import gt40Url from '@/assets/cars/ford_gt40.glb';
import bolideUrl from '@/assets/cars/bugatti_bolide_2024.glb';
import bmw2018Hd from '@/assets/cars/BMW_2018-hd.glb';
import supraHd from '@/assets/cars/toyota_supra_mk4_a80-hd.glb';
import lanciaHd from '@/assets/cars/lancia_037_stradale_1978-hd.glb';
import bmwM8Hd from '@/assets/cars/2020_bmw_m8-hd.glb';
import gt40Hd from '@/assets/cars/ford_gt40-hd.glb';
import bolideHd from '@/assets/cars/bugatti_bolide_2024-hd.glb';
import xbotUrl from '@/assets/Xbot.glb';
import xbotLodUrl from '@/assets/Xbot-lod.glb';
import madkidFaceUrl from '@/assets/madk1d_face_big.jpg';
import envNeon from '@/assets/env/neon.hdr?url';
import envCanyon from '@/assets/env/canyon.hdr?url';
import envAurora from '@/assets/env/aurora.hdr?url';
import envBoss from '@/assets/env/boss.hdr?url';
import envGarage from '@/assets/env/garage.hdr?url';
import asphaltAlbedoUrl from '@/assets/materials/asphalt_albedo.jpg';
import asphaltNormalUrl from '@/assets/materials/asphalt_normal.jpg';
import asphaltRoughUrl from '@/assets/materials/asphalt_rough.jpg';
import puddlesUrl from '@/assets/materials/puddles.jpg';
import rockAlbedoUrl from '@/assets/materials/rock_albedo.jpg';
import rockNormalUrl from '@/assets/materials/rock_normal.jpg';

/**
 * Central asset registry. Everything heavy is loaded once, progress is byte-based
 * (no fake percentages). Consumers clone scenes; never mutate the cached originals.
 *
 * Cars (scripts/build-cars.sh): <model>.glb = LOD0-2 with a 1024 atlas, loaded at boot;
 * <model>-hd.glb = LOD0 with a 2048 atlas, loaded on demand for the player's car on medium/high.
 */
const MODEL_URLS: Record<string, string> = {
  BMW_2018: bmw2018Url,
  toyota_supra_mk4_a80: supraUrl,
  lancia_037_stradale_1978: lanciaUrl,
  '2020_bmw_m8': bmwM8Url,
  ford_gt40: gt40Url,
  bugatti_bolide_2024: bolideUrl,
  Xbot: xbotUrl,
  // boss minions: 4k-triangle skin, clips come from Xbot (scripts/simplify-xbot.mjs)
  'Xbot-lod': xbotLodUrl,
};
const HD_URLS: Record<string, string> = {
  BMW_2018: bmw2018Hd,
  toyota_supra_mk4_a80: supraHd,
  lancia_037_stradale_1978: lanciaHd,
  '2020_bmw_m8': bmwM8Hd,
  ford_gt40: gt40Hd,
  bugatti_bolide_2024: bolideHd,
};

/** CC0 HDRIs (scripts/env-maps.sh) — reflections and image-based light; the visible sky is our own */
export type EnvName = 'neon' | 'canyon' | 'aurora' | 'boss' | 'garage';
const ENV_URLS: Record<EnvName, string> = { neon: envNeon, canyon: envCanyon, aurora: envAurora, boss: envBoss, garage: envGarage };

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
  // tiling surface textures (scripts/materials.sh): data textures, repeat-wrapped, mipmapped
  const surfaces = Object.entries({ asphaltAlbedo: asphaltAlbedoUrl, asphaltNormal: asphaltNormalUrl, asphaltRough: asphaltRoughUrl, puddles: puddlesUrl, rockAlbedo: rockAlbedoUrl, rockNormal: rockNormalUrl }).map(
    ([key, url]) =>
      new Promise<void>((resolve) => {
        new THREE.TextureLoader().load(
          url,
          (t) => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.colorSpace = THREE.NoColorSpace;
            t.anisotropy = 4;
            textures.set(key, t);
            resolve();
          },
          undefined,
          () => resolve(),
        );
      }),
  );
  const hdr = new HDRLoader().setDataType(THREE.HalfFloatType);
  const envs = (Object.keys(ENV_URLS) as EnvName[]).map(
    (name) =>
      new Promise<void>((resolve) => {
        hdr.load(
          ENV_URLS[name],
          (t) => {
            t.mapping = THREE.EquirectangularReflectionMapping;
            envSources.set(name, t);
            resolve();
          },
          undefined,
          (err) => {
            console.error('env load failed', name, err);
            resolve();
          },
        );
      }),
  );
  loadingPromise = Promise.all([...tasks, tex, ...envs, ...surfaces]).then(() => setProgress(1));
  return loadingPromise;
}

const envSources = new Map<EnvName, THREE.DataTexture>();
const envMaps = new Map<EnvName, THREE.Texture>();

/**
 * Prefiltered (PMREM) environment for a scene. Generated on first use and kept for the session —
 * scenes must not dispose it. Returns null if the HDRI failed to load.
 */
export function getEnvMap(renderer: THREE.WebGLRenderer, name: EnvName): THREE.Texture | null {
  const have = envMaps.get(name);
  if (have) return have;
  const src = envSources.get(name);
  if (!src) return null;
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(src);
  pm.dispose();
  src.dispose();
  envSources.delete(name);
  envMaps.set(name, rt.texture);
  return rt.texture;
}

const hdLoads = new Map<string, Promise<GLTF | undefined>>();

/** Loads `<model>-hd` once; resolves with undefined if it fails (callers keep the LOD atlas). */
export function loadHdCar(model: string): Promise<GLTF | undefined> {
  const key = `${model}-hd`;
  const have = gltfs.get(key);
  if (have) return Promise.resolve(have);
  let p = hdLoads.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const url = HD_URLS[model];
      if (!url) return resolve(undefined);
      loader.load(
        url,
        (g) => {
          gltfs.set(key, g);
          resolve(g);
        },
        undefined,
        (err) => {
          console.error('hd car load failed', model, err);
          resolve(undefined);
        },
      );
    });
    hdLoads.set(key, p);
  }
  return p;
}

/** Model asset keys referenced by the car roster (sanity for QA). */
export const CAR_MODEL_KEYS = CARS.map((c) => c.model);
