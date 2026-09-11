// Placeholder until the UI module lands. Shows load progress and the menu stub.
import { useEffect } from 'react';
import { useStore, setLoadProgress, goto } from '@/state/store';
import { loadAllAssets, onAssetProgress } from '@/game/assets';
import { debugBootRouting } from '@/game/debug';
import { GameHost } from '@/ui/GameHost';

export default function App() {
  const screen = useStore((s) => s.screen);
  const p = useStore((s) => s.loadProgress);
  useEffect(() => {
    const off = onAssetProgress(setLoadProgress);
    void loadAllAssets().then(() => {
      goto('menu');
      debugBootRouting();
    });
    return off;
  }, []);
  return (
    <>
      <GameHost />
      {screen === 'boot' && <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#fff' }}>Загрузка {Math.round(p * 100)}%</div>}
    </>
  );
}
