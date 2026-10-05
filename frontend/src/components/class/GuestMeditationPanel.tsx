// 게스트 명상 화면 — SDD-029 P0 + SDD-040 6지표 + SDD-124 그룹 평균 + SDD-125 3열.
// 디자인 정본: design/member-class-player/index.html (3열: 좌=클래스정보·프로필·지표·피드백 /
// 중=상담사 라이브·채팅 / 우=디바이스·raw). 좌우 SUB 폭 리사이즈 가능(기본=최대폭).
// 데이터 계약(useBand/WS)은 SDD-024/026 유지 — 표현층만 교체.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBand } from '../../hooks/useBand';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { useAuthStore } from '../../stores/authStore';
import { resolveBandLinkState } from '../../lib/session-live/signal-status';
import { scoreIndices } from '../../lib/eeg/eegPersonalScore';
import { toDisplayGroupAverage, type GroupAverageDisplay, type GroupAverageEvent } from '../../lib/class/group-average';
import { getSession, getSessionByCode, getSessionByCodeState } from '../../lib/api/session';
import { getClientProfile } from '../../lib/api/client-profile';
import type { SessionLiveEegFeatureEvent } from '../../lib/socket';
import { FadingImageBackground } from './FadingImageBackground';
import { BlinkingText } from './BlinkingText';
import { MemberMetricDial } from './MemberMetricDial';
import { MemberRawData } from './MemberRawData';
import { MemberTrendGraph } from './MemberTrendGraph';
import { MemberDeviceStrip } from './MemberDeviceStrip';
import { MemberClassInfoCard } from './MemberClassInfoCard';
import { MemberProfileCard } from './MemberProfileCard';
import './member-class-player.css';
import { LeadOffModal } from './LeadOffModal';
import { CounselorLiveTile } from './CounselorLiveTile';
import { ClassChatPanel } from '../chat/ClassChatPanel';
import { GuestChatNotice } from '../chat/GuestChatNotice';
import { ClassOnboardingCoachmarks } from './ClassOnboardingCoachmarks';
import { QuietSignalButtons } from './QuietSignalButtons';

interface GuestMeditationPanelProps {
  title: string | null;
  startedAt: string | null;
  durationMin: number;
  onLeave: () => void;
  sessionId: string;
  participantId: string | null;
  /** 클래스 코드 — 상담사 라이브 영상 구독 토큰 요청용 */
  classCode: string | null;
  /** 게스트 소유 증명 토큰 (로그인 회원은 생략) */
  participantToken?: string | null;
  /** 클래스 장소 유형 — 오프라인은 스피커 기본 뮤트(하울링 방지) */
  locationType?: 'online' | 'offline';
  /** 참여 방식 — 오프라인 그룹 대규모에서는 상담사 영상을 숨긴다 */
  participantMode?: 'one_on_one' | 'group';
  /** 정원 — 오프라인 그룹 20명 초과 시 상담사 영상 타일 미표시 */
  maxParticipants?: number;
}

type MetricKey =
  | 'focus'
  | 'relaxation'
  | 'emotional'
  | 'bpm'
  | 'respiration'
  | 'hrv';

interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  /** 표시 스케일 하한/상한 (목업 정본 기준) */
  min: number;
  max: number;
}

const METRICS: readonly MetricDef[] = [
  { key: 'focus', label: '집중도', unit: '%', min: 0, max: 100 },
  { key: 'relaxation', label: '이완도', unit: '%', min: 0, max: 100 },
  { key: 'emotional', label: '감정균형도', unit: '%', min: 0, max: 100 },
  { key: 'bpm', label: 'BPM', unit: 'bpm', min: 40, max: 140 },
  { key: 'respiration', label: '호흡', unit: '회/분', min: 5, max: 30 },
  { key: 'hrv', label: 'HRV', unit: 'ms', min: 10, max: 100 },
] as const;

