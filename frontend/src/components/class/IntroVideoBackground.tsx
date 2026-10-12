// waiting 정적 이미지 배경 — 명상 화면과 동일한 고퀄리티 자연 이미지 고정 (SDD-029 후속)
// 사용자 피드백: intro 영상 품질 저하 → 단일 자연 이미지 고정 표시로 교체.

const INTRO_IMG = '/images/background1.webp';

interface IntroVideoBackgroundProps {
  /** Welcome 페이드 완료 여부 — 고정 이미지는 항상 표시하므로 현재 사용하지 않음 */
  active: boolean;
}

export function IntroVideoBackground({ active: _active }: IntroVideoBackgroundProps) {
  return (
    <img
      src={INTRO_IMG}
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
    />
  );
}
