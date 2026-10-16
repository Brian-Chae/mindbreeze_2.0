// SDD-208 H2 — "체크인 요약" 시트: 응답 수·질문별 분포·살펴볼 응답, 입장 전 체크인(CheckinSummary 재사용), 조용한 신호 집계.
import { ChevronRight } from 'lucide-react';
import type { HostCheckinSummary, HostPreCheckin } from '../../../../../lib/class/host-player-case';
import { CheckinSummary } from '../../../../class/CheckinSummary';
import { HostSection } from '../HostAtoms';
import '../host-player.css';

export interface HostQuietSignalCounts {
  following: number;
  difficult: number;
  resting: number;
}

interface CheckinSheetProps {
  summary: HostCheckinSummary;
  preCheckins: readonly HostPreCheckin[];
  quietSignals: HostQuietSignalCounts;
  onDetail: (participantId: string) => void;
}

const SIGNAL_ROWS = [
  { key: 'following', label: '잘 따라가요' },
  { key: 'difficult', label: '조금 어려워요' },
  { key: 'resting', label: '잠시 쉴게요' },
] as const;

function Distribution({ question, buckets }: { question: string; buckets: readonly { label: string; count: number }[] }) {
  const sorted = [...buckets].sort((a, b) => b.count - a.count);
  const head = sorted.slice(0, 2);
  const restCount = sorted.slice(2).reduce((sum, b) => sum + b.count, 0);
  const parts = [...head, ...(restCount ? [{ label: '기타', count: restCount }] : [])];
  return (
    <div className="hp-dist">
      <div className="hp-dist__q"><span>{question}</span></div>
      <div className="hp-dist__stack" aria-hidden="true">
        {parts.map((part, i) => <i key={part.label} data-c={i + 1} style={{ flex: part.count }} />)}
      </div>
      <div className="hp-dist__leg">
        {parts.map((part, i) => <span key={part.label}><em data-c={i + 1} />{part.label} {part.count}</span>)}
      </div>
    </div>
  );
}

export function CheckinSheet({ summary, preCheckins, quietSignals, onDetail }: CheckinSheetProps) {
  const percent = summary.total ? Math.round((summary.responded / summary.total) * 100) : 0;
  const signalTotal = quietSignals.following + quietSignals.difficult + quietSignals.resting;
  return (
    <div className="hp-sheet">
      <HostSection>
        <div className="hp-dist__q"><span>자가 체크인 응답</span><span><b>{summary.responded}</b> / {summary.total}명</span></div>
        <div className="hp-prog" role="progressbar" aria-label="체크인 응답률" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${percent}%` }} />
        </div>
      </HostSection>
      {summary.questions.slice(0, 3).map((q) => <Distribution key={q.question} question={q.question} buckets={q.buckets} />)}
      {summary.attention.length ? (
        <HostSection label="살펴볼 응답">
          {summary.attention.map((a) => (
            <button type="button" key={a.id} className="hp-note-btn" onClick={() => onDetail(a.id)}>
              <span><b>{a.name}</b><span>{a.text}</span></span>
              <ChevronRight aria-hidden="true" strokeWidth={2} />
            </button>
          ))}
        </HostSection>
      ) : null}
      {preCheckins.length ? (
        <HostSection label={`입장 전 체크인 · ${preCheckins.length}명`}>
          {preCheckins.map((entry) => (
            <div className="hp-row" key={entry.id} data-stack="true">
              <b>{entry.name}</b>
              <CheckinSummary arousal={entry.arousal} valence={entry.valence} emotion={entry.emotion} note={entry.note} />
            </div>
          ))}
        </HostSection>
      ) : null}
      {signalTotal > 0 ? (
        <HostSection label="조용한 신호 · 익명 · 최근 10초">
          {SIGNAL_ROWS.map((row) => (
            <div className="hp-row" key={row.key}><b>{row.label}</b><b>{quietSignals[row.key]}</b></div>
          ))}
        </HostSection>
      ) : null}
    </div>
  );
}
