import { useState } from 'react';
import { useStore, setState, selectCar, buyCar, buyUpgrade, setCarColor, getUpgrades, toast, carColor } from '@/state/store';
import { CARS, CAR_BY_ID } from '@/data/cars';
import { S } from '@/data/strings';
import { upgradePrice } from '@/state/save';
import type { Upgrades } from '@/game/types';
import { Screen, click, money } from '../common';
import { ICheck, ICoin, ILock, IWrench } from '../icons';
import { audio } from '@/game/audio';

const GOLD = '#f5c542';

export function Garage() {
  const garageCar = useStore((s) => s.garageCar);
  const save = useStore((s) => s.save);
  const [tab, setTab] = useState<'paint' | 'tune'>('paint');
  const car = CAR_BY_ID[garageCar] ?? CARS[0];
  const owned = save.ownedCars.includes(car.id);
  const unlocked = save.careerWins.length >= car.unlockWins;
  const selected = save.selectedCar === car.id;
  const color = save.colors[car.id] ?? car.colors[0];
  const up = getUpgrades(car.id);
  const maxes = { power: 620, speed: 96, grip: 1.2, handling: 1.18, drift: 1.15 };

  return (
    <Screen title={S.garage.title} className="garage-screen">
      <div className="garage-body">
        <div className="garage-left">
          <div className="car-title">
            <div className="brand">{car.brand}</div>
            <h2>{car.name}</h2>
            <p className="desc">{car.desc}</p>
          </div>
          <div className="panel" style={{ maxWidth: 520 }}>
            <div className="garage-tabs">
              <button className={tab === 'paint' ? 'on' : ''} onClick={() => { click(); setTab('paint'); }}>{S.garage.paint}</button>
              <button className={tab === 'tune' ? 'on' : ''} onClick={() => { click(); setTab('tune'); }}>{S.garage.tuning}</button>
            </div>
            <div className="hr" />
            {tab === 'paint' ? (
              <>
                <div className="swatches">
                  {car.colors.map((c) => (
                    <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => { click(); setCarColor(car.id, c); }} aria-label={c} />
                  ))}
                  {save.goldPaint && <button className={`swatch gold ${color === GOLD ? 'on' : ''}`} onClick={() => { click(); setCarColor(car.id, GOLD); }} aria-label="gold" />}
                </div>
                <div className="hr" />
                <Stat k={S.garage.stats.power} v={car.power * (1 + up.engine * 0.05)} max={maxes.power * 1.25} label={`${Math.round(car.power * 1.36 * (1 + up.engine * 0.05))} л.с.`} />
                <Stat k={S.garage.stats.speed} v={car.topSpeed * (1 + up.engine * 0.02)} max={maxes.speed * 1.1} label={`${Math.round(car.topSpeed * 3.6 * (1 + up.engine * 0.02))} км/ч`} />
                <Stat k={S.garage.stats.grip} v={car.grip * (1 + up.tires * 0.04)} max={maxes.grip * 1.2} />
                <Stat k={S.garage.stats.handling} v={car.handling * (1 + up.susp * 0.04)} max={maxes.handling * 1.2} />
                <Stat k={S.garage.stats.drift} v={car.driftiness} max={maxes.drift} cyan />
              </>
            ) : (
              <div className="tune-grid">
                {(Object.keys(S.garage.upgrades) as (keyof Upgrades)[]).map((k) => {
                  const lvl = up[k];
                  const price = upgradePrice(lvl);
                  const maxed = lvl >= 5;
                  return (
                    <div className="tune" key={k}>
                      <div className="t">
                        {S.garage.upgrades[k].name}
                        <small>{S.garage.upgrades[k].desc}</small>
                      </div>
                      <div className="pips">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <i key={i} className={i < lvl ? 'on' : ''} />
                        ))}
                      </div>
                      <button
                        className={`btn sm ${maxed ? 'ghost' : ''}`}
                        disabled={maxed || !owned}
                        onClick={() => {
                          if (buyUpgrade(car.id, k)) audio.play('ui-buy');
                          else {
                            audio.play('ui-error');
                            toast(S.garage.notEnough, 'warn');
                          }
                        }}
                      >
                        {maxed ? <><ICheck /> {S.garage.max}</> : <><IWrench /> {money(price)}</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="btn-row">
            {owned ? (
              <button className={`btn ${selected ? 'ghost' : 'primary'} lg`} disabled={selected} onClick={() => { click(); selectCar(car.id); }}>
                <ICheck /> {selected ? S.garage.selected : S.garage.select}
              </button>
            ) : unlocked ? (
              <button
                className="btn gold lg"
                onClick={() => {
                  if (buyCar(car.id)) audio.play('ui-buy');
                  else {
                    audio.play('ui-error');
                    toast(S.garage.notEnough, 'warn');
                  }
                }}
              >
                <ICoin /> {S.garage.buy} · {money(car.price)}
              </button>
            ) : (
              <span className="tag gold">
                <ILock /> {S.garage.locked}: {car.unlockWins}
              </span>
            )}
          </div>
        </div>
        <div className="garage-right">
          <div className="car-list scroll">
            {CARS.map((c) => {
              const o = save.ownedCars.includes(c.id);
              const u = save.careerWins.length >= c.unlockWins;
              return (
                <button
                  key={c.id}
                  className={`car-row ${garageCar === c.id ? 'on' : ''} ${!u ? 'locked' : ''}`}
                  onMouseEnter={() => audio.play('ui-hover', { gain: 0.2 })}
                  onClick={() => {
                    click();
                    setState({ garageCar: c.id });
                  }}
                >
                  <div>
                    <div className="nm">{c.name}</div>
                    <div className="br">{c.brand}</div>
                  </div>
                  {o ? (
                    save.selectedCar === c.id ? <span className="tag red"><ICheck /> {S.garage.selected}</span> : <span className="tag green"><ICheck /></span>
                  ) : u ? (
                    <span className="pr"><ICoin /> {money(c.price)}</span>
                  ) : (
                    <span className="tag"><ILock /> {c.unlockWins}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Screen>
  );
}

function Stat({ k, v, max, label, cyan }: { k: string; v: number; max: number; label?: string; cyan?: boolean }) {
  const pct = Math.max(4, Math.min(100, (v / max) * 100));
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="bar">
        <i className={cyan ? 'cyan' : ''} style={{ width: `${pct}%` }} />
      </span>
      <span className="v">{label ?? Math.round(pct)}</span>
    </div>
  );
}

export function garageColor(carId: string): string {
  return carColor(carId);
}
