// 내담자 클래스 목록 페이지 (SDD-209 FM02)
// 입장 가능한 클래스가 맨 위, 카드 정보는 유형·제목·시각·방식·상태만, 신청은 바텀 시트.
// 캘린더·타임라인은 없다(D-5② 확정).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listSessions, type SessionDto } from '../../lib/api/session';
import { listChatRooms, sendChatMessage } from '../../lib/api/chat';
import { useAuthStore } from '../../stores/authStore';
import { markRead } from '../../lib/api/notifications';
import { useNotificationStore } from '../../stores/notificationStore';
import { useEnterClass } from '../../hooks/useEnterClass';
import { ApplySheet, type ApplyOption } from '../../components/class/flow/shell/ApplySheet';
import { MemberClassListView } from '../../components/class/flow/shell/MemberClassListView';
import { buildClassSections, type SessionWithHost } from '../../components/class/flow/shell/shell-data';
import '../../components/class/flow/shell/shell-kit.css';

export default function ClientSessionListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  // user?.counselors 가 nullish 일 때 매 렌더 새 배열이 생성되어 useMemo deps 가 흔들리는 것을 막기 위해 useMemo 로 안정화한다.
  const counselors = useMemo(() => user?.counselors ?? [], [user?.counselors]);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const removeSessionInvite = useNotificationStore((s) => s.removeSessionInvite);
  const { enter, enteringId } = useEnterClass();

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 클래스 신청 시트
  const [showApply, setShowApply] = useState(false);
  const [options, setOptions] = useState<ApplyOption[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 클래스 데이터 로딩
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSessions()
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 상담사 ID → 이름 매핑
  const counselorNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    counselors.forEach((c) => {
      map[c.id] = c.name;
    });
    return map;
  }, [counselors]);

  // ── 초대된 클래스 ──────────────────────────────────────────────
  const invitedSessionIds = useMemo(
    () => new Set(sessionInvites.map((i) => i.sessionId)),
    [sessionInvites],
  );

  // 초대 도착 시 목록에 아직 없는 클래스를 반영 (listSessions 재조회)
  // HOOK-STATE-03: sessions 를 deps 로 두면 재조회로 sessions 가 갱신될 때마다 effect 가
  // 다시 돌아 반영이 지연·중복된다. 최신 sessions 는 ref 로 읽고, 초대 id 별로 1회만 재조회한다.
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const refetchedInviteIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (sessionInvites.length === 0) return;
    const pending = sessionInvites.filter(
      (inv) =>
        !sessionsRef.current.some((s) => s.id === inv.sessionId) &&
        !refetchedInviteIdsRef.current.has(inv.sessionId),
    );
    if (pending.length === 0) return;
    // 재조회 중 중복 요청 방지 — 실패하면 마킹을 되돌려 다음 기회에 재시도한다.
    pending.forEach((inv) => refetchedInviteIdsRef.current.add(inv.sessionId));
    let cancelled = false;
    listSessions()
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch(() => {
        pending.forEach((inv) => refetchedInviteIdsRef.current.delete(inv.sessionId));
      });
    return () => { cancelled = true; };
  }, [sessionInvites]);

  const handleConfirmInvite = (sessionId: string): void => {
    const invite = sessionInvites.find((i) => i.sessionId === sessionId);
    if (invite?.notificationId) {
      void markRead(invite.notificationId).catch(() => { /* 조용히 실패 */ });
    }
    removeSessionInvite(sessionId);
    navigate(`/app/sessions/${sessionId}`);
  };

  // ── 신청 시트 ──────────────────────────────────────────────────
  const loadRooms = useCallback(async (): Promise<void> => {
    setRoomsError(null);
    try {
      const res = await listChatRooms();
      const next: ApplyOption[] = res.rooms
        .filter((r) => r.room_type === 'direct')
        .map((r) => ({ id: r.id, name: r.peer_name || r.name || '채팅방' }));
      setOptions(next);
      setSelectedRoomId((prev) => (prev && next.some((o) => o.id === prev) ? prev : next[0]?.id ?? null));
    } catch (e: unknown) {
      // 조회 실패를 '채팅방 없음'으로 오인하지 않도록 별도 에러 상태로 분리
      setOptions([]);
      setSelectedRoomId(null);
      setRoomsError(e instanceof Error ? e.message : '채팅방 목록을 불러오지 못했어요');
    }
  }, []);

  const openApply = useCallback((): void => {
    setShowApply(true);
    void loadRooms();
  }, [loadRooms]);

  // 상단 헤더의 "클래스 신청하기" 버튼 이벤트 리스너
  useEffect(() => {
    const handler = (): void => { openApply(); };
    window.addEventListener('open-session-request', handler);
    return () => window.removeEventListener('open-session-request', handler);
  }, [openApply]);

  // 홈의 신청 진입(state.openApply)
  const openedFromHomeRef = useRef(false);
  useEffect(() => {
    const state = location.state as { openApply?: boolean } | null;
    if (!state?.openApply || openedFromHomeRef.current) return;
    openedFromHomeRef.current = true;
    openApply();
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, openApply]);

  const showToast = (message: string): void => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const handleSendRequest = async (): Promise<void> => {
    if (!selectedRoomId) return;
    setSending(true);
    try {
      await sendChatMessage(selectedRoomId, {
        content: '클래스 신청합니다',
        type: 'system',
        event_type: 'session_request',
      });
      setShowApply(false);
      showToast('클래스 신청을 보냈어요');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '클래스 신청을 보내지 못했어요');
    } finally {
      setSending(false);
    }
  };

  const withHost = useMemo<SessionWithHost[]>(
    () => sessions.map((s) => ({ ...s, host_name: (s as SessionWithHost).host_name ?? counselorNameMap[s.host_id] ?? null })),
    [sessions, counselorNameMap],
  );
  const sections = useMemo(() => buildClassSections(withHost, invitedSessionIds), [withHost, invitedSessionIds]);

  return (
    <div className="sh-scope px-4 md:px-8 py-4 md:py-6">
      {/* 토스트 */}
      {toast && (
        <div role="status" className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#1F1F1F] text-white text-sm px-5 py-2.5 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      <div className="sh-col">
        {loading ? (
          <div className="py-8 text-center text-sm text-[#6F6F6F]">불러오는 중...</div>
        ) : error ? (
          <div role="alert" className="py-8 text-center text-sm text-red-500">{error}</div>
        ) : (
          <MemberClassListView
            sections={sections}
            onOpen={(id) => navigate(`/app/sessions/${id}`)}
            enteringId={enteringId}
            onEnter={(id) => {
              // 거절되면(초대 행 없음·종료 등) 상세로 보내 사유와 코드 입장 안내를 보여준다
              void enter(id).then((ok) => {
                if (!ok) navigate(`/app/sessions/${id}`);
              });
            }}
            onConfirmInvite={handleConfirmInvite}
          />
        )}
      </div>

      <ApplySheet
        open={showApply}
        options={options}
        selectedId={selectedRoomId}
        onSelect={setSelectedRoomId}
        onSend={() => void handleSendRequest()}
        onClose={() => setShowApply(false)}
        sending={sending}
        loadError={roomsError}
        onRetry={() => void loadRooms()}
      />
    </div>
  );
}
