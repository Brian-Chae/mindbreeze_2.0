// SDD-209 H1~H3 — 하니스 픽스처: FH02a~e 마법사·FH03 생성 완료. 시안(host-a.html)의 PRESET 을 그대로 옮겼다.
// 입력은 서버·BLE 없이 고정값이고, 마법사 뷰는 useReducer 로 실제처럼 조작된다.
import { createInitialState, type WizardDraft, type WizardState, type WizardStep } from '../../../../lib/class/class-wizard';
import { fixtureDraft } from '../../../../lib/class/flow/host-fixture-data';
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import { WizardFixture } from './WizardFixture';

function wizardCase(step: WizardStep, description: string, patch: Partial<WizardDraft> = {}, ui: Partial<WizardState['ui']> = {}, conflictTitle: string | null = null): FlowCaseEntry {
  const base = createInitialState(fixtureDraft(patch));
  const initial: WizardState = { ...base, step, ui: { ...base.ui, ...ui } };
  return { description, render: (ctx) => <WizardFixture initial={initial} backdropSrc={ctx.backdropSrc} conflictTitle={conflictTitle} /> };
}

export const hostCreateCases: Record<string, FlowCaseEntry> = {
  'FH02a:online-group': wizardCase(1, '온라인 · 그룹 · 정원 10명'),
  'FH02a:online-group-max': wizardCase(1, '온라인 그룹 정원 50명 도달 · + 비활성 + 안내', { capacity: 50 }),
  'FH02a:online-1to1': wizardCase(1, '온라인 · 1:1 (최대 1명 고정)', { size: 'solo' }),
  'FH02a:offline-group': wizardCase(1, '오프라인 · 그룹 (주소 입력)', { place: 'offline' }),
  'FH02a:offline-1to1': wizardCase(1, '오프라인 · 1:1', { place: 'offline', size: 'solo' }),
  'FH02a:custom': wizardCase(1, '기타 유형 선택 · 이름 입력', { type: 'other', customName: '감정 코칭' }),
  'FH02a:leave': wizardCase(1, '나가기 확인 시트', {}, { leaveOpen: true }),
  'FH02b:none': wizardCase(2, 'LINK BAND 사용 안 함', { band: 'none' }),
  'FH02b:optional': wizardCase(2, 'LINK BAND 선택'),
  'FH02b:required': wizardCase(2, 'LINK BAND 필수(참가는 막지 않음)', { band: 'required' }),
  'FH02b:offline': wizardCase(2, '오프라인(영상 녹화 자리를 안내로 대체)', { place: 'offline' }),
  'FH02c:now': wizardCase(3, '지금 바로', { when: 'now' }),
  'FH02c:later': wizardCase(3, '시간 예약'),
  'FH02c:conflict': wizardCase(3, '시간 예약 · 같은 시간 클래스 있음', {}, {}, '박지우 님 1차 상담'),
  'FH02c:long': wizardCase(3, '1시간 30분 표기', { durationMin: 90, timeMin: 1005 }),
  'FH02d:empty': wizardCase(4, '선택 없음', { members: [] }),
  'FH02d:picked': wizardCase(4, '3명 선택'),
  'FH02d:solo': wizardCase(4, '1:1 · 1명 고정', { size: 'solo', members: fixtureDraft().members.slice(0, 1) }),
  'FH02d:search': wizardCase(4, '검색 결과', { members: [{ id: 'm5', name: '정서아', email: 'seoa@example.com' }] }, { memberQuery: '서' }),
  'FH02d:email': wizardCase(
    4, '비회원 이메일 초대(R5) · 형식 오류 인라인',
    { members: fixtureDraft().members.slice(0, 1), emails: ['hana.park@example.com', 'guest.lee@example.com'] },
    { inviteTab: 'email', mailInput: 'minsu@', mailError: true },
  ),
  'FH02e:online': wizardCase(5, '온라인 · 그룹 · 예약 · 이메일 초대 포함', { emails: ['hana.park@example.com'] }),
  'FH02e:offline': wizardCase(5, '오프라인 · 1:1 · 지금 바로', {
    place: 'offline', size: 'solo', band: 'none', when: 'now', video: false, title: '김서연 님 3차 상담', members: fixtureDraft().members.slice(0, 1),
  }),
};
