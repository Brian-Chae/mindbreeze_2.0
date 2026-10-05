// 세션 상세 페이지 (UI Kit)

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deleteSession,
  duplicateSession,
  getSession,
  inviteParticipant,
  removeParticipant,
  saveSessionAsTemplate,
  transitionSession,
  type SessionAction,
  type SessionDto,
  type SessionLiveMetric,
  type SessionParticipant,
} from '../../lib/api/session';
import type { ParticipantChangedEvent } from '../../lib/socket';
import { StatusBadge } from '../../components/session/StatusBadge';
import { ParticipantPicker, type SelectedParticipant } from '../../components/session/ParticipantPicker';
import AppShell from '../../components/layout/AppShell';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';

const TYPE_LABELS: Record<string, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

// SDD-088: 상태 전이 버튼(오픈/시작/일시정지/종료)은 플레이어 안에만 존재한다.
// 상세 페이지는 정보 조회·참여자 관리·[입장]·[닫기(취소)]만 담당한다.
const ACTIONS_BY_STATUS: Record<SessionDto['status'], SessionAction[]> = {
  ready: ['cancel'],
  scheduled: ['cancel'],
  open: ['cancel'],
  in_progress: ['cancel'],
  completed: [],
  cancelled: [],
};

const ACTION_LABELS: Record<SessionAction, string> = {
  open: '오픈',
  start: '시작',
  end: '종료',
  cancel: '취소',
};

/** SDD-088: 오픈된 방의 cancel 은 "클래스 닫기"로 읽힌다 */
function cancelLabel(status: SessionDto['status']): string {
  return status === 'open' ? '클래스 닫기' : ACTION_LABELS.cancel;
}

/** 플레이어 입장 가능 상태 — 종료/취소 외 전부 (완료는 종료 씬 열람 허용) */
const ENTERABLE_STATUSES: SessionDto['status'][] = [
  'ready',
  'scheduled',
  'open',
  'in_progress',
  'completed',
];

const participantLabel = (participant: SessionDto['participants'][number]): string =>
  participant.user_name
  || participant.user_email
  || participant.guest_name
  || (participant.user_id ? participant.user_id.slice(0, 8) : '게스트');

