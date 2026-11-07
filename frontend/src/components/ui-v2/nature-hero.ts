// SDD-320 후속 4 — 홈·클래스 메인 카드 공용 자연 배경. 클래스 id 로 고정한 사진 위에 어두운 보라 그라데이션을 얹는다.
import { heroBackdrop } from '../class/flow/shell/shell-data';

export const NATURE_HERO_GRADIENT = 'linear-gradient(160deg,rgba(37,16,56,.35),rgba(37,16,56,.72) 55%,rgba(37,16,56,.92))';

/** id 가 없으면 'home' 고정 사진. 이미지가 실패해도 .u2-hero--nature 의 배경색(#251038)으로 흰 글자 대비를 지킨다. */
export function natureHeroStyle(id?: string | null): { backgroundImage: string } {
  return { backgroundImage: `${NATURE_HERO_GRADIENT},url(${heroBackdrop(id || 'home')})` };
}
