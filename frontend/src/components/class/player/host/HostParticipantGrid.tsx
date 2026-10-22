// SDD-208 H1 — 참가자 타일 그리드(세로 스크롤, 페이지 버튼 없음) 와 표 보기.
// 타일은 고정 크기이고 열 수는 인원을 균등 분배하도록 고른다(CS1·CS2). 넘치면 이 영역 안에서만 스크롤한다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BatteryLow, Hand, Mic, Pause } from 'lucide-react';
import {
  computeHostGrid,
  hostValueOf,
  metricFraction,
  type HostBand,
  type HostParticipant,
} from '../../../../lib/class/host-player-case';
import { PLAYER_METRICS, type PlayerMetric } from '../../../../lib/class/player-case';
import { StatusRing } from '../shared/StatusRing';
import { useElementSize } from './useElementSize';
import './host-player.css';

const DOT_STATE: Record<HostBand, 'on' | 'off' | 'lost'> = { on: 'on', off: 'off', lost: 'lost', leadoff: 'lost' };

interface HostParticipantGridProps {
  participants: readonly HostParticipant[];
  metric: PlayerMetric;
  /** 전원 미착용(C13) — 링 대신 이니셜 + 체크인 응답 */
  allOff: boolean;
  netBad: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 스크롤 가능할 때만 "1–8 / 20명" 범위 문구를 올린다 */
  onRange: (text: string | null) => void;
  /** 1:1 큰 회원 카드 등 그리드를 대신하는 내용 */
  children?: ReactNode;
  table: boolean;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth;
}

function tileStatus(p: HostParticipant, netBad: boolean, warn: boolean): { tone: string | undefined; node: ReactNode } {
  if (p.presenceState !== 'connected') return { tone: undefined, node: (<><i className="hp-dot" data-state="off" />{presenceLabel(p)}</>) };
  if (p.speaking) return { tone: 'speak', node: (<><i className="hp-dot" data-state="on" />말하는 중</>) };
  if (p.hand) return { tone: 'hand', node: (<><Hand aria-hidden="true" strokeWidth={2} />손듦 · 대기 중</>) };
  if (netBad) return { tone: undefined, node: (<><Pause aria-hidden="true" strokeWidth={2} />수신 일시 중단</>) };
  if (p.lowBattery) return { tone: 'caution', node: (<><BatteryLow aria-hidden="true" strokeWidth={2} />배터리 낮음</>) };
  return { tone: warn ? 'warn' : undefined, node: (<><i className="hp-dot" data-state="on" />연결됨{warn ? ' · 살펴보기' : ''}</>) };
}

function checkinLabel(p: HostParticipant): string {
  if (p.checkinState === 'completed') return '체크인 완료';
  if (p.checkinState === 'not_completed') return '체크인 전';
  return '체크인 확인 중';
}
function presenceLabel(p: HostParticipant): string {
  if (p.presenceState === 'connected') return '참여 중';
  if (p.enteredAt === null) return '미입장';
  return p.presenceState === 'disconnected' ? '현재 미접속' : '접속 확인 중';
}

