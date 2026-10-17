// SDD-208 — 정적 게이지 링. 호흡 지시·호흡 애니메이션은 두지 않는다(값 변화 시 호 전환 1.2초만, 연결 대기 점 페이드는 예외).
import type { CSSProperties, ReactNode } from 'react';
import './player-shared.css';

interface StatusRingProps {
  /** hero = 회원 중앙 링(헤일로+코어), mini = 상담사 타일·6지표 격자(가운데 children) */
  variant?: 'hero' | 'mini';
  /** 0~1 호 길이. null 이면 값 호를 그리지 않는다(미착용·연결 대기) */
  fraction: number | null;
  /** live = 정상, idle = 회색 점선(미착용·대기·접촉 불량), lost = 끊김(코랄 점선) */
  tone?: 'live' | 'idle' | 'lost';
  /** 호 색 CSS 변수 이름(예: --m-focus). 기본은 민트 */
  colorVar?: string;
  /** hero 코어: gauge = 지표명+값, dim = 흐린 값+안내(끊김), msg = 안내문 */
  core?: 'gauge' | 'dim' | 'msg';
  label?: string;
  value?: number | null;
  unit?: string;
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  /** 연결 대기 3점 순차 페이드 */
  dots?: boolean;
  /** mini 가운데 내용 */
  children?: ReactNode;
  ariaLabel: string;
}

const RADIUS = { hero: 46, mini: 44 } as const;

export function StatusRing({
  variant = 'hero', fraction, tone = 'live', colorVar, core = 'gauge',
  label, value, unit, title, subtitle, icon, dots, children, ariaLabel,
}: StatusRingProps) {
  const r = RADIUS[variant];
  const arcStyle: CSSProperties | undefined = colorVar ? { stroke: `var(${colorVar})` } : undefined;
  const dash = fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);

  return (
    <div
      className="pz-ring"
      data-pz="ring"
      data-variant={variant}
      data-tone={tone}
      data-core={variant === 'hero' ? core : undefined}
      role="img"
      aria-label={ariaLabel}
    >
      {variant === 'hero' ? (
        <>
          <span className="pz-ring__halo pz-ring__halo--1" />
          <span className="pz-ring__halo pz-ring__halo--2" />
        </>
      ) : null}
      <svg className="pz-ring__arc" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="pz-ring__trk" cx="50" cy="50" r={r} />
        {dash === null ? null : (
          <circle
            className="pz-ring__val"
            cx="50"
            cy="50"
            r={r}
            pathLength={100}
            strokeDasharray={`${dash} 100`}
            transform="rotate(-90 50 50)"
            style={arcStyle}
          />
        )}
      </svg>
      {variant === 'hero' ? (
        <div className="pz-ring__core">
          <div className="pz-ring__core-in">
            {icon ? <span className="pz-ring__core-ic" aria-hidden="true">{icon}</span> : null}
            {label ? <p className="pz-ring__label">{label}</p> : null}
            {value !== undefined && value !== null ? (
              <p className="pz-ring__num"><b>{value}</b>{unit ? <span>{unit}</span> : null}</p>
            ) : null}
            {title ? <p className="pz-ring__title">{title}</p> : null}
            {subtitle ? <p className="pz-ring__sub">{subtitle}</p> : null}
            {dots ? <span className="pz-ring__dots" aria-hidden="true"><i /><i /><i /></span> : null}
          </div>
        </div>
      ) : (
        <div className="pz-ring__center">{children}</div>
      )}
    </div>
  );
}
