// 게스트 명상 화면 — 1.0 디자인 패리티 (SDD-029 P0) + SDD-040 6지표
// 검정 풀블리드 + FadingImageBackground + 상담사 라이브(상단) + 진행시간·6지표(하단)
// 데이터 계약(useBand/WS)은 SDD-024/026 유지 — 표현층만 교체
// 오프라인 수업은 스피커 기본 뮤트(하울링 방지), 온라인은 기본 ON + 스피커 온오프 토글

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBand } from '../../hooks/useBand';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { useAuthStore } from '../../stores/authStore';
import { resolveBandLinkState } from '../../lib/session-live/signal-status';
import { scoreIndices } from '../../lib/eeg/eegPersonalScore';
import { toDisplayGroupAverage, type GroupAverageDisplay, type GroupAverageEvent } from '../../lib/class/group-average';
import { getSession, getSessionByCodeState } from '../../lib/api/session';
import type { SessionLiveEegFeatureEvent } from '../../lib/socket';
import { FadingImageBackground } from './FadingImageBackground';
import { BlinkingText } from './BlinkingText';
import { MemberMetricDial } from './MemberMetricDial';
import { MemberRawData } from './MemberRawData';
import { MemberDeviceStrip } from './MemberDeviceStrip';
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
  /** 지표 차트 스케일 상한 (디자인 정본 비율 기준) */
  chartMax: number;
  /** 낮을수록 좋은 지표(BPM·호흡) — 차트 방향 코멘트에 사용 */
  lowerIsBetter?: boolean;
  /** 차트 노트에 붙는 스케일 안내 (예: HRV "0–60ms 기준") */
  scaleNote?: string;
}

const METRICS: readonly MetricDef[] = [
  { key: 'focus', label: '집중도', unit: '%', chartMax: 100 },
  { key: 'relaxation', label: '이완도', unit: '%', chartMax: 100 },
  { key: 'emotional', label: '정서안정도', unit: '%', chartMax: 100 },
  { key: 'bpm', label: 'BPM', unit: 'bpm', chartMax: 100, lowerIsBetter: true },
  { key: 'respiration', label: '호흡', unit: '회/분', chartMax: 24, lowerIsBetter: true },
  { key: 'hrv', label: 'HRV', unit: 'ms', chartMax: 60, scaleNote: '0–60ms 기준' },
] as const;

/** SDD-123: MIND/BODY 섹션 — 상담사 화면의 MIND/BODY 구분을 이식 (표시 순서 유지) */
const METRIC_SECTIONS = [
  { key: 'mind', label: '마음', english: 'MIND', keys: ['focus', 'relaxation', 'emotional'] as const },
  { key: 'body', label: '몸', english: 'BODY', keys: ['bpm', 'respiration', 'hrv'] as const },
] as const;

const MAX_POINTS = 300;
const AI_ANALYZING_MS = 15_000;
/** SDD-095: 클래스 채팅 상태(chat_enabled) 폴링 주기 — 상담사 토글을 근실시간 반영 */
const CHAT_STATE_POLL_MS = 5_000;

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

