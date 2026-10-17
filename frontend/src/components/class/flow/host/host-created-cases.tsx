// SDD-209 H3 — 하니스 픽스처: FH03 생성 완료 7케이스(시안 host-a.html fh03 PRESET)
import type { WizardDraft } from '../../../../lib/class/class-wizard';
import { buildCreatedView, type CreatedInviteRow, type CreatedView } from '../../../../lib/class/flow/host-create-flow';
import { FIXTURE_BASE, fixtureDraft } from '../../../../lib/class/flow/host-fixture-data';
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import { maskEmail } from '../../../../lib/class/class-wizard';
import type { SessionDto } from '../../../../lib/api/session';
import { CreatedFixture } from './CreatedFixture';

const GUESTS = ['seoyeon.guest@example.com', 'hana.park@example.com'];

function fixtureView(draft: WizardDraft, failedMembers = 0, failedEmails = 0): CreatedView {
  const sent = draft.members.length - failedMembers;
  const rows: CreatedInviteRow[] = [
    ...draft.members.map((m, i): CreatedInviteRow => ({ key: `member:${m.id}`, kind: 'member', label: m.name, ok: i < sent, userId: m.id })),
    ...draft.emails.map((email, i): CreatedInviteRow => ({
      key: `email:${email}`, kind: 'email', label: maskEmail(email), ok: i < draft.emails.length - failedEmails, email,
    })),
  ];
  const session = { id: 'fixture-session', title: draft.title, access_code: '4827' } as SessionDto;
  return buildCreatedView(session, draft, FIXTURE_BASE, rows);
}

function createdCase(description: string, view: CreatedView): FlowCaseEntry {
  return { description, render: (ctx) => <CreatedFixture view={view} backdropSrc={ctx.backdropSrc} /> };
}

const NOW = { when: 'now' } as const;
const offlineSolo: Partial<WizardDraft> = { place: 'offline', size: 'solo', band: 'none', when: 'now', title: '김서연 님 3차 상담', members: fixtureDraft().members.slice(0, 1) };

export const hostCreatedCases: Record<string, FlowCaseEntry> = {
  'FH03:online': createdCase('온라인 · 지금 바로', fixtureView(fixtureDraft(NOW))),
  'FH03:offline': createdCase('오프라인 · 1:1', fixtureView(fixtureDraft(offlineSolo))),
  'FH03:partial': createdCase('일부 초대 실패 · 다시 시도', fixtureView(fixtureDraft(NOW), 2)),
  'FH03:scheduled': createdCase('예약 생성(열리면 코드 사용)', fixtureView(fixtureDraft())),
  'FH03:none': createdCase('초대 없이 생성', fixtureView(fixtureDraft({ ...NOW, members: [] }))),
  'FH03:email': createdCase('회원 + 비회원 이메일 발송 요청', fixtureView(fixtureDraft({ ...NOW, members: fixtureDraft().members.slice(0, 1), emails: GUESTS }))),
  'FH03:email-partial': createdCase('이메일 일부 발송하지 못함 · 다시 시도', fixtureView(fixtureDraft({ ...NOW, members: fixtureDraft().members.slice(0, 1), emails: GUESTS }), 0, 1)),
};
