// SDD-208 — 회원 중앙 무대: 링(지표 1개) + 링 아래 안내 칩·슬롯 카드·5분 추이.
// 링은 위·아래 슬롯 중 더 큰 쪽을 기준으로 세로 중앙에 둔다(균형.md S7) — --reserve 를 측정해 CSS 가 링 크기를 정한다.
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { MemberCase, SlotAction } from '../../../../lib/class/member-player-case';
import type { PlayerMetricKey } from '../../../../lib/class/player-case';
import { NoticeBanner } from '../shared/NoticeBanner';
import { NoticeOverlay } from '../shared/NoticeOverlay';
import { StatusRing } from '../shared/StatusRing';
import { MemberIcon } from './MemberIcon';
import { displayedInteger } from '../../../../lib/biosignal/display-snapshot';
import { METRIC_GUIDE, formatTrendChange, hasTrendData, metricDef, metricFraction, sparkGeometry, type MetricSeries, type MetricSnapshot } from './member-metrics';
import './member-player.css';

interface MemberStageProps {
  c: MemberCase;
  hero: PlayerMetricKey;
  snapshot: MetricSnapshot;
  series: MetricSeries;
  /** 상담사·내 PiP 또는 오프라인 현장 카드 */
  slotTop: ReactNode;
  /** 오프라인 현장 안내 카드(상담사·내 PiP 자리를 대신한다) */
  sideCard: ReactNode;
  /** 시트가 열려 있는지 — 모바일 바텀 시트에서는 링 아래 카드를 접는다 */
  sheetOpen: boolean;
  onSlotAction: (act: SlotAction) => void;
  /** M19 전체 안내 카드 */
  netDownCard: ReactNode;
}

/** 위·아래 슬롯 높이를 재서 링이 쓸 수 있는 높이에서 예약분을 뺀다 */
function useStageReserve(stageRef: React.RefObject<HTMLDivElement | null>, topRef: React.RefObject<HTMLDivElement | null>, bottomRef: React.RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!stage || !top || !bottom) return undefined;
    const contentHeight = (el: HTMLElement): number =>
      [...el.children].reduce((sum, child) => (child instanceof HTMLElement && child.offsetParent !== null ? sum + child.offsetHeight : sum), 0);
    const measure = (): void => {
      stage.style.setProperty('--reserve', `${Math.max(contentHeight(top), contentHeight(bottom)) + 16}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => window.removeEventListener('resize', measure);
  });
}

function ringAriaLabel(c: MemberCase, label: string, valueText: string | null): string {
  const flat = (s?: string): string => (s ?? '').replace(/\n/g, ' ');
  if (c.ring.core === 'gauge') return `지표 게이지 — ${label}${valueText ? ` ${valueText}` : ''}`;
  if (c.ring.core === 'dim') return `지표 게이지 — ${label}${valueText ? ` ${valueText}` : ''} ${flat(c.ring.subtitle)}`;
  return `지표 게이지 — ${flat(c.ring.title)} ${flat(c.ring.subtitle)}`.trim();
}

function HeroRing({ c, hero, snapshot }: Pick<MemberStageProps, 'c' | 'hero' | 'snapshot'>) {
  const def = metricDef(hero);
  const raw = snapshot[hero];
  // SDD-244: 저장되는 DisplaySnapshot과 같은 표시 규칙(displayedInteger)을 쓴다
  const value = displayedInteger(raw);
  const { ring } = c;
  const waiting = ring.core === 'gauge' && value === null;
  return (
    <StatusRing
      variant="hero"
      core={ring.core}
      tone={ring.tone}
      fraction={ring.core === 'msg' ? null : metricFraction(hero, value)}
      label={ring.showValue ? def.label : undefined}
      value={ring.showValue ? value : undefined}
      unit={def.unit}
      title={ring.title}
      subtitle={waiting ? '측정하는 중이에요' : ring.subtitle}
      icon={ring.icon === 'alert' ? <TriangleAlert size={24} strokeWidth={2} /> : undefined}
      dots={ring.dots}
      ariaLabel={ringAriaLabel(c, def.label, value === null ? null : `${value}${def.unit}`)}
    />
  );
}

function GuideChip({ c, hero, snapshot, series }: Pick<MemberStageProps, 'c' | 'hero' | 'snapshot' | 'series'>) {
  if (c.notice) {
    return <NoticeBanner tone={c.notice.tone} icon={<MemberIcon name={c.notice.icon} />}>{c.notice.text}</NoticeBanner>;
  }
  // 지표 링이 아닌 안내 링(밴드 없음 등)이거나 아직 값이 쌓이지 않았으면 "최근 5분간 …" 문구를 내지 않는다.
  if (c.ring.core !== 'gauge' || !hasTrendData(series[hero], snapshot[hero])) return null;
  return (
    <div className="mp-guide-plain">
      <NoticeBanner tone="info" icon={null}>{METRIC_GUIDE[hero]}</NoticeBanner>
    </div>
  );
}

function TrendCard({ hero, series }: Pick<MemberStageProps, 'hero' | 'series'>) {
  const gradientId = useId();
  const points = series[hero];
  const geometry = sparkGeometry(points, hero);
  return (
    <section className="mp-card mp-trend" data-pz="trend" aria-label="최근 5분 추이">
      <div className="mp-trend__text">
        <span className="mp-trend__label">최근 5분 · {metricDef(hero).label}</span>
        <b className="mp-trend__change">{formatTrendChange(points)}</b>
      </div>
      <div className="mp-spark">
        {geometry ? (
          <>
            <svg viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#01F0C8" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#01F0C8" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="mp-spark__area" d={geometry.area} fill={`url(#${gradientId})`} />
              <path className="mp-spark__line" d={geometry.line} />
            </svg>
            <i className="mp-spark__end" style={{ top: `${geometry.endY}%` }} />
          </>
        ) : (
          <p className="mp-spark__wait">값이 쌓이는 중이에요</p>
        )}
      </div>
    </section>
  );
}

