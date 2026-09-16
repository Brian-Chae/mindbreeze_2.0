// SDD-071: 명시 참가자 한 명의 데이터 패키지 요청·진행·직접 다운로드.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../lib/api/client';
import { createDataExport, getDataExport, getDataExportDownloadUrl, type DataExportJob } from '../../lib/api/data-exports';

const labels = {
  queued: '대기 중', preparing: '파일 생성 중', ready: '다운로드 준비 완료',
  ready_with_warnings: '일부 데이터 제외 · 다운로드 준비 완료', failed: '파일 생성 실패',
  expired: '보관기한 만료', cancelled: '취소됨',
};
const warningLabels: Record<string, string> = {
  not_measured: 'EEG 데이터가 없어 CSV는 헤더만 포함됩니다.',
  unknown: '저장된 EEG 데이터가 없으며 측정 여부를 확인할 수 없습니다.',
  report_missing: '참가자 리포트가 없어 JSON을 제외했습니다.',
  report_pending: '리포트가 아직 완료되지 않아 JSON을 제외했습니다.',
  unresolved_owner_excluded: '참가자 귀속을 확인할 수 없는 과거 데이터는 제외했습니다.',
};
const failureLabels: Record<string, string> = {
  access_revoked: '권한 또는 EEG 동의가 변경되어 중단했습니다.',
  queue_unavailable: '생성 작업을 시작하지 못했습니다. 잠시 후 새로 요청해 주세요.',
  storage_unavailable: '파일 저장소에 연결하지 못했습니다. 잠시 후 새로 요청해 주세요.',
  export_size_limit: '파일 생성 한도를 초과했습니다.',
  worker_timeout: '작업 시간이 초과되었습니다. 새로 요청해 주세요.',
  generation_failed: '파일을 생성하지 못했습니다. 다시 요청해 주세요.',
};

export default function DataExportButton({ sessionId, participantId, userId }: {
  sessionId: string; participantId: string; userId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [purpose, setPurpose] = useState('');
  const [job, setJob] = useState<DataExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requestKey = useRef<string | null>(null);
  const storageKey = `mb-data-export:${userId}:${sessionId}:${participantId}`;

  useEffect(() => {
    let active = true;
    const savedId = sessionStorage.getItem(storageKey);
    if (savedId) {
      getDataExport(savedId).then((next) => { if (active) setJob(next); }).catch(() => {
        if (active) sessionStorage.removeItem(storageKey);
      });
    }
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!job || !['queued', 'preparing'].includes(job.status)) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await getDataExport(job.export_id);
        if (active) { setJob(next); setError(null); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '진행 상태를 확인하지 못했습니다.');
      }
    }, 2000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [job, refresh]);

  async function requestExport() {
    if (busy || purpose.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setDownloadStarted(false);
    requestKey.current ??= crypto.randomUUID();
    try {
      const next = await createDataExport(sessionId, participantId, purpose.trim(), requestKey.current);
      setJob(next);
      sessionStorage.setItem(storageKey, next.export_id);
      requestKey.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터 다운로드 요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!job || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await getDataExportDownloadUrl(job.export_id);
      const link = document.createElement('a');
      link.href = result.url;
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.download = 'mindbreeze-data.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadStarted(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) setJob({ ...job, status: 'expired' });
      setError(e instanceof Error ? e.message : '다운로드 링크를 발급하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const ready = job?.status === 'ready' || job?.status === 'ready_with_warnings';
  const terminal = job && ['failed', 'expired', 'cancelled'].includes(job.status);
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()}
      className="border border-[#E8D9F5] bg-white text-[#5F0080] font-medium hover:bg-[#F5EDFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080] text-[14px] px-5 py-2.5 rounded-xl">
      데이터 다운로드
    </button>
    {createPortal(<dialog ref={dialog} aria-labelledby="data-export-title"
      className="w-[min(92vw,480px)] rounded-2xl p-6 backdrop:bg-black/40 text-[#1F1F1F]">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 id="data-export-title" className="text-lg font-bold">참가자 데이터 다운로드</h2>
        <button type="button" onClick={() => dialog.current?.close()} className="p-2 rounded-lg hover:bg-gray-100" aria-label="닫기">닫기</button>
      </div>
      <p className="text-sm text-gray-600 mb-3">이 리포트의 참가자 한 명에 대한 EEG 특징값 CSV, 완료 리포트 JSON과 세션 정보를 ZIP으로 제공합니다.</p>
      <p className="text-sm text-gray-600 mb-4">실명은 제외되지만 민감한 데이터입니다. 허용된 목적에만 사용하고 보관·재배포에 주의해 주세요. 파일은 요청 후 24시간, 다운로드 링크는 최대 5분 동안 유효합니다.</p>
      {!job && <form onSubmit={(event) => { event.preventDefault(); void requestExport(); }}>
        <label className="block text-sm font-medium mb-2" htmlFor="data-export-purpose">활용 목적</label>
        <textarea id="data-export-purpose" required minLength={2} maxLength={500} value={purpose} disabled={busy}
          onChange={(event) => { setPurpose(event.target.value); requestKey.current = null; }}
          placeholder="예: 담당 세션의 측정 품질과 상담 경과 확인" className="w-full border rounded-lg p-3 text-sm mb-3" />
        <button type="submit" disabled={busy || purpose.trim().length < 2} className="mb-btn mb-btn-primary px-4 py-2 rounded-lg disabled:opacity-50">
          {busy ? '요청 중...' : '파일 생성 요청'}
        </button>
      </form>}
      {job && <div aria-live="polite" className="space-y-3 text-sm">
        <p className="font-semibold">{labels[job.status]}</p>
        {job.size_bytes !== null && <p>파일 크기: {job.size_bytes.toLocaleString()} 바이트</p>}
        <p>보관 만료: {new Date(job.expires_at).toLocaleString('ko-KR')}</p>
        {job.warnings.map((warning) => <p key={warning} className="text-amber-800">{warningLabels[warning] ?? warning}</p>)}
        {job.error_code && <p className="text-red-700">{failureLabels[job.error_code] ?? '파일을 준비하지 못했습니다.'}</p>}
        {ready && <button type="button" onClick={() => void download()} disabled={busy}
          className="mb-btn mb-btn-primary px-4 py-2 rounded-lg disabled:opacity-50">{busy ? '링크 발급 중...' : 'ZIP 다운로드'}</button>}
        {terminal && <button type="button" onClick={() => { setJob(null); setError(null); requestKey.current = null; sessionStorage.removeItem(storageKey); }}
          className="mb-btn mb-btn-secondary px-4 py-2 rounded-lg">새로 요청</button>}
        {downloadStarted && <p>브라우저에 다운로드를 요청했습니다. 저장 결과는 브라우저에서 확인해 주세요.</p>}
      </div>}
      {error && <div role="alert" className="mt-3 text-sm text-red-700"><p>{error}</p>
        {job && ['queued', 'preparing'].includes(job.status) && <button type="button" onClick={() => setRefresh((value) => value + 1)} className="underline mt-2">상태 다시 확인</button>}
      </div>}
    </dialog>, document.body)}
  </>;
}
