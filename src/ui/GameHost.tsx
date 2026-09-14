// Owner: core. Mounts the persistent WebGL viewport and swaps scene controllers with the screen.
import { useEffect, useRef } from 'react';
import { viewport } from '@/game/Viewport';
import { input } from '@/game/input/Input';
import { useStore, getState, setHUD, finishSession, setPaused, toast } from '@/state/store';
import { RaceScene } from '@/game/race/RaceScene';
import { TRACK_BY_ID } from '@/data/tracks';
import { getMapWorld, loadMapWorld } from '@/data/maps';
import { BossScene } from '@/game/boss/BossScene';
import { ShowcaseScene } from '@/game/menu/ShowcaseScene';
import { audio } from '@/game/audio';
import { S } from '@/data/strings';
import type { GameEvent, SceneCallbacks } from '@/game/types';
import { emitHudEvent } from '@/ui/HUD';
import { applyRefreshRate } from '@/game/perf';
import { autoTierAtBoot, startTierWatchdog } from '@/game/tier';

const SHOWCASE_SCREENS = new Set(['menu', 'garage', 'career', 'quick', 'records', 'settings', 'story', 'results']);

export function GameHost() {
  const ref = useRef<HTMLDivElement>(null);
  const screen = useStore((s) => s.screen);
  const sessionKey = useStore((s) => s.sessionKey);
  const garageCar = useStore((s) => s.garageCar);
  const paused = useStore((s) => s.paused);
  const settings = useStore((s) => s.save.settings);
  const showcaseRef = useRef<ShowcaseScene | null>(null);

  useEffect(() => {
    if (ref.current) {
      viewport.mount(ref.current);
      input.attach(ref.current);
      autoTierAtBoot();
      startTierWatchdog();
    }
    return () => input.detach();
  }, []);

  useEffect(() => {
    viewport.setQuality({
      level: settings.quality,
      shadows: settings.shadows,
      bloom: settings.bloom,
      reflections: settings.reflections,
      pixelRatio: Math.min(window.devicePixelRatio || 1, settings.quality === 'low' ? 1.25 : settings.quality === 'medium' ? 1.75 : 2),
    });
    viewport.fpsCap = settings.fpsCap;
    viewport.dynamicRes = settings.dynamicRes;
    applyRefreshRate(settings.fpsCap);
    audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx, engine: settings.engine });
    input.invertY = settings.invertY;
  }, [settings]);

  useEffect(() => {
    const cb: SceneCallbacks = {
      onHUD: setHUD,
      onEvent: (e: GameEvent) => {
        emitHudEvent(e);
        if (e.type === 'boss-phase') toast(`${S.boss.phaseMsg[e.phase - 1]}`, 'warn');
      },
      onFinish: finishSession,
    };
    if (screen === 'race') {
      const p = getState().race;
      if (!p) return;
      showcaseRef.current = null;
      const launch = () => {
        const scene = new RaceScene(p, cb);
        viewport.setController(scene);
        window.__spg.knobs.scene = () => scene;
      };
      // real-place maps fetch their world chunk first (a few hundred KB, cached for the session)
      const map = TRACK_BY_ID[p.trackId]?.map;
      if (!map || getMapWorld(map)) {
        launch();
        return;
      }
      let cancelled = false;
      loadMapWorld(map)
        .catch((err) => console.error('map load failed', map, err))
        .finally(() => {
          if (!cancelled) launch();
        });
      return () => {
        cancelled = true;
      };
    } else if (screen === 'boss') {
      const p = getState().boss;
      if (!p) return;
      showcaseRef.current = null;
      const launch = () => {
        const scene = new BossScene(p, cb);
        viewport.setController(scene);
        window.__spg.knobs.scene = () => scene;
      };
      // the final is fought in the yard of Ligovsky 50: it needs the Ligovsky map data
      if (getMapWorld('ligovsky')) {
        launch();
        return;
      }
      let cancelled = false;
      loadMapWorld('ligovsky')
        .catch((err) => console.error('map load failed', err))
        .finally(() => {
          if (!cancelled) launch();
        });
      return () => {
        cancelled = true;
      };
    } else if (SHOWCASE_SCREENS.has(screen)) {
      if (!showcaseRef.current) {
        showcaseRef.current = new ShowcaseScene();
        viewport.setController(showcaseRef.current);
      }
      const s = getState();
      const carId = screen === 'garage' ? garageCar : s.save.selectedCar;
      const color = s.save.colors[carId] ?? undefined;
      showcaseRef.current.show(carId, color ?? '', screen === 'garage' ? 'garage' : 'menu');
    }
  }, [screen, sessionKey, garageCar]);

  useEffect(() => {
    viewport.getController()?.setPaused?.(paused);
    viewport.wake();
    input.enabled = !paused;
  }, [paused]);

  useEffect(() => {
    return input.onAction((a) => {
      const s = getState();
      if (a === 'pause' && (s.screen === 'race' || s.screen === 'boss')) setPaused(!s.paused);
      if (a === 'camera' && s.screen === 'race') (viewport.getController() as RaceScene | null)?.setCameraMode?.(-1);
      if (a === 'respawn' && s.screen === 'race') (viewport.getController() as RaceScene | null)?.respawn?.();
      if (a === 'fly' && s.screen === 'race') (viewport.getController() as RaceScene | null)?.toggleFly?.();
    });
  }, []);

  return <div ref={ref} className={`spg-viewport${settings.quality === 'low' && !settings.bloom ? ' no-post' : ''}`} />;
}
