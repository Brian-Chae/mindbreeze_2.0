// SDD-209 SH1 — 회원 입장 CTA 판정(홈 히어로·상세 푸터 공용). 입장은 초대된 회원의 `POST /sessions/{id}/enter` 로 이어진다(useEnterClass).
import type { ClassChipKey } from './class-labels';

export type EnterActionKind = 'enter' | 'view' | 'report' | 'list' | 'disabled';

export interface EnterAction {
  kind: EnterActionKind;
  label: string;
  disabled: boolean;
  /** 버튼 위 보조 안내 한 줄 */
  note: string;
  /** 윤곽선 버튼으로 그린다(보조 동작) */
  line: boolean;
}

/** 상세(FM03) 하단 CTA */
export function deriveDetailAction(chip: ClassChipKey): EnterAction {
  switch (chip) {
    case 'open':
    case 'live':
      return { kind: 'enter', label: '입장하기', disabled: false, note: '준비는 2분이면 끝나요', line: false };
    case 'soon':
      return { kind: 'enter', label: '입장 대기하기', disabled: false, note: '미리 입장해서 기다릴 수 있어요', line: false };
    case 'done':
      return { kind: 'report', label: '리포트 보기', disabled: false, note: 'AI 기록으로 만든 리포트예요', line: false };
    case 'cancelled':
      return { kind: 'list', label: '클래스 목록 보기', disabled: false, note: '이 클래스에는 입장할 수 없어요', line: true };
    default:
      return { kind: 'disabled', label: '입장하기', disabled: true, note: '클래스가 열리면 알려드려요', line: false };
  }
}

/** 홈 히어로(FM01) CTA */
export function deriveHeroAction(chip: ClassChipKey): EnterAction {
  switch (chip) {
    case 'open':
    case 'live':
      return { kind: 'enter', label: '입장하기', disabled: false, note: '', line: false };
    case 'soon':
      return { kind: 'enter', label: '입장 대기하기', disabled: false, note: '', line: false };
    default:
      return { kind: 'view', label: '클래스 보기', disabled: false, note: '', line: true };
  }
}
