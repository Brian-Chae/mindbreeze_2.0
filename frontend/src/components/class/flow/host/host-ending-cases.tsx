// SDD-209 H8 — 하니스 픽스처: FH09 9케이스(종료 확인 2 + 종료 씬 7)
import { ChevronLeft, Home } from 'lucide-react';
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import { ENDING_FIXTURES } from '../../../../lib/class/flow/host-ending-fixtures';
import { deriveEnding } from '../../../../lib/class/flow/host-ending-model';
import { LOBBY_TITLE } from '../../../../lib/class/flow/host-lobby-fixtures';
import { EndConfirmScreen, EndingScene } from './EndingScreen';

const BACK = { label: '뒤로', icon: <ChevronLeft size={20} aria-hidden="true" /> };
const HOME = { label: '홈으로', icon: <Home size={20} aria-hidden="true" /> };

function confirmCase(description: string, busy: boolean): FlowCaseEntry {
  return {
    description,
    render: (ctx) => <EndConfirmScreen title={LOBBY_TITLE} sub="진행 중 · 온라인 · 그룹" headcount={8} busy={busy} left={BACK} backdropSrc={ctx.backdropSrc} onEnd={() => undefined} onContinue={() => undefined} />,
  };
}

function sceneCase(description: string, key: keyof typeof ENDING_FIXTURES): FlowCaseEntry {
  return {
    description,
    render: (ctx) => <EndingScene view={deriveEnding(ENDING_FIXTURES[key])} title={LOBBY_TITLE} left={HOME} backdropSrc={ctx.backdropSrc} onOpenRecord={() => undefined} />,
  };
}

export const hostEndingCases: Record<string, FlowCaseEntry> = {
  'FH09:confirm': confirmCase('종료 확인 시트', false),
  'FH09:confirm-busy': confirmCase('종료 확인 — 끝내는 중', true),
  'FH09:end-saving': sceneCase('종료 씬 — 녹음 저장 중', 'end-saving'),
  'FH09:end-stt': sceneCase('종료 씬 — 음성 인식 중', 'end-stt'),
  'FH09:end-ai': sceneCase('종료 씬 — AI 요약 중', 'end-ai'),
  'FH09:end-done': sceneCase('종료 씬 — 리포트 완료', 'end-done'),
  'FH09:manual-ing': sceneCase('수동 기록 모드 — 진행 중', 'manual-ing'),
  'FH09:manual-done': sceneCase('수동 기록 모드 — 완료', 'manual-done'),
  'FH09:excluded-common': sceneCase('종료 씬 — 리포트 제외 참가자가 있어 그룹 공통 요약 제외 안내', 'excluded-common'),
};
