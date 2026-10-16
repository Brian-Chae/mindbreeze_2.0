// SDD-208 H3 — 1:1 큰 회원 카드와 참가자 상세 시트가 함께 쓰는 조각: 6지표 격자 · 5분 추이 · 체크인 응답 · 밴드 안내.
import type { CSSProperties } from 'react';
import { hostValueOf, metricFraction, trendDelta, type HostParticipant } from '../../../../lib/class/host-player-case';
import { PLAYER_METRICS, type PlayerMetric } from '../../../../lib/class/player-case';
import { StatusRing } from '../shared/StatusRing';
import './host-player.css';

const mcol = (metric: PlayerMetric): CSSProperties => ({ ['--mcol' as string]: `var(${metric.colorVar})` });

export function HostMinis({ participant, selected }: { participant: HostParticipant; selected: PlayerMetric['key'] }) {
  return (
    <div className="hp-minis" data-pz="minis">
      {PLAYER_METRICS.map((m) => {
        const value = hostValueOf(participant, m.key);
        const live = value !== null;
        const tone = participant.band === 'off' ? 'idle' : 'lost';
        return (
          <div key={m.key} className="hp-mini" data-pz="mini" data-sel={m.key === selected ? 'true' : undefined} style={mcol(m)}>
            <StatusRing
              variant="mini"
              fraction={live ? metricFraction(m, value) : null}
              tone={live ? 'live' : tone}
              colorVar={m.colorVar}
              ariaLabel={`${m.label} ${live ? value : '값 없음'}`}
            >
              <b className="hp-ring-num" data-empty={live ? undefined : 'true'}>{live ? value : '—'}</b>
            </StatusRing>
            <span className="hp-mini__ml">{m.short}</span>
          </div>
        );
      })}
    </div>
  );
}

function TrendSvg({ points, metric }: { points: readonly number[]; metric: PlayerMetric }) {
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo) * 0.2 || 4;
  const y = (v: number): number => 44 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 40 - 2;
  const last = points.length - 1;
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${((i / last) * 300).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 300 44" preserveAspectRatio="none" role="img" aria-label={`최근 5분 ${metric.label} 추이`} style={{ color: `var(${metric.colorVar})` }}>
      <path d={`${line} L300 44 L0 44 Z`} fill="currentColor" fillOpacity=".16" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HostTrendCard({ participant, metric, points }: { participant: HostParticipant; metric: PlayerMetric; points: readonly number[] }) {
  if (participant.band === 'on' && points.length >= 2) {
    const delta = trendDelta(points);
    return (
      <div className="hp-trend" data-pz="trend" style={mcol(metric)}>
        <div className="hp-trend__th">
          <span>최근 5분 · {metric.label}</span>
          {delta !== null ? <b>{delta > 0 ? '+' : ''}{delta}</b> : null}
        </div>
        <TrendSvg points={points} metric={metric} />
        <div className="hp-trend__axis"><span>5분 전</span><span>지금</span></div>
      </div>
    );
  }
  const message = participant.band === 'lost'
    ? `LINK BAND 연결이 ${participant.agoLabel ?? '방금 전'}부터 끊겼어요. 다시 연결되면 지표가 이어서 표시돼요.`
    : participant.band === 'leadoff'
      ? '접촉이 불안정해요. 밴드를 이마에 밀착하도록 안내해 주세요.'
      : participant.band === 'on'
        ? '추이를 만드는 중이에요. 값이 쌓이면 최근 5분의 변화가 이 자리에 표시돼요.'
        : 'LINK BAND 없이 참여 중이에요. 체크인 응답으로 상태를 살펴보세요.';
  return <div className="hp-noband" data-pz="trend">{message}</div>;
}

export function HostQaCard({ participant, card }: { participant: HostParticipant; card: boolean }) {
  return (
    <div className={card ? 'hp-qas hp-card' : 'hp-qas'} data-pz="qas" data-empty={participant.checkin.length ? undefined : 'true'}>
      <p className="hp-lbl">체크인 응답</p>
      {participant.checkin.length ? (
        participant.checkin.map(([q, a]) => (
          <div className="hp-qa" key={q}>
            <span className="hp-qa__q">{q}</span>
            <span className="hp-qa__a">{a}</span>
          </div>
        ))
      ) : (
        <p className="hp-note">아직 체크인 응답이 없어요.</p>
      )}
    </div>
  );
}
