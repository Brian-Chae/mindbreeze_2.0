// SDD-208 H1·H2 — 칩 줄: 가운데 정렬, 한 줄을 넘으면 선택 칩부터 접고 뒤에서부터 접어 "+N"(CS4).
// 칩은 조치가 필요한 것(손든 회원·필요 조치·대기)과 상태(녹음·내 밴드·밴드 요약)를 아이콘 + 글자로 함께 전한다.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowUpDown, ClipboardCheck, Hand, Mic, Pause, TriangleAlert, Users, X } from 'lucide-react';
import { fitChipCount, type HostBand, type HostChip, type HostSheetKey } from '../../../../lib/class/host-player-case';
import { useElementSize } from './useElementSize';
import './host-player.css';

const BAND_TEXT: Record<HostBand, string> = { on: '연결됨', off: '밴드 미착용', lost: '연결 끊김', leadoff: '접촉 불량' };
const BAND_DOT: Record<HostBand, 'on' | 'off' | 'lost'> = { on: 'on', off: 'off', lost: 'lost', leadoff: 'lost' };

const CHIP_GAP = 4;

export interface HostChipHandlers {
  onSheet: (sheet: HostSheetKey) => void;
  onRevoke: (participantId: string) => void;
  onToggleHandsFirst: () => void;
  onClearFilter: () => void;
}

interface ChipItem {
  key: string;
  optional: boolean;
  node: ReactNode;
}

function chipItem(chip: HostChip, handlers: HostChipHandlers): ChipItem {
  switch (chip.key) {
    case 'rec':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={chip.label} onClick={() => handlers.onSheet('media')}>
            {chip.paused ? (
              <span className="hp-ap" data-tone="pause"><Pause aria-hidden="true" strokeWidth={2} />기록 일시정지</span>
            ) : (
              <span className="hp-ap" data-tone="rec"><i className="hp-rdot" aria-hidden="true" />녹음 중 <b>{chip.elapsed}</b></span>
            )}
          </button>
        ),
      };
    case 'checkin':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={chip.label} onClick={() => handlers.onSheet('checkin')}>
            <span className="hp-ap"><ClipboardCheck aria-hidden="true" strokeWidth={2} />체크인 <b>{chip.done}/{chip.total}</b></span>
          </button>
        ),
      };
    case 'speak':
      return {
        key: chip.key, optional: false,
        node: (
          <>
            <button type="button" className="hp-achip" aria-label={chip.label} onClick={() => handlers.onSheet('hands')}>
              <span className="hp-ap" data-tone="speak"><Mic aria-hidden="true" strokeWidth={2} />{chip.name} 말하는 중</span>
            </button>
            <button type="button" className="hp-achip" aria-label={`${chip.name} 발언권 회수`} onClick={() => handlers.onRevoke(chip.participantId)}>
              <span className="hp-ap" data-tone="act">회수</span>
            </button>
          </>
        ),
      };
    case 'hands':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={chip.label} onClick={() => handlers.onSheet('hands')}>
            <span className="hp-ap" data-tone="hand"><Hand aria-hidden="true" strokeWidth={2} />손든 회원 <b>{chip.count}</b></span>
          </button>
        ),
      };
    case 'actions':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={`필요 조치 · ${chip.label}`} onClick={() => handlers.onSheet('actions')}>
            <span className="hp-ap" data-tone={chip.leadOff ? 'warn' : 'caution'}>
              <TriangleAlert aria-hidden="true" strokeWidth={2} />
              {chip.leadOff ? <>접촉 확인 <b>{chip.leadOff}</b></> : null}
              {chip.leadOff && chip.lowBattery ? ' · ' : null}
              {chip.lowBattery ? <>배터리 <b>{chip.lowBattery}</b></> : null}
            </span>
          </button>
        ),
      };
    case 'queue':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={chip.label} onClick={() => handlers.onSheet('queue')}>
            <span className="hp-ap"><Users aria-hidden="true" strokeWidth={2} />대기 <b>{chip.count}</b></span>
          </button>
        ),
      };
    case 'signals':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={chip.label} onClick={() => handlers.onSheet('checkin')}>
            <span className="hp-ap"><Activity aria-hidden="true" strokeWidth={2} />조용한 신호 <b>{chip.count}</b></span>
          </button>
        ),
      };
    case 'myband':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={chip.label} onClick={() => handlers.onSheet('myband')}>
            <span className="hp-ap">
              <i className="hp-dot" data-state={chip.state === 'connected' ? 'on' : 'off'} />
              {chip.state === 'connected'
                ? <>내 밴드 연결됨{chip.relaxation !== null ? <> · 이완 <b>{chip.relaxation}</b></> : null}</>
                : chip.state === 'connecting' ? '내 밴드 연결 중'
                  : chip.state === 'unsupported' ? '내 밴드 미지원 · 선택' : '내 밴드 미착용 · 선택'}
            </span>
          </button>
        ),
      };
    case 'first':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-pressed={chip.on} aria-label={chip.label} onClick={handlers.onToggleHandsFirst}>
            <span className="hp-ap" data-tone={chip.on ? 'on' : undefined}><ArrowUpDown aria-hidden="true" strokeWidth={2} />손든 회원 우선</span>
          </button>
        ),
      };
    case 'filter':
      return {
        key: chip.key, optional: false,
        node: (
          <button type="button" className="hp-achip" aria-label={`${chip.label} 해제`} onClick={handlers.onClearFilter}>
            <span className="hp-ap" data-tone="on">{chip.label.replace('필터 · ', '')}<X aria-hidden="true" strokeWidth={2} /></span>
          </button>
        ),
      };
    case 'band':
      return {
        key: chip.key, optional: false,
        node: chip.solo && chip.soloBand ? (
          <span className="hp-achip" role="group" aria-label="밴드 상태">
            <span className="hp-ap" data-size="sm">
              <span className="hp-ap__sg"><i className="hp-dot" data-state={BAND_DOT[chip.soloBand]} />밴드 {BAND_TEXT[chip.soloBand]}</span>
            </span>
          </span>
        ) : (
          <span className="hp-achip" role="group" aria-label="밴드 상태 요약">
            <span className="hp-ap" data-size="sm">
              <span className="hp-ap__sg"><i className="hp-dot" data-state={chip.on > 0 ? 'on' : 'zero'} />연결 <b>{chip.on}</b></span>
              <span className="hp-ap__sg"><i className="hp-dot" data-state="off" />미착용 <b>{chip.off}</b></span>
              <span className="hp-ap__sg"><i className="hp-dot" data-state={chip.lost > 0 ? 'lost' : 'zero'} />끊김 <b>{chip.lost}</b></span>
            </span>
          </span>
        ),
      };
  }
}

