// 세션 목록 페이지 (목록 + 캘린더 토글 + 생성 모달) — UI Kit

import { useEffect, useState, useCallback } from 'react';

import { listSessions, createSession, type SessionDto, type SessionType, type CreateSessionPayload } from '../../lib/api/session';
import { SessionCard } from '../../components/session/SessionCard';
import { CalendarView } from '../../components/session/CalendarView';
import { useSessionStore } from '../../stores/sessionStore';
import AppShell from '../../components/layout/AppShell';

const nowPlusOneHour = (): string => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const inputCls =
  'w-full px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080]';
const labelCls = 'block text-sm font-medium text-[#1F1F1F] mb-1.5';

function CreateSessionModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<SessionType>('clinical');
  const [scheduledAt, setScheduledAt] = useState(nowPlusOneHour());
  const [durationMin, setDurationMin] = useState(50);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(1);
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateSessionPayload = {
        type,
        scheduled_at: new Date(scheduledAt).toISOString(),
        duration_min: durationMin,
        title: title || undefined,
        notes: notes || undefined,
        max_participants: maxParticipants,
        force,
      };
      await createSession(payload);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '세션 생성에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setType('clinical');
    setScheduledAt(nowPlusOneHour());
    setDurationMin(50);
    setTitle('');
    setNotes('');
    setMaxParticipants(1);
    setForce(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white rounded-[20px] shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-[#EFEFEF]">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[#1F1F1F]">새 세션 생성</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#6F6F6F] hover:text-[#1F1F1F] hover:bg-[#F2F3F8] transition-colors"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>세션 유형</label>
            <select value={type} onChange={(e) => setType(e.target.value as SessionType)} className={inputCls}>
              <option value="clinical">임상심리상담</option>
              <option value="hypnosis">최면심리상담</option>
              <option value="meditation">명상수업</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>일시</label>
            <input
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className={inputCls}
            />
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
                max={100}
                required
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(Number(e.target.value))}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>제목</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>메모</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-[#1F1F1F]">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            시간 충돌 무시
          </label>
          {error && <p className="text-sm text-[#B3261E]">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={submitting} className="mb-btn">
              {submitting ? '생성 중...' : '생성'}
            </button>
            <button type="button" onClick={handleClose} className="mb-btn mb-btn--ghost">
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SessionListPage() {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { viewMode, setViewMode, currentDate, setCurrentDate } = useSessionStore();

  const refreshSessions = useCallback(() => {
    setLoading(true);
    listSessions()
      .then((res) => setSessions(res.sessions))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const shiftWeek = (direction: 1 | -1): void => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + direction * 7);
    setCurrentDate(next);
  };

  const rightSlot = (
    <button type="button" onClick={() => setShowCreate(true)} className="mb-btn">
      + 새 세션
    </button>
  );

  return (
    <AppShell title="세션 관리" sub="SESSIONS" rightSlot={rightSlot}>
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-full bg-[#F2F3F8] p-1">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                viewMode === 'list' ? 'bg-[#5F0080] text-white font-bold' : 'text-[#1F1F1F] font-medium'
              }`}
            >
              목록
            </button>
            <button
              type="button"
              onClick={() => setViewMode('weekly')}
              className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                viewMode === 'weekly' ? 'bg-[#5F0080] text-white font-bold' : 'text-[#1F1F1F] font-medium'
              }`}
            >
              주간
            </button>
          </div>
          {viewMode === 'weekly' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => shiftWeek(-1)}
                className="w-9 h-9 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
              >
                ‹
              </button>
              <span className="text-sm font-mono text-[#1F1F1F] min-w-[120px] text-center">
                {currentDate.toLocaleDateString('ko-KR')}
              </span>
              <button
                type="button"
                onClick={() => shiftWeek(1)}
                className="w-9 h-9 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {loading && <p className="text-[#6F6F6F]">불러오는 중...</p>}
        {error && <p className="text-[#B3261E]">{error}</p>}

        {!loading && !error && viewMode === 'list' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {sessions.length === 0 ? (
              <p className="text-[#6F6F6F] col-span-full text-center py-12">
                등록된 세션이 없습니다.
              </p>
            ) : (
              sessions.map((s) => <SessionCard key={s.id} session={s} />)
            )}
          </div>
        )}

        {!loading && !error && viewMode === 'weekly' && (
          <CalendarView sessions={sessions} currentDate={currentDate} />
        )}

        <CreateSessionModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={refreshSessions}
        />
      </div>
    </AppShell>
  );
}
