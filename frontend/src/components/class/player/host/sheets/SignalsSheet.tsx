import type { HostQuietSignalCounts } from './CheckinSheet';

/** 익명 집계만 받으므로 회원 이름이나 식별자는 표시할 수 없다. */
export function SignalsSheet({ counts, onCheckin }: { counts: HostQuietSignalCounts; onCheckin: () => void }) {
  const total = counts.following + counts.difficult + counts.resting;
  return <div className="hp-sheet hp-signals-sheet">
    <p className="hp-note">익명 신호는 최근 10초 동안의 건수만 보여요.</p>
    {([['following', '잘 따라가요'], ['difficult', '조금 어려워요'], ['resting', '잠시 쉴게요']] as const).map(([key, label]) =>
      <div className="hp-row" key={key}><b>{label}</b><b>{counts[key]}</b></div>)}
    {total === 0 ? <p className="hp-note">최근 10초 동안 받은 신호가 아직 없어요.</p> : null}
    <button type="button" className="hp-btn" data-variant="ghost" onClick={onCheckin}>체크인 요약 보기</button>
  </div>;
}
