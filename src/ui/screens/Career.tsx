import { useStore, startCareerStage } from '@/state/store';
import { CAREER, RIVALS } from '@/data/story';
import { TRACK_BY_ID } from '@/data/tracks';
import { S } from '@/data/strings';
import { Screen, click, money } from '../common';
import { Portrait } from '../Portrait';
import { ICheck, ILock, IFlag, ISkull } from '../icons';

export function Career() {
  const wins = useStore((s) => s.save.careerWins);
  const nextId = CAREER.find((c) => !wins.includes(c.id))?.id;
  return (
    <Screen title={S.career.title}>
      <div className="career-grid">
        {CAREER.map((st, i) => {
          const rival = RIVALS[st.rivalId];
          const done = wins.includes(st.id);
          const unlocked = wins.length >= st.requiresWins;
          const track = st.trackId ? TRACK_BY_ID[st.trackId] : null;
          const cls = `stage ${done ? 'done' : ''} ${!unlocked ? 'locked' : ''} ${st.id === nextId ? 'next' : ''}`;
          return (
            <div key={st.id} className={cls} style={{ ['--acc' as string]: rival.accent }}>
              <div className="who">
                <Portrait id={rival.portrait} size={64} />
                <div>
                  <div className="rank">
                    {S.career.stage} {i + 1} · {rival.tag}
                  </div>
                  <div className="name">{rival.name}</div>
                </div>
              </div>
              <div className="meta">
                <span>{st.kind === 'boss' ? S.career.boss : S.tracks.title}</span>
                <b>{track ? `${track.name} · ${track.laps} ${S.tracks.laps.toLowerCase()}` : S.boss.sub}</b>
                <span>{S.career.reward}</span>
                <b>{money(st.reward)}</b>
              </div>
              <div className="foot">
                {done ? (
                  <span className="tag green">
                    <ICheck /> {S.career.done}
                  </span>
                ) : unlocked ? (
                  <span className="tag red">{st.id === nextId ? S.career.next : ''}</span>
                ) : (
                  <span className="tag">
                    <ILock /> {S.garage.locked}: {st.requiresWins}
                  </span>
                )}
                <button
                  className={`btn sm ${st.id === nextId ? 'primary' : ''}`}
                  disabled={!unlocked}
                  onClick={() => {
                    click();
                    startCareerStage(st.id);
                  }}
                >
                  {st.kind === 'boss' ? <ISkull /> : <IFlag />}
                  {S.career.challenge}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