function HostTile({ p, metric, allOff, netBad, pressed, onSelect }: {
  p: HostParticipant; metric: PlayerMetric; allOff: boolean; netBad: boolean; pressed: boolean; onSelect: (id: string) => void;
}) {
  const value = hostValueOf(p, metric.key);
  const badge = p.speaking ? 'speak' : p.hand ? 'hand' : null;

  if (allOff) {
    return (
      <button type="button" className="hp-tile" data-pz="tile" data-away="true" data-band="off" data-hand={p.hand ? 'true' : undefined} data-speaking={p.speaking ? 'true' : undefined} data-participant-id={p.id}
        aria-pressed={pressed} aria-label={`${p.name} ${checkinLabel(p)} ${presenceLabel(p)}${p.hand ? ", 손들었어요" : ""}${p.speaking ? ", 말하는 중" : ""}`} onClick={() => onSelect(p.id)}>
        {badge ? <span className="hp-tile__badge" data-kind={badge} aria-hidden="true">{badge === 'speak' ? <Mic strokeWidth={2} /> : <Hand strokeWidth={2} />}</span> : null}
        <div className="hp-avring"><span className="hp-avt">{p.name.slice(0, 1)}</span></div>
        <span className="hp-tile__nm">{p.name}</span>
        <span className="hp-tile__st"><i className="hp-dot" data-state="off" />{p.speaking ? '말하는 중' : p.hand ? '손듦 · 대기 중' : `${checkinLabel(p)} · ${presenceLabel(p)}`}</span>
      </button>
    );
  }

  if (p.band === 'on') {
    const warn = metric.unit === '%' && value !== null && value < 50 && !p.hand && !p.speaking;
    const status = tileStatus(p, netBad, warn);
    return (
      <button type="button" className="hp-tile" data-pz="tile" data-band="on" data-participant-id={p.id}
        data-warn={warn ? 'true' : undefined} data-hand={p.hand ? 'true' : undefined} data-speaking={p.speaking ? 'true' : undefined}
        aria-pressed={pressed}
        aria-label={`${p.name} ${metric.label} ${value ?? '측정 중'}${value === null ? '' : metric.unit}${p.hand ? ', 손들었어요' : ''}${p.speaking ? ', 말하는 중' : ''}`}
        onClick={() => onSelect(p.id)}>
        {badge ? (
          <span className="hp-tile__badge" data-kind={badge} aria-hidden="true">{badge === 'speak' ? <Mic strokeWidth={2} /> : <Hand strokeWidth={2} />}</span>
        ) : null}
        <StatusRing variant="mini" fraction={value === null ? 0 : metricFraction(metric, value)} tone="live" colorVar={metric.colorVar} ariaLabel={`${metric.label} ${value ?? '측정 중'}`}>
          <b className="hp-ring-num">{value === null ? '—' : value}</b>
          <small className="hp-ring-label">{metric.short}</small>
        </StatusRing>
        <span className="hp-tile__nm">{p.name}</span>
        <span className="hp-tile__st" data-tone={status.tone}>{status.node}</span>
      </button>
    );
  }

  const leadoff = p.band === 'leadoff';
  const lost = p.band === 'lost';
  const ringTone = p.band === 'off' ? 'idle' : 'lost';
  const nb = leadoff ? '접촉' : lost ? '끊김' : '미착용';
  const statusText = p.presenceState !== 'connected' ? presenceLabel(p) : leadoff ? '접촉 불량 · 확인' : lost ? `연결 끊김 · ${p.agoLabel ?? '방금 전'}` : '밴드 없이 참여';
  const label = leadoff ? `${p.name} 접촉 불량` : lost ? `${p.name} 연결 끊김` : `${p.name} 밴드 미착용`;
  return (
    <button type="button" className="hp-tile" data-pz="tile" data-band={p.band} data-participant-id={p.id}
      data-hand={p.hand ? 'true' : undefined} data-speaking={p.speaking ? 'true' : undefined}
      data-away={leadoff ? undefined : 'true'} aria-pressed={pressed} aria-label={`${label}${p.hand ? ", 손들었어요" : ""}${p.speaking ? ", 말하는 중" : ""}`} onClick={() => onSelect(p.id)}>
      {badge ? <span className="hp-tile__badge" data-kind={badge} aria-hidden="true">{badge === 'speak' ? <Mic strokeWidth={2} /> : <Hand strokeWidth={2} />}</span> : null}
      <StatusRing variant="mini" fraction={null} tone={ringTone} ariaLabel={label}>
        <span className="hp-ring-nb" data-warn={leadoff || lost ? 'true' : undefined}>{nb}</span>
      </StatusRing>
      <span className="hp-tile__nm">{p.name}</span>
      <span className="hp-tile__st" data-tone={leadoff ? 'warn' : undefined}>
        <i className="hp-dot" data-state={DOT_STATE[p.band]} />{p.speaking ? '말하는 중' : p.hand ? '손듦 · 대기 중' : statusText}
      </span>
    </button>
  );
}

