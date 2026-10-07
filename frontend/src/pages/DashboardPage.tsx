// 상담사 클래스 대시보드 — 행동 중심 재설계 (SDD-187)
// 위계: 지금 할 일(Action Queue) → 오늘·다가오는 일정 → 요약 타일 → 내 클래스 → 대화/알림 → 코드 접이식

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import OrgRemovedNoticeDialog from '../components/org/OrgRemovedNoticeDialog';
import { StatusBadge } from '../components/session/StatusBadge';
import {
  getCounselorDashboard,
  type ClassSummary,
  type CounselorDashboardResponse,
} from '../lib/api/dashboard';
import type { SessionType } from '../lib/api/session';
import { listChatRooms, type ChatRoom } from '../lib/api/chat';
import { listNotifications, type NotificationDto } from '../lib/api/notifications';
import { useAuthStore } from '../stores/authStore';

const TYPE_LABELS: Record<SessionType, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

const TYPE_CLASSES: Record<SessionType, string> = {
  clinical: 'bg-[#F5EDFC] text-[#5F0080]',
  hypnosis: 'bg-[#EFE3FA] text-[#6E1A8C]',
  meditation: 'bg-[#E6F8F3] text-[#1F8A5B]',
  custom: 'bg-[#FFF4DC] text-[#8A6B1F]',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return formatDateTime(iso);
}

