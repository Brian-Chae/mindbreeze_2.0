// 세션 생성 페이지 (UI Kit)

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createSession,
  type CreateSessionPayload,
  type LinkbandMode,
  type LocationType,
  type ParticipantMode,
  type SessionDto,
  type SessionType,
} from '../../lib/api/session';
import { ParticipantPicker, type SelectedParticipant } from '../../components/session/ParticipantPicker';
import AppShell from '../../components/layout/AppShell';

export default function SessionCreatePage() {
  const navigate = useNavigate();
  const [type, setType] = useState<SessionType>('clinical');
  const [customTypeName, setCustomTypeName] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('offline');
  const [participantMode, setParticipantMode] = useState<ParticipantMode>('one_on_one');
  const [linkbandMode, setLinkbandMode] = useState<LinkbandMode>('none');
  const [durationMin, setDurationMin] = useState(50);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(1);
  const [selectedParticipants, setSelectedParticipants] = useState<SelectedParticipant[]>([]);
  const [createdSession, setCreatedSession] = useState<SessionDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        participant_ids: selectedParticipants.length > 0 ? selectedParticipants.map((s) => s.userId) : undefined,
        custom_type_name: type === 'custom' ? customTypeName || undefined : undefined,
        location_type: locationType,
        participant_mode: participantMode,
        linkband_mode: linkbandMode,
        sfu_enabled: locationType === 'online' && participantMode === 'group',
      };
      const created = await createSession(payload);
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
                <option value="clinical">임상심리상담</option>
                <option value="hypnosis">최면심리상담</option>
                <option value="meditation">명상수업</option>
                <option value="custom">기타 (직접 입력)</option>
              </select>
              {type === 'custom' && (
                <input
                  type="text"
                  required
                  value={customTypeName}
                  onChange={(e) => setCustomTypeName(e.target.value)}
                  placeholder="세션 유형명 입력"
                  maxLength={30}
                  className={`${inputCls} mt-2`}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>진행 방식</label>
                <select value={locationType} onChange={(e) => setLocationType(e.target.value as LocationType)} className={inputCls}>
                  <option value="offline">오프라인 (대면)</option>
                  <option value="online">온라인 (화상)</option>
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
                      setSelectedParticipants((current) => current.slice(0, 1));
                    }
                  }}
                  className={inputCls}
                >
                  <option value="one_on_one">1:1</option>
                  <option value="group">1:N (그룹)</option>
                </select>
              </div>
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
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className={`${inputCls} disabled:bg-[#F2F3F8]`}
                />
              </div>
            </div>

            <ParticipantPicker
              selected={selectedParticipants}
              onChange={setSelectedParticipants}
              maxParticipants={maxParticipants}
            />

            <div>
              <label className={labelCls}>제목</label>
              <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>메모</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
            </div>

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