/** SDD-123: MIND/BODY 섹션 — 상담사 화면의 MIND/BODY 구분 이식 (표시 순서 유지) */
const METRIC_SECTIONS = [
  { key: 'mind', label: '마음', english: 'MIND', note: '뇌파 인지 상태 지표', keys: ['focus', 'relaxation', 'emotional'] as const },
  { key: 'body', label: '몸', english: 'BODY', note: '자율신경 및 활력 지표', keys: ['bpm', 'respiration', 'hrv'] as const },
] as const;

const MAX_POINTS = 300;
const AI_ANALYZING_MS = 15_000;
/** SDD-095: 클래스 채팅 상태(chat_enabled) 폴링 주기 */
const CHAT_STATE_POLL_MS = 5_000;
/** SDD-125: 좌/우 SUB 패널 폭 (기본=최대폭) */
const LEFT_W = 460;
const LEFT_MIN = 250;
const RIGHT_W = 420;
const RIGHT_MIN = 220;

type MetricSeries = Record<MetricKey, number[]>;

function emptySeries(): MetricSeries {
  return {
    focus: [],
    relaxation: [],
    emotional: [],
    bpm: [],
    respiration: [],
    hrv: [],
  };
}

/** 초 → mm:ss */
function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** 링버퍼에 1포인트 추가 — 불변 업데이트로 새 배열 반환(그래프 useMemo 갱신 보장). MAX_POINTS 초과 시 가장 오래된 값 제거 */
function pushRingPoint(buf: number[], value: number): number[] {
  const next = [...buf, value];
  return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
}

/** 스피커 아이콘 (음소거 시 X) */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" fill={muted ? 'none' : 'currentColor'} stroke="currentColor" />
      {muted ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
    </svg>
  );
}

