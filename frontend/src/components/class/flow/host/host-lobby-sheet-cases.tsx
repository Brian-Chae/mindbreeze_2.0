// SDD-209 H6 — 하니스 픽스처: FH06a 로비 시트 11케이스(시안 host-b.html toolSheet)
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import { LobbySheetFixture, type LobbySheetCase } from './LobbySheetFixture';

function sheetCase(description: string, spec: LobbySheetCase): FlowCaseEntry {
  return { description, render: (ctx) => <LobbySheetFixture spec={spec} backdropSrc={ctx.backdropSrc} /> };
}

export const hostLobbySheetCases: Record<string, FlowCaseEntry> = {
  'FH06a:invite': sheetCase('회원 초대 — 입장 전 3명(초대했어요·재발송 요청 결과·입장 코드 복사)', { kind: 'invite', lobby: 'g-on-3' }),
  'FH06a:invite-all': sheetCase('회원 초대 — 전원 입장', { kind: 'invite', lobby: 'g-on-8' }),
  'FH06a:bgm': sheetCase('BGM', { kind: 'bgm', lobby: 'g-on-3' }),
  'FH06a:band': sheetCase('내 밴드 — 미연결', { kind: 'band', lobby: 'g-on-3', band: { connected: false, leadOff: null } }),
  'FH06a:band-on': sheetCase('내 밴드 — 연결됨·접촉 양호(트래커 숨김, 칩만)', { kind: 'band', lobby: 'g-on-3', band: { connected: true, leadOff: { ch1: false, ch2: false } } }),
  'FH06a:band-bad-l': sheetCase('내 밴드 — L 전극 접촉 실패', { kind: 'band', lobby: 'g-on-3', band: { connected: true, leadOff: { ch1: true, ch2: false } } }),
  'FH06a:band-bad-r': sheetCase('내 밴드 — R 전극 접촉 실패', { kind: 'band', lobby: 'g-on-3', band: { connected: true, leadOff: { ch1: false, ch2: true } } }),
  'FH06a:band-bad-lr': sheetCase('내 밴드 — L·R 모두 접촉 실패', { kind: 'band', lobby: 'g-on-3', band: { connected: true, leadOff: { ch1: true, ch2: true } } }),
  'FH06a:speak': sheetCase('발언권', { kind: 'speak', lobby: 'g-on-3' }),
  'FH06a:chat': sheetCase('채팅 켜짐', { kind: 'chat', lobby: 'g-on-3', chatEnabled: true }),
  'FH06a:chat-off': sheetCase('채팅 꺼짐', { kind: 'chat', lobby: 'g-on-3', chatEnabled: false }),
};
