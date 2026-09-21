// 세션 생성 페이지 (UI Kit)

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createSession,
  inviteParticipant,
  type CreateSessionPayload,
  type LinkbandMode,
  type LocationType,
  type ParticipantMode,
  type SessionDto,
  type SessionType,
} from '../../lib/api/session';
import AppShell from '../../components/layout/AppShell';
import { ParticipantPicker, type SelectedParticipant } from '../../components/session/ParticipantPicker';

export default function SessionCreatePage() {
  const navigate = useNavigate();
  const [type, setType] = useState<SessionType>('meditation');
  const [locationType] = useState<LocationType>('offline');
  const [participantMode, setParticipantMode] = useState<ParticipantMode>('one_on_one');
  const [linkbandMode, setLinkbandMode] = useState<LinkbandMode>('none');
  const [durationMin, setDurationMin] = useState(50);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [participants, setParticipants] = useState<SelectedParticipant[]>([]);
  const [createdSession, setCreatedSession] = useState<SessionDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteWarning, setInviteWarning] = useState<string | null>(null);

  // 1:1 모드면 1명, 그룹이면 최대 참여자 수만큼 선택 가능
  const pickerMax = participantMode === 'one_on_one' ? 1 : maxParticipants;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateSessionPayload = {
        type,
        duration_min: durationMin,
        title: title || undefined,
        notes: notes || undefined,
        max_participants: maxParticipants,
        location_type: locationType,
        participant_mode: participantMode,
        linkband_mode: linkbandMode,
        sfu_enabled: locationType === 'online' && participantMode === 'group',
      };
      const created = await createSession(payload);

      // 선택된 참여자 일괄 초대 — 개별 실패해도 클래스 생성 자체는 성공 처리
      if (participants.length > 0) {
        const results = await Promise.allSettled(
          participants.map((p) => inviteParticipant(created.id, p.userId)),
        );
        const failed = participants.filter((_, i) => results[i].status === 'rejected');
        if (failed.length > 0) {
          setInviteWarning(
            `일부 참여자 초대에 실패했습니다: ${failed.map((p) => p.name).join(', ')}. 클래스 상세에서 다시 초대할 수 있습니다.`,
          );
        }
      }

      setCreatedSession(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : '세션 생성에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyCode = async (): Promise<void> => {
    if (!createdSession?.access_code) return;
    try {
      await navigator.clipboard.writeText(createdSession.access_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('클래스 코드를 복사하지 못했습니다. 코드를 직접 선택해 주세요.');
    }
  };

  const inputCls =
    'w-full px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080]';
  const labelCls = 'block text-sm font-medium text-[#1F1F1F] mb-1.5';

  if (createdSession) {
    return (
      <AppShell title="클래스 생성 완료" sub="CREATE">
        <div className="max-w-[640px] mx-auto">
          <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6 sm:p-10 text-center">
            <p className="text-sm font-semibold text-[#1F8A5B] mb-2">즉시 클래스가 준비되었습니다</p>
            <h1 className="text-2xl font-bold text-[#1F1F1F] mb-8">
              {createdSession.title || '제목 없음'}
            </h1>
            <p className="text-sm text-[#6F6F6F] mb-2">참여자에게 아래 클래스 코드를 공유하세요</p>
            <div className="rounded-[20px] bg-[#F5EDFC] border border-[#DDD0EA] px-4 py-8 mb-4">
              <div className="font-mono text-5xl sm:text-6xl font-black tracking-[0.18em] text-[#5F0080]">
                {createdSession.access_code || '------'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              disabled={!createdSession.access_code}
              className="mb-btn w-full sm:w-auto disabled:opacity-50"
            >
              {copied ? '복사 완료' : '클래스 코드 복사'}
            </button>
            {inviteWarning && (
              <p className="mt-3 text-sm text-[#B3261E] bg-[#FDF1F0] border border-[#F2C9C5] rounded-xl px-4 py-3 text-left">
                {inviteWarning}
              </p>
            )}
            {error && <p className="mt-3 text-sm text-[#B3261E]">{error}</p>}
            <div className="flex flex-col sm:flex-row justify-center gap-2 mt-8">
              <button
                type="button"
                onClick={() => navigate(`/sessions/${createdSession.id}`)}
                className="mb-btn w-full sm:w-auto"
              >
                클래스 상세로 이동
              </button>
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className="mb-btn mb-btn--ghost w-full sm:w-auto"
              >
                클래스 목록으로 이동
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="새 세션" sub="CREATE">
      <div className="max-w-[640px] mx-auto">
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-5 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className={labelCls}>세션 유형</label>
              <select value={type} onChange={(e) => setType(e.target.value as SessionType)} className={inputCls}>
                <option value="meditation">명상수업</option>
                <option value="clinical">임상심리상담</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>인원</label>
              <select
                value={participantMode}
                onChange={(e) => {
                  const nextMode = e.target.value as ParticipantMode;
                  setParticipantMode(nextMode);
                  if (nextMode === 'one_on_one') {
                    setMaxParticipants(1);
                    // 1:1 전환 시 선택된 참여자를 1명으로 정리
                    setParticipants((prev) => prev.slice(0, 1));
                  }
                }}
                className={inputCls}
              >
                <option value="one_on_one">1:1</option>
                <option value="group">1:N (그룹)</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>LINK BAND</label>
              <select value={linkbandMode} onChange={(e) => setLinkbandMode(e.target.value as LinkbandMode)} className={inputCls}>
                <option value="none">미사용</option>
                <option value="optional">선택</option>
                <option value="required">필수</option>
              </select>
            </div>

            <div className="rounded-xl bg-[#F5EDFC] border border-[#DDD0EA] px-4 py-3">
              <p className="text-sm font-semibold text-[#5F0080]">즉시 클래스</p>
              <p className="text-xs text-[#6F6F6F] mt-1">
                일정 등록 없이 생성되며, 준비가 끝나면 상세 화면에서 바로 시작할 수 있습니다.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>소요 시간(분)</label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  required
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>최대 참여자 수</label>
                <input
                  type="number"
                  min={1}
                  max={participantMode === 'one_on_one' ? 1 : 100}
                  required
                  value={maxParticipants}
                  disabled={participantMode === 'one_on_one'}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setMaxParticipants(next);
                    // 최대 인원 축소 시 선택된 참여자도 그 수에 맞게 정리
                    setParticipants((prev) => (prev.length > next ? prev.slice(0, next) : prev));
                  }}
                  className={`${inputCls} disabled:bg-[#F2F3F8]`}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>제목</label>
              <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>메모</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
            </div>

            <ParticipantPicker selected={participants} onChange={setParticipants} maxParticipants={pickerMax} />

            {error && <p className="text-sm text-[#B3261E]">{error}</p>}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button type="submit" disabled={submitting} className="mb-btn w-full sm:w-auto">
                {submitting ? '생성 중...' : '즉시 클래스 만들기'}
              </button>
              <button type="button" onClick={() => navigate('/sessions')} className="mb-btn mb-btn--ghost w-full sm:w-auto">
                취소
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
