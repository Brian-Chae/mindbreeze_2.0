// SDD-253 — 데스크톱 리포트 목록: 클래스 > 회차(담당 상담사) > 회원 > 리포트 계층 (A안 '상태 하나 크게 + 행 끝 단일 주 버튼').
// 모바일은 기존 카드 목록을 유지하므로 이 컴포넌트는 데스크톱에서만 쓴다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getReportHierarchy,
  type HierarchyDoc,
  type HierarchyGroup,
  type HierarchyMember,
  type HierarchyResponse,
  type HierarchySession,
  type HierarchyTab,
} from '../../lib/api/report-hierarchy';
import { ACTIVITY_LABELS, ageLabel, formatKst, genderLabel, rowState } from '../../lib/report-ops-labels';

const PAGE_LIMIT = 10;
const TONE_CLASS: Record<string, string> = {
  failed: 'bg-[#FAE9DE] text-[#9B532F]',
  pending: 'bg-[#F0E6F6] text-[#710B91]',
  generating: 'bg-[#EEEBEF] text-[#71697B]',
  done: 'bg-[#E9F2EB] text-[#50745B]',
  muted: 'bg-[#EEEBEF] text-[#83788A]',
};
const TONE_TEXT: Record<string, string> = {
  failed: 'text-[#994C25]',
  pending: 'text-[#710B91]',
  generating: 'text-[#71697B]',
  done: 'text-[#50745B]',
  muted: 'text-[#71697B]',
};

