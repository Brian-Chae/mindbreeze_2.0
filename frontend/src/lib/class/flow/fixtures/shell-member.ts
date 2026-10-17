// SDD-209 SH — 회원 셸형 케이스(FM01 홈 · FM02 목록 · FM03 상세) 픽스처. 렌더는 shell-cases.tsx 가 맡는다(.ts 라 JSX 를 못 쓴다).
import { renderShellCase } from '../../../../components/class/flow/shell/shell-cases';
import type { FlowCaseEntry } from '../types';

const SHELL_MEMBER_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  FM01: {
    upcoming: '예정된 클래스(D-3) · 클래스 보기',
    soon: '곧 열림(30분 뒤) · 입장 대기하기',
    open: '입장 가능 · 입장하기',
    live: '진행 중(12분째) · 입장하기',
    empty: '예정 없음 · 클래스 신청하기',
  },
  FM02: {
    list: '입장 가능 최상단 · 예정 · 지난 클래스',
    invited: '초대받은 클래스 구역 추가',
    apply: '클래스 신청 바텀 시트',
  },
  FM03: {
    scheduled: '예정(온라인 그룹) · 입장하기 비활성',
    'scheduled-offline': '예정(오프라인 1:1) · 장소 안내',
    open: '입장 가능(온라인 그룹) · 입장하기',
    'open-offline': '입장 가능(오프라인 그룹, 밴드 권장) · 입장하기',
    'open-1on1': '입장 가능(온라인 1:1) · 입장하기',
    done: '완료 · 리포트 보기',
    cancelled: '취소 · 클래스 목록 보기',
  },
};

export const flowCases: Record<string, FlowCaseEntry> = Object.fromEntries(
  Object.entries(SHELL_MEMBER_KEYS).flatMap(([screen, keys]) =>
    Object.entries(keys).map(([key, description]): [string, FlowCaseEntry] => [
      `${screen}:${key}`,
      { description, render: () => renderShellCase(screen, key) },
    ]),
  ),
);
