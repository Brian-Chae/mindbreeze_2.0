// 클래스 온보딩 코치마크 — 순수 로직(스텝 구성 · 노출 이력).
// 컴포넌트(ClassOnboardingCoachmarks.tsx)와 테스트가 함께 사용한다.
//
// 첫 참여자(게스트/신규 회원)가 기본 뮤트 · 손들기(발언권) · 스피커 온오프 ·
// 몰입(화면 끄기) 모드 규칙을 모른 채 입장해 당황하지 않도록 안내 스텝을 만든다.

/** 코치마크 노출 이력 localStorage 키 */
export const CLASS_ONBOARDING_STORAGE_KEY = 'mb_class_onboarding_seen';

export type CoachmarkStepId = 'publish' | 'hand' | 'speaker' | 'immersive';

export interface CoachmarkStep {
  id: CoachmarkStepId;
  /** 안내 아이콘(이모지) */
  icon: string;
  title: string;
  body: string;
}

export interface CoachmarkMode {
  locationType?: 'online' | 'offline';
  participantMode?: 'one_on_one' | 'group';
  maxParticipants?: number;
}

/**
 * 기본 뮤트 + 손들기(발언권) 대상 여부.
 * GuestMeditationPanel 의 speakingManaged 와 동일 규칙 — 온라인 그룹이며 정원 ≤20명일 때만.
 */
export function isSpeakingManaged(mode: CoachmarkMode): boolean {
  return (
    mode.locationType === 'online' &&
    mode.participantMode === 'group' &&
    (mode.maxParticipants ?? 0) <= 20
  );
}

/** 노출 이력 조회 — localStorage 접근이 차단된 환경(프라이빗 모드 등)에서도 예외 없이 동작한다. */
export function isClassOnboardingSeen(): boolean {
  try {
    return localStorage.getItem(CLASS_ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 노출 이력 저장 — 저장이 차단되어도 현재 화면에서는 닫힌 상태로 유지한다. */
export function markClassOnboardingSeen(): void {
  try {
    localStorage.setItem(CLASS_ONBOARDING_STORAGE_KEY, '1');
  } catch {
    /* 저장 실패는 무시 — 화면 동작에는 영향이 없다. */
  }
}

/** 세션 모드에 맞는 순차 안내 스텝. 손들기는 기본 뮤트(온라인 그룹 ≤20)에서만 의미가 있다. */
export function buildCoachmarkSteps(mode: CoachmarkMode): CoachmarkStep[] {
  const speakingManaged = isSpeakingManaged(mode);
  const offline = mode.locationType === 'offline';
  const steps: CoachmarkStep[] = [];

  // (1) 기본 뮤트(온라인 1:N) 또는 상시 송출(1:1) — 모드별 마이크·카메라 기본 상태
  if (speakingManaged) {
    steps.push({
      id: 'publish',
      icon: '🎙️',
      title: '마이크는 기본 뮤트예요',
      body: '여러 명이 함께하는 수업이라, 내 목소리와 화면은 기본적으로 전달되지 않아요. 편안하게 자리에 앉아 주세요.',
    });
  } else if (offline) {
    steps.push({
      id: 'publish',
      icon: '🏫',
      title: '대면으로 진행되는 수업이에요',
      body: '한 공간에 모여 진행하는 수업이라, 하울링 방지를 위해 상담사 음성은 기본 음소거 상태로 시작해요.',
    });
  } else {
    steps.push({
      id: 'publish',
      icon: '💬',
      title: '1:1 수업은 상시 송출이에요',
      body: '상담사와 바로 대화할 수 있도록 마이크와 카메라가 켜진 상태로 진행돼요. 준비되면 그대로 이야기해 주세요.',
    });
  }

  // (2) 손들기 → 발언권 부여 — 기본 뮤트(온라인 그룹 ≤20)에서만 노출
  if (speakingManaged) {
    steps.push({
      id: 'hand',
      icon: '🙋',
      title: '발언은 [손 들기]로 요청해요',
      body: '말하고 싶을 때 [손 들기]를 누르면 상담사에게 알림이 가요. 발언권을 받으면 마이크와 카메라가 함께 켜져요.',
    });
  }

  // (3) 스피커 온/오프
  steps.push({
    id: 'speaker',
    icon: '🔊',
    title: '스피커는 언제든 켜고 끌 수 있어요',
    body: offline
      ? '우측 상단 스피커 버튼을 누르면 상담사 음성을 켤 수 있어요. 소리가 커지면 다시 눌러 음소거할 수 있어요.'
      : '우측 상단 스피커 버튼으로 상담사 음성을 음소거하거나 다시 켤 수 있어요.',
  });

  // (4) 몰입(화면 끄기) 모드
  steps.push({
    id: 'immersive',
    icon: '🌙',
    title: '몰입 모드 — 화면 끄기',
    body: '우측 하단 [화면 끄기]를 누르면 화면이 어두워지고 경과 시간만 남아요. 화면을 누르면 바로 돌아올 수 있어요.',
  });

  return steps;
}
