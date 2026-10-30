// SDD-209 H7 — 하니스 픽스처: FH07 시작 확인 12케이스 · FH08 나가기·닫기 3케이스(시안 host-b.html fh07/fh08)
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import { LobbyOverlayFixture, type LobbyOverlaySpec } from './LobbyOverlayFixture';

function overlay(description: string, spec: LobbyOverlaySpec): FlowCaseEntry {
  return { description, render: (ctx) => <LobbyOverlayFixture spec={spec} backdropSrc={ctx.backdropSrc} /> };
}

const start = (lobby: string, extra: Partial<Extract<LobbyOverlaySpec, { kind: 'start' }>> = {}): LobbyOverlaySpec => ({
  kind: 'start', lobby, micOn: true, recordChecked: true, excluded: 0, research: 0, ...extra,
});

export const hostStartCases: Record<string, FlowCaseEntry> = {
  'FH07:ok': overlay('전원 준비 완료 — 간단 확인(리포트 제외 2명·연구 동의 5명 줄)', start('g-on-8', { excluded: 2, research: 5 })),
  'FH07:pending': overlay('일부 준비 중 — 준비 중 회원 목록', start('g-on-3')),
  'FH07:all-wait': overlay('전원 준비 중(준비 완료 0명)', start('g-on-3-wait')),
  'FH07:many-wait': overlay('준비 중 8명 — 3명만 보이고 외 N명 접기', start('g-on-12-many')),
  'FH07:mic-off': overlay('마이크 꺼짐, 수동 기록으로 진행(코치 선택)', start('g-on-3', { micOn: false })),
  'FH07:no-consent': overlay('코치가 녹음 체크 해제, 수동 기록으로 진행(제외·연구 동의 0명이라 줄 없음)', start('g-on-8', { recordChecked: false })),
  'FH07:offline': overlay('오프라인 — 준비 중 회원(장소 행)', start('g-off-3')),
  'FH07:one': overlay('1:1 — 준비 완료(연구 동의 1명 한 줄)', start('o-on-1r', { research: 1 })),
  'FH07:one-wait': overlay('1:1 — 준비 중', start('o-on-1')),
  'FH07:empty-wait': overlay('대기실 0명 — 온라인·그룹', start('g-on-0')),
  'FH07:empty-wait-offline': overlay('대기실 0명 — 오프라인', start('g-off-0')),
  'FH07:empty-wait-one': overlay('대기실 0명 — 온라인·1:1', start('o-on-0')),
  'FH08:choose': overlay('선택 — 대기 회원 3명', { kind: 'leave', lobby: 'g-on-3', stage: 'choose' }),
  'FH08:choose-0': overlay('선택 — 대기 회원 0명', { kind: 'leave', lobby: 'g-on-0', stage: 'choose' }),
  'FH08:confirm': overlay('클래스 닫기 재확인 (코랄)', { kind: 'leave', lobby: 'g-on-3', stage: 'confirm' }),
};
