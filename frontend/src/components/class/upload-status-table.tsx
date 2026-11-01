// SDD-265: 회차 상세 상황판(시안 안3-A). 상단 숫자 4칸 + 전송 막대 + "확인할 사람" 표 먼저, 정상은 접고 10명씩 페이지.
// 신호별(뇌파·맥박·움직임) 세부는 참여자 '기록 보기'에서만 보인다. 점수·완료·보증 표현 없음.
import { useMemo, useState } from 'react';
import type { UploadParticipantDto, UploadStatusResponse } from '../../lib/api/upload-status';
import {
  BOARD_LABEL, COACH_OK_NOTE, DASH, FINAL_PENDING_COACH, FINAL_PENDING_PERSON_NOTE, showFinalPending, PAGE_SIZE, percentText, arrivedText, basisNote, boardState, coachAction, formatBytes, formatMinutes, formatTotalHours,
  pageCount, personAction, personBucket, slicePage, transferPercent, type BoardState, type PersonBucket,
} from '../../lib/upload-status/board';
import { displayName, formatClock, formatCount, latestReceived, rawTotals } from '../../lib/upload-status/view';
import { FinalPendingChip, Metric, StateBadge, TransferBar, cardClass, fieldClass } from './upload-board-parts';

export const SERVER_BASIS_NOTE = '서버에 도착한 기록 기준이에요. 리포트 반영 여부는 별도예요.';
const SIGNAL_NAME = { eeg: '뇌파', ppg: '맥박', acc: '움직임' } as const;

const personComponents = (p: UploadParticipantDto): string => {
  const prog = p.progress;
  if (!prog) return '집계 대기';
  const parts: string[] = [];
  if (prog.feature.expected !== null && prog.feature.received < prog.feature.expected) parts.push('분석 데이터');
  const rawShort = (['eeg', 'ppg', 'acc'] as const).some((k) => prog.raw[k].expected !== null && prog.raw[k].received < (prog.raw[k].expected as number));
  if (rawShort) parts.push('측정 기록 파일');
  return parts.length ? `${parts.join('·')} 일부 도착` : '일부 도착';
};

const compState = (received: number, expected: number | null): string => (expected === null ? '집계 대기' : received >= expected ? '모두 도착' : '일부 도착');

function Evidence({ p }: { p: UploadParticipantDto }) {
  const prog = p.progress;
  return (
    <details className="text-[12px]">
      <summary className="min-h-11 cursor-pointer py-2 text-[#5F0080]">기록 보기</summary>
      <div data-testid="upload-detail" className="space-y-1 rounded-[10px] bg-[#F8F5FA] p-2.5 text-[#4A3F52]">
        {prog ? <>
          <p>분석 데이터 · {compState(prog.feature.received, prog.feature.expected)}</p>
          <p>측정 기록 파일 · {(['eeg', 'ppg', 'acc'] as const).some((k) => prog.raw[k].expected === null) ? '집계 대기' : (['eeg', 'ppg', 'acc'] as const).every((k) => prog.raw[k].received >= (prog.raw[k].expected as number)) ? '모두 도착' : '일부 도착'}</p>
          {(['eeg', 'ppg', 'acc'] as const).map((k) => <p key={k}>{SIGNAL_NAME[k]} · {compState(prog.raw[k].received, prog.raw[k].expected)}</p>)}
        </> : <p>집계 대기</p>}
        <p>마지막 도착 {formatClock(latestReceived(p))}</p>
      </div>
    </details>
  );
}