function TypeBadge({ cls }: { cls: ClassSummary }) {
  const label =
    cls.type === 'custom' && cls.custom_type_name
      ? cls.custom_type_name
      : TYPE_LABELS[cls.type as SessionType];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide ${TYPE_CLASSES[cls.type as SessionType] ?? 'bg-[#F2F3F8] text-[#6F6F6F]'}`}
    >
      {label}
    </span>
  );
}

function AccessCodeCell({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };
  if (!code) return <span className="text-[#C2C3CE]">-</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono font-bold tracking-widest text-[#5F0080]">{code}</span>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="px-3 py-2 min-h-[40px] rounded-lg bg-[#F5EDFC] text-[#5F0080] text-[13px] font-semibold hover:bg-[#EBDEF7] transition-colors"
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}

function ClassCard({ cls, onEnter }: { cls: ClassSummary; onEnter?: (id: string) => void }) {
  const isLive = cls.status === 'in_progress' || cls.status === 'open';
  const showRecordLink = cls.has_record || cls.has_summary;
  return (
    <div className="bg-white border border-[#E8E3EC] rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/sessions/${cls.id}`} className="font-bold text-[14px] text-[#1F1F1F] hover:text-[#5F0080] truncate">
          {cls.title || '제목 없음'}
        </Link>
        <StatusBadge status={cls.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge cls={cls} />
        <span className="text-[12px] text-[#6F6F6F]">
          참여 {cls.participant_count}명
          {cls.guest_count > 0 && ` · 게스트 ${cls.guest_count}`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {cls.access_code && <AccessCodeCell code={cls.access_code} />}
        {isLive && onEnter && (
          <button
            type="button"
            onClick={() => onEnter(cls.id)}
            className="ml-auto rounded-lg bg-[#5F0080] px-4 py-2 min-h-[40px] text-[13px] font-bold text-white hover:bg-[#4B0066] transition-colors"
          >
            입장
          </button>
        )}
      </div>
      {showRecordLink && (
        <Link
          to={`/sessions/${cls.id}/record`}
          className="inline-flex text-[13px] font-bold text-[#5F0080] hover:underline"
        >
          기록 보기 →
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<CounselorDashboardResponse | null>(null);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [res, chatRes, notifRes] = await Promise.all([
        getCounselorDashboard(),
        listChatRooms().catch(() => ({ rooms: [] as ChatRoom[] })),
        listNotifications(true, 5).catch(() => ({ notifications: [] as NotificationDto[], total: 0, unread: 0 })),
      ]);
      setData(res);
      setChatRooms(chatRes.rooms);
      setNotifications(notifRes.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : '대시보드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // ── 파생 데이터 ────────────────────────────────────────────────
  const liveClasses = useMemo(
    () => data?.classes.filter((c) => c.status === 'in_progress' || c.status === 'open') ?? [],
    [data],
  );
  // 검토 대기 = 승인 게이트(pending_review)에 있는 리포트 수 (백엔드 집계).
  // 클래스 완료 여부·기록 존재 여부와 무관하게 실제 검토중 리포트 수와 일치해야 한다.
  const pendingReviewCount = data?.pending_review_count ?? 0;
  const todaySessions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return (
      data?.classes
        .filter((c) => {
          if (!c.scheduled_at) return false;
          const d = new Date(c.scheduled_at);
          return d >= today && d < tomorrow && c.status !== 'cancelled';
        })
        .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime()) ?? []
    );
  }, [data]);

  const upcomingSessions = useMemo(() => {
    const now = new Date();
    return (
      data?.classes
        .filter((c) => c.scheduled_at && new Date(c.scheduled_at) >= now && c.status !== 'cancelled')
        .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
        .slice(0, 5) ?? []
    );
  }, [data]);

  const scheduledClasses = useMemo(
    () => data?.classes.filter((c) => c.status === 'scheduled' || c.status === 'ready') ?? [],
    [data],
  );

  // ── 다음 세션 (포인트 카드) ────────────────────────────────────
  // 진행 중/오픈 세션이 최우선, 없으면 가장 임박한 예정 세션 1개.
  const nextSession = useMemo<ClassSummary | null>(() => {
    if (!data) return null;
    if (liveClasses.length > 0) return liveClasses[0];
    const upcoming = data.classes
      .filter((c) => c.scheduled_at && new Date(c.scheduled_at) >= new Date() && c.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
    return upcoming[0] ?? null;
  }, [data, liveClasses]);
  const pastClasses = useMemo(
    () => data?.classes.filter((c) => c.status === 'completed' || c.status === 'cancelled') ?? [],
    [data],
  );

  const recentChats = useMemo(() => {
    return [...chatRooms]
      .sort((a, b) => {
        const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bt - at;
      })
      .slice(0, 3);
  }, [chatRooms]);

  const recentNotifications = useMemo(() => {
    return [...notifications]
      .filter((n) => !n.is_read)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  }, [notifications]);

  const displayName = data?.counselor_name ?? user?.name ?? '상담사';
  const orgLabel =
    data?.org_kind === 'individual'
      ? '내 개인 상담소'
      : data?.org_name
        ? `${data.org_name} 소속`
        : 'MY CLASSES';
  const counselorCode = user?.counselor_code ?? null;
  const showProfileBanner =
    !profileBannerDismissed && user?.role === 'counselor' && !user.onboarding_completed;

  const handleCopyCounselorCode = async (): Promise<void> => {
    if (!counselorCode) return;
    try {
      await navigator.clipboard.writeText(counselorCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };

  const handleEnterLive = useCallback(
    (id: string) => navigate(`/sessions/${id}/player`),
    [navigate],
  );

  return (
    <AppShell
      title={`안녕하세요, ${displayName}님`}
      sub={orgLabel}
      rightSlot={
        <div className="flex items-center gap-2">
          <Link
            to="/sessions"
            className="h-11 inline-flex items-center px-4 rounded-full border border-[#DDD0EA] bg-white text-[#5F0080] font-semibold text-sm hover:bg-[#F5EDFC] transition-colors"
          >
            세션 목록
          </Link>
          <Link
            to="/sessions/new"
            className="h-11 inline-flex items-center px-[18px] rounded-full bg-[#5F0080] text-white font-semibold text-sm hover:bg-[#4B0066] transition-colors"
          >
            + 새 클래스
          </Link>
        </div>
      }
    >
      <OrgRemovedNoticeDialog />

      {error && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl bg-[#FDECEC] p-3 text-sm text-[#B3261E] sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchDashboard()}
            className="shrink-0 self-start rounded-lg border border-[#B3261E]/40 bg-white px-3 py-1.5 text-[13px] font-semibold text-[#B3261E] transition-colors hover:bg-[#F9D9D9] sm:self-auto"
          >
            다시 시도
          </button>
        </div>
      )}

      {showProfileBanner && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#DDD0EA] bg-[#F5EDFC] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[14px] font-bold text-[#5F0080]">프로필을 완성해보세요</p>
            <p className="mt-1 text-[13px] text-[#6F6F6F]">
              자격증명·경력 등은 원하실 때 설정에서 입력하실 수 있습니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/onboarding/counselor')}
              className="h-9 rounded-xl bg-[#5F0080] px-4 text-[13px] font-semibold text-white hover:bg-[#4B0066] transition-colors"
            >
              프로필 완성하기
            </button>
            <button
              type="button"
              onClick={() => setProfileBannerDismissed(true)}
              className="h-9 rounded-xl border border-[#C9B0E8] bg-white px-4 text-[13px] font-semibold text-[#6F6F6F] hover:bg-[#EFE3FA] transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-[#6F6F6F] text-sm">불러오는 중...</div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-8">
          {/* ── 좌측 컬럼 ── */}
          <div className="flex flex-col gap-6 lg:gap-8 min-w-0">
            {/* 지금 할 일 (Action Queue) */}
            <section>
              <div className="flex flex-col gap-3">
                {nextSession ? (
                  <div className="flex flex-col rounded-2xl bg-gradient-to-br from-[#6E1A8C] via-[#5F0080] to-[#4B0066] p-5 text-white shadow-[0_16px_40px_rgba(95,0,128,0.24)] lg:min-h-[248px]">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] opacity-85">
                      <span className="h-2 w-2 rounded-full bg-[#01f0c8]" />
                      {nextSession.status === 'in_progress' || nextSession.status === 'open'
                        ? '진행 중'
                        : '다음 세션'}
                    </div>
                    <h3 className="mt-1 text-[18px] font-extrabold leading-tight text-white sm:text-[20px]">
                      {nextSession.title || '제목 없음'}
                    </h3>
                    <p className="mt-1 text-[13px] text-white">
                      {nextSession.scheduled_at ? `${formatDateTime(nextSession.scheduled_at)} · ` : ''}
                      참여자 {nextSession.participant_count}명
                      {nextSession.access_code ? ` · 코드 ${nextSession.access_code}` : ''}
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                      {nextSession.access_code && (
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(nextSession.access_code ?? '')}
                          className="rounded-lg bg-white/15 border border-white/25 px-3 py-2 text-[12px] font-bold min-h-[40px] hover:bg-white/25 transition-colors"
                        >
                          코드 복사
                        </button>
                      )}
                      {nextSession.status === 'in_progress' || nextSession.status === 'open' ? (
                        <button
                          type="button"
                          onClick={() => handleEnterLive(nextSession.id)}
                          className="rounded-lg bg-white px-5 py-2.5 text-[14px] font-extrabold text-[#5F0080] min-h-[44px] hover:bg-[#F5EDFC] transition-colors"
                        >
                          입장
                        </button>
                      ) : (
                        <Link
                          to={`/sessions/${nextSession.id}`}
                          className="rounded-lg bg-white px-5 py-2.5 text-[14px] font-extrabold text-[#5F0080] min-h-[44px] hover:bg-[#F5EDFC] transition-colors"
                        >
                          상세 보기
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col rounded-2xl bg-gradient-to-br from-[#6E1A8C] via-[#5F0080] to-[#4B0066] p-5 text-white shadow-[0_16px_40px_rgba(95,0,128,0.24)] lg:min-h-[248px]">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] opacity-85">
                      다음 세션
                    </div>
                    <h3 className="mt-1 text-[18px] font-extrabold leading-tight text-white sm:text-[20px]">
                      아직 예정된 세션이 없어요
                    </h3>
                    <p className="mt-1 text-[13px] text-white">
                      클래스를 바로 열어 내담자와 세션을 시작해보세요.
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                      <Link
                        to="/sessions/new"
                        className="rounded-lg bg-white px-5 py-2.5 text-[14px] font-extrabold text-[#5F0080] min-h-[44px] hover:bg-[#F5EDFC] transition-colors"
                      >
                        클래스 바로 열기
                      </Link>
                    </div>
                  </div>
                )}
                {pendingReviewCount > 0 && (
                    <div className="rounded-2xl border border-[#DDD0EA] bg-white p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[15px] font-bold text-[#1F1F1F]">
                            리포트 검토 대기 {pendingReviewCount}건
                          </p>
                          <p className="mt-1 text-[13px] text-[#6F6F6F]">
                            기록이 완료된 세션의 리포트를 검토해주세요.
                          </p>
                        </div>
                        <Link
                          to="/reports"
                          className="shrink-0 rounded-lg bg-[#5F0080] px-4 py-2.5 min-h-[44px] text-[13px] font-bold text-white hover:bg-[#4B0066] transition-colors"
                        >
                          리포트 검토
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
            </section>

            {/* 오늘·다가오는 일정 */}
            <section>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-extrabold text-[18px] text-[#1F1F1F] tracking-tight">오늘 · 다가오는 일정</h2>
                <span className="font-mono text-[11px] text-[#6F6F6F]">오늘 {todaySessions.length}건</span>
              </div>
              {upcomingSessions.length > 0 ? (
                <div className="rounded-2xl border border-[#E8E3EC] bg-white px-5">
                  {upcomingSessions.map((cls) => {
                    const isToday = cls.scheduled_at
                      ? new Date(cls.scheduled_at).toDateString() === new Date().toDateString()
                      : false;
                    return (
                      <div
                        key={cls.id}
                        className="flex items-center gap-3 border-b border-[#F0ECF2] py-4 last:border-0"
                      >
                        <div className="w-[76px] shrink-0">
                          <div className="text-[14.5px] font-extrabold text-[#1F1F1F]">
                            {formatTime(cls.scheduled_at)}
                          </div>
                          <div className="text-[11px] font-semibold text-[#767676]">
                            {cls.scheduled_at
                              ? `${new Date(cls.scheduled_at).getMonth() + 1}/${new Date(cls.scheduled_at).getDate()}`
                              : ''}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-bold text-[#1F1F1F]">
                            {cls.title || '제목 없음'}
                          </div>
                          <div className="truncate text-[12px] text-[#6F6F6F]">
                            {cls.participant_count > 0 ? `참여 ${cls.participant_count}명` : ''}
                            {isToday ? ' · 오늘' : ''}
                          </div>
                        </div>
                        <StatusBadge status={cls.status} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#E8E3EC] py-10 text-center text-sm text-[#6F6F6F]">
                  예정된 일정이 없습니다
                </div>
              )}
            </section>

            {/* 내 클래스 */}
            <section>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-extrabold text-[18px] text-[#1F1F1F] tracking-tight">내 클래스</h2>
                <Link to="/sessions" className="text-[13px] font-bold text-[#5F0080] hover:underline">
                  전체 보기
                </Link>
              </div>
              {data.classes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#E8E3EC] p-12 text-center">
                  <p className="text-[#6F6F6F] text-sm mb-4">아직 진행한 클래스가 없습니다.</p>
                  <Link
                    to="/sessions/new"
                    className="inline-flex h-10 px-5 items-center rounded-xl bg-[#F5EDFC] text-[#5F0080] font-semibold text-sm hover:bg-[#EBDEF7] transition-colors"
                  >
                    클래스 만들기
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {(liveClasses.length > 0 || scheduledClasses.length > 0) && (
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold text-[#5F0080]">
                        <span className="h-3 w-1 rounded bg-[#5F0080]" />
                        진행 중 · 예정
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {[...liveClasses, ...scheduledClasses].map((cls) => (
                          <ClassCard key={cls.id} cls={cls} onEnter={handleEnterLive} />
                        ))}
                      </div>
                    </div>
                  )}
                  {pastClasses.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold text-[#6F6F6F]">
                        <span className="h-3 w-1 rounded bg-[#9B9B9B]" />
                        지난 세션
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {pastClasses.slice(0, 4).map((cls) => (
                          <ClassCard key={cls.id} cls={cls} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ── 우측 레일 ── */}
          <div className="flex flex-col gap-6 lg:gap-6 min-w-0">
            {/* 요약 타일 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[#E8E3EC] bg-white p-4">
                <div className="text-[12px] font-semibold text-[#6F6F6F]">진행 중</div>
                <div className="mt-2 text-[30px] font-extrabold tracking-tight text-[#1F8A5B]">
                  {data.in_progress_classes}
                </div>
                <div className="mt-1 text-[11px] font-bold text-[#5F0080]">입장하기 →</div>
              </div>
              <div className="rounded-2xl border border-[#E8E3EC] bg-white p-4">
                <div className="text-[12px] font-semibold text-[#6F6F6F]">검토 대기</div>
                <div className="mt-2 text-[30px] font-extrabold tracking-tight text-[#5F0080]">
                  {pendingReviewCount}
                </div>
                <div className="mt-1 text-[11px] font-bold text-[#5F0080]">리포트 검토 →</div>
              </div>
              <div className="rounded-2xl border border-[#E8E3EC] bg-white p-4">
                <div className="text-[12px] font-semibold text-[#6F6F6F]">오늘 예정</div>
                <div className="mt-2 text-[30px] font-extrabold tracking-tight text-[#1F1F1F]">
                  {todaySessions.length}
                </div>
                <div className="mt-1 text-[11px] font-bold text-[#5F0080]">일정 보기 →</div>
              </div>
              <div className="rounded-2xl border border-[#E8E3EC] bg-white p-4">
                <div className="text-[12px] font-semibold text-[#6F6F6F]">총 참여자</div>
                <div className="mt-2 text-[30px] font-extrabold tracking-tight text-[#1F1F1F]">
                  {data.total_participants.toLocaleString('ko-KR')}
                </div>
                <div className="mt-1 text-[11px] font-bold text-[#5F0080]">내담자 관리 →</div>
              </div>
            </div>

            {/* 최근 대화 */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-extrabold text-[18px] text-[#1F1F1F] tracking-tight">최근 대화</h2>
                <Link to="/chat" className="text-[13px] font-bold text-[#5F0080] hover:underline">
                  전체
                </Link>
              </div>
              {recentChats.length > 0 ? (
                <div className="rounded-2xl border border-[#E8E3EC] bg-white px-5">
                  {recentChats.map((room) => (
                    <Link
                      key={room.id}
                      to={`/chat/${room.id}`}
                      className="flex w-full items-start gap-3 border-b border-[#F0ECF2] py-3.5 text-left last:border-0"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5F0080] to-[#8A4FB8] text-[12px] font-bold text-white">
                        {(room.display_name || room.peer_name || '내').charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-bold text-[#1F1F1F]">
                            {room.display_name || room.peer_name || '내담자'}
                          </span>
                          {(room.unread_count ?? 0) > 0 && (
                            <span className="rounded-full bg-[#5F0080] px-1.5 text-[10px] font-extrabold text-white">
                              {room.unread_count}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[13px] text-[#6F6F6F]">
                          {room.last_message?.content || '새로운 대화가 없습니다'}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-[#767676]">
                        {relativeTime(room.last_message_at ?? null)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#E8E3EC] py-8 text-center text-sm text-[#6F6F6F]">
                  대화가 없습니다
                </div>
              )}
            </section>

            {/* 새 알림 */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-extrabold text-[18px] text-[#1F1F1F] tracking-tight">새 알림</h2>
                <Link to="/notifications" className="text-[13px] font-bold text-[#5F0080] hover:underline">
                  전체
                </Link>
              </div>
              {recentNotifications.length > 0 ? (
                <div className="rounded-2xl border border-[#E8E3EC] bg-white px-5">
                  {recentNotifications.map((n) => (
                    <div key={n.id} className="flex items-start gap-3 border-b border-[#F0ECF2] py-3.5 last:border-0">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#5F0080]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-[#1F1F1F]">{n.title}</div>
                        {n.body && <div className="truncate text-[12px] text-[#6F6F6F]">{n.body}</div>}
                        <div className="text-[11px] text-[#767676]">{relativeTime(n.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#E8E3EC] py-8 text-center text-sm text-[#6F6F6F]">
                  새로운 알림이 없습니다
                </div>
              )}
            </section>

            {/* 상담사 코드 (접이식) */}
            {counselorCode && (
              <section className="rounded-2xl border border-[#E8E3EC] bg-white p-5">
                <button
                  type="button"
                  onClick={() => setCodeOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <div className="text-[12px] font-semibold text-[#6F6F6F]">내 상담사 코드</div>
                    <div className="mt-0.5 font-mono text-[15px] font-extrabold tracking-[0.14em] text-[#5F0080]">
                      {codeOpen ? counselorCode : counselorCode.slice(0, 2) + '••••'}
                    </div>
                  </div>
                  <span className="text-[#6F6F6F]">{codeOpen ? '▲' : '▼'}</span>
                </button>
                {codeOpen && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyCounselorCode()}
                      className="rounded-lg border border-[#C9B0E8] bg-white px-4 py-2 min-h-[44px] text-sm font-bold text-[#5F0080] hover:bg-[#EFE3FA] transition-colors"
                    >
                      {codeCopied ? '복사됨' : '복사'}
                    </button>
                    <p className="text-[12px] text-[#6F6F6F]">
                      내담자에게 이 코드를 공유하면 상담 관계가 연결됩니다.
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