function HostTable({ participants, metric, selectedId, onSelect }: {
  participants: readonly HostParticipant[]; metric: PlayerMetric; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <div className="hp-tbl-wrap" data-pz="table">
      <table className="hp-tbl">
        <thead>
          <tr>
            <th scope="col">이름</th>
            {PLAYER_METRICS.map((m) => <th scope="col" key={m.key} data-sel={m.key === metric.key ? 'true' : undefined}>{m.short}</th>)}
          </tr>
        </thead>
        <tbody>
          {participants.map((p) => (
            <tr key={p.id} data-participant-id={p.id} aria-selected={selectedId === p.id} onClick={() => onSelect(p.id)}>
              <td>
                <button type="button" className="hp-tbl__open" onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}>
                  <span className="hp-tbl__nd"><i className="hp-dot" data-state={DOT_STATE[p.band]} />{p.name}</span>
                </button>
              </td>
              {PLAYER_METRICS.map((m) => {
                const v = hostValueOf(p, m.key);
                return <td key={m.key} data-sel={m.key === metric.key ? 'true' : undefined} data-mu={v === null ? 'true' : undefined}>{v === null ? '—' : v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HostParticipantGrid({ participants, metric, allOff, netBad, selectedId, onSelect, onRange, children, table }: HostParticipantGridProps) {
  const { ref, size, node } = useElementSize<HTMLDivElement>();
  const [fade, setFade] = useState({ top: false, bottom: false });
  const onRangeRef = useRef(onRange);
  useEffect(() => {
    onRangeRef.current = onRange;
  });

  // 시안과 같이 안쪽 여백(좌우 3px·상하 4px)을 뺀 영역으로 타일 크기를 계산한다
  const layout = computeHostGrid({ width: Math.max(0, size.width - 6), height: Math.max(0, size.height - 8), viewportWidth: viewportWidth(), count: participants.length });

  const updateScrollHints = useCallback(() => {
    if (!node) return;
    const up = node.scrollTop > 4;
    const down = node.scrollTop + node.clientHeight < node.scrollHeight - 4;
    setFade((prev) => (prev.top === up && prev.bottom === down ? prev : { top: up, bottom: down }));
    const scrollable = node.scrollHeight > node.clientHeight + 1;
    if (!scrollable || table) {
      onRangeRef.current(null);
      return;
    }
    const box = node.getBoundingClientRect();
    const tiles = [...node.querySelectorAll<HTMLElement>('[data-pz="tile"]')];
    let first = -1;
    let last = -1;
    tiles.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const visible = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
      if (visible > r.height * 0.5) {
        if (first < 0) first = i;
        last = i;
      }
    });
    onRangeRef.current(first < 0 ? null : `${first + 1}–${last + 1} / ${tiles.length}명`);
  }, [node, table]);

  useLayoutEffect(() => {
    updateScrollHints();
  });

  const gridStyle: CSSProperties = {
    ['--tw' as string]: `${layout.tileWidth}px`,
    ['--th' as string]: `${layout.tileHeight}px`,
    ['--rs' as string]: `${layout.ringSize}px`,
    ['--rf' as string]: layout.largeNumber ? 'var(--fs-36)' : 'var(--fs-24)',
    ['--mcol' as string]: `var(${metric.colorVar})`,
    gap: layout.gap,
    maxWidth: table || children ? undefined : layout.maxWidth,
  };

  return (
    <div className="hp-gridwrap">
      <div
        className="hp-gridscroll"
        data-pz="gridscroll"
        data-fade-t={fade.top ? 'true' : undefined}
        data-fade-b={fade.bottom ? 'true' : undefined}
        ref={ref}
        onScroll={updateScrollHints}
      >
        <div className="hp-grid" data-mode={children ? 'solo' : table ? 'table' : 'tiles'} data-net-bad={netBad ? 'true' : undefined} style={gridStyle}>
          {children ?? (table ? (
            <HostTable participants={participants} metric={metric} selectedId={selectedId} onSelect={onSelect} />
          ) : (
            participants.map((p) => (
              <HostTile key={p.id} p={p} metric={metric} allOff={allOff} netBad={netBad} pressed={selectedId === p.id} onSelect={onSelect} />
            ))
          ))}
        </div>
      </div>
    </div>
  );
}
