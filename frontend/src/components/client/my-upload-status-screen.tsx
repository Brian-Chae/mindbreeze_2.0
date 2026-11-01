// SDD-265: 회원 "내 데이터 저장 현황"(시안 안3-A 회원 화면). 최근 10회차 선택 → 상태·내 측정 길이·내 데이터 크기·전송 현황·한 줄 조치를 한 화면에.
// 서버에 도착한 기록 기준. 점수·완료·보증 표현 없음. 수집 제외(미착용·마이크 끔)는 문제가 아니다.
import { useEffect, useMemo, useState } from 'react';
import { FinalPendingChip, Metric, TransferBar, cardClass, fieldClass } from '../class/upload-board-parts';
import { useMyUploadStatus } from '../../hooks/use-my-upload-status';
import type { MySessionRow } from '../../lib/api/my-upload-status';
import { DASH, formatBytes, formatMinutes, percentText } from '../../lib/upload-status/board';
import {
  MEMBER_KIND_ICON, MEMBER_KIND_LABEL, MEMBER_KIND_TONE, memberFinalPending, memberKind, memberLine, memberPercent,
} from '../../lib/upload-status/member-view';
import { formatClock } from '../../lib/upload-status/view';

const fmtDate = (iso: string | null): string => {
  if (!iso) return '일시 미정';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '일시 미정' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};
const optionText = (r: MySessionRow): string => `${fmtDate(r.started_at)} · ${r.class_title ?? '이름 없는 클래스'} ${r.seq ?? '?'}회차`;

function Detail({ row }: { row: MySessionRow }) {
  const kind = memberKind(row);
  const percent = memberPercent(row, kind);
  const finalPending = memberFinalPending(row, kind);
  const unknown = kind === 'pending';
  const noPercent = percent === null;
  return (
    <section data-testid="my-upload-status" data-kind={kind} aria-label="내 데이터 저장 현황" className={`${cardClass} border-t-[3px] border-t-[#5F0080]`}>
      <h2 className="text-[18px] font-bold">내 데이터 저장 현황</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 md:gap-3">
        <Metric testId="my-state" title="내 상태" value={<span data-testid="my-state-badge" className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[16px] font-semibold ${MEMBER_KIND_TONE[kind]}`}><span aria-hidden="true">{MEMBER_KIND_ICON[kind]}</span>{MEMBER_KIND_LABEL[kind]}</span>} sub={finalPending ? <FinalPendingChip className="!text-[11px]" /> : kind === 'ok' ? '추가 조치 없음' : undefined} />
        <Metric testId="my-duration" title="내 측정 길이" value={formatMinutes(row.measured_min ?? row.duration_min)} sub={row.duration_min !== null ? `회차 ${formatMinutes(row.duration_min)}` : '선택한 회차'} />
        <Metric testId="my-bytes" title="내 데이터 크기" value={unknown || kind === 'excluded' ? DASH : formatBytes(row.bytes_arrived)} sub={row.bytes_expected !== null && kind !== 'excluded' ? `예상 ${formatBytes(row.bytes_expected)}` : unknown ? '연결 후 확인' : undefined} />
        <Metric testId="my-percent" title="전송 현황" value={kind === 'excluded' ? DASH : percentText(percent)} sub={noPercent ? '최신 현황 확인 대기' : '도착한 크기 기준'} />
      </div>
      {kind !== 'excluded' && <div className="mt-3"><TransferBar percent={percent} /></div>}
      <p data-testid="my-action" className={`mt-3 rounded-xl px-3 py-2.5 text-[13px] ${kind === 'warn' ? 'bg-[#FFF2DD] text-[#805000]' : 'bg-[#F4EDF8] text-[#5F0080]'}`}>{memberLine(kind, finalPending)}</p>
      <p className="mt-2 text-[12px] text-[#776D7B]">마지막 도착 {formatClock(row.last_received_at)}</p>
    </section>
  );
}

export function MyUploadStatusScreen() {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const page = cursors.length - 1;
  const v = useMyUploadStatus(cursors[page]);
  const [picked, setPicked] = useState('');
  const rows = useMemo(() => v.items ?? [], [v.items]);
  // 선택이 없거나 목록에서 사라지면 가장 최근 회차를 보인다(한 화면 요약).
  useEffect(() => { if (rows.length > 0 && !rows.some((r) => r.session_id === picked)) setPicked(rows[0].session_id); }, [rows, picked]);
  const current = rows.find((r) => r.session_id === picked) ?? null;

  if (v.error?.status === 401) return <p role="alert" className={cardClass}>로그인이 필요해요. 다시 로그인해 주세요.</p>;
  if (v.forbidden) return <p role="alert" className={cardClass}>내 데이터를 볼 수 없어요. 잠시 후 다시 시도해 주세요.</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-3 text-[#2C2133]" data-testid="my-upload-screen">
      <p className="text-[13px] leading-relaxed text-[#776D7B]">내가 참여한 회차의 데이터가 서버에 도착한 현황이에요.</p>
      {v.offline && <p role="status" className={`${cardClass} text-[13px] text-amber-900`}>오프라인이에요. 연결되면 다시 확인해요.</p>}
      {v.error && ![401, 403].includes(v.error.status) && <p role="alert" className={`${cardClass} text-[13px] text-amber-900`}>현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
      {v.items === null && !v.error && <p role="status" className="text-[#776D7B]">불러오는 중이에요…</p>}
      {v.items !== null && rows.length === 0 && <p role="status" className={`${cardClass} text-center text-[#776D7B]`}>아직 확인할 회차가 없어요</p>}
      {rows.length > 0 && (
        <label className="block text-[12px] text-[#776D7B]">회차 선택 · 최근 {rows.length}회차
          <select aria-label="내 회차 선택" className={`${fieldClass} mt-1 w-full`} value={picked} onChange={(e) => setPicked(e.target.value)}>
            {rows.map((r) => <option key={r.session_id} value={r.session_id}>{optionText(r)}</option>)}
          </select>
        </label>
      )}
      {current && <Detail key={current.session_id} row={current} />}
      {(page > 0 || v.hasMore) && (
        <nav aria-label="페이지" className="flex items-center justify-between">
          <button type="button" data-testid="my-page-prev" disabled={page === 0} onClick={() => setCursors((c) => c.slice(0, -1))} className={`${fieldClass} disabled:opacity-40`}>이전 10회차</button>
          <span className="text-[12px] text-[#776D7B]">{page + 1}쪽</span>
          <button type="button" data-testid="my-page-next" disabled={!v.hasMore} onClick={() => { const c = v.nextCursor; if (c) setCursors((s) => [...s, c]); }} className={`${fieldClass} disabled:opacity-40`}>다음 10회차</button>
        </nav>
      )}
      <button type="button" onClick={v.refresh} className={fieldClass}>새로고침</button>
    </div>
  );
}