interface HostChipLineProps {
  chips: readonly HostChip[];
  /** 그리드가 스크롤될 때만 있는 "1–8 / 20명" 문구(선택 칩 — 가장 먼저 접힌다) */
  range: string | null;
  handlers: HostChipHandlers;
  /** 접힌 칩 목록을 여는 "+N" 버튼 */
  onMore: () => void;
}

export function HostChipLine({ chips, range, handlers, onMore }: HostChipLineProps) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const { ref: sizeRef, size } = useElementSize<HTMLDivElement>();
  const itemRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [fit, setFit] = useState<{ hiddenKeys: string; hidden: number }>({ hiddenKeys: '', hidden: 0 });

  const items: ChipItem[] = [
    ...chips.map((chip) => chipItem(chip, handlers)),
    ...(range ? [{ key: 'range', optional: true, node: <span className="hp-achip"><span className="hp-ap hp-range"><b>{range}</b></span></span> }] : []),
  ];

  // 칩 내용(라벨)이나 줄 폭이 바뀔 때만 다시 잰다
  const signature = `${chips.map((c) => c.label).join('|')}#${range ?? ''}#${size.width}`;
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const keys = items.map((i) => i.key);
    const widths = keys.map((k) => itemRefs.current.get(k)?.offsetWidth ?? 0);
    const result = fitChipCount({
      widths,
      optional: items.map((i) => i.optional),
      avail: line.clientWidth,
      gap: CHIP_GAP,
      moreWidth: moreRef.current?.offsetWidth ?? 56,
    });
    const hiddenKeys = keys.filter((_, idx) => !result.visible.includes(idx)).join(',');
    setFit((prev) => (prev.hiddenKeys === hiddenKeys && prev.hidden === result.hidden ? prev : { hiddenKeys, hidden: result.hidden }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items 는 매 렌더 새 배열이라 signature 로 갈음한다
  }, [signature]);

  const hiddenSet = new Set(fit.hiddenKeys ? fit.hiddenKeys.split(',') : []);
  return (
    <div
      className="hp-chipline"
      data-pz="chipline"
      ref={(node) => {
        lineRef.current = node;
        sizeRef(node);
      }}
    >
      {items.map((item) => (
        <span
          key={item.key}
          className="hp-chipgrp"
          data-hidden={hiddenSet.has(item.key) ? 'true' : undefined}
          aria-hidden={hiddenSet.has(item.key) ? true : undefined}
          ref={(node) => {
            if (node) itemRefs.current.set(item.key, node);
            else itemRefs.current.delete(item.key);
          }}
        >
          {item.node}
        </span>
      ))}
      <button
        type="button"
        className="hp-achip"
        ref={moreRef}
        aria-label="나머지 보기"
        data-hidden={fit.hidden > 0 ? undefined : 'true'}
        onClick={onMore}
      >
        <span className="hp-ap"><b>+{fit.hidden}</b></span>
      </button>
    </div>
  );
}