interface Props {
  /** 분할 검토에서 선택된 리포트 */
  selectedReportId: string | null;
  onOpen: (reportId: string) => void;
  /** 분할 검토 중에는 좁은 대기 목록으로 그린다 */
  compact?: boolean;
  reloadKey: number;
  /** 관리자 화면 보조 영역(운영 설정·샘플 등) */
  toolbarExtra?: React.ReactNode;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-md bg-[#F1EDF3] px-2 py-0.5 text-[12px] font-semibold text-[#796E80]">{children}</span>;
}

function MemberRow({ member, selected, compact, onOpen }: { member: HierarchyMember; selected: boolean; compact: boolean; onOpen: (id: string) => void }) {
  const doc = member.client_report;
  const state = rowState(doc);
  const open = () => doc && onOpen(doc.report_id);
  return (
    <li
      data-testid="member-row"
      data-tone={state.tone}
      className={`grid items-center gap-x-6 px-6 py-4 ${compact ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[minmax(200px,1fr)_minmax(260px,1.5fr)_140px]'} ${selected ? 'bg-[#F2E7F8]' : 'bg-white'} border-t border-[#EEEAF0]`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F0EDF2] text-[14px] text-[#73617C]">{(member.name ?? '?').slice(0, 1)}</span>
        <div className="min-w-0">
          <strong className="block truncate text-[16px] text-[#29272D]">{member.name ?? '이름 미확인'}</strong>
          <p className="whitespace-nowrap text-[12px] text-[#8B8191]">{genderLabel(member.gender)} · {ageLabel(member.age)}{member.is_guest ? ' · 비회원 참여자' : ''}</p>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[19px] font-bold ${TONE_CLASS[state.tone]}`}>{state.icon}</span>
        <div className="min-w-0">
          <strong className={`block whitespace-nowrap text-[17px] ${TONE_TEXT[state.tone]}`}>{state.label}</strong>
          {!compact && state.hint && <p className="truncate text-[12px] text-[#8B8191]">{state.hint}</p>}
        </div>
      </div>
      {!compact && (
        <div>
          {state.action && doc ? (
            <button
              type="button"
              onClick={open}
              className={`inline-flex h-11 w-[140px] items-center justify-center whitespace-nowrap rounded-[10px] border px-4 text-[14px] font-semibold ${
                state.tone === 'pending'
                  ? 'border-[#5F0080] bg-[#5F0080] text-white hover:bg-[#7D3399]'
                  : state.tone === 'failed'
                    ? 'border-[#DCC6B8] bg-[#FFFAF6] text-[#994C25] hover:bg-[#FFF3EA]'
                    : 'border-[#DED8E3] bg-white text-[#5F0080] hover:bg-[#F5EDFC]'
              }`}
              aria-label={`${member.name ?? '회원'} ${state.action}`}
            >
              {state.action}
            </button>
          ) : null}
        </div>
      )}
      {compact && state.action && doc && (
        <button type="button" onClick={open} className="h-11 whitespace-nowrap rounded-[10px] border border-[#DED8E3] bg-white px-3 text-[13px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC]">열기</button>
      )}
    </li>
  );
}

function SessionBlock({ session, selectedId, compact, onOpen }: { session: HierarchySession; selectedId: string | null; compact: boolean; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const common: HierarchyDoc | null = session.common_report;
  return (
    <section aria-label={`${session.title ?? '회차'} 회차`} className="border-t border-[#E5E0E7]">
      <header className="flex flex-wrap items-center gap-3 bg-[#F8F6F9] px-5 py-3.5">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? '회차 접기' : '회차 펼치기'} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#6C5C75] hover:bg-[#EFE9F2]">{open ? '−' : '＋'}</button>
        <div className="min-w-0 flex-1">
          <strong className={`block text-[15px] text-[#3A2F42] ${compact ? 'line-clamp-2' : 'truncate'}`} title={session.title ?? ''}>{session.title ?? '제목 없는 회차'}</strong>
          <span className={`block text-[12px] text-[#8B8191] ${compact ? '' : 'whitespace-nowrap'}`}>
            {formatKst(session.scheduled_at)} · 담당 {session.counselor_name ?? '미확인'} · 참여 {session.participant_count}명
            {session.matched_count !== session.participant_count ? ` · 일치 ${session.matched_count}명` : ''}
          </span>
        </div>
        <div className={`flex items-center gap-2 ${compact ? 'w-full flex-wrap pl-11' : ''}`}>
          {session.needs_review > 0 && <Chip>이 회차 검토 필요 {session.needs_review}</Chip>}
          {session.delivery_failed > 0 && <Chip>이 회차 발송 실패 {session.delivery_failed}</Chip>}
          {common && (
            <button type="button" onClick={() => onOpen(common.report_id)} className="h-11 shrink-0 whitespace-nowrap rounded-[10px] border border-[#DED8E3] bg-white px-4 text-[13px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC]">
              상담사용 · 회차 공통
            </button>
          )}
        </div>
      </header>
      {open && (
        <ul className="m-0 list-none p-0">
          {session.members.length === 0 ? (
            <li className="px-6 py-4 text-[13px] text-[#8B8191]">조건에 맞는 회원이 없습니다.</li>
          ) : (
            session.members.map((m) => (
              <MemberRow key={m.participant_id} member={m} selected={!!m.client_report && m.client_report.report_id === selectedId} compact={compact} onOpen={onOpen} />
            ))
          )}
        </ul>
      )}
    </section>
  );
}

function GroupBlock({ group, selectedId, compact, onOpen }: { group: HierarchyGroup; selectedId: string | null; compact: boolean; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-[15px] border border-[#E5E0E7] bg-white">
      <div className="flex items-center gap-3 px-5 py-4">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? '클래스 접기' : '클래스 펼치기'} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#6C5C75] hover:bg-[#EFE9F2]">{open ? '−' : '＋'}</button>
        <strong className={`min-w-0 flex-1 text-[16px] text-[#29272D] ${compact ? 'line-clamp-2' : 'truncate'}`} title={group.title}>
          {group.title}
          {group.continued && <span className="ml-2 text-[12px] font-normal text-[#8B8191]">이어지는 회차</span>}
        </strong>
        {!compact && <span className="whitespace-nowrap text-[13px] text-[#7C7482]">회차 {group.session_total}개</span>}
        {!compact && group.needs_review > 0 && <Chip>클래스 전체 검토 필요 {group.needs_review}</Chip>}
      </div>
      {open && group.sessions.map((s) => <SessionBlock key={s.session_id} session={s} selectedId={selectedId} compact={compact} onOpen={onOpen} />)}
    </div>
  );
}

export default function ReportHierarchyList({ selectedReportId, onOpen, compact = false, reloadKey, toolbarExtra }: Props) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [tab, setTab] = useState<HierarchyTab>('all');
  const [activity, setActivity] = useState('');
  const [counselorId, setCounselorId] = useState('');
  const [period, setPeriod] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HierarchyResponse | null>(null);
  const [counselors, setCounselors] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q), 250);
    return () => window.clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [debouncedQ, tab, activity, counselorId, period]);

  const dateFrom = useMemo(() => {
    if (!period) return undefined;
    const d = new Date();
    d.setDate(d.getDate() - Number(period));
    return d.toISOString().slice(0, 10);
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getReportHierarchy({ q: debouncedQ, tab, activity, counselorId, dateFrom, page, limit: PAGE_LIMIT })
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setCounselors((prev) => {
          const next = new Map(prev);
          r.groups.forEach((g) => g.sessions.forEach((s) => s.counselor_name && next.set(s.counselor_id, s.counselor_name)));
          return next;
        });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : '리포트 목록을 불러오지 못했습니다.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, tab, activity, counselorId, dateFrom, page, reloadKey, localReload]);

  const reset = useCallback(() => {
    setQ('');
    setTab('all');
    setActivity('');
    setCounselorId('');
    setPeriod('');
  }, []);

  const summary = data?.summary;
  const firstPending = useMemo(() => {
    for (const g of data?.groups ?? []) for (const s of g.sessions) for (const m of s.members) {
      if (m.client_report && rowState(m.client_report).tone === 'pending') return m.client_report.report_id;
    }
    return null;
  }, [data]);
  const totalPages = Math.max(1, Math.ceil((data?.total_sessions ?? 0) / PAGE_LIMIT));
  const field = 'h-11 rounded-[10px] border border-[#E0DBE3] bg-white px-3 text-[14px] text-[#51485A]';

  return (
    <div className="space-y-4">
      {!compact && summary && (
        <div className="flex items-center justify-between rounded-2xl border border-[#E5D8EC] bg-[#F2EAF6] px-7 py-5">
          <div>
            <h2 className="m-0 text-[21px] font-bold text-[#5F0080]">
              {summary.needs_review > 0 ? `검토가 필요한 회원용 ${summary.needs_review}건` : '지금 검토할 회원용 리포트가 없습니다'}
            </h2>
            <p className="mt-1 text-[14px] text-[#786780]">
              {summary.failed_delivery > 0 ? `발송 실패 ${summary.failed_delivery}건은 다시 발송할 수 있습니다.` : '승인과 발송은 한 번에 처리됩니다.'}
            </p>
          </div>
          {firstPending && (
            <button type="button" onClick={() => onOpen(firstPending)} className="h-11 whitespace-nowrap rounded-[10px] border border-[#5F0080] bg-[#5F0080] px-5 text-[15px] font-semibold text-white hover:bg-[#7D3399]">검토 시작</button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="성명·클래스·회차 검색" aria-label="리포트 검색" className={`${field} w-[270px]`} />
        <select value={activity} onChange={(e) => setActivity(e.target.value)} aria-label="활동 필터" className={`${field} w-[139px]`}>
          <option value="">전체 활동</option>
          <option value="meditation">{ACTIVITY_LABELS.meditation}</option>
          <option value="clinical">임상심리상담</option>
          <option value="hypnosis">최면심리상담</option>
          <option value="custom">{ACTIVITY_LABELS.custom}</option>
        </select>
        <select value={counselorId} onChange={(e) => setCounselorId(e.target.value)} aria-label="상담사 필터" className={`${field} w-[175px]`}>
          <option value="">전체 상담사</option>
          {[...counselors.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="기간 필터" className={`${field} w-[139px]`}>
          <option value="">전체 기간</option>
          <option value="7">최근 7일</option>
          <option value="30">최근 30일</option>
          <option value="90">최근 90일</option>
        </select>
        <div className="ml-auto flex items-center gap-2">{toolbarExtra}</div>
      </div>

      <div role="tablist" aria-label="리포트 상태" className="flex gap-1.5 border-b border-[#E7E0EB] pb-3">
        {([
          ['all', '전체', summary ? summary.total_members ?? summary.total_sessions : null],
          ['needs_review', '검토 필요', summary?.needs_review ?? null],
          ['failed', '발송 실패', summary?.failed_delivery ?? null],
        ] as const).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`h-11 whitespace-nowrap rounded-none px-4 text-[14px] font-semibold ${tab === value ? 'border-b-[3px] border-[#5F0080] text-[#5F0080]' : 'border-b-[3px] border-transparent text-[#82778B] hover:text-[#5F0080]'}`}
          >
            {label}
            {count !== null && <span className="ml-1.5 text-[12px]">{count}</span>}
          </button>
        ))}
      </div>

      {tab !== 'all' || debouncedQ ? (
        <p className="m-0 text-[13px] text-[#8D8293]">
          {data ? `일치하는 회차 ${data.total_sessions}개` : ''} · 클래스·회차 경로를 함께 보여 줍니다.
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-2xl border border-[#F5C2C2] bg-red-50 p-8 text-center text-[15px] text-red-700">
          {error}
          <div><button type="button" onClick={() => setLocalReload((v) => v + 1)} className="mt-3 h-11 rounded-[10px] bg-[#5F0080] px-5 font-semibold text-white">다시 불러오기</button></div>
        </div>
      ) : loading && !data ? (
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      ) : data && data.groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-10 text-center">
          <p className="m-0 text-[14px] text-[#6F6F6F]">{debouncedQ || tab !== 'all' || activity || counselorId || period ? '조건에 맞는 리포트가 없습니다.' : '아직 생성된 리포트가 없습니다. 클래스를 진행하면 회차별 리포트가 여기에 모입니다.'}</p>
          {(debouncedQ || tab !== 'all' || activity || counselorId || period) && (
            <button type="button" onClick={reset} className="mt-3 h-11 px-4 text-[13px] font-semibold text-[#5F0080] hover:underline">필터 초기화</button>
          )}
        </div>
      ) : (
        <div className="space-y-4" aria-busy={loading}>
          {!compact && (
            <div aria-hidden className="grid grid-cols-[minmax(200px,1fr)_minmax(260px,1.5fr)_140px] gap-x-6 px-6 text-[12px] font-semibold text-[#8A808F]">
              <span>회원</span><span>리포트 상태</span><span>할 일</span>
            </div>
          )}
          {data?.groups.map((g) => <GroupBlock key={g.key} group={g} selectedId={selectedReportId} compact={compact} onOpen={onOpen} />)}
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="h-11 rounded-xl border border-[#EFEFEF] bg-white px-4 text-[13px] font-semibold text-[#5F0080] disabled:opacity-40">이전</button>
          <span className="text-[13px] tabular-nums text-[#6F6F6F]">{page} / {totalPages}<span className="ml-2 text-[#9B9B9B]">(회차 {data.total_sessions}개)</span></span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="h-11 rounded-xl border border-[#EFEFEF] bg-white px-4 text-[13px] font-semibold text-[#5F0080] disabled:opacity-40">다음</button>
        </div>
      )}
    </div>
  );
}
