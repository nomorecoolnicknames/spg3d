import { useEffect } from 'react';
import { useStore, setLoadProgress, goto } from '@/state/store';
import { loadAllAssets, onAssetProgress } from '@/game/assets';
import { debugBootRouting } from '@/game/debug';
import { audio } from '@/game/audio';
import { GameHost } from '@/ui/GameHost';
import { Boot, Menu } from '@/ui/screens/Menu';
import { Career } from '@/ui/screens/Career';
import { Quick } from '@/ui/screens/Quick';
import { Garage } from '@/ui/screens/Garage';
import { Records, Settings, Story, Results, useIsTouchLayout } from '@/ui/screens/Misc';
import { RaceHUD, BossHUD, PauseOverlay } from '@/ui/HUD';
import { RaceTouch, BossTouch } from '@/ui/TouchControls';
import { MusicWidget } from '@/ui/MusicWidget';
import { PerfOverlay } from '@/ui/PerfOverlay';

export default function App() {
  const screen = useStore((s) => s.screen);
  const hud = useStore((s) => s.hud);
  const paused = useStore((s) => s.paused);
  const toast = useStore((s) => s.toast);
  const touch = useIsTouchLayout();
  const inGame = screen === 'race' || screen === 'boss';

  useEffect(() => {
    const off = onAssetProgress(setLoadProgress);
    void loadAllAssets().then(() => {
      goto('menu');
      debugBootRouting();
    });
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      off();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('in-game', inGame);
    document.body.classList.toggle('touch-race', touch && screen === 'race');
    document.body.classList.toggle('touch-boss', touch && screen === 'boss');
  }, [inGame, touch, screen]);

  return (
    <>
      <GameHost />
      {screen === 'boot' && <Boot />}
      {screen === 'menu' && <Menu />}
      {screen === 'career' && <Career />}
      {screen === 'quick' && <Quick />}
      {screen === 'garage' && <Garage />}
      {screen === 'records' && <Records />}
      {screen === 'settings' && <Settings />}
      {screen === 'story' && <Story />}
      {screen === 'results' && <Results />}
      {screen === 'race' && hud?.kind === 'race' && <RaceHUD hud={hud} />}
      {screen === 'boss' && hud?.kind === 'boss' && <BossHUD hud={hud} />}
      {screen === 'race' && touch && !paused && <RaceTouch />}
      {screen === 'boss' && touch && !paused && hud?.kind === 'boss' && !hud.dead && !hud.intro && <BossTouch />}
      {inGame && paused && <PauseOverlay />}
      {toast && (
        <div className="toasts">
          <div key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</div>
        </div>
      )}
      {(screen === 'menu' || screen === 'results' || (inGame && paused)) && <MusicWidget mini={screen !== 'menu'} />}
      <PerfOverlay />
    </>
  );
}
