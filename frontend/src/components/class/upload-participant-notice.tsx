// SDD-261: 리포트 상세 — 해당 참여자가 수신 확인 필요일 때만 한 줄 안내. 실패·권한 없음이면 숨긴다.
import { useEffect, useState } from 'react';
import { getSession } from '../../lib/api/session';
import { useUploadStatus } from '../../hooks/use-upload-status';

export function UploadParticipantNotice({ sessionId, participantId }: { sessionId: string | null | undefined; participantId: string | null | undefined }) {
  const [classId, setClassId] = useState<string | null>(null);
  useEffect(() => {
    setClassId(null);
    if (!sessionId) return undefined;
    let alive = true;
    getSession(sessionId).then((s) => { if (alive) setClassId(s.class_id ?? null); }, () => undefined);
    return () => { alive = false; };
  }, [sessionId]);
  const { data, error } = useUploadStatus(classId, sessionId, { live: false });
  if (error || !participantId) return null;
  const me = data?.participants.find((p) => p.participant_id === participantId);
  if (me?.status !== 'needs_attention') return null;
  return <p data-testid="upload-participant-notice" data-print-exclude className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">데이터가 아직 더 도착할 수 있어요</p>;
}
