// 클래스 상세 페이지 (SDD-209 FH04)
// 4자리 입장 코드 표시·공유, 준비 현황·다음 할 일, 취소/닫기/삭제 확인 시트, 더보기 시트.
// 상태 전이(오픈/시작/종료)는 플레이어 안에만 있다(SDD-088) — 여기는 정보 조회·참여자 관리·입장(열기)·취소/닫기만 담당한다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClassSessionDetail } from '../../components/class/structure/class-session-detail';
import { Ellipsis } from 'lucide-react';
import {
  deleteSession,
  duplicateSession,
  getSession,
  inviteParticipant,
  removeParticipant,
  saveSessionAsTemplate,
  transitionSession,
  type SessionDto,
  type SessionLiveMetric,
  type SessionParticipant,
} from '../../lib/api/session';
import type { ParticipantChangedEvent } from '../../lib/socket';
import { SessionLocationEditor } from '../../components/session/session-location-editor';
import { ParticipantPicker, type SelectedParticipant } from '../../components/session/ParticipantPicker';
import AppShell from '../../components/layout/AppShell';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { ClassActionSheet, type ClassActionKind } from '../../components/class/flow/shell/ClassActionSheet';
import { HostDetailView } from '../../components/class/flow/shell/HostDetailView';
import { HostMenuSheet } from '../../components/class/flow/shell/HostMenuSheet';
import { toHostDetailData, toMailInviteInput } from '../../components/class/flow/shell/host-shell-data';
import { EMAIL_INVITE_COOLDOWN_SEC, inviteByEmail, listEmailInvites, type InviteEmailItem } from '../../lib/api/class-flow-host';
import { maskEmail } from '../../lib/class/flow/member-format';
import '../../components/class/flow/shell/shell-kit.css';

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
  const { classId, id } = useParams<{ classId: string; id: string }>();
  return classId && id ? <ClassSessionDetail classId={classId} sessionId={id}/> : <LegacySessionDetailPage/>;
}
function LegacySessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  // SDD-095: 템플릿 저장 완료 표시
  const [templateSaved, setTemplateSaved] = useState(false);
  // 열린 시트: 더보기 또는 취소/닫기/삭제 확인
  const [sheet, setSheet] = useState<'menu' | ClassActionKind | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSelected, setInviteSelected] = useState<SelectedParticipant[]>([]);

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

  // SDD-129(③-8): WS 구독으로 클래스 상태 즉시 반영 (5초 폴링은 WS 미결합 시 폴백)
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

  // 취소·닫기 — 확인 시트에서 확정한다(window.confirm 없음)
  const handleTransitionCancel = async (): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await transitionSession(id, 'cancel');
      setSession(updated);
      setSheet(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '상태 변경에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
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
    let invited = 0;
    try {
      let updated = session;
      for (const s of inviteSelected) {
        updated = await inviteParticipant(id, s.userId);
        // FE-DETAIL-001: 초대는 순차 실행이라 중간 실패 시 앞선 성공이 화면에 반영되지 않는다.
        // 성공한 초대마다 즉시 setSession 해 부분 성공을 유지한다.
        setSession(updated);
        invited += 1;
      }
      setShowInvite(false);
      setInviteSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '초대에 실패했습니다');
      // 중간 실패로 서버 상태와 어긋날 수 있어, 성공분 반영 후 최신 클래스를 재조회한다.
      if (invited > 0) {
        try {
          setSession(await getSession(id));
        } catch {
          /* 폴링/WS 이벤트가 다음 기회에 복구한다 */
        }
      }
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

  const flashCopied = (kind: 'code' | 'link'): void => {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  };

  // 코드 복사: 4자리 입장 코드 그대로
  const handleCopyCode = async (): Promise<void> => {
    if (!session?.access_code) return;
    try {
      await navigator.clipboard.writeText(session.access_code);
      flashCopied('code');
    } catch {
      setError('입장 코드를 복사하지 못했어요. 코드를 직접 선택해 주세요.');
    }
  };

  // 링크 복사: /join 주소만 — 코드는 URL 에 싣지 않는다(접근 로그·히스토리 노출 방지)
  const handleCopyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join`);
      flashCopied('link');
    } catch {
      setError('링크를 복사하지 못했어요.');
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
      setSheet(null);
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
      setSheet(null);
    }
  };

  // SDD-209 B14: 이메일 초대 목록(요청 결과 — 전달 확인이 아니다)과 다시 보내기
  const [mailItems, setMailItems] = useState<InviteEmailItem[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadMailInvites = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const res = await listEmailInvites(id);
      setMailItems(res.invites);
      setNowMs(Date.now());
    } catch {
      // 목록을 못 받으면 이 구역만 그리지 않는다 — 클래스 상세에는 영향이 없다
    }
  }, [id]);
  useEffect(() => {
    void loadMailInvites();
  }, [loadMailInvites]);
  const mailInputs = useMemo(
    () => mailItems.map((item) => toMailInviteInput(item, new Date(nowMs), EMAIL_INVITE_COOLDOWN_SEC, maskEmail)),
    [mailItems, nowMs],
  );
  // 쿨다운 안에 있는 항목이 있으면 1초마다 남은 시간을 갱신한다
  const hasCooldown = mailInputs.some((m) => m.cooldownSec > 0);
  useEffect(() => {
    if (!hasCooldown) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasCooldown]);
  const handleResendMail = useCallback(async (inviteId: string): Promise<void> => {
    const target = mailItems.find((item) => item.invite_id === inviteId);
    if (!id || !target?.email) return;
    try {
      await inviteByEmail(id, [target.email]);
    } catch {
      // 요청 결과는 목록에서 다시 확인한다
    }
    await loadMailInvites();
  }, [id, mailItems, loadMailInvites]);

  const data = useMemo(() => (session ? toHostDetailData(session, { mailInvites: mailInputs }) : null), [session, mailInputs]);

  if (session?.class_id) return <ClassSessionDetail classId={session.class_id} sessionId={session.id}/>;

  if (error && !session) {
    return (
      <AppShell title="클래스 상세">
        <div className="max-w-3xl mx-auto" role="alert">
          <p className="text-[#B3261E]">{error}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => window.location.reload()} className="mb-btn text-sm">
              다시 시도
            </button>
            <button type="button" onClick={() => navigate('/sessions')} className="mb-btn mb-btn--ghost text-sm">
              목록으로
            </button>
          </div>
        </div>
      </AppShell>
    );
  }
  if (!session || !data) {
    return (
      <AppShell title="클래스 상세">
        <div className="max-w-3xl mx-auto">
          <p className="text-[#6F6F6F]">불러오는 중...</p>
        </div>
      </AppShell>
    );
  }

  const handleCta = (): void => {
    if (data.next.ctaKind === 'record') navigate(`/sessions/${session.id}/record`);
    else if (data.next.ctaKind === 'duplicate') void handleDuplicate();
    else navigate(`/sessions/${session.id}/player`);
  };

  const rightSlot = (
    <button type="button" data-testid="menu-open" aria-label="더보기" onClick={() => setSheet('menu')} className="mb-btn mb-btn--ghost" style={{ minWidth: 44, minHeight: 44 }}>
      <Ellipsis size={20} aria-hidden="true" />
    </button>
  );

  const actionKind: ClassActionKind | null = sheet === 'cancel' || sheet === 'close' || sheet === 'delete' ? sheet : null;
  const actionCount = actionKind === 'cancel' ? session.participants.length : data.people.total;

  return (
    <AppShell title="클래스 상세" rightSlot={rightSlot} noScroll>
      <div className="sh-scope mx-auto h-full w-full overflow-y-auto pb-6">
        <div className="sh-col">
          <HostDetailView
            data={data}
            heroId={session.id}
            copied={copied}
            onCta={handleCta}
            onCopyCode={() => void handleCopyCode()}
            onCopyLink={() => void handleCopyLink()}
            onEditPlace={() => setEditingLocation(true)}
            onRequestAction={(kind) => setSheet(kind)}
            onInvite={() => setShowInvite((v) => !v)}
            onRemove={(userId) => void handleRemoveParticipant(userId)}
            onResend={(inviteId) => void handleResendMail(inviteId)}
            placeEditor={editingLocation ? (
              <SessionLocationEditor
                key={session.id}
                session={session}
                onSaved={(updated) => { setSession(updated); setEditingLocation(false); }}
                onCancel={() => setEditingLocation(false)}
              />
            ) : undefined}
            invitePanel={showInvite ? (
              <>
                <ParticipantPicker
                  selected={inviteSelected}
                  onChange={setInviteSelected}
                  maxParticipants={session.max_participants - data.people.total}
                />
                <div className="sh-inline-panel__act">
                  <button type="button" className="sh-btn" data-testid="invite-submit" onClick={() => void handleInvite()} disabled={busy || inviteSelected.length === 0}>
                    초대
                  </button>
                  <button type="button" className="sh-btn ghost" onClick={() => { setShowInvite(false); setInviteSelected([]); }}>
                    취소
                  </button>
                </div>
              </>
            ) : undefined}
          />
          {error ? <p role="alert" className="text-sm text-[#B3261E] bg-[#FDECEC] px-4 py-3 rounded-xl">{error}</p> : null}
        </div>
      </div>

      <HostMenuSheet
        open={sheet === 'menu'}
        canDelete={data.canDelete}
        templateSaved={templateSaved}
        busy={busy}
        onDuplicate={() => void handleDuplicate()}
        onTemplate={() => void handleSaveAsTemplate()}
        onDelete={() => setSheet('delete')}
        onClose={() => setSheet(null)}
      />
      {actionKind ? (
        <ClassActionSheet
          kind={actionKind}
          count={actionCount}
          busy={busy}
          error={error}
          onConfirm={() => void (actionKind === 'delete' ? handleDelete() : handleTransitionCancel())}
          onClose={() => { setSheet(null); setError(null); }}
        />
      ) : null}
    </AppShell>
  );
}
