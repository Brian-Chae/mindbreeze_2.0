// SDD-323 F7 — 권한 변경 확인 모달(승격·회수·해지·대표 넘기기·가입 거절). 영향 설명 + 사유 필수 + 중복 제출 방지 + 에러코드별 문구.
import { useRef, useState } from 'react';
import { orgErrorMessage, type CounselorItem } from '../../../../lib/api/org';
import { OrgDialog } from '../ui-v2-org-parts';

import { actionCopy, type ActionKind } from './members-model';

/** 서버 에러코드가 막은 사유를 보여주는 읽기 전용 모달(마지막 관리자·진행 세션 등 조건부 차단). */
export function BlockedDialog({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return (
    <OrgDialog labelledBy="u2m-blocked-title" onClose={onClose}>
      <h3 id="u2m-blocked-title">{title}</h3>
      <p>{message}</p>
      <div className="u2-dialog-actions"><button type="button" className="u2-secondary" onClick={onClose}>닫기</button></div>
    </OrgDialog>
  );
}

export function ActionDialog({
  kind,
  target,
  onSubmit,
  onClose,
}: {
  kind: ActionKind;
  target: Pick<CounselorItem, 'name'>;
  /** 성공하면 resolve. 실패하면 reject(ApiError) — 이 모달이 에러코드 문구를 보여준다. */
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const copy = actionCopy(kind, target.name);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  const submit = async (): Promise<void> => {
    const trimmed = reason.trim();
    if (!trimmed || inflight.current) return; // 더블클릭 방지
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(orgErrorMessage(err, '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
      inflight.current = false;
      setBusy(false);
    }
  };

  return (
    <OrgDialog labelledBy="u2m-action-title" onClose={busy ? () => undefined : onClose}>
      <h3 id="u2m-action-title">{copy.title}</h3>
      <p>{copy.impact}</p>
      <label className="u2-dialog-label">
        사유 (필수)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="사유를 입력하세요" disabled={busy} />
      </label>
      {error && <p className="u2-org-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      <div className="u2-dialog-actions">
        <button type="button" className="u2-secondary" onClick={onClose} disabled={busy}>취소</button>
        <button
          type="button"
          className={`u2-primary ${copy.danger ? 'u2-btn-solid-danger' : ''}`}
          onClick={() => void submit()}
          disabled={busy || !reason.trim()}
        >
          {busy ? '처리 중…' : copy.confirm}
        </button>
      </div>
    </OrgDialog>
  );
}
