// 세션 후 AI 기록지 조회·편집 페이지 (SDD-013)
// 3탭 (AI 요약 / 전사문 / 상담사 메모) + WebSocket 실시간 처리 상태

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getRecord, getTranscript, type RecordResponse, type TranscriptResponse } from '../../lib/api/audio';
import { RecordView } from '../../components/records/RecordView';
import { useRecordSocket, RECORD_STATUS_LABELS, type RecordStatus } from '../../hooks/useRecordSocket';

function StatusProgressBar({ status }: { status: RecordStatus }) {
  const steps: { key: RecordStatus; label: string }[] = [
    { key: 'merging', label: '병합' },
    { key: 'transcribing', label: '인식' },
    { key: 'diarizing', label: '화자분리' },
    { key: 'summarizing', label: '요약' },
    { key: 'completed', label: '완료' },
  ];

  const currentIndex = steps.findIndex((s) => s.key === status);
  const isFailed = status === 'failed';

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-center gap-1.5">
        {isFailed ? (
          <span className="text-sm font-medium text-red-600 dark:text-red-400">처리 실패</span>
        ) : (
          <>
            {steps.map((step, i) => {
              const isDone = i < currentIndex;
              const isCurrent = i === currentIndex;
              return (
                <div key={step.key} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <div
                      className={`h-px w-6 ${
                        isDone ? 'bg-indigo-400' : 'bg-neutral-300 dark:bg-neutral-600'
                      }`}
                    />
                  )}
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                      isDone
                        ? 'bg-indigo-600 text-white'
                        : isCurrent
                          ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-400 dark:bg-indigo-900/50 dark:text-indigo-300'
                          : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400'
                    }`}
                  >
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span
                    className={`text-xs ${
                      isCurrent
                        ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                        : 'text-neutral-500'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">
        {status === 'completed'
          ? 'AI 기록지 생성이 완료되었습니다.'
          : status === 'failed'
            ? '처리 중 오류가 발생했습니다. 다시 시도해주세요.'
            : `${RECORD_STATUS_LABELS[status]}...`}
      </p>
    </div>
  );
}

export default function SessionRecordPage() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<RecordResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { status: wsStatus, subscribe } = useRecordSocket();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [r, t] = await Promise.all([getRecord(id), getTranscript(id)]);
      setRecord(r);
      setTranscript(t);
      setLoading(false);

      if (r.status === 'completed' || r.status === 'failed') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
      return r;
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
      return null;
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    // WebSocket 구독
    subscribe(id);

    // 초기 로드
    fetchData();

    // 폴링 (3초 간격, 완료/실패 시 중지)
    pollRef.current = setInterval(() => {
      fetchData();
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [id, subscribe, fetchData]);

  // WebSocket 상태가 업데이트될 때마다 데이터 갱신
  useEffect(() => {
    if (wsStatus === 'completed' || wsStatus === 'failed') {
      fetchData();
    }
  }, [wsStatus, fetchData]);

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (loading && !record) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-sm text-neutral-500">기록지 로딩 중...</div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        기록지를 불러올 수 없습니다.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 md:max-w-3xl md:p-6 text-sm md:text-base">
      <h1 className="text-lg md:text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        AI 기록지
      </h1>

      {wsStatus && wsStatus !== 'completed' && wsStatus !== 'failed' && (
        <StatusProgressBar status={wsStatus} />
      )}

      <RecordView
        record={record}
        transcript={transcript}
        onUpdated={setRecord}
      />
    </div>
  );
}
