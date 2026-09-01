// 세션 후 AI 기록지 조회·편집 페이지 (SDD-013)
// 3탭 (AI 요약 / 전사문 / 상담사 메모) + WebSocket 실시간 처리 상태

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { StatusBadge } from '../../components/session/StatusBadge';
import { RecordView } from '../../components/records/RecordView';
import { getRecord, getTranscript, type RecordResponse, type TranscriptResponse } from '../../lib/api/audio';
import { getSession, type SessionDto, type SessionType } from '../../lib/api/session';
import { useRecordSocket, RECORD_STATUS_LABELS, type RecordStatus } from '../../hooks/useRecordSocket';

const TYPE_LABELS: Record<SessionType, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

const TYPE_CLASSES: Record<SessionType, string> = {
  clinical: 'bg-[#F5EDFC] text-[#5F0080]',
  hypnosis: 'bg-[#EFE3FA] text-[#6E1A8C]',
  meditation: 'bg-[#E6F8F3] text-[#1F8A5B]',
  custom: 'bg-[#FFF4DC] text-[#8A6B1F]',
};

const PROCESSING_STATUSES: RecordStatus[] = ['merging', 'transcribing', 'diarizing', 'summarizing'];

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AccessCodeCell({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };

  if (!code) {
    return <span className="text-[#C2C3CE]">-</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono font-bold tracking-widest text-[#5F0080]">{code}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="px-2 py-1 rounded-lg bg-[#F5EDFC] text-[#5F0080] text-[11px] font-semibold hover:bg-[#EBDEF7] transition-colors"
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}

function TypeBadge({ session }: { session: SessionDto }) {
  const label =
    session.type === 'custom' && session.custom_type_name
      ? session.custom_type_name
      : TYPE_LABELS[session.type];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide ${TYPE_CLASSES[session.type]}`}
    >
      {label}
    </span>
  );
}

function ClassMetaCard({ session }: { session: SessionDto }) {
  const guestCount = session.participants.filter((p) => p.is_guest).length;
  const participantCount = session.participants.length;

  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-bold tracking-tight text-[#1F1F1F] text-[17px]">
          {session.title || '제목 없음'}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge session={session} />
          <StatusBadge status={session.status} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">
            클래스 코드
          </div>
          <AccessCodeCell code={session.access_code} />
        </div>
        <div>
          <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">
            참여자
          </div>
          <span className="text-[14px] text-[#1F1F1F]">
            {participantCount}명
            {guestCount > 0 && (
              <span className="text-[12px] text-[#9B9B9B] ml-1">(게스트 {guestCount})</span>
            )}
          </span>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">
            일시
          </div>
          <span className="text-[14px] text-[#6F6F6F] font-mono">
            {formatDateTime(session.started_at)} ~ {formatDateTime(session.ended_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusProgressBar({ status }: { status: RecordStatus }) {
  const steps: { key: RecordStatus; label: string }[] = [
    { key: 'merging', label: '병합' },
    { key: 'transcribing', label: '인식' },
    { key: 'diarizing', label: '화자분리' },
    { key: 'summarizing', label: '요약' },
    { key: 'completed', label: '완료' },
  ];

  const currentIndex = steps.findIndex((s) => s.key === status);

  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((step, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div key={step.key} className="flex items-center gap-1.5">
              {i > 0 && (
                <div
                  className={`h-px w-6 ${isDone ? 'bg-[#5F0080]' : 'bg-[#DDDEE7]'}`}
                />
              )}
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  isDone
                    ? 'bg-[#5F0080] text-white'
                    : isCurrent
                      ? 'bg-[#F5EDFC] text-[#5F0080] ring-2 ring-[#5F0080]'
                      : 'bg-[#F2F3F8] text-[#6F6F6F]'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span
                className={`text-xs ${
                  isCurrent ? 'font-semibold text-[#5F0080]' : 'text-[#6F6F6F]'
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-[#6F6F6F]">
        {`${RECORD_STATUS_LABELS[status]}...`}
      </p>
    </div>
  );
}

function isProcessingStatus(status: string | null): status is RecordStatus {
  return status !== null && PROCESSING_STATUSES.includes(status as RecordStatus);
}

export default function SessionRecordPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionDto | null>(null);
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

  const fetchSession = useCallback(async () => {
    if (!id) return;
    try {
      const s = await getSession(id);
      setSession(s);
    } catch {
      /* 세션 메타 로드 실패 시 기록지는 계속 표시 */
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    subscribe(id);
    void fetchSession();
    void fetchData();

    pollRef.current = setInterval(() => {
      void fetchData();
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [id, subscribe, fetchData, fetchSession]);

  useEffect(() => {
    if (wsStatus === 'completed' || wsStatus === 'failed') {
      void fetchData();
    }
  }, [wsStatus, fetchData]);

  const recordStatus = record?.status ?? null;
  const progressStatus = isProcessingStatus(wsStatus)
    ? wsStatus
    : isProcessingStatus(recordStatus)
      ? (recordStatus as RecordStatus)
      : null;

  if (error) {
    return (
      <AppShell title="AI 기록지" sub="클래스 기록">
        <div className="p-3 rounded-xl bg-[#FDECEC] text-[#B3261E] text-sm">{error}</div>
      </AppShell>
    );
  }

  if (loading && !record) {
    return (
      <AppShell title="AI 기록지" sub="클래스 기록">
        <div className="text-[#6F6F6F] text-sm">기록지 로딩 중...</div>
      </AppShell>
    );
  }

  if (!record) {
    return (
      <AppShell title="AI 기록지" sub="클래스 기록">
        <div className="text-sm text-[#6F6F6F]">기록지를 불러올 수 없습니다.</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="AI 기록지" sub="클래스 기록">
      <div className="space-y-4 max-w-4xl">
        {session && <ClassMetaCard session={session} />}

        {progressStatus && <StatusProgressBar status={progressStatus} />}

        <RecordView
          record={record}
          transcript={transcript}
          onUpdated={setRecord}
        />
      </div>
    </AppShell>
  );
}
