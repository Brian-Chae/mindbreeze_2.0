// SDD-209 M — 회원 케이스 픽스처 공용 값(시안 member-a/b 고정 시연값). flowCases 를 내보내지 않으므로 레지스트리는 건너뛴다.
import { parseFlowCaseRef } from '../case-key';
import type { FlowBandMode, FlowPlace, FlowPrepCaseKey, FlowSize } from '../types';

export const DEMO = {
  title: '마음챙김 명상 · 4회차',
  soloTitle: '마음챙김 상담 · 3회차',
  host: '채용욱',
  hostLabel: '채용욱 코치',
  time: '오늘 오후 3:00',
  startLabel: '오늘 오후 3:00 시작',
  place: '서울 강남구 테헤란로 123, 5층 명상실',
  placeShort: '5층 명상실',
  name: '김서연',
  guestName: '지은',
  maskedEmail: 'se***@example.com',
  retentionDays: 90,
} as const;

export interface PrepCase {
  place: FlowPlace;
  size: FlowSize;
  bandMode: FlowBandMode;
  state: string;
  started: boolean;
  title: string;
}

/** 케이스 키 → 준비 마법사 입력. 밴드 모드 토큰이 없는 키(FM08·FM09)는 opt 로 둔다 */
export function prepCaseOf(ref: string): PrepCase {
  const parsed = parseFlowCaseRef(ref);
  if (!parsed || parsed.kind !== 'prep') throw new Error(`준비 흐름 케이스 키가 아니에요: ${ref}`);
  return fromPrep(parsed);
}

function fromPrep(parsed: FlowPrepCaseKey): PrepCase {
  return {
    place: parsed.place,
    size: parsed.size,
    bandMode: parsed.bandMode ?? 'opt',
    state: parsed.state,
    started: parsed.started,
    title: parsed.size === 'solo' ? DEMO.soloTitle : DEMO.title,
  };
}
