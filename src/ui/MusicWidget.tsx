import { useEffect, useState } from 'react';
import { audio } from '@/game/audio';
import type { MusicState } from '@/game/audio/api';
import { useStore, setSettings } from '@/state/store';
import { S } from '@/data/strings';
import { IPrev, IPlay, IPause, IStop, INext } from './icons';

function fmt(t: number): string {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** the saved track and play state are restored once per session, not by every widget that mounts */
let restored = false;

/** Winamp 2.81 — the house player. Restored from settings once, collapsible; `inline` sits inside a panel (pause). */
export function MusicWidget({ mini = false, docked = false, inline = false }: { mini?: boolean; docked?: boolean; inline?: boolean }) {
  const settings = useStore((s) => s.save.settings);
  const [st, setSt] = useState<MusicState>(audio.music.state);
  const [collapsed, setCollapsed] = useState(mini);
  useEffect(() => audio.music.subscribe(setSt), []);
  useEffect(() => {
    audio.music.setDsp(settings.dsp);
  }, [settings.dsp]);
  useEffect(() => {
    // restore track + play state once per session: a widget that mounts later (results, pause, menu) must not
    // jump back to the saved track while the playlist has moved on during a race
    if (restored) return;
    restored = true;
    if (settings.musicPlaying) audio.music.play(settings.musicTrack);
    else audio.music.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (st.index !== settings.musicTrack || st.playing !== settings.musicPlaying) setSettings({ musicTrack: st.index, musicPlaying: st.playing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.index, st.playing]);
  const tr = st.track;
  const title = tr.title ? `${st.index + 1}. ${tr.artist} — ${tr.title}` : '—';
  return (
    <div className={`wa ${st.playing ? '' : 'paused'} ${collapsed ? 'mini' : ''} ${docked ? 'docked' : ''} ${inline ? 'inline' : ''}`}>
      <div className="tb">
        <b>{S.player.title}</b>
        <button onClick={() => setCollapsed(!collapsed)} aria-label="toggle">{collapsed ? '▴' : '▾'}</button>
      </div>
      <div className="lcd">
        <div className="time">{fmt(st.time)}</div>
        {!collapsed && (
          <div className="bars">
            {st.bars.map((b, i) => (
              <i key={i} style={{ height: `${Math.max(6, b * 100)}%` }} />
            ))}
          </div>
        )}
        <div className="marq"><span>{title}</span></div>
      </div>
      <div className="ctl">
        <button onClick={() => audio.music.prev()} title={S.player.prev}><IPrev /></button>
        <button onClick={() => { audio.unlock(); audio.music.play(); }} title={S.player.play}><IPlay /></button>
        <button onClick={() => audio.music.pause()} title={S.player.pause}><IPause /></button>
        <button onClick={() => { audio.music.pause(); audio.music.seek(0); }} title="stop"><IStop /></button>
        <button onClick={() => audio.music.next()} title={S.player.next}><INext /></button>
      </div>
      {!collapsed && (
        <>
          <div className="vol">
            <span>{S.player.vol}</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.music} onChange={(e) => setSettings({ music: Number(e.target.value) })} />
            <span>{Math.round(settings.music * 100)}%</span>
          </div>
          <div className="dsp">
            <button className={settings.dsp.bass ? 'on' : ''} onClick={() => setSettings({ dsp: { ...settings.dsp, bass: !settings.dsp.bass } })}>{S.player.bass}</button>
            <button className={settings.dsp.mode === 'nightcore' ? 'on' : ''} onClick={() => setSettings({ dsp: { ...settings.dsp, mode: settings.dsp.mode === 'nightcore' ? 'normal' : 'nightcore' } })}>{S.player.nightcore}</button>
            <button className={settings.dsp.mode === 'slowed' ? 'on' : ''} onClick={() => setSettings({ dsp: { ...settings.dsp, mode: settings.dsp.mode === 'slowed' ? 'normal' : 'slowed' } })}>{S.player.slowed}</button>
          </div>
        </>
      )}
    </div>
  );
}