/** 링버퍼에 1포인트 추가 — MAX_POINTS 초과 시 가장 오래된 값 제거 */
function pushRingPoint(buf: number[], value: number): void {
  buf.push(value);
  if (buf.length > MAX_POINTS) {
    buf.splice(0, buf.length - MAX_POINTS);
  }
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
  const wasLeadOffRef = useRef(false);
  const analyzingTimerRef = useRef<number | null>(null);
  /** 링버퍼 갱신 시 리렌더 트리거(미니바 갱신용) — 값 자체는 사용하지 않는다 */
  const [, setSeriesTick] = useState(0);
  const seriesRef = useRef<MetricSeries>(emptySeries());
  const bandRef = useRef<ReturnType<typeof useBand> | null>(null);
  const targetSec = Math.max(1, durationMin) * 60;

  // 로그인 회원의 참가자 행은 user_id가 있어 무토큰 업로드가 403(사칭 차단)으로 거부된다.
  // 회원은 반드시 토큰으로, 비로그인 게스트만 skipAuth로 연결한다.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // ── SDD-095: 클래스 채팅 ──
  // 회원(로그인)만 세션 상세로 채팅 상태를 조회한다(게스트는 권한 없음 → 패널 미노출).
  // 상담사가 명상 중에 켜면 5초 폴링으로 감지해 패널을 펼치고, 진입 시점에는 접힘(배지만)으로 둔다.
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatRoomId, setChatRoomId] = useState<string | null>(null);
  const [chatStateReady, setChatStateReady] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  /** 직전 관측값 — 세션별로 「진입 시 기본 접힘 / 진행 중 켜짐 = 펼침」을 판정한다 */
  const lastChatEnabledRef = useRef<{ sessionId: string; value: boolean } | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !sessionId) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const detail = await getSession(sessionId);
        if (cancelled) return;
        setChatEnabled(Boolean(detail.chat_enabled));
        setChatRoomId(detail.chat_room_id ?? null);
        setChatStateReady(true);
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

  // SDD-095 후속: 게스트는 채팅방 접근 권한이 없으므로, by-code 상태로 chat_enabled만 조회해
  // '회원 전용' 안내(GuestChatNotice)를 노출한다 — 패널 대신 회원가입 유도.
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
        // 상태 조회 실패는 무해 — 안내만 미표시
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), CHAT_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthenticated, classCode, participantId]);

  // 명상 진행 중에는 기본 접힘(안읽음 배지만) — 진행 중 상담사가 켜면 그때 펼친다
  useEffect(() => {
    if (!chatStateReady) return;
    const previous = lastChatEnabledRef.current;
    lastChatEnabledRef.current = { sessionId, value: chatEnabled };
    if (!previous || previous.sessionId !== sessionId) {
      setChatExpanded(false);
      return;
    }
    if (chatEnabled && !previous.value) setChatExpanded(true);
  }, [chatStateReady, chatEnabled, sessionId]);

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
        // feature 계약은 raw 비율(0~1) — 표시 전 표준모델/코호트 정규화(0~100)
        setRemoteEfficiency(scoreIndices({ relaxationIndex: efficiency }).relaxationIndex);
      }
    },
    [participantId, sessionId],
  );

  // SDD-124: 절대 그룹 평균 수신 — 마음 0~1 → 0~100 정규화, 몸 절대값 그대로.
  // payload 는 정규화(계약 검증)를 통과한 GroupAverageEvent. 개인 식별자·순위 없음.
  const handleGroupAverage = useCallback((event: GroupAverageEvent) => {
    setGroupAverage(toDisplayGroupAverage(event));
  }, []);

  // 개선 5: 무음 시그널 — 기본 뮤트(온라인 1:N)에서도 발언권 없이 상태를 조용히 전달한다.
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
    if (!b || metricsBlocked) {
      return {
        focus: null,
        relaxation: remoteEfficiency,
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
  useEffect(() => {
    const id = window.setInterval(() => {
      const sample = readSnapshot();
      const series = seriesRef.current;
      for (const def of METRICS) {
        const v = sample[def.key];
        if (v !== null && Number.isFinite(v)) {
          pushRingPoint(series[def.key], v);
        }
      }
      setSeriesTick((t) => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [readSnapshot]);

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

  // 오프라인 그룹 20명 초과 수업은 강당형 대면 진행 — 원격 상담사 영상 타일을 숨긴다
  const showCounselorVideo = !(
    locationType === 'offline' &&
    participantMode === 'group' &&
    (maxParticipants ?? 0) > 20
  );

  // SDD-094: 온라인 그룹(≤20)만 발언권(손들기) 대상 —
  // 온라인 1:1은 상시 송출(canPublish=true)이라 버튼이 뜨지 않고, 오프라인/>20은 대상 아님
  const speakingManaged =
    locationType === 'online' &&
    participantMode === 'group' &&
    (maxParticipants ?? 0) <= 20;

  return (
    <div className="member-class-player">
      <FadingImageBackground />
      <div className="player-scrim" aria-hidden="true" />
      <div className="player-screen" inert={screenOff}>
        <header className="player-topbar">
          <button type="button" onClick={onLeave} className="player-pill">← 종료</button>
          <h1>{title ?? '클래스'}</h1>
      {/* SDD-095: 클래스 채팅 — chat_enabled일 때만 노출(패널 내부 게이트).
          몰입(화면 끄기) 중에도 마운트를 유지해 안읽음 배지가 쌓이게 하되,
          몰입 오버레이(z-50, DOM상 뒤)가 위를 덮어 시각·클릭을 가린다. */}
      <div className="player-chat">
      <ClassChatPanel
        sessionId={sessionId}
        enabled={chatEnabled}
        roomId={chatRoomId}
        collapsed={!chatExpanded}
        onCollapsedChange={(next) => setChatExpanded(!next)}
        title="클래스 채팅"
      />

      {/* SDD-095 후속: 게스트에게 채팅방이 회원 전용임을 안내(회원가입 유도) */}
      {!isAuthenticated && guestChatEnabled && <GuestChatNotice />}
      </div>


          <button type="button" onClick={() => setSpeakerOn((v) => !v)}
            aria-pressed={speakerOn} aria-label={speakerOn ? '스피커 음소거' : '스피커 켜기'} className="player-pill">
            <SpeakerIcon muted={!speakerOn} />
            <span className="player-desktop-label">{speakerOn ? '음소거' : '스피커 켜기'}</span>
          </button>
          <button type="button" onClick={() => setScreenOff(true)} aria-label="화면 끄기" className="player-pill">
            <span aria-hidden="true">⏻</span><span className="player-desktop-label">화면 끄기</span>
          </button>
        </header>

        <div className="player-body member-2col">
          {/* 좌측: "지금 나를 알려요" 시그널 + 상담사 영상 + 함께한 시간 */}
          <div className="member-left">
            <section className="member-signal-card" aria-label="지금 나를 알려요">
              <h3 className="member-card-title">지금 나를 알려요</h3>
              <QuietSignalButtons onSend={liveSocket.sendSignal} />
            </section>
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
          </div>

          {/* 우측: 나의 상태(마음3+몸3, 그룹 평균 대비) + 디바이스/raw */}
          <div className="member-right">
            <section className="member-metrics-card" aria-label="나의 상태">
              <div className="player-metric-sections">
                {METRIC_SECTIONS.map((section) => (
                  <section key={section.key} className="player-metric-section" aria-label={section.label}>
                    <h3>{section.label}<small>{section.english}</small></h3>
                    <div className="player-metric-items">
                      {section.keys.map((key) => {
                        const metric = METRICS.find((m) => m.key === key)!;
                        return (
                          <MemberMetricDial
                            key={key}
                            label={metric.label}
                            value={snapshot[key]}
                            unit={metric.unit}
                            maxValue={metric.chartMax}
                            series={seriesRef.current[key]}
                            average={groupAverage?.[key] ?? null}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <section className="member-device-raw-card" aria-label="디바이스 및 원시 데이터">
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

      {/* 개선 9: 최초 1회 온보딩 코치마크 — 기본 뮤트·손들기·스피커·몰입 모드 안내.
          localStorage로 재노출을 막고, [건너뛰기]/[다시 보지 않기]로 즉시 닫을 수 있다. */}
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
