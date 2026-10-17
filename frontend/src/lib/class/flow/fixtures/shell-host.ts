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
  FH04: {
    ready: '준비(일정 없음) · 클래스 열기, 코드 복사 비활성',
    scheduled: '예정 · 클래스 열기',
    open: '입장 가능 · 입장 코드 표시·복사, 클래스 닫기 행',
    progress: '진행 중 · 클래스 취소 숨김',
    completed: '완료 · 코드가 닫혔어요 · 기록 보기',
    cancelled: '취소 · 복제해서 만들기',
    offline: '오프라인 1:1 · 장소 주소',
    menu: '더보기 시트(복제·템플릿 저장·삭제)',
    cancel: '클래스 취소 확인 시트',
    close: '클래스 닫기 확인 시트',
    delete: '클래스 삭제 확인 시트',
    net: '연결 끊김 안내',
    'email-invites': '이메일 초대 현황 · 다시 보내기',
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
