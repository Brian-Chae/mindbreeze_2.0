// SDD-262: 회원 "내 데이터 저장 현황" 본문. 서버 수신 기준, 수치는 '수신 N창'으로만 표기한다.
import { useEffect, useState } from 'react';
import { useMyUploadStatus } from '../../hooks/use-my-upload-status';
import { listMySessionOptions, type MySessionOption } from '../../lib/api/my-upload-status';
import {
  isLiveSession, MY_SIGNAL_LABEL, MY_STATUS_HINT, MY_STATUS_ICON, MY_STATUS_LABEL, pickCandidateSessions, type MyStatusKind,
} from '../../lib/upload-status/member-view';
import { formatClock, formatCount } from '../../lib/upload-status/view';

const TONE: Record<MyStatusKind, string> = {
  needs_attention: 'border-amber-300 bg-amber-50 text-amber-900',
  uploading: 'border-sky-300 bg-sky-50 text-sky-900',
  received: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  no_data: 'border-[#E9E2EB] bg-[#F7F4F9] text-[#4A3F52]',
};
const card = 'rounded-2xl border border-[#E9E2EB] bg-white p-4';
const fmtDate = (iso: string | null): string => {
  if (!iso) return '일시 미정'; const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '일시 미정' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

function SessionStatus({ session }: { session: MySessionOption }) {
  const v = useMyUploadStatus(session.id, isLiveSession(session.status));
  if (v.forbidden) return <p role="alert" className={card}>이 회차의 내 데이터를 볼 수 없어요. 참여 기록이 없는 회차일 수 있어요.</p>;
  if (v.notFound) return <p role="alert" className={card}>회차를 찾을 수 없어요.</p>;
  if (v.error?.status === 401) return <p role="alert" className={card}>로그인이 필요해요. 다시 로그인해 주세요.</p>;
  return <div className="space-y-3" data-testid="my-upload-status">
    {v.offline && <p role="status" className={`${card} text-[13px] text-amber-900`}>오프라인이에요. 연결되면 다시 확인해요.</p>}
    {v.error && ![401, 403, 404].includes(v.error.status) && <p role="alert" className={`${card} text-[13px] text-amber-900`}>현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
    {v.model ? <>
      <section className={`rounded-2xl border p-4 ${TONE[v.model.kind]}`} aria-label="저장 상태">
        <p className="flex items-center gap-2 text-[16px] font-bold"><span aria-hidden="true">{MY_STATUS_ICON[v.model.kind]}</span>{MY_STATUS_LABEL[v.model.kind]}</p>
        <p className="mt-1 text-[13px] leading-relaxed">{MY_STATUS_HINT[v.model.kind]}</p>
      </section>
      <section className={card} aria-label="수신 수치">
        <p className="text-[12px] text-[#776D7B]">서버 수신 기준</p>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-[14px]">
          <div><dt className="text-[#776D7B]">리포트 입력(feature)</dt><dd className="font-bold">수신 {formatCount(v.model.featureWindows)}창</dd></div>
          <div><dt className="text-[#776D7B]">마지막 수신</dt><dd className="font-bold">{formatClock(v.model.lastReceivedAt)}</dd></div>
        </dl>
        <p className="mt-3 text-[13px] text-[#776D7B]">원시 데이터 조각 · 등록 {formatCount(v.model.raw.registered)} · 업로드됨 {formatCount(v.model.raw.uploaded)} · 대기 {formatCount(v.model.raw.pending)} · 실패 {formatCount(v.model.raw.failed)}</p>
        <ul className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
          {v.model.signals.map((s) => <li key={s.signal} className="rounded-xl bg-[#F7F4F9] p-2"><strong>{MY_SIGNAL_LABEL[s.signal]}</strong><br />업로드 {formatCount(s.uploaded)}<br />대기 {formatCount(s.pending)}{s.failed > 0 && <><br />실패 {formatCount(s.failed)}</>}</li>)}
        </ul>
      </section>
    </> : !v.error && <p role="status" className="text-[#776D7B]">불러오는 중이에요…</p>}
    <button type="button" onClick={v.refresh} className="min-h-11 rounded-xl border border-[#E9E2EB] px-4 text-[14px] text-[#5B1A8A]">새로고침</button>
  </div>;
}

export function MyUploadStatusScreen() {
  const [options, setOptions] = useState<MySessionOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState('');
  useEffect(() => {
    const c = new AbortController();
    listMySessionOptions(c.signal).then((rows) => { if (!c.signal.aborted) setOptions(pickCandidateSessions(rows)); }, () => { if (!c.signal.aborted) setFailed(true); });
    return () => c.abort();
  }, []);
  const current = options?.find((o) => o.id === picked) ?? null;
  return <div className="mx-auto max-w-2xl space-y-4 text-[#2C2133]">
    <p className="text-[13px] leading-relaxed text-[#776D7B]">내가 참여한 회차의 데이터가 서버에 도착한 현황이에요. 서버가 받은 기준으로만 보여 줘요.</p>
    {failed && <p role="alert" className={`${card} text-[13px] text-amber-900`}>회차 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
    {options && options.length === 0 && <p role="status" className={`${card} text-center text-[#776D7B]`}>아직 확인할 회차가 없어요</p>}
    {options && options.length > 0 && <label className="block text-[12px] text-[#776D7B]">회차
      <select aria-label="회차 선택" className="mt-1 min-h-11 w-full rounded-xl border border-[#E8E2ED] bg-white px-3 text-[14px] text-[#2C2133]" value={picked} onChange={(e) => setPicked(e.target.value)}>
        <option value="">회차 선택</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.classTitle} · {o.seq ?? '?'}회차 · {fmtDate(o.scheduled_at)}</option>)}
      </select></label>}
    {current && <SessionStatus key={current.id} session={current} />}
  </div>;
}
