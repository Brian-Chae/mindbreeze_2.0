// SDD-318 — 라이트용 아크 링. 데이터와 무관한 고정 장식이다(진행·상태를 표현하지 않는다).
import '../../styles/ui-v2.css';

export type UiV2ArcVariant = 'hero' | 'cover' | 'card';

export function UiV2ArcRing({ variant = 'hero' }: { variant?: UiV2ArcVariant }) {
  return (
    <svg className={`u2-arc u2-arc--${variant}`} viewBox="0 0 210 210" aria-hidden="true" focusable="false">
      <path d="M30 178A90 90 0 1 1 180 178" />
      <path d="M42 166A74 74 0 1 1 168 166" />
      <path d="M55 155A57 57 0 1 1 155 155" />
    </svg>
  );
}
