import { useEffect, useState } from 'react';
import { autoTierAtBoot } from '@/game/tier';
import { useStore, setSettings, resetProgress, goto, launchFromStory, setInitials, restartSession, setState, getState } from '@/state/store';
import { TRACKS } from '@/data/tracks';
import { CAR_BY_ID } from '@/data/cars';
import { RIVALS } from '@/data/story';
import { S } from '@/data/strings';
import type { RaceResults } from '@/game/types';
import { Screen, click, fmtTime, money } from '../common';
import { Portrait } from '../Portrait';
import { IMedal, IRefresh, IFlag, ISkull } from '../icons';
import { audio } from '@/game/audio';
import { bench, onBench, startBench } from '@/game/perf';
import { copyText } from '../PerfOverlay';
import { toast } from '@/state/store';

// ───────────────────────────────────────────── Records
export function Records() {
  const save = useStore((s) => s.save);
  const [confirm, setConfirm] = useState(false);
  const c = save.career;
  return (
    <Screen title={S.records.title}>
      <div className="two-col">
        <div className="panel">
          <h2>{S.records.career}</h2>
          <div className="kv">
            <span>{S.records.races}</span>
            <b>{c.races}</b>
            <span>{S.records.wins}</span>
            <b>{c.wins}</b>
            <span>{S.records.drift}</span>
            <b>{c.driftPoints.toLocaleString('ru-RU')}</b>
            <span>{S.records.earned}</span>
            <b>{money(c.earned)}</b>
            <span>{S.records.bossKills}</span>
            <b>{c.bossKills}</b>
          </div>
          <div className="hr" />
          {!confirm ? (
            <button className="btn ghost sm" onClick={() => { click(); setConfirm(true); }}>
              <IRefresh /> {S.records.reset}
            </button>
          ) : (
            <div className="btn-row">
              <span className="muted">{S.records.resetConfirm}</span>
              <button className="btn primary sm" onClick={() => { click(); resetProgress(); setConfirm(false); }}>{S.common.yes}</button>
              <button className="btn ghost sm" onClick={() => { click(); setConfirm(false); }}>{S.common.no}</button>
            </div>
          )}
        </div>
        <div className="panel">
          <h2>{S.records.trackRecords}</h2>
          {TRACKS.map((t) => {
            const r = save.records[t.id];
            return (
              <div className="rec-row" key={t.id}>
                <span className="t">{t.name}</span>
                <span className="lap">{r ? fmtTime(r.bestLap) : S.records.none}</span>
                <span className="ini">{r ? `${r.initials} · ${CAR_BY_ID[r.carId]?.name ?? ''}` : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}

// ───────────────────────────────────────────── Settings
export function Settings() {
  const st = useStore((s) => s.save.settings);
  const [, force] = useState(0);
  useEffect(() => onBench(() => force((n) => n + 1)), []);
  const report = bench.report ? (JSON.parse(bench.report) as { summary: Record<string, number | null> }) : null;
  const Seg = <T extends string | number | boolean>({ value, opts, onChange }: { value: T; opts: [T, string][]; onChange: (v: T) => void }) => (
    <div className="seg">
      {opts.map(([v, l]) => (
        <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => { click(); onChange(v); }}>
          {l}
        </button>
      ))}
    </div>
  );
  const onOff: [boolean, string][] = [[true, S.settings.on], [false, S.settings.off]];
  const Range = ({ k, v }: { k: 'master' | 'music' | 'sfx' | 'engine'; v: number }) => (
    <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => setSettings({ [k]: Number(e.target.value) })} />
  );
  return (
    <Screen title={S.settings.title}>
      <div className="two-col">
        <div className="panel">
          <h2>{S.settings.graphics}</h2>
          <div className="set-row"><span>{S.settings.quality}</span><Seg value={st.qualityAuto ? 'auto' : st.quality} opts={[['auto', S.settings.qualityAuto], ['low', S.settings.qualityNames.low], ['medium', S.settings.qualityNames.medium], ['high', S.settings.qualityNames.high]]} onChange={(q) => (q === 'auto' ? (setSettings({ qualityAuto: true, tierVersion: 0 }), autoTierAtBoot()) : setSettings({ qualityAuto: false, quality: q, shadows: q === 'high', bloom: q !== 'low', reflections: q === 'high' }))} /></div>
          <div className="set-row"><span>{S.settings.shadows}</span><Seg value={st.shadows} opts={onOff} onChange={(v) => setSettings({ shadows: v })} /></div>
          <div className="set-row"><span>{S.settings.bloom}</span><Seg value={st.bloom} opts={onOff} onChange={(v) => setSettings({ bloom: v })} /></div>
          <div className="set-row"><span>{S.settings.fovKick}</span><Seg value={st.fovKick} opts={onOff} onChange={(v) => setSettings({ fovKick: v })} /></div>
          <div className="hr" />
          <h2>{S.settings.controls}</h2>
          <div className="set-row"><span>{S.settings.camera}</span><Seg value={st.camera} opts={S.race.cameras.map((n, i) => [i, n] as [number, string])} onChange={(v) => setSettings({ camera: v })} /></div>
          <div className="set-row"><span>{S.settings.invertY}</span><Seg value={st.invertY} opts={onOff} onChange={(v) => setSettings({ invertY: v })} /></div>
          <div className="set-row"><span>{S.settings.touch}</span><Seg value={st.touch} opts={[['auto', S.settings.touchAuto], ['on', S.settings.on], ['off', S.settings.off]]} onChange={(v) => setSettings({ touch: v })} /></div>
        </div>
        <div className="panel">
          <h2>{S.settings.performance}</h2>
          <div className="set-row"><span>{S.settings.fpsCap}</span><Seg value={st.fpsCap} opts={[[30, S.settings.fpsCapNames[30]], [60, S.settings.fpsCapNames[60]], [0, S.settings.fpsCapNames[0]]]} onChange={(v) => setSettings({ fpsCap: v })} /></div>
          <div className="set-row"><span>{S.settings.dynamicRes}</span><Seg value={st.dynamicRes} opts={onOff} onChange={(v) => setSettings({ dynamicRes: v })} /></div>
          <div className="set-row"><span>{S.settings.perfOverlay}</span><Seg value={st.perfOverlay} opts={onOff} onChange={(v) => setSettings({ perfOverlay: v })} /></div>
          <div className="hr" />
          <h2>{S.settings.bench}</h2>
          <p className="muted" style={{ marginBottom: 8 }}>{S.settings.benchHint}</p>
          <button className="btn primary sm" disabled={bench.running} onClick={() => { click(); startBench('shchyolkovo', 90); }}>{S.settings.benchStart}</button>
          {report && (
            <>
              <div className="hr" />
              <h2>{S.settings.benchResult}</h2>
              <div className="kv">
                <span>{S.settings.fpsAvg}</span><b>{report.summary.fpsAvg}</b>
                <span>{S.settings.fpsP5}</span><b>{report.summary.fpsP5}</b>
                <span>{S.settings.frameP95}</span><b>{report.summary.frameP95Max} мс</b>
                <span>{S.settings.drawCallsMax}</span><b>{report.summary.drawCallsMax}</b>
                <span>{S.settings.trianglesMax}</span><b>{Math.round((report.summary.trianglesMax ?? 0) / 1000)} тыс.</b>
                <span>{S.settings.tempDelta}</span><b>{report.summary.batteryTempStart != null ? `${report.summary.batteryTempStart}° → ${report.summary.batteryTempEnd}°` : '—'}</b>
              </div>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={async () => { const ok = await copyText(bench.report ?? ''); toast(ok ? S.settings.copied : S.settings.copyFailed, ok ? 'good' : 'warn'); }}>{S.settings.copyReport}</button>
              </div>
              <textarea className="report-box" readOnly value={bench.report ?? ''} onFocus={(e) => e.currentTarget.select()} />
            </>
          )}
        </div>
        <div className="panel">
          <h2>{S.settings.audio}</h2>
          <div className="set-row"><span>{S.settings.master}</span><Range k="master" v={st.master} /></div>
          <div className="set-row"><span>{S.settings.music}</span><Range k="music" v={st.music} /></div>
          <div className="set-row"><span>{S.settings.sfx}</span><Range k="sfx" v={st.sfx} /></div>
          <div className="set-row"><span>{S.settings.engine}</span><Range k="engine" v={st.engine} /></div>
        </div>
      </div>
    </Screen>
  );
}

// ───────────────────────────────────────────── Story
export function Story() {
  const story = useStore((s) => s.story);
  const results = useStore((s) => s.results);
  const rival = story ? RIVALS[story.rivalId] : null;
  const lines = !story || !rival ? [] : story.phase === 'before' ? rival.before : story.won ? rival.win : rival.lose;
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(0);
  const line = lines[idx] ?? '';
  const done = shown >= line.length;
  const last = idx >= lines.length - 1;
  useEffect(() => {
    setShown(0);
    const id = window.setInterval(() => setShown((n) => Math.min(line.length, n + 1)), 22);
    return () => window.clearInterval(id);
  }, [line]);
  useEffect(() => {
    setIdx(0);
  }, [story]);
  if (!story || !rival) return null;
  const finish = () => {
    click();
    if (story.phase === 'before') launchFromStory();
    else goto('results');
  };
  const advance = () => {
    if (!done) setShown(line.length);
    else if (!last) {
      audio.play('ui-click', { gain: 0.4 });
      setIdx(idx + 1);
    } else finish();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const finalLabel = story.phase === 'before' ? (story.launch?.screen === 'boss' ? S.story.toBoss : S.story.go) : S.story.results;
  const won = story.phase === 'after' && (results?.kind === 'race' ? results.player.place === 1 : results?.kind === 'boss' ? results.won : false);
  return (
    <div className="ui-layer dim">
      <div className="story-wrap" onClick={advance}>
        <div className="story" style={{ ['--acc' as string]: rival.accent }}>
          <Portrait id={rival.portrait} size={150} />
          <div>
            <div className="who">
              <span className="n">{rival.name}</span>
              <span className="r">{story.phase === 'before' ? `${S.story.challenge} · ${rival.tag}` : won ? S.story.afterWin : S.story.afterLose}</span>
            </div>
            <div className="txt">
              {line.slice(0, shown)}
              {!done && <span className="caret" />}
            </div>
            <div className="foot">
              <div className="dots">
                {lines.map((_, i) => (
                  <i key={i} className={i <= idx ? 'on' : ''} />
                ))}
              </div>
              <div className="btn-row">
                {!last && <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); click(); setIdx(lines.length - 1); setShown(999); }}>{S.story.skip}</button>}
                <button className="btn primary" onClick={(e) => { e.stopPropagation(); if (last) finish(); else advance(); }}>
                  {last ? (story.launch?.screen === 'boss' ? <ISkull /> : <IFlag />) : null}
                  {last ? finalLabel : S.story.next}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────── Results
export function Results() {
  const results = useStore((s) => s.results);
  const race = useStore((s) => s.race);
  const initials = useStore((s) => s.save.initials);
  if (!results) return null;
  if (results.kind === 'boss') {
    return (
      <div className="ui-layer tint stripes">
        <div className="results-wrap">
          <div className="results">
            <div className="head">
              <h1 className={results.won ? 'win' : ''}>{results.won ? S.results.bossWin : S.results.bossLose}</h1>
              <div className="sub">{S.boss.name} · {fmtTime(results.time)}</div>
            </div>
            <div className="panel" style={{ gridColumn: 'span 2', maxWidth: 520 }}>
              <h2>{S.results.rewards}</h2>
              <div className="reward">
                <span>{S.boss.sub}</span>
                <b>{money(results.reward)}</b>
                <span>{S.results.total}</span>
                <b className="tot">{money(results.reward)}</b>
              </div>
              {results.won && <p className="muted" style={{ marginTop: 10 }}>{S.results.unlockAll}</p>}
              <div className="hr" />
              <div className="btn-row">
                <button className="btn primary" onClick={() => { click(); goto('career'); }}>{S.results.next}</button>
                <button className="btn ghost" onClick={() => { click(); goto('menu'); }}>{S.results.menu}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const r = results as RaceResults;
  const victory = r.player.place === 1;
  const trackName = TRACKS.find((t) => t.id === r.trackId)?.name ?? '';
  const carName = CAR_BY_ID[r.carId]?.name ?? '';
  return (
    <div className="ui-layer tint stripes">
      <div className="results-wrap">
        <div className="results">
          <div className="head">
            <h1 className={victory ? 'win' : ''}>{victory ? S.results.victory : `${r.player.place} ${S.results.place}`}</h1>
            <div className="sub">{trackName} · {carName}{r.timeAttack ? ` · ${S.tracks.timeAttack}` : ''}</div>
          </div>
          <div className="panel board">
            <div className="r hdr"><span /><span>{S.results.driver}</span><span className="t">{S.results.finishTime}</span><span className="t">{S.results.bestLap}</span></div>
            {r.entries.map((e) => (
              <div key={e.name} className={`r ${e.isPlayer ? 'me' : ''}`}>
                <span className="p">{e.place <= 3 ? <IMedal place={e.place} /> : e.place}</span>
                <span className="n"><i style={{ background: e.color }} />{e.name}</span>
                <span className="t">{e.finished ? fmtTime(e.totalTime) : `+${fmtTime(e.totalTime)}`}</span>
                <span className="t b">{fmtTime(e.bestLap)}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>{S.results.rewards}</h2>
            <div className="reward">
              <span>{S.results.forPlace}</span><b>{money(r.reward.place)}</b>
              <span>{S.results.forDrift} · {r.driftScore.toLocaleString('ru-RU')}</span><b>{money(r.reward.drift)}</b>
              <span>{S.results.forClean}</span><b>{money(r.reward.cleanLap)}</b>
              {r.reward.trap > 0 && <><span>{S.results.forTrap} · {r.reward.trapKmh} {S.race.kmh}</span><b>{money(r.reward.trap)}</b></>}
              {r.reward.record > 0 && <><span>{S.results.forRecord}</span><b>{money(r.reward.record)}</b></>}
              <span>{S.results.total}</span><b className="tot">{money(r.reward.total)}</b>
            </div>
            {r.newRecord && (
              <div className="record-box" style={{ marginTop: 12 }}>
                <span className="l">{S.results.newRecord}</span>
                <input value={initials} maxLength={3} onChange={(e) => setInitials(e.target.value.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '').slice(0, 3))} />
                <span className="muted">{S.results.initials}</span>
              </div>
            )}
            <div className="hr" />
            <div className="btn-row">
              <button className="btn primary" onClick={() => { click(); if (race) { restartSession(); setState({ prevScreen: 'results', screen: 'race', results: null }); } }}>{S.results.again}</button>
              {r.career && <button className="btn" onClick={() => { click(); goto('career'); }}>{S.results.next}</button>}
              <button className="btn ghost" onClick={() => { click(); goto('menu'); }}>{S.results.menu}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useIsTouchLayout(): boolean {
  const isTouch = useStore((s) => s.isTouch);
  const mode = useStore((s) => s.save.settings.touch);
  return mode === 'on' || (mode === 'auto' && isTouch);
}

export { getState };
