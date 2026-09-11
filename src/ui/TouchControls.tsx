import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { input, type TouchState } from '@/game/input/Input';
import { IArrowLeft, IArrowRight, IArrowUp, IArrowDown, INitro, IFire, IRun, IRefresh } from './icons';
import { viewport } from '@/game/Viewport';

type Key = 'left' | 'right' | 'throttle' | 'brake' | 'handbrake' | 'nitro' | 'fire' | 'sprint';

function HoldBtn({ k, className, children, style }: { k: Key; className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const [on, setOn] = useState(false);
  const set = (v: boolean) => {
    setOn(v);
    input.setTouch(k as keyof TouchState, v as never);
  };
  return (
    <button
      className={`tbtn ${className ?? ''} ${on ? 'on' : ''}`}
      style={style}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export function RaceTouch() {
  useEffect(() => () => input.reset(), []);
  return (
    <div className="touch">
      <HoldBtn k="left" style={{ left: 'calc(20px + var(--sal))', bottom: 'calc(24px + var(--sab))' }}><IArrowLeft /></HoldBtn>
      <HoldBtn k="right" style={{ left: 'calc(104px + var(--sal))', bottom: 'calc(24px + var(--sab))' }}><IArrowRight /></HoldBtn>
      <HoldBtn k="handbrake" className="sm" style={{ left: 'calc(62px + var(--sal))', bottom: 'calc(112px + var(--sab))' }}>ДРИФТ</HoldBtn>
      <HoldBtn k="throttle" style={{ right: 'calc(20px + var(--sar))', bottom: 'calc(24px + var(--sab))' }}><IArrowUp /></HoldBtn>
      <HoldBtn k="brake" style={{ right: 'calc(104px + var(--sar))', bottom: 'calc(24px + var(--sab))' }}><IArrowDown /></HoldBtn>
      <HoldBtn k="nitro" className="cyan sm" style={{ right: 'calc(62px + var(--sar))', bottom: 'calc(112px + var(--sab))' }}><INitro /></HoldBtn>
      <button className="tbtn sm" style={{ left: 'calc(50% - 30px)', top: 'calc(48px + var(--sat))', width: 60, height: 40 }} onClick={() => (viewport.getController() as { respawn?: () => void } | null)?.respawn?.()} aria-label="respawn"><IRefresh /></button>
    </div>
  );
}

export function BossTouch() {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLElement>(null);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });
  useEffect(() => () => input.reset(), []);
  const onStick = (e: RPointerEvent<HTMLDivElement>) => {
    const el = stickRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    const nx = l > 1 ? dx / l : dx, ny = l > 1 ? dy / l : dy;
    input.setTouch('stickX', nx);
    input.setTouch('stickY', ny);
    if (knobRef.current) knobRef.current.style.transform = `translate(${nx * 40}px, ${ny * 40}px)`;
  };
  const endStick = () => {
    stickId.current = null;
    input.setTouch('stickX', 0);
    input.setTouch('stickY', 0);
    if (knobRef.current) knobRef.current.style.transform = '';
  };
  return (
    <div className="touch">
      <div
        className="lookpad"
        onPointerDown={(e) => {
          if (lookId.current !== null) return;
          lookId.current = e.pointerId;
          lastLook.current = { x: e.clientX, y: e.clientY };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== lookId.current) return;
          const dx = e.clientX - lastLook.current.x, dy = e.clientY - lastLook.current.y;
          lastLook.current = { x: e.clientX, y: e.clientY };
          input.addLook(-dx * 0.005, -dy * 0.004);
        }}
        onPointerUp={(e) => { if (e.pointerId === lookId.current) lookId.current = null; }}
        onPointerCancel={(e) => { if (e.pointerId === lookId.current) lookId.current = null; }}
      />
      <div
        ref={stickRef}
        className="stick"
        onPointerDown={(e) => {
          stickId.current = e.pointerId;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          onStick(e);
        }}
        onPointerMove={(e) => { if (e.pointerId === stickId.current) onStick(e); }}
        onPointerUp={endStick}
        onPointerCancel={endStick}
      >
        <i ref={knobRef} />
      </div>
      <HoldBtn k="fire" style={{ right: 'calc(20px + var(--sar))', bottom: 'calc(24px + var(--sab))', width: 90, height: 90 }}><IFire /></HoldBtn>
      <HoldBtn k="sprint" className="cyan sm" style={{ right: 'calc(120px + var(--sar))', bottom: 'calc(30px + var(--sab))' }}><IRun /></HoldBtn>
    </div>
  );
}
