import { useEffect, useState } from 'react';
import { useStore, goto, setState, getState } from '@/state/store';
import { S } from '@/data/strings';
import { CAREER } from '@/data/story';
import logoUrl from '@/assets/logo.jpg';
import { IFlag, ICar, IWrench, ITrophy, ISettings, IMusic } from '../icons';
import { Balance, click } from '../common';
import type { ScreenId } from '@/game/types';
import { useIsTouchLayout } from './Misc';
import { audio } from '@/game/audio';

const ITEMS: { id: ScreenId; t: string; h: string; icon: typeof IFlag }[] = [
  { id: 'career', t: S.menu.career, h: S.menu.careerHint, icon: IFlag },
  { id: 'quick', t: S.menu.quick, h: S.menu.quickHint, icon: ICar },
  { id: 'garage', t: S.menu.garage, h: S.menu.garageHint, icon: IWrench },
  { id: 'records', t: S.menu.records, h: S.menu.recordsHint, icon: ITrophy },
  { id: 'settings', t: S.menu.settings, h: S.menu.settingsHint, icon: ISettings },
];

export function Boot() {
  const p = useStore((s) => s.loadProgress);
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % S.boot.tips.length), 3200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="ui-layer solid">
      <div className="screen boot">
        <img src={logoUrl} alt={S.title} />
        <div className="progress">
          <i style={{ width: `${Math.round(p * 100)}%` }} />
        </div>
        <div className="label">
          {S.boot.loading} <b>{Math.round(p * 100)}%</b>
        </div>
        <div className="tip">{S.boot.tips[tip]}</div>
        <div className="ver">{S.version}</div>
      </div>
    </div>
  );
}

export function Menu() {
  const wins = useStore((s) => s.save.careerWins.length);
  const touch = useIsTouchLayout();
  const playerOpen = useStore((s) => s.playerOpen);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowDown' || e.code === 'KeyS') setActive((a) => (a + 1) % ITEMS.length);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') setActive((a) => (a - 1 + ITEMS.length) % ITEMS.length);
      else if (e.code === 'Enter' || e.code === 'Space') {
        click();
        goto(ITEMS[active].id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  return (
    <div className="ui-layer tint stripes">
      {/* always on screen, whatever the height: player toggle and settings */}
      <div className="menu-tools">
        <button className={`tool ${playerOpen ? 'on' : ''}`} onClick={() => { click(); audio.unlock(); setState({ playerOpen: !playerOpen }); }}>
          <IMusic />
          <span>{S.menu.player}</span>
        </button>
        <button className="tool" onClick={() => { click(); goto('settings'); }}>
          <ISettings />
          <span>{S.menu.settings}</span>
        </button>
      </div>
      <div className="screen menu">
        <img className="menu-logo" src={logoUrl} alt={S.title} />
        <div className="menu-tagline">{S.tagline}</div>
        <nav className="menu-list">
          {ITEMS.map((it, i) => (
            <button
              key={it.id}
              className={`menu-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => {
                setActive(i);
                audio.play('ui-hover', { gain: 0.25 });
              }}
              onClick={() => {
                click();
                audio.unlock();
                if (it.id === 'garage') setState({ garageCar: getState().save.selectedCar });
                goto(it.id);
              }}
            >
              <it.icon />
              <span className="t">{it.t}</span>
              <span className="h">{it.h}</span>
            </button>
          ))}
        </nav>
        <div className="menu-strip">
          <Balance />
          <div className="balance" style={{ color: 'var(--cyan)', background: 'var(--cyan-dim)' }}>
            {wins} / {CAREER.length}
            <small>{S.menu.wins}</small>
          </div>
        </div>
        <div className="menu-foot">
          <div className="keys">{touch ? S.menu.controlsTouch : S.menu.controls}</div>
        </div>
      </div>
    </div>
  );
}
