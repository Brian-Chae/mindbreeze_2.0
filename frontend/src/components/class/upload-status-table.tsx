// SDD-261: 설정·클래스 관리가 공유하는 회차 참여자 서버 수신 현황 표.
// 서버 수신 기준만 표시한다. 점수·완료·100%·좋음/나쁨 표현 없음. 폰 대기량은 "미확인"(0건 아님).
import { useMemo, useState } from 'react';
import type { UploadParticipantDto, UploadStatusResponse } from '../../lib/api/upload-status';
import {
  COLLECTION_LABEL, DEFAULT_FILTERS, SIGNAL_LABEL, STATUS_ICON, STATUS_LABEL, STATUS_ORDER,
  displayName, filterParticipants, formatClock, formatCount, groupParticipants, latestReceived, rawTotals, reasonLabel,
  type UploadFilters, type UploadGrouping,
} from '../../lib/upload-status/view';

const statusTone = (s: UploadParticipantDto['status']): string =>
  s === 'needs_attention' ? 'bg-amber-50 text-amber-900' : s === 'uploading' ? 'bg-[#F3E9F8] text-[#5B1A8A]' : 'bg-gray-100 text-gray-700';

export const SERVER_BASIS_NOTE = '서버에서 받은 데이터만 표시해요. 전체 생성 범위와의 대조는 미확인이에요.';
export const PHONE_QUEUE_NOTE = '폰에 남아 있는 전송 대기량은 현재 서버에 보고되지 않아요. 서버 등록 대기 건수와는 다르며, 미확인은 0건을 뜻하지 않아요.';

function PhoneQueue() {
  return (
    <details className="inline text-[12px] text-[#776D7B]">
      <summary className="inline cursor-pointer">폰 대기량: 미확인 ⓘ</summary>
      <span className="mt-1 block">{PHONE_QUEUE_NOTE}</span>
    </details>
  );
}