export function GuestMeditationPanel({
  title,
  startedAt,
  durationMin,
  onLeave,
  sessionId,
  participantId,
  classCode,
  participantToken,
  locationType,
  participantMode,
  maxParticipants,
}: GuestMeditationPanelProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  /** 화면 끄기(몰입) 모드 — 1.0 절전 모드 패리티 */
  const [screenOff, setScreenOff] = useState(false);
  /** WS로 수신한 본인 두뇌휴식도 — 밴드 로컬값 폴백 */
  const [remoteEfficiency, setRemoteEfficiency] = useState<number | null>(null);
  /** LeadOff 해소 후 15초 "AI 분석중" */
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  /** 접촉불량 모달 — 사용자가 「무시하기」하면 닫힘 */
  const [leadOffDismissed, setLeadOffDismissed] = useState(false);
  /** 스피커 온오프 — 오프라인 기본 뮤트(하울링 방지), 온라인 기본 ON */
  const [speakerOn, setSpeakerOn] = useState(locationType === 'online');
  /** SDD-124: 절대 그룹 평균(표시 스케일) — class:group_average 수신 */
  const [groupAverage, setGroupAverage] = useState<GroupAverageDisplay | null>(null);
  /** SDD-125: 밴드 착용자 수(그룹 평균 이벤트 payload) */
  const [wearerCount, setWearerCount] = useState<number | null>(null);
  /** SDD-125: 클래스 정보(상담사명·참여자수) */
  const [counselorName, setCounselorName] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState<number | null>(null);
  /** SDD-125: 내 프로필(성별·생년월일) */
  const [profile, setProfile] = useState<{ gender?: string | null; birthDate?: string | null } | null>(null);
  /** SDD-125: 좌/우 패널 폭 */
  const [leftW, setLeftW] = useState(LEFT_W);
  const [rightW, setRightW] = useState(RIGHT_W);
  const [resizing, setResizing] = useState(false);
  /** SDD-125 후속: 추이 그래프 선택 지표 */
  const [selectedTrend, setSelectedTrend] = useState<MetricKey>('focus');
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number; startW: number } | null>(null);

  const wasLeadOffRef = useRef(false);
  const analyzingTimerRef = useRef<number | null>(null);
  /** 링버퍼 갱신 시 리렌더 트리거(미니바 갱신용) */
  const [, setSeriesTick] = useState(0);
  const seriesRef = useRef<MetricSeries>(emptySeries());
  const bandRef = useRef<ReturnType<typeof useBand> | null>(null);
  const targetSec = Math.max(1, durationMin) * 60;

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  // ── SDD-125: 클래스 정보(상담사명·참여자수) — 회원/게스트 경로 분기 ──
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        if (isAuthenticated) {
          const detail = await getSession(sessionId);
          if (cancelled) return;
          const host = user?.counselors?.find((c) => c.id === detail.host_id)?.name ?? null;
          setCounselorName(host);
          setParticipantCount(detail.participants?.length ?? null);
        } else if (classCode) {
          const byCode = await getSessionByCode(classCode);
          if (cancelled) return;
          setCounselorName(byCode.host_name);
          setParticipantCount(byCode.participant_count);
        }
      } catch {
        // 클래스 정보 조회 실패는 무해 — 카드 최소 표기
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, classCode, isAuthenticated, user]);

  // ── SDD-125: 내 프로필(성별·생년월일) — 회원만 ──
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    getClientProfile()
      .then((p) => {
        if (!cancelled) setProfile({ gender: p.gender, birthDate: p.birth_date });
      })
      .catch(() => {
        // 프로필 조회 실패는 무해 — 이름만 표기
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // ── SDD-095: 클래스 채팅 ──
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatRoomId, setChatRoomId] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !sessionId) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const detail = await getSession(sessionId);
        if (cancelled) return;
        setChatEnabled(Boolean(detail.chat_enabled));
        setChatRoomId(detail.chat_room_id ?? null);
      } catch {
        // 채팅 상태 조회 실패는 클래스 진행에 영향이 없어야 한다 — 패널만 미표시
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), CHAT_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthenticated, sessionId]);

  // 게스트는 채팅방 접근 권한이 없으므로 by-code 상태로 chat_enabled만 조회
  const [guestChatEnabled, setGuestChatEnabled] = useState(false);

  useEffect(() => {
    if (isAuthenticated || !classCode || !participantId) return undefined;
    const code = classCode;
    const pid = participantId;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const state = await getSessionByCodeState(code, pid);
        if (!cancelled) setGuestChatEnabled(Boolean(state.chat_enabled));
      } catch {
        // 상태 조회 실패는 무해
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), CHAT_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthenticated, classCode, participantId]);

  const band = useBand({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
  });
  bandRef.current = band;

  const handleEegFeature = useCallback(
    (event: SessionLiveEegFeatureEvent) => {
      if (!participantId || event.participant_id !== participantId) return;
      if (event.session_id && event.session_id !== sessionId) return;
      const efficiency =
        event.current_efficiency ??
        event.relaxation_index ??
        event.feature?.relaxation_index ??
        null;
      if (typeof efficiency === 'number') {
        setRemoteEfficiency(scoreIndices({ relaxationIndex: efficiency }).relaxationIndex);
      }
    },
    [participantId, sessionId],
  );

  const handleGroupAverage = useCallback((event: GroupAverageEvent) => {
    setGroupAverage(toDisplayGroupAverage(event));
    setWearerCount(event.wearer_count);
  }, []);

  const liveSocket = useSessionLiveSocket({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
    onEegFeature: handleEegFeature,
    onGroupAverage: handleGroupAverage,
  });

  const isLive = band.connectionState === 'connected';
  const linkState = resolveBandLinkState({
    bleConnected: isLive,
    lastEegAt: band.lastEegAt,
  });
  const metricsBlocked =
    band.deviceStatus === 'lead_off' || linkState === 'stale';

  /** 현재 시점 6지표 스냅샷 (null 보존) */
  const readSnapshot = useCallback((): Record<MetricKey, number | null> => {
    const b = bandRef.current;
    if (!b) {
      // 밴드 미착용 — 원격(서버) 값 뷰: 이완도만 원격값으로 표시
      return {
        focus: null,
        relaxation: remoteEfficiency,
        emotional: null,
        bpm: null,
        respiration: null,
        hrv: null,
      };
    }
    if (metricsBlocked) {
      // SDD-128(②-21): 접촉불량/링크 stale — 전 지표 미측정(null)으로 일관 표시
      return {
        focus: null,
        relaxation: null,
        emotional: null,
        bpm: null,
        respiration: null,
        hrv: null,
      };
    }
    const live = b.connectionState === 'connected';
    return {
      focus: live ? (b.scoredIndices?.focusIndex ?? null) : null,
      relaxation: live
        ? (b.scoredIndices?.relaxationIndex ?? remoteEfficiency)
        : remoteEfficiency,
      emotional: live ? (b.scoredIndices?.emotionalStability ?? null) : null,
      bpm: live ? b.heartRate : null,
      respiration: live ? b.respiratoryRate : null,
      hrv: live ? b.sdnn : null,
    };
  }, [metricsBlocked, remoteEfficiency]);

  const snapshot = readSnapshot();

  // 1Hz 링버퍼 — 6지표 시계열
  // SDD-127: readSnapshot을 ref로 안정화해 타이머를 1회만 생성(서버 신호에 의한 리셋·샘플 누락 방지)
  const readSnapshotRef = useRef(readSnapshot);
  useEffect(() => {
    readSnapshotRef.current = readSnapshot;
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      const sample = readSnapshotRef.current();
      const series = seriesRef.current;
      for (const def of METRICS) {
        const v = sample[def.key];
        if (v !== null && Number.isFinite(v)) {
          series[def.key] = pushRingPoint(series[def.key], v);
        }
      }
      setSeriesTick((t) => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // LeadOff 해소 → 15초 AI 분석중 + 모달 재표시 준비
  useEffect(() => {
    const isLeadOff = band.deviceStatus === 'lead_off';
    if (isLeadOff) {
      wasLeadOffRef.current = true;
      setLeadOffDismissed(false);
      setIsAnalyzing(false);
      if (analyzingTimerRef.current != null) {
        window.clearTimeout(analyzingTimerRef.current);
        analyzingTimerRef.current = null;
      }
      return;
    }
    if (wasLeadOffRef.current) {
      wasLeadOffRef.current = false;
      setIsAnalyzing(true);
      if (analyzingTimerRef.current != null) {
        window.clearTimeout(analyzingTimerRef.current);
      }
      analyzingTimerRef.current = window.setTimeout(() => {
        setIsAnalyzing(false);
        analyzingTimerRef.current = null;
      }, AI_ANALYZING_MS);
    }
  }, [band.deviceStatus]);

  const showLeadOffModal = band.deviceStatus === 'lead_off' && !leadOffDismissed;

  useEffect(() => {
    return () => {
      if (analyzingTimerRef.current != null) {
        window.clearTimeout(analyzingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const startedMs = startedAt ? new Date(startedAt).getTime() : Date.now();

    const tick = (): void => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // SDD-125: 리사이즈 핸들 드래그 (좌/우 SUB 폭 조정)
  const onHandlePointerDown = (side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { side, startX: e.clientX, startW: side === 'left' ? leftW : rightW };
    setResizing(true);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const next = drag.side === 'left' ? drag.startW + dx : drag.startW - dx;
      if (drag.side === 'left') {
        setLeftW(Math.max(LEFT_MIN, Math.min(LEFT_W, next)));
      } else {
        setRightW(Math.max(RIGHT_MIN, Math.min(RIGHT_W, next)));
      }
    };
    const onUp = (): void => {
      dragRef.current = null;
      setResizing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // 오프라인 그룹 20명 초과 수업은 강당형 대면 진행 — 원격 상담사 영상 타일을 숨긴다
  const showCounselorVideo = !(
    locationType === 'offline' &&
    participantMode === 'group' &&
    (maxParticipants ?? 0) > 20
  );

  // 온라인 그룹(≤20)만 발언권(손들기) 대상
  const speakingManaged =
    locationType === 'online' &&
    participantMode === 'group' &&
    (maxParticipants ?? 0) <= 20;

  return (
    <div
      className={`member-class-player${resizing ? ' resizing' : ''}`}
      style={{ '--col-metrics-w': `${leftW}px`, '--col-device-w': `${rightW}px` } as React.CSSProperties}
    >
      <FadingImageBackground />
      <div className="player-scrim" aria-hidden="true" />
      <div className="player-screen" inert={screenOff}>
        <header className="player-topbar">
          <button type="button" onClick={onLeave} className="player-pill">← 종료</button>
          <h1>{title ?? '클래스'}</h1>
          <button type="button" onClick={() => setSpeakerOn((v) => !v)}
            aria-pressed={speakerOn} aria-label={speakerOn ? '스피커 음소거' : '스피커 켜기'} className="player-pill">
            <SpeakerIcon muted={!speakerOn} />
            <span className="player-desktop-label">{speakerOn ? '음소거' : '스피커 켜기'}</span>
          </button>
          <button type="button" onClick={() => setScreenOff(true)} aria-label="화면 끄기" className="player-pill">
            <span aria-hidden="true">⏻</span><span className="player-desktop-label">화면 끄기</span>
          </button>
        </header>

        <div className="player-body">
          {/* 좌측 SUB: 클래스 정보 + 프로필 + 나의 상태 + 피드백 */}
          <div className="column-panel col-metrics">
            <MemberClassInfoCard
              counselorName={counselorName}
              participantCount={participantCount}
              wearerCount={wearerCount}
              groupFocus={groupAverage?.focus ?? null}
            />
            <MemberProfileCard
              name={user?.name ?? null}
              gender={profile?.gender}
              birthDate={profile?.birthDate}
              bandConnected={isLive}
            />

            <section className="glass-card member-metrics-card" aria-label="나의 상태">
              <div className="card-header-row" style={{ marginBottom: 4 }}>
                <div className="card-title-group">
                  <h2 className="card-title" style={{ fontSize: 15 }}>나의 상태</h2>
                  <p className="card-subtitle" style={{ marginTop: 1 }}>그룹 평균 대비 실시간 흐름</p>
                </div>
                <span className="member-device-dot" aria-hidden="true" style={isLive ? undefined : { background: 'var(--player-muted)', boxShadow: 'none' }} />
              </div>
              {METRIC_SECTIONS.map((section) => (
                <section key={section.key} className="player-metric-section" aria-label={section.label}>
                  <div className="metrics-section-heading">
                    <span className="metrics-group-title">{section.label} {section.english}</span>
                    <span className="metrics-group-note">{section.note}</span>
                  </div>
                  <div className="metrics-grid-3">
                    {section.keys.map((key) => {
                      const metric = METRICS.find((m) => m.key === key)!;
                      return (
                        <MemberMetricDial
                          key={key}
                          label={metric.label}
                          value={snapshot[key]}
                          unit={metric.unit}
                          min={metric.min}
                          max={metric.max}
                          series={seriesRef.current[key]}
                          average={groupAverage?.[key] ?? null}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
              <MemberTrendGraph
                metrics={METRICS}
                selected={selectedTrend}
                onSelect={(k) => setSelectedTrend(k as MetricKey)}
                series={seriesRef.current}
                average={groupAverage?.[selectedTrend] ?? null}
              />
              <div className="metric-legend">
                <span className="legend-item"><span className="legend-swatch legend-ring" aria-hidden="true" /> 링: 현재값</span>
                <span className="legend-item"><span className="legend-swatch legend-bar" aria-hidden="true" /> 막대: 최근 수신값</span>
                <span className="legend-item"><span className="legend-swatch legend-dot" aria-hidden="true" /> 증감: 3분 대비</span>
              </div>
            </section>

            <section className="glass-card member-signal-card" aria-label="지금 나를 알려요">
              <h3 className="member-card-title">지금 나를 알려요</h3>
              <QuietSignalButtons onSend={liveSocket.sendSignal} />
            </section>
          </div>

          <div
            className="resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="좌측 패널 폭 조절"
            onPointerDown={onHandlePointerDown('left')}
          />

          {/* 중앙 MAIN: 상담사 라이브 + 채팅 */}
          <div className="column-panel col-live">
            <section className="member-video-card" aria-label="상담사 영상">
              <span className="player-video-label">{showCounselorVideo ? '상담사 라이브' : '함께하는 명상'}</span>
              {showCounselorVideo ? (
                <CounselorLiveTile
                  code={classCode} participantId={participantId} participantToken={participantToken}
                  sessionId={sessionId} speakingManaged={speakingManaged} speakerOn={speakerOn}
                  className="player-live-tile"
                />
              ) : <div className="player-hall">편안하게 호흡에 집중해 주세요</div>}
              <div className="player-timer" aria-label="진행시간">
                <span className="player-timer-now">{formatClock(elapsedSec)}</span>
                <span className="player-timer-total">/ {formatClock(targetSec)}</span>
              </div>
            </section>

            {(chatEnabled || (!isAuthenticated && guestChatEnabled)) && (
              <section className="glass-card member-chat-card" aria-label="클래스 채팅">
                {isAuthenticated ? (
                  <ClassChatPanel
                    sessionId={sessionId}
                    enabled={chatEnabled}
                    roomId={chatRoomId}
                    collapsed={chatCollapsed}
                    onCollapsedChange={setChatCollapsed}
                    title="클래스 채팅"
                  />
                ) : (
                  <GuestChatNotice />
                )}
              </section>
            )}
          </div>

          <div
            className="resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="우측 패널 폭 조절"
            onPointerDown={onHandlePointerDown('right')}
          />

          {/* 우측 SUB: 디바이스 + raw */}
          <div className="column-panel col-device">
            <section className="glass-card member-device-raw-card" aria-label="디바이스 및 원시 데이터">
              <div className="member-device-head">
                <MemberDeviceStrip
                  connected={isLive}
                  battery={band.battery}
                  deviceStatus={band.deviceStatus}
                  signalQualityLevel={band.signalQualityLevel}
                  connectedElapsedSec={band.connectedElapsedSec}
                />
                {isLive ? (
                  <button type="button" onClick={() => void band.disconnect()} className="player-connect">연결 해제</button>
                ) : (
                  <button type="button" onClick={() => void band.connect()}
                    disabled={!band.isSupported || band.connectionState === 'connecting'} className="player-connect">
                    {!band.isSupported ? 'Chrome/Edge 필요' : band.connectionState === 'connecting' ? '연결 중...' : band.isMock ? '시뮬레이션 시작' : 'LINK BAND 연결'}
                  </button>
                )}
              </div>
              {isAnalyzing && <span className="player-analyzing"><BlinkingText>AI 분석중</BlinkingText></span>}
              {band.error && <p role="alert" className="player-band-error">{band.error}</p>}
              <MemberRawData band={band} />
            </section>
          </div>
        </div>

        <LeadOffModal
          isVisible={showLeadOffModal}
          leadOff={band.leadOff}
          onDismiss={() => setLeadOffDismissed(true)}
        />

        <ClassOnboardingCoachmarks
          locationType={locationType}
          participantMode={participantMode}
          maxParticipants={maxParticipants}
        />
      </div>

      {/* 화면 끄기 오버레이 — 검정 + 타이머 + 가운데 켜기 (1500ms crossfade) */}
      <div
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-[1500ms] ${
          screenOff ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!screenOff}
        inert={!screenOff}
      >
        <p className="text-[13px] text-white/60 tabular-nums">{formatClock(elapsedSec)}</p>
        <button
          type="button"
          onClick={() => setScreenOff(false)}
          className="mt-6 rounded-full border border-white/30 px-8 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
        >
          화면 켜기
        </button>
      </div>
    </div>
  );
}
