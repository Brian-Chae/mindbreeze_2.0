import { CLASS_SIGNAL_META, SIGNAL_ACTIVE_MS, normalizeSignalDisplayName, type SignalMap } from '../../../../../lib/class/quiet-signal';
import type { HostQuietSignalCounts } from './CheckinSheet';

/** 상담사 전용: 최근 10초 회원별 최신 선택만 휘발성으로 표시한다. */
export function SignalsSheet({ counts, onCheckin, signals = {} }: { counts: HostQuietSignalCounts; onCheckin: () => void; signals?: SignalMap }) {
  const total = counts.following + counts.difficult + counts.resting;
  const recent = Object.entries(signals).filter(([, signal]) => Date.now() - signal.at < SIGNAL_ACTIVE_MS);
  return <div className="hp-sheet hp-signals-sheet">
    <p className="hp-note">최근 10초 동안 회원별 최신 선택을 보여요. 이름과 선택은 상담사에게만 보여요.</p>
    {([['following', '잘 따라가요'], ['difficult', '조금 어려워요'], ['resting', '잠시 쉴게요']] as const).map(([key, label]) =>
      <div className="hp-row" key={key}><b>{label}</b><b>{counts[key]}</b></div>)}
    {recent.map(([id, signal]) => <div className="hp-row" data-signal-person key={id}>
      <b>{normalizeSignalDisplayName(signal.displayName)}</b><span>{CLASS_SIGNAL_META[signal.type].label}</span>
    </div>)}
    {total === 0 ? <p className="hp-note">최근 10초 동안 받은 신호가 아직 없어요.</p> : null}
    <button type="button" className="hp-btn" data-variant="ghost" onClick={onCheckin}>체크인 요약 보기</button>
  </div>;
}