function PersonTable({ rows, attention }: { rows: UploadParticipantDto[]; attention?: boolean }) {
  return (
    <table className="w-full border-collapse text-left text-[13px]">
      <thead className="hidden md:table-header-group"><tr className="bg-[#F2F3F8] text-[12px]"><th className="p-3">이름</th><th className="p-3">마지막 도착</th><th className="p-3">{attention ? '덜 도착한 기록' : '데이터 크기 · 측정 길이'}</th><th className="p-3">{attention ? '할 일' : '기록'}</th></tr></thead>
      <tbody>
        {rows.map((p) => {
          const failed = rawTotals(p).failed > 0;
          const stalled = p.reasons.includes('raw_pending_stale');
          return (
            <tr key={p.participant_id} data-testid="upload-row" data-bucket={attention ? 'attention' : 'other'} className="grid grid-cols-2 border-t border-[#EEE8F1] md:table-row">
              <td className="p-2.5 font-semibold md:p-3">{displayName(p)}{p.is_guest && <small className="ml-1 font-normal text-[#776D7B]">게스트</small>}</td>
              <td className="p-2.5 md:p-3">{formatClock(latestReceived(p))}</td>
              <td className="col-span-2 p-2.5 md:col-span-1 md:p-3">{attention ? personComponents(p) : `${formatBytes(p.metrics?.bytes_arrived)} · ${formatMinutes(p.metrics?.measured_min)}`}</td>
              <td className="col-span-2 p-2.5 md:col-span-1 md:p-3">{attention ? personAction({ failed, stalled }) : null}<Evidence p={p} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Paged({ rows, label, attention }: { rows: UploadParticipantDto[]; label: string; attention?: boolean }) {
  const [page, setPage] = useState(0);
  const last = pageCount(rows.length) - 1;
  const cur = Math.min(page, last);
  return (
    <div data-testid={`paged-${label}`}>
      <PersonTable rows={slicePage(rows, cur)} attention={attention} />
      {rows.length > PAGE_SIZE && (
        <div className="mt-2 flex items-center justify-between">
          <button type="button" data-testid="person-prev" disabled={cur === 0} onClick={() => setPage(cur - 1)} className={`${fieldClass} disabled:opacity-40`}>이전 {PAGE_SIZE}명</button>
          <span data-testid="person-info" className="text-[12px] text-[#776D7B]">{cur + 1} / {last + 1} · {formatCount(rows.length)}명</span>
          <button type="button" data-testid="person-next" disabled={cur === last} onClick={() => setPage(cur + 1)} className={`${fieldClass} disabled:opacity-40`}>다음 {PAGE_SIZE}명</button>
        </div>
      )}
    </div>
  );
}

export interface UploadStatusTableProps { data: UploadStatusResponse }

/** 회차 상태: 상세는 목록과 같은 판정을 쓰되 최상위 progress 를 그대로 넘긴다. */
function sessionState(data: UploadStatusResponse): BoardState {
  return boardState({ progress: data.progress ?? null, summary: data.summary, session_status: data.session_status, status: null });
}

export function UploadStatusTable({ data }: UploadStatusTableProps) {
  const [query, setQuery] = useState('');
  const state = sessionState(data);
  const m = data.metrics;
  const prog = data.progress ?? null;
  const attentionN = prog ? prog.participants.needs_attention : data.summary.needs_attention;
  const percent = transferPercent(m, prog?.overall, state === 'ok');
  const uncertain = state === 'pending';
  const buckets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const b: Record<PersonBucket, UploadParticipantDto[]> = { attention: [], arrived: [], final_pending: [], waiting: [], excluded: [] };
    for (const p of data.participants) {
      if (q && !displayName(p).toLowerCase().includes(q)) continue;
      b[personBucket(p)].push(p);
    }
    for (const k of Object.keys(b) as PersonBucket[]) b[k].sort((x, y) => displayName(x).localeCompare(displayName(y), 'ko') || x.participant_id.localeCompare(y.participant_id));
    return b;
  }, [data.participants, query]);
  const action = coachAction(state, attentionN);
  const finalPendingN = prog?.participants.final_pending ?? buckets.final_pending.length;
  const showFinal = showFinalPending(state, finalPendingN);
  const pendingN = buckets.final_pending.length;
  const waitingN = buckets.waiting.length;
  const excludedN = buckets.excluded.length;

  return (
    <div className="space-y-3" data-testid="upload-status-table">
      <section aria-label="회차 상황판" className={`${cardClass} border-t-[3px] border-t-[#5F0080]`}>
        <h2 className="text-[18px] font-bold">회차 데이터 상황판</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          <Metric testId="metric-state" title="상태" value={<StateBadge state={state} label={state === 'warn' ? `${BOARD_LABEL.warn} ${attentionN}명` : BOARD_LABEL[state]} className="!text-[14px]" />} sub={state === 'ok' ? COACH_OK_NOTE : state === 'warn' ? '앱 연결 확인' : state === 'live' ? '현재까지 도착한 기록' : '최신 현황 확인 대기'} />
          <Metric testId="metric-people" title="참여자" value={uncertain ? DASH : arrivedText(m)} sub="도착 / 확인된 대상" />
          <Metric testId="metric-bytes" title="데이터 크기" value={uncertain ? DASH : formatBytes(m?.bytes_arrived)} sub={m?.bytes_expected != null ? `예상 ${formatBytes(m.bytes_expected)}` : '연결 후 확인'} />
          <Metric testId="metric-duration" title="측정 길이" value={formatMinutes(m?.duration_min)} sub={m?.participant_minutes_total != null ? `참여자 합계 ${formatTotalHours(m.participant_minutes_total)}` : '참여자 합계 확인 전'} />
        </div>
        <div className="mt-4 flex justify-between"><b>전송 현황</b><b data-testid="transfer-percent">{percentText(percent)}</b></div>
        {showFinal && <div className="mb-1"><FinalPendingChip /></div>}
        <TransferBar percent={percent} />
        {showFinal && <p data-testid="final-pending-line" className="text-[12px] text-[#655173]">{FINAL_PENDING_COACH}</p>}
        <p className="text-[12px] text-[#776D7B]">{basisNote(prog, state)}</p>
        {(action || state === 'ok') && <p data-testid="action-line" className="mt-2 text-[12px] text-[#805000]">{action ?? COACH_OK_NOTE}</p>}
        <details className="mt-3 rounded-[10px] bg-[#F8F5FA] p-2.5 text-[12px]">
          <summary className="min-h-11 cursor-pointer py-2 text-[#5F0080]">전송 세부 보기</summary>
          <p>분석 데이터 · {prog ? compState(prog.feature.received, prog.feature.expected) : '집계 대기'}</p>
          <p>측정 기록 파일 · {prog ? (['eeg', 'ppg', 'acc'] as const).some((k) => prog.raw[k].expected === null) ? '집계 대기' : (['eeg', 'ppg', 'acc'] as const).every((k) => prog.raw[k].received >= (prog.raw[k].expected as number)) ? '모두 도착' : '일부 도착' : '집계 대기'}</p>
          <p className="text-[#776D7B]">{SERVER_BASIS_NOTE}</p>
        </details>
      </section>

      <div className="flex gap-2" role="search">
        <input type="search" aria-label="참여자 이름 검색" placeholder="참여자 이름" value={query} onChange={(e) => setQuery(e.target.value)} className={`${fieldClass} min-w-0 flex-1`} />
      </div>

      {data.participants.length === 0 ? (
        <p role="status" className={`${cardClass} text-center text-[#776D7B]`}>등록된 참여자가 없어요</p>
      ) : buckets.attention.length + buckets.arrived.length + pendingN + waitingN + excludedN === 0 ? (
        <p role="status" className={`${cardClass} text-center text-[#776D7B]`}>조건에 맞는 참여자가 없어요</p>
      ) : (
        <section className={cardClass} aria-label="참여자">
          {buckets.attention.length > 0 && (
            <div data-testid="group-attention"><h2 className="mb-1 text-[18px] font-bold">확인할 사람 · {formatCount(buckets.attention.length)}명</h2><Paged rows={buckets.attention} label="attention" attention /></div>
          )}
          {buckets.arrived.length > 0 && (
            <details data-testid="group-arrived" className="mt-2">
              <summary className="min-h-11 cursor-pointer py-2 font-medium text-[#5F0080]">모두 도착 {formatCount(buckets.arrived.length)}명 보기</summary>
              <Paged rows={buckets.arrived} label="arrived" />
            </details>
          )}
          {pendingN > 0 && (
            <details data-testid="group-final-pending" className="mt-2">
              <summary className="min-h-11 cursor-pointer py-2 font-medium text-[#5F0080]">최종 확인 대기 {formatCount(pendingN)}명</summary>
              <p className="text-[12px] text-[#776D7B]">{FINAL_PENDING_PERSON_NOTE}</p>
              <Paged rows={buckets.final_pending} label="final-pending" />
            </details>
          )}
          {waitingN + excludedN > 0 && (
            <details data-testid="group-waiting" className="mt-2">
              <summary className="min-h-11 cursor-pointer py-2 font-medium text-[#5F0080]">{[waitingN > 0 && `집계 대기·전송 중 ${formatCount(waitingN)}명`, excludedN > 0 && `수집 제외 ${formatCount(excludedN)}명`].filter(Boolean).join(' · ')}</summary>
              {waitingN > 0 && <Paged rows={buckets.waiting} label="waiting" />}
              {excludedN > 0 && <div className="mt-2"><p className="text-[12px] text-[#776D7B]">수집 제외는 문제가 아니에요</p><Paged rows={buckets.excluded} label="excluded" /></div>}
            </details>
          )}
        </section>
      )}
    </div>
  );
}
