// SDD-209 H3 — 클래스 생성 오케스트레이션(생성 → 회원 초대 → 비회원 이메일 초대)과 생성 완료 화면 모델.
// API 는 주입받는다(테스트가 모킹). 등록 성공 ≠ 알림 전달 성공이므로 화면에는 "요청 결과"만 표시한다(P7).
import type { LinkbandMode, SessionDto } from '../../api/session';
import type { InviteEmailResponse, InviteMemberResponse } from '../../api/class-flow-host';
import { buildCreatePayload, fmtWhen, maskEmail, maxParticipantsOf, type WizardDraft } from '../class-wizard';
import type { FlowPlace, FlowSize } from './types';

export interface HostCreateApi {
  createSession: (payload: ReturnType<typeof buildCreatePayload>) => Promise<SessionDto>;
  inviteMember: (sessionId: string, userId: string) => Promise<InviteMemberResponse>;
  inviteByEmail: (sessionId: string, emails: readonly string[]) => Promise<InviteEmailResponse>;
}

export interface CreatedInviteRow {
  key: string;
  kind: 'member' | 'email';
  /** 회원 이름 또는 마스킹된 이메일(전체 주소를 화면에 두지 않는다) */
  label: string;
  /** 초대 등록(회원) / 메일 발송 요청(이메일)이 접수됐는가 */
  ok: boolean;
  userId?: string;
  email?: string;
}

export interface CreatedView {
  sessionId: string;
  title: string;
  /** 입장 코드(4자리). 받지 못하면 null */
  code: string | null;
  place: FlowPlace;
  size: FlowSize;
  capacity: number;
  band: LinkbandMode;
  /** 예약 클래스면 `내일 오후 3:15`, 지금 바로면 null */
  scheduleText: string | null;
  rows: CreatedInviteRow[];
}

const EMAIL_OK_REQUESTS: ReadonlySet<string> = new Set(['queued', 'skipped_cooldown', 'skipped_pending']);

function httpStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' ? status : null;
  }
  return null;
}

/** 이미 초대된 회원(409)은 성공으로 본다(검증 FH03 partial) */
async function inviteOne(api: HostCreateApi, sessionId: string, userId: string): Promise<boolean> {
  try {
    await api.inviteMember(sessionId, userId);
    return true;
  } catch (error) {
    return httpStatus(error) === 409;
  }
}

async function inviteEmails(api: HostCreateApi, sessionId: string, emails: readonly string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!emails.length) return out;
  try {
    const res = await api.inviteByEmail(sessionId, emails);
    for (const email of emails) {
      const hit = res.results.find((r) => r.email.toLowerCase() === email.toLowerCase());
      out.set(email, hit ? EMAIL_OK_REQUESTS.has(hit.request) : false);
    }
  } catch {
    for (const email of emails) out.set(email, false);
  }
  return out;
}

export function buildCreatedView(session: SessionDto, draft: WizardDraft, base: Date, rows: CreatedInviteRow[]): CreatedView {
  return {
    sessionId: session.id,
    title: session.title?.trim() || draft.title.trim() || '새 클래스',
    code: session.access_code ?? null,
    place: draft.place,
    size: draft.size,
    capacity: maxParticipantsOf(draft),
    band: draft.band,
    scheduleText: draft.when === 'later' ? fmtWhen(draft, base) : null,
    rows,
  };
}

/** 클래스를 만들고 선택한 회원·이메일을 초대한다. 초대 실패는 생성 자체를 실패로 만들지 않는다 */
export async function runCreate(api: HostCreateApi, draft: WizardDraft, base: Date, force: boolean): Promise<CreatedView> {
  const session = await api.createSession(buildCreatePayload(draft, base, force));
  const memberOk = await Promise.all(draft.members.map((m) => inviteOne(api, session.id, m.id)));
  const emailOk = await inviteEmails(api, session.id, draft.emails);
  const rows: CreatedInviteRow[] = [
    ...draft.members.map((m, i): CreatedInviteRow => ({ key: `member:${m.id}`, kind: 'member', label: m.name, ok: memberOk[i], userId: m.id })),
    ...draft.emails.map((email): CreatedInviteRow => ({ key: `email:${email}`, kind: 'email', label: maskEmail(email), ok: emailOk.get(email) ?? false, email })),
  ];
  return buildCreatedView(session, draft, base, rows);
}

/** 실패한 한 건만 다시 요청한다(회원은 `/invite`, 이메일은 `/invite/email`) */
export async function retryInvite(api: HostCreateApi, view: CreatedView, rowKey: string): Promise<CreatedView> {
  const row = view.rows.find((r) => r.key === rowKey);
  if (!row || row.ok) return view;
  let ok = false;
  if (row.kind === 'member' && row.userId) ok = await inviteOne(api, view.sessionId, row.userId);
  if (row.kind === 'email' && row.email) ok = (await inviteEmails(api, view.sessionId, [row.email])).get(row.email) ?? false;
  return { ...view, rows: view.rows.map((r) => (r.key === rowKey ? { ...r, ok } : r)) };
}

export interface InviteHeading {
  heading: string;
  /** 초대 행이 하나도 없을 때의 안내 */
  emptyHint: string | null;
}

/** 초대 카드 제목. 전달·열람을 단정하는 문구는 쓰지 않는다 */
export function inviteHeading(rows: readonly CreatedInviteRow[]): InviteHeading {
  if (!rows.length) return { heading: '초대한 회원이 아직 없어요', emptyHint: '클래스 상세에서 언제든 회원을 초대할 수 있어요.' };
  const members = rows.filter((r) => r.kind === 'member');
  const sent = members.filter((r) => r.ok).length;
  const failed = members.length - sent;
  if (!members.length) return { heading: '메일 발송을 요청했어요', emptyHint: null };
  if (sent === 0) return { heading: '초대하지 못한 회원이 있어요', emptyHint: null };
  return { heading: failed ? `회원 ${sent}명을 초대했어요` : `초대한 회원 ${sent}명을 초대했어요`, emptyHint: null };
}

export function inviteRowText(row: CreatedInviteRow): string {
  if (row.kind === 'member') return row.ok ? '초대했어요' : '초대하지 못했어요';
  return row.ok ? '메일 발송을 요청했어요' : '발송하지 못했어요';
}
