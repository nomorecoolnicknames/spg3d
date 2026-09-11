import { useEffect, useRef, useState } from 'react';
import { useStore, setPaused, goto, restartSession, getState } from '@/state/store';
import { useIsTouchLayout } from './screens/Misc';
import type { BossHUD as BossHUDState, GameEvent, RaceHUD as RaceHUDState } from '@/game/types';
import { TRACK_BY_ID } from '@/data/tracks';
import { S } from '@/data/strings';
import { TrackData } from '@/game/world/TrackData';
import { fmtTime, click } from './common';
import { IPause } from './icons';

/** Event bus from GameHost → HUD (messages, drift popups). */
type Listener = (e: GameEvent) => void;
const listeners = new Set<Listener>();
export function emitHudEvent(e: GameEvent): void {
  for (const l of listeners) l(e);
}
function useHudEvents(cb: Listener): void {
  useEffect(() => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, [cb]);
}

interface Msg {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'good' | 'big';
}

// ───────────────────────────────────────────── Race HUD
export function RaceHUD({ hud }: { hud: RaceHUDState }) {
  const race = useStore((s) => s.race);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [drift, setDrift] = useState<{ pts: number; combo: number; id: number } | null>(null);
  const idRef = useRef(0);
  const push = (text: string, tone: Msg['tone'] = 'info', ms = 2200) => {
    const id = ++idRef.current;
    setMsgs((m) => [...m.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), ms);
  };
  useHudEvents((e) => {
    if (e.type === 'lap') push(e.lap >= e.total ? S.race.finish : e.best && e.lap > 1 ? `${S.race.newBest} ${fmtTime(e.lapTime)}` : `${S.race.lap} ${e.lap} · ${fmtTime(e.lapTime)}`, e.best ? 'good' : 'info');
    else if (e.type === 'message') push(e.text, e.tone ?? 'info');
    else if (e.type === 'drift-end') {
      const id = ++idRef.current;
      setDrift({ pts: e.points, combo: e.combo, id });
      window.setTimeout(() => setDrift((d) => (d && d.id === id ? null : d)), 1400);
    } else if (e.type === 'finish') push(S.race.finish, 'big', 3000);
  });
  const track = race ? TRACK_BY_ID[race.trackId] : null;
  return (
    <div className="hud">
      <div className="hud-tl">
        <div className="lp">
          <div className="box cell">
            <div className="k">{S.race.lap}</div>
            <div className="v">
              {hud.lap}
              <small>/{hud.totalLaps}</small>
            </div>
          </div>
          {!hud.timeAttack && (
            <div className="box cell pos">
              <div className="k">{S.race.pos}</div>
              <div className="v">
                {hud.position}
                <small>/{hud.racers}</small>
              </div>
            </div>
          )}
        </div>
        {!hud.timeAttack && hud.leaderboard.length > 1 && (
          <div className="box lb">
            {hud.leaderboard.map((e, i) => (
              <div key={e.name} className={`r ${e.isPlayer ? 'me' : ''}`}>
                <span className="p">{i + 1}</span>
                <i style={{ background: e.color }} />
                <span className="n">{e.name}</span>
                <span className="g">{i === 0 ? S.race.leader : `+${e.gap} ${S.common.m}`}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="hud-tr">
        <div className="box times">
          <div className="big">{fmtTime(hud.raceTime)}</div>
          <div className="row"><span>{S.race.lapTime}</span><b>{fmtTime(hud.lapTime)}</b></div>
          <div className="row"><span>{S.race.best}</span><b className="best">{fmtTime(hud.bestLap)}</b></div>
          {hud.lastLap != null && <div className="row"><span>{S.race.last}</span><b>{fmtTime(hud.lastLap)}</b></div>}
        </div>
        {hud.split != null && <div className={`box split ${hud.split <= 0 ? 'neg' : 'pos'}`}>{hud.split <= 0 ? '−' : '+'}{Math.abs(hud.split).toFixed(2)}</div>}
        {track && <Minimap track={track} dots={hud.minimap} />}
      </div>
      <div className="hud-br">
        {hud.driftChain > 0 && (
          <div className="drift-pop" style={{ position: 'static', transform: 'none' }}>
            <div className="pts">
              {hud.driftChain.toLocaleString('ru-RU')}
              {hud.driftCombo > 1 && <b>×{hud.driftCombo}</b>}
            </div>
            <div className="k">{S.race.drift}</div>
          </div>
        )}
        <Speedo hud={hud} />
        <div className="nitro">
          <div className={`bar ${hud.nitroActive ? 'on' : ''}`}>
            <i style={{ width: `${hud.nitro}%` }} />
          </div>
          <div className="k">{S.race.nitro} · Shift</div>
        </div>
      </div>
      <div className="hud-center">
        {hud.countdown !== null && (
          <div key={String(hud.countdown)} className={`count ${hud.countdown === 'go' ? 'go' : ''}`}>
            {hud.countdown === 'go' ? S.race.go : hud.countdown}
          </div>
        )}
        {hud.wrongWay && <div className="msg warn">{S.race.wrongWay}</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.tone}`}>{m.text}</div>
        ))}
        {drift && (
          <div key={drift.id} className="drift-pop end" style={{ position: 'static', transform: 'none' }}>
            <div className="pts">
              +{drift.pts.toLocaleString('ru-RU')}
              {drift.combo > 1 && <b>×{drift.combo}</b>}
            </div>
            <div className="k">{S.race.drift}</div>
          </div>
        )}
      </div>
      <button className="box pause-btn" onClick={() => { click(); setPaused(true); }}>
        <IPause style={{ width: 10, height: 10, verticalAlign: -1, marginRight: 6 }} />
        {S.race.pause}
      </button>
    </div>
  );
}

function Speedo({ hud }: { hud: RaceHUDState }) {
  // arc gauge: 240° sweep, rpm needle + speed fill
  const R = 62, cx = 120, cy = 96;
  const a0 = Math.PI * 0.85, a1 = Math.PI * 2.15;
  const arc = (from: number, to: number, r: number) => {
    const x0 = cx + Math.cos(from) * r, y0 = cy + Math.sin(from) * r, x1 = cx + Math.cos(to) * r, y1 = cy + Math.sin(to) * r;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const rpmA = a0 + (a1 - a0) * Math.min(1, hud.rpm);
  const red = hud.rpm > 0.9;
  return (
    <div className="speedo">
      <svg viewBox="0 0 240 150">
        <path d={arc(a0, a1, R)} stroke="rgba(255,255,255,0.12)" strokeWidth="8" fill="none" />
        <path d={arc(a0 + (a1 - a0) * 0.85, a1, R)} stroke="rgba(229,35,58,0.35)" strokeWidth="8" fill="none" />
        <path d={arc(a0, Math.max(a0 + 0.001, rpmA), R)} stroke={red ? '#e5233a' : hud.nitroActive ? '#2ee6ff' : '#f2f3f7'} strokeWidth="8" fill="none" style={{ filter: red ? 'drop-shadow(0 0 6px #e5233a)' : undefined }} />
        {Array.from({ length: 9 }).map((_, i) => {
          const a = a0 + ((a1 - a0) * i) / 8;
          return <line key={i} x1={cx + Math.cos(a) * (R - 8)} y1={cy + Math.sin(a) * (R - 8)} x2={cx + Math.cos(a) * (R - 13)} y2={cy + Math.sin(a) * (R - 13)} stroke="rgba(255,255,255,0.5)" strokeWidth="2" />;
        })}
      </svg>
      <div className="gear">
        <small>ПЕРЕДАЧА</small>
        {hud.gear === 0 ? 'R' : hud.gear}
      </div>
      <div className="kmh">
        <b className={hud.nitroActive ? 'nitro' : ''}>{hud.speedKmh}</b>
        <small>{S.common.kmh}</small>
      </div>
    </div>
  );
}

function Minimap({ track, dots }: { track: { id: string }; dots: RaceHUDState['minimap'] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pathRef = useRef<{ x: number; y: number }[] | null>(null);
  const idRef = useRef('');
  useEffect(() => {
    if (idRef.current !== track.id) {
      pathRef.current = new TrackData(TRACK_BY_ID[track.id]).minimap(5);
      idRef.current = track.id;
    }
    const c = ref.current;
    if (!c || !pathRef.current) return;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const px = (x: number) => ((x + 1) / 2) * (W - 28) + 14;
    const py = (y: number) => ((y + 1) / 2) * (H - 28) + 14;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pathRef.current.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.x), py(p.y)) : ctx.lineTo(px(p.x), py(p.y))));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 4;
    ctx.stroke();
    const s0 = pathRef.current[0];
    ctx.fillStyle = '#fff';
    ctx.fillRect(px(s0.x) - 3, py(s0.y) - 3, 6, 6);
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(px(d.x), py(d.y), d.isPlayer ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = d.isPlayer ? 2.5 : 1;
      ctx.strokeStyle = d.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }, [track.id, dots]);
  return (
    <div className="box minimap">
      <canvas ref={ref} width={150} height={150} />
    </div>
  );
}

// ───────────────────────────────────────────── Boss HUD
export function BossHUD({ hud }: { hud: BossHUDState }) {
  const touch = useStore((s) => s.isTouch);
  return (
    <div className="hud">
      <div className="boss-top">
        <div className="nm">
          <b>{hud.bossName}</b>
          <span>{S.boss.sub} · {fmtTime(hud.timer)}</span>
        </div>
        <div className="hp">
          <i style={{ width: `${hud.bossHP}%` }} />
        </div>
        <div className="phases">
          {S.boss.phases.map((p, i) => (
            <span key={p} className={i + 1 === hud.bossPhase ? 'on' : i + 1 < hud.bossPhase ? 'done' : ''}>{p}</span>
          ))}
        </div>
        {hud.coreExposed && <div className="core-label">{S.boss.core}</div>}
        {hud.message && !hud.coreExposed && <div className="msg warn" style={{ textAlign: 'center', fontSize: 20 }}>{hud.message}</div>}
      </div>
      <div className="boss-bl">
        <div className="k"><span>{S.boss.hp}</span><span>{hud.playerHP}</span></div>
        <div className="hp">
          <i className={hud.playerHP < 30 ? 'low' : ''} style={{ width: `${hud.playerHP}%` }} />
        </div>
        <div className="k"><span>{S.boss.reload}</span><span>{hud.ammoReady ? '●' : `${Math.round(hud.reload * 100)}%`}</span></div>
        <div className="hp">
          <i style={{ width: `${hud.reload * 100}%`, background: hud.ammoReady ? 'var(--cyan)' : 'rgba(255,255,255,0.35)' }} />
        </div>
      </div>
      <div className="boss-br">
        <div className="mn">{S.boss.minions}<b>{hud.minions}</b></div>
      </div>
      {!hud.intro && !hud.dead && !hud.won && (
        <div className="crosshair">
          <svg viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="14" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
            <circle cx="32" cy="32" r={13 * hud.reload} fill="none" stroke={hud.ammoReady ? '#2ee6ff' : '#e5233a'} strokeWidth="2" strokeDasharray={`${2 * Math.PI * 13 * hud.reload} 999`} transform="rotate(-90 32 32)" />
            <path d="M32 6v10M32 48v10M6 32h10M48 32h10" stroke="#fff" strokeWidth="2" />
            <circle cx="32" cy="32" r="1.6" fill="#fff" />
          </svg>
        </div>
      )}
      <div className="vignette" style={{ opacity: hud.hitFlash * 0.9 + (hud.playerHP < 30 && !hud.dead ? 0.25 : 0) }} />
      {hud.intro && (
        <div className="boss-intro">
          <div className="t">{S.boss.intro}</div>
          <div className="c">{touch ? S.boss.controlsTouch : S.boss.controls}</div>
        </div>
      )}
      {hud.dead && (
        <div className="overlay dead">
          <div className="box">
            <h2>{S.boss.dead}</h2>
            <button className="btn primary" onClick={() => { click(); (window.__spg.knobs.scene?.() as { retry?: () => void } | undefined)?.retry?.(); }}>
              {S.boss.retry}
            </button>
            <button className="btn ghost" onClick={() => { click(); goto('career'); }}>{S.race.quit}</button>
          </div>
        </div>
      )}
      {hud.won && (
        <div className="hud-center">
          <div className="msg big">{S.results.bossWin}</div>
        </div>
      )}
      <button className="box pause-btn" onClick={() => { click(); setPaused(true); }}>
        <IPause style={{ width: 10, height: 10, verticalAlign: -1, marginRight: 6 }} />
        {S.race.pause}
      </button>
    </div>
  );
}

// ───────────────────────────────────────────── Pause
export function PauseOverlay() {
  const screen = useStore((s) => s.screen);
  const touch = useIsTouchLayout();
  return (
    <div className="overlay">
      <div className="box">
        <h2>{S.race.pause}</h2>
        <button className="btn primary" onClick={() => { click(); setPaused(false); }}>{S.race.resume}</button>
        <button className="btn" onClick={() => { click(); setPaused(false); restartSession(); }}>{S.race.restart}</button>
        <button className="btn ghost" onClick={() => { click(); setPaused(false); goto(getState().race?.career || screen === 'boss' ? 'career' : 'menu'); }}>{S.race.quit}</button>
        <div className="keys">{screen === 'boss' ? (touch ? S.boss.controlsTouch : S.boss.controls) : touch ? S.menu.controlsTouch : S.menu.controls}</div>
      </div>
    </div>
  );
}
