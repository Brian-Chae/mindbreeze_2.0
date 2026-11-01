// SDD-261: 리포트 화면의 "데이터 수신 확인 필요 N명" 칩. 업로드 현황과 같은 훅을 쓰며 표를 만들지 않는다.
// 조회 실패·403·404·0명이면 아무것도 그리지 않는다(리포트 화면은 기존 그대로 동작 — 실패 격리).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSession } from '../../lib/api/session';
import { useUploadStatus } from '../../hooks/use-upload-status';
import { uploadStatusScreenPath } from '../../lib/upload-status/view';

export function UploadAttentionChip({ classId, sessionId, live = true }: { classId: string | null | undefined; sessionId: string | null | undefined; live?: boolean }) {
  const { data, error } = useUploadStatus(classId, sessionId, { live });
  const count = error ? 0 : data?.summary.needs_attention ?? 0;
  if (!classId || !sessionId || count <= 0) return null;
  return (
    <Link data-testid="upload-attention-chip" to={uploadStatusScreenPath(classId, sessionId)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-[13px] font-semibold text-amber-900 hover:bg-amber-100">
      <span aria-hidden="true">!</span>데이터 수신 확인 필요 {count}명
    </Link>
  );
}

/** class_id 를 모르는 화면(구 리포트 목록)용: 회차에서 클래스를 찾아 같은 칩을 그린다. 실패하면 숨긴다. */
export function UploadAttentionChipBySession({ sessionId, live = false }: { sessionId: string | null | undefined; live?: boolean }) {
  const [classId, setClassId] = useState<string | null>(null);
  useEffect(() => {
    setClassId(null);
    if (!sessionId) return undefined;
    let alive = true;
    getSession(sessionId).then((s) => { if (alive) setClassId(s.class_id ?? null); }, () => undefined);
    return () => { alive = false; };
  }, [sessionId]);
  return <UploadAttentionChip classId={classId} sessionId={sessionId} live={live} />;
}