function SlotCard({ card, onAction }: { card: NonNullable<MemberCase['slot']>; onAction: (act: SlotAction) => void }) {
  const coral = card.tone === 'coral';
  return (
    <section className={`mp-card mp-info${card.steps ? ' mp-info--steps' : ''}${coral ? ' mp-info--coral' : ''}`} data-pz="info-card">
      <span className="mp-info__ic"><MemberIcon name={card.icon} /></span>
      <div className="mp-info__tx">
        {card.title ? <b>{card.title}</b> : null}
        {card.text ? <p>{card.text}</p> : null}
        {card.steps ? <ol>{card.steps.map((step) => <li key={step}>{step}</li>)}</ol> : null}
      </div>
      {card.action ? (
        <button type="button" className="mp-pill mp-pill--small" onClick={() => onAction(card.action!.act)}>{card.action.label}</button>
      ) : null}
    </section>
  );
}

export function MemberStage({ c, hero, snapshot, series, slotTop, sideCard, sheetOpen, onSlotAction, netDownCard }: MemberStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useStageReserve(stageRef, topRef, bottomRef);

  return (
    <div className="mp-stage" ref={stageRef} data-net={c.netDown ? 'down' : c.conn.ok ? 'ok' : 'reconnecting'} data-sheet-open={sheetOpen ? 'true' : 'false'}>
      <NoticeOverlay>
        {c.banner ? (
          <NoticeBanner tone="coral" variant="banner" icon={<MemberIcon name="wifiOff" />}>
            <b>{c.banner.title}</b>
            <span>{c.banner.text}</span>
          </NoticeBanner>
        ) : null}
      </NoticeOverlay>
      {c.netDown ? (
        netDownCard
      ) : (
        <>
          <div className="mp-slot-top" ref={topRef}>
            {slotTop}
            {sideCard ? <div className="mp-hero-side">{sideCard}</div> : null}
          </div>
          <HeroRing c={c} hero={hero} snapshot={snapshot} />
          <div className="mp-slot-bottom" ref={bottomRef}>
            <div className="mp-stack">
              <GuideChip c={c} hero={hero} snapshot={snapshot} series={series} />
              {c.showTrend ? <TrendCard hero={hero} series={series} /> : null}
              {c.slot ? <SlotCard card={c.slot} onAction={onSlotAction} /> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