/** FE-RT-003: WS 참여자 메트릭을 상세 화면 참여자 스키마로 매핑한다(활성 참여자 기준). */
const toSessionParticipant = (metric: SessionLiveMetric): SessionParticipant => ({
  user_id: metric.user_id ?? null,
  guest_name: metric.is_guest ? metric.display_name : null,
  is_guest: metric.is_guest,
  band_connected: metric.band_connected,
  linkband_device_id: null,
  webrtc_peer_id: null,
  consent_audio: false,
  consent_eeg: false,
  is_waitlisted: false,
  waitlist_position: null,
  user_name: metric.display_name,
});

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // SDD-095: 템플릿 저장 완료 표시
  const [templateSaved, setTemplateSaved] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSelected, setInviteSelected] = useState<SelectedParticipant[]>([]);

  const activeParticipants = (session?.participants ?? []).filter((p) => !p.is_waitlisted);
  const waitlisted = (session?.participants ?? []).filter((p) => p.is_waitlisted);

  // FE-RT-003: WS 참여자 변경 구독 — 추가/제거/대기열 변동을 session 상태에 반영한다.
  const handleParticipantChanged = useCallback(
    (event: ParticipantChangedEvent) => {
      if (!id || event.session_id !== id) return;
      setSession((prev) => {
        if (!prev) return prev;
        const liveActive =
          event.participants && event.participants.length > 0
            ? event.participants.map(toSessionParticipant)
            : null;
        // 서버가 배열을 실어 보내면 활성 목록만 교체하고 대기열은 기존 값을 유지한다.
        const nextParticipants = liveActive
          ? [...liveActive, ...prev.participants.filter((p) => p.is_waitlisted)]
          : prev.participants;
        return {
          ...prev,
          participants: nextParticipants,
          waitlist_count: event.waitlist_count ?? prev.waitlist_count,
        };
      });
      // 배열 없이 변경만 알리는 서버 계약에서는 REST 스냅샷으로 목록·대기열을 보완한다.
      if (!event.participants || event.participants.length === 0) {
        void getSession(id)
          .then((next) => {
            setSession(next);
            setError(null);
          })
          .catch(() => {
            /* 다음 participant_changed/상태 이벤트에서 복구 */
          });
      }
    },
    [id],
  );

  // SDD-129(③-8): WS 구독으로 세션 상태 즉시 반영 (5초 폴링은 WS 미결합 시 폴백)
  const { isReady } = useSessionLiveSocket({
    sessionId: id,
    onSessionStateChanged: (event) => {
      setSession((prev) =>
        prev
          ? { ...prev, status: event.status as SessionDto['status'], started_at: event.started_at ?? prev.started_at }
          : prev,
      );
    },
    onParticipantChanged: handleParticipantChanged,
  });

  useEffect(() => {
    if (!id) return;
    if (isReady) return; // WS 실시간 수신 중 — 폴링 중단
    let cancelled = false;
    const loadSession = (): void => {
      getSession(id)
        .then((nextSession) => {
          if (!cancelled) {
            setSession(nextSession);
            // 폴링 재시도 성공 시 이전 오류 문구를 지운다(에러 복구)
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    };

    loadSession();
    const timer = window.setInterval(loadSession, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, isReady]);

  const handleAction = async (action: SessionAction): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await transitionSession(id, action);
      setSession(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '상태 변경에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!id) return;
    if (!confirm('정말 삭제하시겠습니까?')) return;
    setBusy(true);
    try {
      await deleteSession(id);
      navigate('/sessions');
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제에 실패했습니다');
      setBusy(false);
    }
  };

  const handleInvite = async (): Promise<void> => {
    if (!id || inviteSelected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let updated = session;
      for (const s of inviteSelected) {
        updated = await inviteParticipant(id, s.userId);
      }
      setSession(updated);
      setShowInvite(false);
      setInviteSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '초대에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveParticipant = async (userId: string): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await removeParticipant(id, userId);
      setSession(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '참여자 제거에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = async (): Promise<void> => {
    if (!session?.access_code) return;
    try {
      await navigator.clipboard.writeText(session.access_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('클래스 코드를 복사하지 못했습니다. 코드를 직접 선택해 주세요.');
    }
  };

  // SDD-095: 반복 클래스 재개설 — 유형 설정만 복사한 새 클래스로 이동한다.
  const handleDuplicate = async (): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const duplicated = await duplicateSession(id);
      navigate(`/sessions/${duplicated.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '클래스 복제에 실패했습니다');
      setBusy(false);
    }
  };

  // SDD-095: 현재 설정을 템플릿으로 저장 — 생성 폼의 "내 템플릿에서 시작"에 나타난다.
  const handleSaveAsTemplate = async (): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await saveSessionAsTemplate(id);
      setTemplateSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '템플릿 저장에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  if (error && !session) {
    return (
      <AppShell title="세션 상세" sub="DETAIL">
        <div className="max-w-3xl mx-auto" role="alert">
          <p className="text-[#B3261E]">{error}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => window.location.reload()} className="mb-btn text-sm">
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => navigate('/sessions')}
              className="mb-btn mb-btn--ghost text-sm"
            >
              목록으로
            </button>
          </div>
        </div>
      </AppShell>
    );
  }
  if (!session) {
    return (
      <AppShell title="세션 상세" sub="DETAIL">
        <div className="max-w-3xl mx-auto">
          <p className="text-[#6F6F6F]">불러오는 중...</p>
        </div>
      </AppShell>
    );
  }

  const actions = ACTIONS_BY_STATUS[session.status];

  const rightSlot = (
    /* 모바일에서는 보조 버튼(템플릿/복제/삭제)을 감추고 [입장]/[취소]만 노출한다.
       mb-tokens.css 의 .mb-btn{display:inline-flex} 가 Tailwind utilities 뒤에 로드되므로
       hidden 유틸리티가 먹도록 !important 변형(!hidden / sm:!inline-flex)을 쓴다. */
    <div className="flex flex-wrap items-center gap-2">
      {/* SDD-095: 템플릿으로 저장 / 복제 — 반복 클래스를 같은 설정으로 다시 만든다 */}
      <button
        type="button"
        onClick={handleSaveAsTemplate}
        disabled={busy || templateSaved}
        className="mb-btn mb-btn--ghost text-sm disabled:opacity-50 !hidden sm:!inline-flex"
      >
        {templateSaved ? '템플릿 저장됨' : '템플릿으로 저장'}
      </button>
      <button
        type="button"
        onClick={handleDuplicate}
        disabled={busy}
        className="mb-btn mb-btn--ghost text-sm !hidden sm:!inline-flex"
      >
        복제
      </button>
      {/* SDD-088: [입장] 단일 버튼 — 플레이어가 상태에 맞는 씬을 전개한다 */}
      {ENTERABLE_STATUSES.includes(session.status) && (
        <button
          type="button"
          onClick={() => navigate(`/sessions/${session.id}/player`)}
          disabled={busy}
          className="mb-btn text-sm"
        >
          입장
        </button>
      )}
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => handleAction(action)}
          disabled={busy}
          className="mb-btn mb-btn--ghost text-sm"
        >
          {action === 'cancel' ? cancelLabel(session.status) : ACTION_LABELS[action]}
        </button>
      ))}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="mb-btn mb-btn--ghost text-sm !text-[#B3261E] !hidden sm:!inline-flex"
      >
        삭제
      </button>
    </div>
  );

  return (
    <AppShell
      title="세션 상세"
      sub="DETAIL"
      rightSlot={rightSlot}
      noScroll
    >
      <div className="max-w-3xl mx-auto space-y-4 pb-6 h-full overflow-y-auto">
        {/* 뒤로 가기 + 상태 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className="text-sm text-[#6F6F6F] hover:text-[#1F1F1F] transition-colors"
          >
            ← 목록으로
          </button>
          <StatusBadge status={session.status} />
        </div>

        {/* 세션 정보 카드 */}
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#F5EDFC] text-[#5F0080]">
              {TYPE_LABELS[session.type]}
            </span>
          </div>
          <h1 className="text-xl font-bold text-[#1F1F1F]">
            {session.title || '제목 없음'}
          </h1>
          {session.access_code && (
            <div className="rounded-xl bg-[#F5EDFC] border border-[#DDD0EA] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <dt className="text-xs text-[#6F6F6F] mb-1">클래스 코드</dt>
                <dd className="font-mono text-3xl font-black tracking-[0.16em] text-[#5F0080]">
                  {session.access_code}
                </dd>
              </div>
              <button type="button" onClick={handleCopyCode} className="mb-btn text-sm">
                {copied ? '복사 완료' : '코드 복사'}
              </button>
            </div>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-0.5">일시</dt>
              <dd className="text-sm text-[#1F1F1F] font-medium">
                {session.scheduled_at ? new Date(session.scheduled_at).toLocaleString('ko-KR') : '즉시 클래스'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-0.5">소요 시간</dt>
              <dd className="text-sm text-[#1F1F1F] font-medium">{session.duration_min}분</dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-0.5">참여자</dt>
              <dd className="text-sm text-[#1F1F1F] font-medium">
                {session.participants.length} / {session.max_participants}
              </dd>
            </div>
          </dl>
          {session.notes && (
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-1">메모</dt>
              <p className="text-sm text-[#1F1F1F] whitespace-pre-wrap leading-relaxed">
                {session.notes}
              </p>
            </div>
          )}
        </div>

        {/* 참여자 카드 */}
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1F1F1F]">
              참여자 ({activeParticipants.length}/{session.max_participants}명)
              {session.waitlist_count > 0 && (
                <span className="ml-2 text-[#6F6F6F] font-normal text-xs">
                  대기 {session.waitlist_count}명
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              disabled={busy}
              className="inline-flex h-11 items-center px-3 -mx-3 text-sm text-[#5F0080] font-medium hover:underline"
            >
              + 참여자 초대
            </button>
          </div>

          {activeParticipants.length === 0 && waitlisted.length === 0 ? (
            <p className="text-sm text-[#6F6F6F]">아직 참여자가 없습니다</p>
          ) : (
            <ul className="divide-y divide-[#EFEFEF] -mx-2">
              {activeParticipants.map((p, index) => (
                <li key={p.user_id ?? `guest-${p.guest_name ?? index}`} className="flex items-center justify-between gap-2 px-2 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="w-2 h-2 shrink-0 rounded-full bg-[#1F8A5B]" />
                    <span className="min-w-0 truncate text-sm text-[#1F1F1F]">
                      {participantLabel(p)}
                    </span>
                  </div>
                  {p.user_id && (
                    <button
                      type="button"
                      onClick={() => handleRemoveParticipant(p.user_id!)}
                      disabled={busy}
                      className="inline-flex h-11 shrink-0 min-w-[44px] items-center justify-end px-3 -my-2.5 text-sm text-[#B3261E] hover:underline disabled:opacity-50"
                    >
                      제거
                    </button>
                  )}
                </li>
              ))}
              {waitlisted.length > 0 && (
                <>
                  <li className="px-2 py-2 text-xs text-[#6F6F6F] font-medium bg-[#FAFAFA]">
                    대기열
                  </li>
                  {waitlisted
                    .sort((a, b) => (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99))
                    .map((p, index) => (
                      <li key={p.user_id ?? `waitlisted-guest-${p.guest_name ?? index}`} className="flex items-center justify-between gap-2 px-2 py-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span className="w-2 h-2 shrink-0 rounded-full bg-[#E6A817]" />
                          <span className="min-w-0 truncate text-sm text-[#6F6F6F]">
                            {participantLabel(p)}
                          </span>
                          <span className="shrink-0 text-xs text-[#A0A0B0]">
                            {p.waitlist_position}순위
                          </span>
                        </div>
                        {p.user_id && (
                          <button
                            type="button"
                            onClick={() => handleRemoveParticipant(p.user_id!)}
                            disabled={busy}
                            className="inline-flex h-11 shrink-0 min-w-[44px] items-center justify-end px-3 -my-2.5 text-sm text-[#B3261E] hover:underline disabled:opacity-50"
                          >
                            제거
                          </button>
                        )}
                      </li>
                    ))}
                </>
              )}
            </ul>
          )}

          {showInvite && (
            <div className="border-t border-[#EFEFEF] pt-4 mt-2">
              <ParticipantPicker
                selected={inviteSelected}
                onChange={setInviteSelected}
                maxParticipants={session.max_participants - activeParticipants.length}
              />
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={handleInvite}
                  disabled={busy || inviteSelected.length === 0}
                  className="mb-btn text-sm"
                >
                  초대
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInvite(false); setInviteSelected([]); }}
                  className="mb-btn mb-btn--ghost text-sm"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-[#B3261E] bg-[#FDECEC] px-4 py-3 rounded-xl">{error}</p>
        )}
      </div>
    </AppShell>
  );
}
