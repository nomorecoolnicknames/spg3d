import { useStore, setState, startRace, goto, carColor } from '@/state/store';
import { TRACKS, TRACK_BY_ID } from '@/data/tracks';
import { CAR_BY_ID } from '@/data/cars';
import { S } from '@/data/strings';
import { Screen, Stars, TrackMap, click } from '../common';
import { useIsTouchLayout } from './Misc';
import { IFlag, ILock } from '../icons';

export function Quick() {
  const quick = useStore((s) => s.quick);
  const wins = useStore((s) => s.save.careerWins.length);
  const carId = useStore((s) => s.save.selectedCar);
  const color = useStore((s) => s.save.colors[carId]) ?? carColor(carId);
  const car = CAR_BY_ID[carId];
  const track = TRACK_BY_ID[quick.trackId];
  const set = (p: Partial<typeof quick>) => setState({ quick: { ...quick, ...p } });
  const touch = useIsTouchLayout();
  const start = () => {
    click();
    startRace({ trackId: quick.trackId, carId, color, laps: quick.laps, opponents: quick.timeAttack ? 0 : quick.opponents, difficulty: quick.difficulty, career: false, timeAttack: quick.timeAttack });
  };
  const diffIdx = quick.difficulty < 0.95 ? 0 : quick.difficulty > 1.05 ? 2 : 1;
  return (
    <Screen title={S.menu.quick} right={touch ? <button className="btn primary" onClick={start}><IFlag /> {S.tracks.start}</button> : undefined}>
      <div className="quick-left">
        <div className="track-cards">
          {TRACKS.map((t, i) => {
            const unlocked = i === 0 || wins >= i;
            return (
              <button
                key={t.id}
                className={`track-card ${quick.trackId === t.id ? 'on' : ''} ${unlocked ? '' : 'locked'}`}
                disabled={!unlocked}
                onClick={() => {
                  click();
                  set({ trackId: t.id, laps: t.laps });
                }}
              >
                <TrackMap track={t} color={quick.trackId === t.id ? '#ffffff' : 'rgba(255,255,255,0.7)'} />
                <div className="nm">{t.name}</div>
                <div className="sub">{t.subtitle}</div>
                <div className="row">
                  <Stars n={t.difficulty} />
                  <span>
                    {S.tracks.length}: {t.lengthHint} {S.common.m}
                  </span>
                </div>
                {!unlocked && (
                  <span className="tag">
                    <ILock /> {S.tracks.locked}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="panel">
          <p className="muted">{track.desc}</p>
          {track.map && <p className="muted credit">{S.tracks.osmCredit}</p>}
        </div>
      </div>
      <div className="quick-right">
        <div className="panel">
          <div className="field">
            <label>{S.tracks.laps}</label>
            <div className="seg">
              {[1, 2, 3, 5].map((l) => (
                <button key={l} className={quick.laps === l ? 'on' : ''} onClick={() => { click(); set({ laps: l }); }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="hr" />
          <div className="field">
            <label>{S.tracks.opponents}</label>
            <div className="seg">
              {[3, 5, 7].map((o) => (
                <button key={o} className={quick.opponents === o && !quick.timeAttack ? 'on' : ''} disabled={quick.timeAttack} onClick={() => { click(); set({ opponents: o }); }}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="hr" />
          <div className="field">
            <label>{S.tracks.difficulty}</label>
            <div className="seg">
              {S.tracks.diffNames.map((n, i) => (
                <button key={n} className={diffIdx === i ? 'on' : ''} onClick={() => { click(); set({ difficulty: [0.85, 1.0, 1.15][i] }); }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="hr" />
          <div className="field">
            <label>{S.tracks.timeAttack}</label>
            <div className="seg">
              <button className={!quick.timeAttack ? 'on' : ''} onClick={() => { click(); set({ timeAttack: false }); }}>
                {S.settings.off}
              </button>
              <button className={quick.timeAttack ? 'on' : ''} onClick={() => { click(); set({ timeAttack: true }); }}>
                {S.settings.on}
              </button>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="car-summary">
            <span className="sw" style={{ background: color }} />
            <div>
              <div className="nm">{car.name}</div>
              <div className="br">{car.brand}</div>
            </div>
            <button className="btn sm ghost" onClick={() => { click(); goto('garage'); }}>
              {S.menu.garage}
            </button>
          </div>
        </div>
        {!touch && (
          <button className="btn primary lg" onClick={start}>
            <IFlag /> {S.tracks.start}
          </button>
        )}
      </div>
    </Screen>
  );
}
