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
};

export const flowCases: Record<string, FlowCaseEntry> = Object.fromEntries(
  Object.entries(SHELL_MEMBER_KEYS).flatMap(([screen, keys]) =>
    Object.entries(keys).map(([key, description]): [string, FlowCaseEntry] => [
      `${screen}:${key}`,
      { description, render: () => renderShellCase(screen, key) },
    ]),
  ),
);