function StatusBadge({ p }: { p: UploadParticipantDto }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${statusTone(p.status)}`}>
      <span aria-hidden="true">{STATUS_ICON[p.status]}</span>{STATUS_LABEL[p.status]}
    </span>
  );
}

function RawLine({ p }: { p: UploadParticipantDto }) {
  const t = rawTotals(p);
  return <>원시 {formatCount(t.uploaded)}건 수신{t.pending > 0 ? ` · 서버 등록 대기 ${formatCount(t.pending)}건` : ''}</>;
}

function ReasonLines({ p }: { p: UploadParticipantDto }) {
  const failed = rawTotals(p).failed;
  if (p.reasons.length === 0) return p.status === 'received_unreconciled' ? <span>알려진 내부 결측 없음 · 전체 대조 미확인</span> : null;
  return (
    <ul className="space-y-0.5">
      {p.reasons.map((r) => (
        <li key={r}>{reasonLabel(r)}{r === 'raw_failed' && failed > 0 ? ` · ${formatCount(failed)}건` : ''}</li>
      ))}
    </ul>
  );
}

function Detail({ p }: { p: UploadParticipantDto }) {
  return (
    <div className="space-y-1.5 bg-[#FAF7FC] px-4 py-3 text-[13px] text-[#4A3F52]" data-testid="upload-detail">
      <p>마지막 수신 {formatClock(latestReceived(p))}</p>
      <p>
        {p.raw.signals.map((s) => `${SIGNAL_LABEL[s.signal_type]} ${formatCount(s.uploaded)}건`).join(' · ')} 수신
        {p.raw.signals.some((s) => s.pending > 0) && ` · 서버 등록 대기 ${p.raw.signals.map((s) => `${SIGNAL_LABEL[s.signal_type]} ${s.pending}`).join('/')}`}
      </p>
      <p>feature 내부 결측 {formatCount(p.feature.internal_missing)} · 원시 내부 결측 {formatCount(p.raw.signals.reduce((n, s) => n + s.internal_missing, 0))}</p>
      <p>리포트 입력 데이터 수신 여부와 리포트 선택({p.report_included === null ? '미확인' : p.report_included ? '선택' : '제외'})은 별도예요.</p>
      <p>전체 대조 미확인</p>
      <div><PhoneQueue /></div>
    </div>
  );
}

function Row({ p }: { p: UploadParticipantDto }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-testid="upload-row" data-status={p.status} className="border-b border-[#F0EBF2] last:border-b-0">
      <div className="grid items-center gap-2 px-4 py-3 text-[14px] md:grid-cols-[1.2fr_0.9fr_1.1fr_1.3fr_0.9fr_1.4fr_auto]">
        <div className="min-w-0 break-words font-semibold text-[#2C2133]">{displayName(p)}{p.is_guest && <span className="ml-1 text-[12px] font-normal text-[#776D7B]">게스트</span>}</div>
        <div className="text-[#4A3F52]">{p.participation_status === 'waitlisted' ? '대기열' : COLLECTION_LABEL[p.collection_state]}</div>
        <div className="text-[#4A3F52]">feature {formatCount(p.feature.received)}창 수신</div>
        <div className="text-[#4A3F52]"><RawLine p={p} /></div>
        <div className="text-[13px] text-[#776D7B]">{formatClock(latestReceived(p))}</div>
        <div className="space-y-1"><StatusBadge p={p} /><div className="text-[12px] text-[#4A3F52]"><ReasonLines p={p} /></div></div>
        <button type="button" aria-expanded={open} aria-label={`${displayName(p)} 상세 ${open ? '접기' : '확인'}`} onClick={() => setOpen((v) => !v)} className="min-h-11 min-w-11 rounded-lg text-[#5B1A8A]">{open ? '▲' : '▼'}</button>
      </div>
      {open && <Detail p={p} />}
    </li>
  );
}

const HEADERS = ['참여자', '수집 대상', 'feature 수신', '원시 수신', '마지막 수신', '확인 상태', '상세'];

export interface UploadStatusTableProps { data: UploadStatusResponse }

export function UploadStatusTable({ data }: UploadStatusTableProps) {
  const [filters, setFilters] = useState<UploadFilters>(DEFAULT_FILTERS);
  const [grouping, setGrouping] = useState<UploadGrouping>('attention');
  const filtered = useMemo(() => filterParticipants(data.participants, filters), [data.participants, filters]);
  const groups = useMemo(() => groupParticipants(filtered, grouping), [filtered, grouping]);
  const s = data.summary;
  const featureTotal = data.participants.reduce((n, p) => n + p.feature.received, 0);
  const rawTotal = data.participants.reduce((n, p) => n + rawTotals(p).uploaded, 0);
  const rawPending = data.participants.reduce((n, p) => n + rawTotals(p).pending, 0);
  const rawFailed = data.participants.reduce((n, p) => n + rawTotals(p).failed, 0);
  const set = <K extends keyof UploadFilters>(key: K, value: UploadFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const field = 'min-h-11 rounded-xl border border-[#E8E2ED] bg-white px-3 text-[14px]';

  return (
    <div className="space-y-4" data-testid="upload-status-table">
      <section aria-label="요약" className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-[#E9E2EB] bg-white p-4">
          <p className="text-[13px] text-[#776D7B]">참여자 {formatCount(s.participants)}명 · 확인 상태</p>
          <p className="mt-1 text-[22px] font-bold text-[#2C2133]">{formatCount(s.needs_attention)}명 <span className="text-[14px] font-semibold text-amber-900">! 확인 필요</span></p>
          <p className="text-[13px] text-[#4A3F52]">수신 확인 {formatCount(s.received_unreconciled)}명 · 수집 제외 {formatCount(s.excluded)}명 · 등록 건 업로드 중 {formatCount(s.uploading)}명 · 미수신 {formatCount(s.no_data)}명</p>
          <p className="text-[12px] text-[#776D7B]">전체 대조 미확인</p>
        </div>
        <div className="rounded-2xl border border-[#E9E2EB] bg-white p-4">
          <p className="text-[13px] text-[#776D7B]">feature · 리포트 입력 데이터 수신</p>
          <p className="mt-1 text-[22px] font-bold text-[#2C2133]">{formatCount(featureTotal)} <span className="text-[14px] font-semibold">창 수신</span></p>
          <p className="text-[12px] text-[#776D7B]">↓ 서버 수신 기준 · 리포트 선택 여부·품질은 별도 확인</p>
        </div>
        <div className="rounded-2xl border border-[#E9E2EB] bg-white p-4">
          <p className="text-[13px] text-[#776D7B]">원시 데이터 · EEG / PPG / ACC</p>
          <p className="mt-1 text-[22px] font-bold text-[#2C2133]">{formatCount(rawTotal)} <span className="text-[14px] font-semibold">건 수신</span></p>
          <p className="text-[12px] text-[#4A3F52]">◷ 서버 등록 대기 {formatCount(rawPending)}건 · 서버가 받지 않은 등록 건 {formatCount(rawFailed)}건</p>
          <p className="text-[12px] text-[#776D7B]">전체 생성 건수 미확인</p>
        </div>
      </section>
      <div className="text-[13px] text-[#776D7B]">ⓘ {SERVER_BASIS_NOTE} <PhoneQueue /></div>

      <div className="flex flex-wrap gap-2" role="search">
        <input type="search" aria-label="참여자 이름 검색" placeholder="참여자 이름" value={filters.query} onChange={(e) => set('query', e.target.value)} className={`${field} min-w-0 flex-1`} />
        <select aria-label="상태 필터" value={filters.status} onChange={(e) => set('status', e.target.value as UploadFilters['status'])} className={field}>
          <option value="all">전체 상태</option>
          {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
        </select>
        <select aria-label="수집 대상 필터" value={filters.collection} onChange={(e) => set('collection', e.target.value as UploadFilters['collection'])} className={field}>
          <option value="all">전체 수집 대상</option>
          <option value="eligible">수집 대상</option><option value="excluded">수집 제외</option><option value="unknown">수집 대상 미확인</option>
        </select>
        <select aria-label="리포트 선택 필터" value={filters.report} onChange={(e) => set('report', e.target.value as UploadFilters['report'])} className={field}>
          <option value="all">리포트 선택 전체</option><option value="included">리포트 선택</option><option value="excluded">리포트 제외</option>
        </select>
        <select aria-label="그룹핑" value={grouping} onChange={(e) => setGrouping(e.target.value as UploadGrouping)} className={field}>
          <option value="attention">확인 필요 / 그 외</option><option value="collection">수집 대상별</option>
        </select>
      </div>

      {data.participants.length === 0 ? (
        <p role="status" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-center text-[#776D7B]">등록된 참여자가 없어요</p>
      ) : filtered.length === 0 ? (
        <p role="status" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-center text-[#776D7B]">조건에 맞는 참여자가 없어요</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#E9E2EB] bg-white">
          <div className="hidden bg-[#FAF7FC] px-4 py-2 text-[12px] text-[#776D7B] md:grid md:grid-cols-[1.2fr_0.9fr_1.1fr_1.3fr_0.9fr_1.4fr_auto] md:gap-2" aria-hidden="true">
            {HEADERS.map((h) => <div key={h}>{h}</div>)}
          </div>
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className="border-y border-[#F0EBF2] bg-[#FDFBFE] px-4 py-2 text-[13px] font-semibold text-[#5B1A8A]">{g.label} · {formatCount(g.rows.length)}명</h3>
              <ul>{g.rows.map((p) => <Row key={p.participant_id} p={p} />)}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
