// 플랫폼 관리자 — 채팅 신고 처리 · 금칙어 관리 ([MB261026][FIX] D4 + Apple 1.2)
// - 처리 기한: 접수 확인 2영업일 · 1차 판단 5영업일(서버 계산).
// - 최소 열람: 목록에는 메시지 발췌·이메일이 없다. "신고된 메시지 보기"를 눌러야 상세를 불러오고, 서버가 열람을 감사 로그에 남긴다.
// - 처리 상태는 기록일 뿐이다. 계정 정지가 필요하면 사용자 관리 화면에서 사람이 직접 한다.

import { useCallback, useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { buttonClass, cardClass, fieldClass } from '../../components/ui';
import {
  addChatFilterTerm,
  getChatReport,
  listChatFilterTerms,
  listChatReports,
  removeChatFilterTerm,
  transitionChatReport,
  type ChatFilterTermDto,
  type ChatReportDetailDto,
  type ChatReportItemDto,
  type ChatReportListResponse,
  type ChatReportStatus,
  type ChatReportTransitionTarget,
} from '../../lib/api/admin';
import { CHAT_REPORT_REASONS } from '../../lib/api/chat';

const STATUS_LABELS: Record<ChatReportStatus, string> = {
  submitted: '접수',
  reviewing: '검토 중',
  actioned: '조치 완료',
  dismissed: '조치 없음',
  withdrawn: '신고자 철회',
};
const STATUS_STYLES: Record<ChatReportStatus, string> = {
  submitted: 'bg-[#E0F2FE] text-[#075985]',
  reviewing: 'bg-[#FEF3C7] text-[#92400E]',
  actioned: 'bg-[#D1FAE5] text-[#065F46]',
  dismissed: 'bg-[#EDE9F0] text-[#4B3F52]',
  withdrawn: 'bg-[#F3F4F6] text-[#6B7280]',
};
const STATUS_ORDER: ChatReportStatus[] = ['submitted', 'reviewing', 'actioned', 'dismissed', 'withdrawn'];
const REASON_LABELS: Record<string, string> = Object.fromEntries(CHAT_REPORT_REASONS.map((r) => [r.value, r.label]));
const ROOM_LABELS: Record<string, string> = { direct: '1:1', group: '그룹', session: '클래스' };
const HEADER_CLASS = 'px-4 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F] whitespace-nowrap';

const kstFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatKst(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '-' : kstFormatter.format(date);
}

const isOpen = (status: ChatReportStatus): boolean => status === 'submitted' || status === 'reviewing';

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function StatusBadge({ status }: { status: ChatReportStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** 기한 칸: 완료면 완료 시각, 미완료면 기한(초과 시 빨간 배지). 철회는 기한 없음. */
function DueCell({ due, doneAt, overdue, status }: { due: string; doneAt: string | null; overdue: boolean; status: ChatReportStatus }) {
  if (status === 'withdrawn') return <span className="text-[#9B9B9B]">-</span>;
  if (doneAt) return <span className="text-[#065F46]">완료 {formatKst(doneAt)}</span>;
  if (overdue) {
    return (
      <span data-overdue="true" className="inline-flex whitespace-nowrap rounded-full bg-[#FEE2E2] px-2.5 py-1 text-[12px] font-bold text-[#991B1B]">
        기한 초과 · {formatKst(due)}
      </span>
    );
  }
  return <span className="whitespace-nowrap text-[#1F1F1F]">{formatKst(due)}까지</span>;
}

// ── 신고 상세 패널 ──

interface PanelProps {
  item: ChatReportItemDto;
  detail: ChatReportDetailDto | null;
  onViewDetail: () => void;
  detailLoading: boolean;
  onTransition: (to: ChatReportTransitionTarget, note?: string) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}

function ReportPanel({ item, detail, onViewDetail, detailLoading, onTransition, busy, onClose }: PanelProps) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [item.id]);
  const open = isOpen(item.status);
  const canDecide = open && note.trim().length > 0 && !busy;
  const history = detail?.history ?? [];

  return (
    <section className={cardClass('default', 'mt-6')} aria-label="신고 상세">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold text-[#1F1F1F]">
            {item.reporter.name ?? '알 수 없음'} → {item.reported_user.name ?? '알 수 없음'}
          </h2>
          <p className="mt-1 text-[12px] font-mono text-[#9B9B9B]">신고 ID: {item.id}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-2 text-[15px] md:grid-cols-2">
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-[#6F6F6F]">사유</dt><dd>{item.reason ? REASON_LABELS[item.reason] ?? item.reason : '미선택'}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-[#6F6F6F]">대화방</dt><dd>{item.room_type ? ROOM_LABELS[item.room_type] ?? item.room_type : '-'}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-[#6F6F6F]">접수</dt><dd>{formatKst(item.created_at)}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-[#6F6F6F]">처리자</dt><dd>{item.handled_by_name ?? '-'}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-[#6F6F6F]">접수 확인 기한</dt><dd><DueCell due={item.ack_due_at} doneAt={item.acknowledged_at} overdue={item.ack_overdue} status={item.status} /></dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-[#6F6F6F]">1차 판단 기한</dt><dd><DueCell due={item.decision_due_at} doneAt={item.decided_at} overdue={item.decision_overdue} status={item.status} /></dd></div>
      </dl>

      <div className="mt-5 rounded-xl border border-[#EFEFEF] bg-[#FAFAFC] p-4">
        {detail ? (
          <div className="space-y-2 text-[14px]">
            <p className="text-[12px] text-[#6F6F6F]">열람 기록이 남습니다. 신고된 메시지 1건만 보여 줍니다.</p>
            {detail.message_excerpt ? (
              <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-[#1F1F1F]">{detail.message_excerpt}</blockquote>
            ) : (
              <p className="text-[#6F6F6F]">메시지 없이 프로필에서 신고되었습니다.</p>
            )}
            <p className="break-all text-[#6F6F6F]">신고자 이메일: {detail.reporter.email ?? '-'} · 대상 이메일: {detail.reported_user.email ?? '-'}</p>
            {detail.resolution_note && <p className="text-[#1F1F1F]">판단 메모: {detail.resolution_note}</p>}
          </div>
        ) : (
          <button type="button" onClick={onViewDetail} disabled={detailLoading} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            {detailLoading ? '불러오는 중...' : item.has_message ? '신고된 메시지 보기' : '신고 상세 보기'}
          </button>
        )}
      </div>

      {history.length > 0 && (
        <ol className="mt-4 space-y-1 text-[13px] text-[#4B4B4B]" aria-label="처리 이력">
          {history.map((h, index) => (
            <li key={`${h.at ?? ''}-${index}`}>
              {formatKst(h.at)} · {h.admin_name ?? '운영자'} · {STATUS_LABELS[h.from_status as ChatReportStatus] ?? h.from_status} → {STATUS_LABELS[h.to_status as ChatReportStatus] ?? h.to_status}
              {h.note ? ` · ${h.note}` : ''}
            </li>
          ))}
        </ol>
      )}

      {item.status === 'withdrawn' && (
        <p className="mt-4 rounded-xl bg-[#F3F4F6] p-3 text-[13px] text-[#4B5563]">신고자가 철회한 신고입니다. 처리할 수 없습니다.</p>
      )}

      <div className="mt-5 space-y-3">
        <textarea
          name="resolution-note"
          aria-label="판단 메모"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={3}
          disabled={!open || busy}
          placeholder="판단 내용과 조치를 적어 주세요(조치 완료·조치 없음 종결에 필수). 계정 정지는 사용자 관리에서 직접 합니다."
          className={fieldClass('textarea')}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={item.status !== 'submitted' || busy}
            onClick={() => void onTransition('reviewing', note.trim() || undefined)}
            className={buttonClass({ variant: 'secondary' })}
          >
            검토 시작
          </button>
          <button type="button" disabled={!canDecide} onClick={() => void onTransition('actioned', note.trim())} className={buttonClass()}>
            조치 완료
          </button>
          <button type="button" disabled={!canDecide} onClick={() => void onTransition('dismissed', note.trim())} className={buttonClass({ variant: 'secondary' })}>
            조치 없음 종결
          </button>
          <button type="button" onClick={onClose} className={buttonClass({ variant: 'ghost', size: 'sm', className: 'ml-auto' })}>
            닫기
          </button>
        </div>
      </div>
    </section>
  );
}

// ── 신고 탭 ──

function ReportsTab() {
  const [data, setData] = useState<ChatReportListResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChatReportStatus | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatReportDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listChatReports({ status: statusFilter || undefined, overdue: overdueOnly, size: 50 }));
    } catch (cause) {
      setError(errorText(cause, '신고 목록을 불러오지 못했습니다.'));
    }
  }, [statusFilter, overdueOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const select = (id: string): void => {
    setSelectedId(id);
    setMessage(null);
    if (detail?.id !== id) setDetail(null);
  };

  const viewDetail = async (): Promise<void> => {
    if (!selectedId) return;
    setDetailLoading(true);
    try {
      setDetail(await getChatReport(selectedId));
    } catch (cause) {
      setError(errorText(cause, '신고 상세를 불러오지 못했습니다.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const transition = async (to: ChatReportTransitionTarget, note?: string): Promise<void> => {
    if (!selectedId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await transitionChatReport(selectedId, to, note);
      setDetail((prev) => (prev && prev.id === result.id ? { ...prev, status: result.status, resolution_note: result.resolution_note, history: result.history } : prev));
      setMessage(`${STATUS_LABELS[result.status]}(으)로 바꿨습니다.`);
      await load();
    } catch (cause) {
      setError(errorText(cause, '처리 상태를 바꾸지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {data && !data.notice_email_configured && (
        <div data-testid="notice-email-missing" role="status" className="mb-5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[13px] text-[#92400E]">
          운영 신고 수신 주소가 설정되지 않아 메일 알림이 가지 않습니다. 새 신고는 이 화면에서 확인해 주세요.
        </div>
      )}
      {message && (
        <div role="status" className="mb-5 rounded-xl bg-[#F5EDFC] p-3 text-sm text-[#5F0080]">{message}</div>
      )}

      <section className="mb-5 flex flex-wrap items-center gap-3">
        <select
          aria-label="신고 상태 필터"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ChatReportStatus | '')}
          className={fieldClass('select', '!w-auto')}
        >
          <option value="">전체 상태</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}{data ? ` (${data.counts[s] ?? 0})` : ''}</option>
          ))}
        </select>
        <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-[#1F1F1F]">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          기한 초과만
        </label>
        <span className="ml-auto text-[13px] text-[#6F6F6F]">총 {data?.total ?? 0}건 · 기한: 접수 확인 2영업일 · 1차 판단 5영업일</span>
      </section>

      {error ? (
        <div role="alert" className="rounded-2xl border border-[#F5C2C2] bg-red-50 p-6 text-center">
          <div className="text-sm text-red-700">{error}</div>
          <button type="button" onClick={() => void load()} className={buttonClass({ className: 'mt-4' })}>다시 시도</button>
        </div>
      ) : data === null ? (
        <div className="rounded-2xl border border-[#EFEFEF] p-10 text-center text-sm text-[#6F6F6F]">신고 목록을 불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-10 text-center text-sm text-[#6F6F6F]">해당하는 신고가 없습니다.</div>
      ) : (
        <div className={cardClass('none', 'overflow-x-auto')}>
          <table className="min-w-[960px] w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-[#EFEFEF] bg-[#F8FAFC]">
                {['접수 일시', '상태', '사유', '신고자', '대상', '접수 확인 기한', '1차 판단 기한', '처리자'].map((h) => (
                  <th key={h} className={HEADER_CLASS}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      select(row.id);
                    }
                  }}
                  className={`cursor-pointer border-b border-[#EFEFEF] last:border-0 hover:bg-[#F8FAFC] ${selectedId === row.id ? 'bg-[#F5EDFC]' : ''}`}
                >
                  <td className="px-4 py-3 font-mono text-[12px] text-[#6F6F6F] whitespace-nowrap">{formatKst(row.created_at)}</td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-3 text-[#1F1F1F]">{row.reason ? REASON_LABELS[row.reason] ?? row.reason : '미선택'}</td>
                  <td className="px-4 py-3 text-[#1F1F1F]">{row.reporter.name ?? '-'}</td>
                  <td className="px-4 py-3 font-semibold text-[#1F1F1F]">{row.reported_user.name ?? '-'}</td>
                  <td className="px-4 py-3"><DueCell due={row.ack_due_at} doneAt={row.acknowledged_at} overdue={row.ack_overdue} status={row.status} /></td>
                  <td className="px-4 py-3"><DueCell due={row.decision_due_at} doneAt={row.decided_at} overdue={row.decision_overdue} status={row.status} /></td>
                  <td className="px-4 py-3 text-[#6F6F6F]">{row.handled_by_name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ReportPanel
          item={selected}
          detail={detail?.id === selected.id ? detail : null}
          onViewDetail={() => void viewDetail()}
          detailLoading={detailLoading}
          onTransition={transition}
          busy={busy}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

// ── 금칙어 탭 ──

function FilterTermsTab({ reloadKey }: { reloadKey: number }) {
  const [terms, setTerms] = useState<ChatFilterTermDto[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTerms((await listChatFilterTerms()).items);
    } catch (cause) {
      setError(errorText(cause, '금칙어 목록을 불러오지 못했습니다.'));
    }
  }, []);

  useEffect(() => {
    setConfirmId(null);
    void load();
  }, [load, reloadKey]);

  const add = async (): Promise<void> => {
    const term = draft.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      await addChatFilterTerm(term);
      setDraft('');
      await load();
    } catch (cause) {
      setError(errorText(cause, '금칙어를 추가하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await removeChatFilterTerm(id);
      setConfirmId(null);
      await load();
    } catch (cause) {
      setError(errorText(cause, '금칙어를 삭제하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cardClass('default')}>
      <p className="text-[13px] text-[#6F6F6F]">
        등록한 단어가 들어간 채팅 메시지는 보내지지 않습니다(띄어쓰기·기호·대소문자 변형 포함). 기존 메시지를 지우거나 계정을 제재하지 않습니다.
        오탐 신고가 오면 단어를 지우면 바로 풀립니다.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          name="filter-term"
          aria-label="추가할 금칙어"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          maxLength={100}
          placeholder="추가할 단어"
          className={fieldClass('input', '!w-64')}
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void add()} className={buttonClass()}>
          추가
        </button>
        <span className="ml-auto text-[13px] text-[#6F6F6F]">{terms ? `${terms.length}개` : ''}</span>
      </div>
      {error && <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-[13px] text-red-700">{error}</div>}
      {terms === null ? (
        <p className="mt-4 text-sm text-[#6F6F6F]">불러오는 중...</p>
      ) : terms.length === 0 ? (
        <p className="mt-4 text-sm text-[#6F6F6F]">등록된 금칙어가 없습니다. 비어 있으면 필터가 아무것도 막지 않습니다.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#EFEFEF]">
          {terms.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2 text-[14px]">
              <span className="min-w-0 flex-1 break-all font-semibold text-[#1F1F1F]">{t.term}</span>
              <span className="text-[12px] text-[#9B9B9B]">{t.created_by_name ?? '시드'} · {formatKst(t.created_at)}</span>
              {confirmId === t.id ? (
                <>
                  <button type="button" disabled={busy} onClick={() => void remove(t.id)} className={buttonClass({ variant: 'secondary', tone: 'danger', size: 'sm' })}>
                    삭제 확인
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                    취소
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmId(t.id)} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ChatReportsPage() {
  const [tab, setTab] = useState<'reports' | 'terms'>('reports');
  const [termsReloadKey, setTermsReloadKey] = useState(0);
  const tabClass = (active: boolean): string =>
    buttonClass({ variant: active ? 'primary' : 'secondary', size: 'sm' });

  return (
    <AppShell title="채팅 신고" sub="CHAT REPORTS" wide>
      <div className="mb-5 flex gap-2" role="tablist" aria-label="채팅 신고 메뉴">
        <button type="button" role="tab" aria-selected={tab === 'reports'} onClick={() => setTab('reports')} className={tabClass(tab === 'reports')}>
          신고
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'terms'}
          onClick={() => {
            setTab('terms');
            setTermsReloadKey((k) => k + 1);
          }}
          className={tabClass(tab === 'terms')}
        >
          금칙어
        </button>
      </div>
      {tab === 'reports' ? <ReportsTab /> : <FilterTermsTab reloadKey={termsReloadKey} />}
    </AppShell>
  );
}
