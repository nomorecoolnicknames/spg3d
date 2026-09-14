import { useEffect, useState } from 'react';
import { useStore, toast } from '@/state/store';
import { bench, cancelBench, onBench, sample, snapshotReport, type PerfSample } from '@/game/perf';
import { S } from '@/data/strings';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Compact live counters (2 Hz). Shown when enabled in settings, via ?perf=1, or while a benchmark runs. */
export function PerfOverlay() {
  const enabled = useStore((s) => s.save.settings.perfOverlay) || new URLSearchParams(location.search).has('perf');
  const [, force] = useState(0);
  const [s, setS] = useState<PerfSample | null>(null);
  useEffect(() => onBench(() => force((n) => n + 1)), []);
  const visible = enabled || bench.running;
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const tick = async () => {
      const v = await sample();
      if (alive) setS(v);
    };
    void tick();
    const id = window.setInterval(tick, 500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [visible]);
  if (!visible || !s) return null;
  const elapsed = bench.running ? Math.min(bench.duration, Math.round((performance.now() - bench.startedAt) / 1000)) : 0;
  const temp = s.thermal.batteryTempC != null ? `${s.thermal.batteryTempC.toFixed(1)}°` : '—';
  const fpsTone = s.fps >= s.cap * 0.95 || (s.cap === 0 && s.fps >= 55) ? 'ok' : s.fps >= s.cap * 0.75 ? 'mid' : 'bad';
  return (
    <div className="perf">
      <div className="perf-row">
        <b className={fpsTone}>{s.fps.toFixed(0)}</b>
        <span>fps / {s.cap || '∞'}</span>
        <span>кадр {s.frameP95.toFixed(1)}</span>
        <span>cpu {s.cpuP95.toFixed(1)}</span>
        <span>dc {s.drawCalls}</span>
        <span>{Math.round(s.triangles / 1000)}k tri</span>
        <span>×{s.resScale.toFixed(2)}</span>
        <span>{temp}</span>
        {s.thermal.thermalStatus != null && <span>th {s.thermal.thermalStatus}</span>}
      </div>
      <div className="perf-row">
        {bench.running ? (
          <>
            <span>
              {S.settings.benchRunning}: {elapsed} / {bench.duration} с
            </span>
            <button onClick={() => cancelBench()}>{S.settings.benchStop}</button>
          </>
        ) : (
          <button
            onClick={async () => {
              const ok = await copyText(await snapshotReport());
              toast(ok ? S.settings.copied : S.settings.copyFailed, ok ? 'good' : 'warn');
            }}
          >
            {S.settings.copyReport}
          </button>
        )}
      </div>
    </div>
  );
}
