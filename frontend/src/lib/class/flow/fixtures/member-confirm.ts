// SDD-209 M1 — FM05(입장 확인) · FM10(취소·종료·미오픈·오류·끊김·입장 정보 만료) 케이스 픽스처.
import { createElement } from 'react';
import { EntryConfirmView } from '../../../../components/class/flow/member/EntryConfirmView';
import { MemberStateScreen } from '../../../../components/class/flow/member/MemberStateScreen';
import type { FlowStateKind } from '../member-machine';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { DEMO } from './member-common';

const noop = (): void => undefined;

interface ConfirmCase {
  description: string;
  identitySource: 'account' | 'input';
  wait: boolean;
  offline: boolean;
}

const CONFIRM: Record<string, ConfirmCase> = {
  member: { description: '로그인 회원 · 입장 가능', identitySource: 'account', wait: false, offline: false },
  'guest-name': { description: '비회원 · 입력한 정보로 확인', identitySource: 'input', wait: false, offline: false },
  'member-wait': { description: '아직 열리지 않음 · 열리면 자동 입장', identitySource: 'account', wait: true, offline: false },
  'member-offline': { description: '오프라인 · 1:1 · LINK BAND 사용 안 함(장소 줄)', identitySource: 'account', wait: false, offline: true },
};

const STATES: Record<FlowStateKind, string> = {
  cancelled: '클래스가 취소됐어요',
  closed: '이미 끝난 클래스예요',
  notyet: '아직 열리지 않았어요',
  error: '조회 실패 · 서버 문구 원문 노출 없음',
  offline: '네트워크 끊김',
  'entry-expired': '입장 정보 만료 · 코드 입력하기',
};

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const [key, c] of Object.entries(CONFIRM)) {
  flowCases[`FM05:${key}`] = {
    description: c.description,
    render: (ctx: FlowCaseContext) =>
      createElement(EntryConfirmView, {
        title: c.offline ? DEMO.soloTitle : DEMO.title,
        startLabel: DEMO.startLabel,
        hostName: DEMO.host,
        address: c.offline ? DEMO.place : null,
        place: c.offline ? 'offline' : 'online',
        size: c.offline ? 'solo' : 'group',
        bandMode: c.offline ? 'none' : 'opt',
        displayName: DEMO.guestName,
        identitySource: c.identitySource,
        wait: c.wait,
        backdropSrc: ctx.backdropSrc,
        onEnter: noop,
        onBack: noop,
      }),
  };
}

for (const [kind, description] of Object.entries(STATES) as Array<[FlowStateKind, string]>) {
  flowCases[`FM10:${kind}`] = {
    description,
    render: (ctx: FlowCaseContext) =>
      createElement(MemberStateScreen, {
        kind, classTitle: DEMO.title, whenLabel: DEMO.time, backdropSrc: ctx.backdropSrc, onPrimary: noop, onSecondary: noop,
      }),
  };
}
