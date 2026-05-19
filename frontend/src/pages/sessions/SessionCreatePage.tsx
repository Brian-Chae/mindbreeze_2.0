// 세션 생성 페이지

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession, type SessionType, type CreateSessionPayload } from '../../lib/api/session';

export default function SessionCreatePage(){
  const navigate = useNavigate();
  const [type, setType] = useState<SessionType>('clinical');
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMin, setDurationMin] = useState(50);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(1);
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
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
      const created = await createSession(payload);
      navigate(`/sessions/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '세션 생성에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1';

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">새 세션 생성</h1>
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
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={inputCls}
          />
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          시간 충돌 무시
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? '생성 중...' : '생성'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
}
