// SDD-208 — 회원 뷰(MemberClassView) 입력 계약. 뷰는 props 만 받는 순수 컴포넌트이고,
// 훅(useBand·소켓·LiveKit)은 MemberClassContainer 만 호출한다(plan R4: useBand 인스턴스는 화면당 1개).
import type { ReactNode } from 'react';
import type { SignalSendResult } from '../../../../hooks/useSessionLiveSocket';
import type { MemberCaseInput } from '../../../../lib/class/member-player-case';
import type { PlayerMetricKey } from '../../../../lib/class/player-case';
import type { ClassSignalType } from '../../../../lib/class/quiet-signal';
import type { MetricSeries, MetricSnapshot } from './member-metrics';

export type MemberSheetKey = 'status' | 'chat' | 'signal' | 'sound' | 'device';

export interface MemberHeaderModel {
  title: string;
  elapsedSec: number;
  totalSec: number;
  /** 상담사 PiP 칩에 쓰는 이름. 없으면 "상담사" 만 표시 */
  counselorName: string | null;
  /** 카메라가 꺼졌을 때 내 PiP 자리에 쓰는 이니셜 */
  myInitial: string;
}

export interface MemberDeviceModel {
  /** 0~100 */
  battery: number | null;
  signalLabel: string;
  contactLabel: string;
  connectedElapsedSec: number;
  error: string | null;
  /** 접촉 불량이 풀린 직후 15초 */
  analyzing: boolean;
  /** 원시 파형 2채널(표시용으로 줄인 점들). 없으면 파형 영역을 그리지 않는다 */
  raw: { fp1: readonly number[]; fp2: readonly number[] } | null;
  /** 시뮬레이션 모드면 연결 버튼 라벨이 "시뮬레이션 시작" */
  isMock: boolean;
  /** 서버로 아직 못 보낸 밴드 데이터 수 — 0보다 크면 네트워크 끊김 카드에 "보관 중" 문구를 보여 준다 */
  pendingCount: number;
}

export interface MemberSoundModel {
  /** 상담사 음성 듣기 */
  speakerOn: boolean;
  /** 상담사가 재생 중인 가이드 이름. 없으면 null */
  trackTitle: string | null;
  /** 0~1 */
  volume: number;
  /** 브라우저 자동재생 정책으로 무음 — "소리 켜기"가 필요하다 */
  blocked: boolean;
  /** 오프라인 현장 카드 보조 문구 */
  onsiteLabel: string | null;
}

export interface MemberChatModel {
  /** 상담사가 채팅을 켰는가 */
  enabled: boolean;
  /** false 면 게스트 — 채팅 대신 안내를 보여 준다 */
  authenticated: boolean;
  unread: number;
  /** 시트 본문(ClassChatPanel embedded 또는 하니스 데모) */
  node: ReactNode;
}

export type MemberCheckin = 'comfortable' | 'normal' | 'heavy';

/** 상담사 영상 연결 문제 — failed: 영상을 불러오지 못했다(토큰 발급 실패), waiting: 상담사 화상이 아직 시작되지 않아 재시도를 모두 썼다 */
export type MemberHostVideoIssue = 'failed' | 'waiting';

export interface MemberViewActions {
  onLeave: () => void;
  onHeroChange: (key: PlayerMetricKey) => void;
  onSheetChange: (key: MemberSheetKey | null) => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onRaiseHand: () => void;
  onEndSpeaking: () => void;
  onBandConnect: () => void;
  onBandDisconnect: () => void;
  onBandCancel: () => void;
  onBandRetry: () => void;
  onBandContinue: () => void;
  /** 접촉 불량 시트의 [접촉 다시 확인] — 안내를 접고 측정이 이어지길 기다린다 */
  onBandRecheck: () => void;
  onNetRetry: () => void;
  /** 상담사 영상 연결을 다시 시도한다 */
  onHostVideoRetry: () => void;
  onSignal: (type: ClassSignalType) => SignalSendResult;
  onSpeakerChange: (on: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onResumeAudio: () => void;
  onScreenOff: () => void;
  /** 없으면 현장 카드에 체크인 칩을 그리지 않는다(서버 저장 API 없음) */
  onCheckin?: (value: MemberCheckin) => void;
  /** 종료·대기열 화면 버튼 */
  onEndAction: () => void;
  onWaitlistLeave: () => void;
}

export interface MemberClassViewProps {
  input: MemberCaseInput;
  header: MemberHeaderModel;
  hero: PlayerMetricKey;
  snapshot: MetricSnapshot;
  series: MetricSeries;
  device: MemberDeviceModel;
  sound: MemberSoundModel;
  chat: MemberChatModel;
  /** 상담사 PiP 영상(LiveKit 트랙). 없으면 아바타 */
  hostVideo?: ReactNode;
  /** 내 PiP 영상 */
  myVideo?: ReactNode;
  /** 상담사 영상 연결 문제 — 있으면 상담사 PiP 자리에 안내 칩과 [영상 다시 시도]를 보인다(트랙이 아직 없는 것과 구분) */
  hostVideoIssue?: MemberHostVideoIssue | null;
  /** 오프라인 현장 카드에서 고른 체크인 */
  checkin?: MemberCheckin | null;
  sheet: MemberSheetKey | null;
  /** 하니스·측정용 정지 배경. 없으면 교차 페이드 배경 */
  backdropSrc?: string;
  /** 종료 화면(M21) 정보 */
  end?: MemberEndModel;
  /** 대기열 화면(M20) 정보 */
  waitlist?: MemberWaitlistModel;
  actions: MemberViewActions;
}

export interface MemberEndModel {
  title: string;
  /** "30분" */
  durationLabel: string;
  /** 게스트는 "홈으로", 회원은 "대시보드로 이동" */
  actionLabel: string;
  /** 기존 리포트 메일 신청 패널(시트로 연다). 없으면 [리포트 받기]를 그리지 않는다(D5) */
  reportPanel?: ReactNode;
  /** 기존 사후 체크인 패널(시트로 연다). 없으면 [오늘 상태 남기기]를 그리지 않는다(D5) */
  checkinPanel?: ReactNode;
}

export interface MemberWaitlistModel {
  title: string;
  counselorName: string | null;
  /** "14:00" */
  startLabel: string | null;
  /** 로그인 회원에게만 입장 알림(푸시)이 간다 — 게스트는 안내 문구를 빼야 한다 */
  notifyByPush: boolean;
}
