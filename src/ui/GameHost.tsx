// Owner: core. Mounts the persistent WebGL viewport and swaps scene controllers with the screen.
import { useEffect, useRef } from 'react';
import { viewport } from '@/game/Viewport';
import { input } from '@/game/input/Input';
import { useStore, getState, setHUD, finishSession, setPaused, toast } from '@/state/store';
import { RaceScene } from '@/game/race/RaceScene';
import { BossScene } from '@/game/boss/BossScene';
import { ShowcaseScene } from '@/game/menu/ShowcaseScene';
import { audio } from '@/game/audio';
import type { GameEvent, SceneCallbacks } from '@/game/types';

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
    }
    return () => input.detach();
  }, []);

  useEffect(() => {
    viewport.setQuality({
      level: settings.quality,
      shadows: settings.shadows,
      bloom: settings.bloom,
      reflections: settings.reflections,
      pixelRatio: settings.quality === 'low' ? 1 : settings.quality === 'medium' ? Math.min(1.5, window.devicePixelRatio || 1) : Math.min(2, window.devicePixelRatio || 1),
    });
    audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx, engine: settings.engine });
    input.invertY = settings.invertY;
  }, [settings]);

  useEffect(() => {
    const cb: SceneCallbacks = {
      onHUD: setHUD,
      onEvent: (e: GameEvent) => {
        if (e.type === 'message') toast(e.text, e.tone ?? 'info');
      },
      onFinish: finishSession,
    };
    if (screen === 'race') {
      const p = getState().race;
      if (!p) return;
      showcaseRef.current = null;
      const scene = new RaceScene(p, cb);
      viewport.setController(scene);
      window.__spg.knobs.scene = () => scene;
    } else if (screen === 'boss') {
      const p = getState().boss;
      if (!p) return;
      showcaseRef.current = null;
      const scene = new BossScene(p, cb);
      viewport.setController(scene);
      window.__spg.knobs.scene = () => scene;
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
    input.enabled = !paused;
  }, [paused]);

  useEffect(() => {
    return input.onAction((a) => {
      const s = getState();
      if (a === 'pause' && (s.screen === 'race' || s.screen === 'boss')) setPaused(!s.paused);
      if (a === 'camera' && s.screen === 'race') (viewport.getController() as RaceScene | null)?.setCameraMode?.(-1);
      if (a === 'respawn' && s.screen === 'race') (viewport.getController() as RaceScene | null)?.respawn?.();
    });
  }, []);

  return <div ref={ref} className="spg-viewport" />;
}
