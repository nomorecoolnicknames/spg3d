import type { ReactNode } from 'react';
import { useStore, goto } from '@/state/store';
import type { ScreenId, TrackSpec } from '@/game/types';
import { S } from '@/data/strings';
import { IBack, ICoin, IStar } from './icons';
import { audio } from '@/game/audio';

export const fmtTime = (t: number | null | undefined): string => {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

export const money = S.common.money;

export function click(): void {
  audio.play('ui-click', { gain: 0.6 });
}

export function Balance() {
  const m = useStore((s) => s.save.money);
  return (
    <div className="balance">
      <ICoin />
      {money(m)}
      <small>{S.menu.balance}</small>
    </div>
  );
}

export function Screen({ title, back = 'menu', children, layer = 'tint', right, className = '' }: { title: string; back?: ScreenId | null; children: ReactNode; layer?: 'tint' | 'tint-right' | 'solid' | 'dim'; right?: ReactNode; className?: string }) {
  return (
    <div className={`ui-layer ${layer} stripes`}>
      <div className={`screen ${className}`}>
        <div className="screen-head">
          {back && (
            <button className="back-btn" onClick={() => { click(); goto(back); }}>
              <IBack />
              {S.common.back}
            </button>
          )}
          <h1>{title}</h1>
          <span className="spacer" />
          {right ?? <Balance />}
        </div>
        <div className="screen-body">{children}</div>
      </div>
    </div>
  );
}

export function Stars({ n, max = 3 }: { n: number; max?: number }) {
  return (
    <span className="stars">
      {Array.from({ length: max }).map((_, i) => (
        <IStar key={i} className={i < n ? '' : 'off'} />
      ))}
    </span>
  );
}

/** Track outline drawn from the control points (Catmull-Rom through them). */
export function TrackMap({ track, color = '#f2f3f7', className = 'map' }: { track: TrackSpec; color?: string; className?: string }) {
  const pts = track.points.map(([x, z]) => [x, z] as [number, number]);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ) || 1;
  const W = 140, H = 100, pad = 10;
  const sx = (x: number) => pad + ((x - minX) / span) * (W - pad * 2) + ((W - pad * 2) * (1 - (maxX - minX) / span)) / 2;
  const sz = (z: number) => pad + ((z - minZ) / span) * (H - pad * 2) + ((H - pad * 2) * (1 - (maxZ - minZ) / span)) / 2;
  // catmull-rom → bezier segments
  const n = pts.length;
  let d = `M ${sx(pts[0][0])} ${sz(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1z = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2z = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${sx(c1x)} ${sz(c1z)}, ${sx(c2x)} ${sz(c2z)}, ${sx(p2[0])} ${sz(p2[1])}`;
  }
  const th = track.theme;
  const g1 = th === 'city' ? '#1c1238' : th === 'desert' ? '#5a2a3a' : '#0b2033';
  const g2 = th === 'city' ? '#05060f' : th === 'desert' ? '#2c1a4d' : '#02030a';
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <defs>
        <linearGradient id={`tm-${track.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={g1} />
          <stop offset="1" stopColor={g2} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#tm-${track.id})`} />
      <path d={d} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="6" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={sx(pts[0][0])} cy={sz(pts[0][1])} r="3" fill={track.env.neonA} />
    </svg>
  );
}
