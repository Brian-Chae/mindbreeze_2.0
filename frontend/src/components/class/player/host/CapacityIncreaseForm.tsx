// SDD-289 — 정원 늘리기 폼(라이브 설정 시트·클래스 상세 공용). 늘리기만, 현재 입장 인원 미만 불가, 방식별 상한.
import { useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { schedulingApi } from '../../../../lib/api/class-scheduling';
import {
  capacityInputMessage, capacityMax, capacityServerMessage, capacitySuccessMessage, validateCapacityInput,
} from '../../../../lib/class/capacity-increase';
import './host-player.css';

export interface CapacityFormProps {
  classId: string;
  /** 현재 정원 */
  current: number;
  /** 현재 입장 인원 — 이보다 적게 정할 수 없다 */
  occupied: number;
  waiting: number;
  online: boolean;
  revision: number | undefined;
  /** 기관관리자는 사유 필수 */
  admin: boolean;
  /** 성공 후(클래스 쿼리 갱신용). 서버가 돌려준 정원을 넘긴다 */
  onChanged: (newCapacity: number) => void;
}

export function CapacityIncreaseForm({ classId, current, occupied, waiting, online, revision, admin, onChanged }: CapacityFormProps) {
  const max = capacityMax(online);
  const [raw, setRaw] = useState(String(Math.min(current + 1, max)));
  // 외부에서 현재 정원이 바뀌면(성공 후 갱신·다른 기기 변경) 낡아진 입력만 새 정원+1 로 맞춘다. 더 큰 값을 편집 중이면 보존한다.
  const [seenCurrent, setSeenCurrent] = useState(current);
  if (seenCurrent !== current) {
    setSeenCurrent(current);
    const typed = raw.trim();
    if (!/^\d+$/.test(typed) || Number(typed) <= current) setRaw(String(Math.min(current + 1, max)));
  }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [done, setDone] = useState('');
  const lock = useRef(false);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const full = current >= max;
  const ctx = { current, occupied, online };
  const check = validateCapacityInput(raw, ctx);
  const inputMessage = !full && check.error ? capacityInputMessage(check.error, ctx) : '';
  const reasonMissing = admin && !reason.trim();
  const canSubmit = !busy && !full && check.error === null && !reasonMissing && revision !== undefined;

  const step = (delta: number) => {
    const base = Number(raw.trim()) || current;
    setRaw(String(Math.max(1, base + delta)));
    setDone('');
    setServerError('');
  };

  const submit = async () => {
    if (!canSubmit || check.value === null || lock.current || revision === undefined) return;
    const signature = JSON.stringify([check.value, reason.trim(), revision]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    lock.current = true; setBusy(true); setServerError(''); setDone('');
    try {
      const res = await schedulingApi.increaseCapacity(classId, {
        operation_key: pending.current.key,
        expected_revision: revision,
        capacity: check.value,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      pending.current = null;
      const next = res.capacity ?? check.value;
      setDone(capacitySuccessMessage(next, res.promoted_count ?? 0));
      setRaw(String(Math.min(next + 1, capacityMax(online))));
      onChanged(next);
    } catch (e) {
      setServerError(capacityServerMessage(e));
    } finally {
      lock.current = false; setBusy(false);
    }
  };

  const errorText = inputMessage || serverError;
  return (
    <form className="hp-cap" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3 className="hp-cap__title">정원 늘리기</h3>
      <p className="hp-note">정원은 늘리기만 할 수 있어요. 최대 {max}명({online ? '온라인' : '오프라인'}).</p>
      <div className="hp-cap__stepper">
        <button type="button" className="hp-btn" data-variant="ghost" aria-label="정원 1명 줄이기" disabled={busy || full} onClick={() => step(-1)}><Minus aria-hidden="true" /></button>
        <input
          type="text" inputMode="numeric" className="hp-cap__input" aria-label="새 정원" disabled={busy || full}
          aria-invalid={inputMessage ? true : undefined} aria-describedby="hp-cap-msg"
          value={raw} onChange={(e) => { setRaw(e.target.value); setDone(''); setServerError(''); }}
        />
        <button type="button" className="hp-btn" data-variant="ghost" aria-label="정원 1명 늘리기" disabled={busy || full || Number(raw) >= max} onClick={() => step(1)}><Plus aria-hidden="true" /></button>
      </div>
      {admin ? (
        <label className="hp-cap__reason">변경 사유(필수)
          <input type="text" className="hp-cap__input" maxLength={1000} disabled={busy} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      ) : null}
      <p id="hp-cap-msg" role={errorText ? 'alert' : 'status'} className="hp-cap__msg" data-tone={errorText ? 'coral' : undefined}>
        {errorText || done || (full ? `이미 최대 정원(${max}명)이에요.` : waiting > 0 ? `대기 ${waiting}명이 있어요. 늘리면 순서대로 입장 처리돼요.` : '')}
      </p>
      <button type="submit" className="hp-btn" data-variant="coral" disabled={!canSubmit}>{busy ? '처리 중' : '정원 늘리기'}</button>
    </form>
  );
}
