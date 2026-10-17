// SDD-209 SH — 상담사 셸형 케이스(FH01 목록 · FH04 상세) 픽스처. 렌더는 shell-cases.tsx 가 맡는다(.ts 라 JSX 를 못 쓴다).
import { renderShellCase } from '../../../../components/class/flow/shell/shell-cases';
import type { FlowCaseEntry } from '../types';

const SHELL_HOST_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  FH01: {
    open: '열린 클래스 상단 고정 · 이어서 열기/시작하기/클래스 닫기',
    'open-offline': '열린 클래스(오프라인 1:1)',
    progress: '진행 중 클래스 · 이어서 열기',
    idle: '열린 클래스 없음 · 다음 클래스 카드',
    empty: '클래스 없음 · 첫 클래스 만들기',
    past: '지난 클래스 탭',
    net: '연결 끊김 안내',
  },
};

export const flowCases: Record<string, FlowCaseEntry> = Object.fromEntries(
  Object.entries(SHELL_HOST_KEYS).flatMap(([screen, keys]) =>
    Object.entries(keys).map(([key, description]): [string, FlowCaseEntry] => [
      `${screen}:${key}`,
      { description, render: () => renderShellCase(screen, key) },
    ]),
  ),
);
