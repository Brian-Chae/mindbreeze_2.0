// SDD-245: 페이지 외곽 프레임과 제목. 좌우 gutter는 AppShell/ClientShell이 소유하므로 여기서 padding을 다시 주지 않는다(이중 inset 금지).
import type { HTMLAttributes, ReactNode } from 'react';

export type PageFrameWidth = 'standard' | 'reading' | 'form' | 'full';

// standard 1200 = 1280 border-box − 좌우 gutter 40×2. reading/form은 읽기 목적의 좁은 폭(기존 페이지 값 보존).
const WIDTH: Record<PageFrameWidth, string> = {
  standard: 'mx-auto w-full max-w-mb-content',
  reading: 'mx-auto w-full max-w-4xl',
  form: 'mx-auto w-full max-w-xl',
  full: 'w-full',
};

export interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  width?: PageFrameWidth;
  children?: ReactNode;
}

export function PageFrame({ width = 'standard', className, children, ...rest }: PageFrameProps) {
  const cls = [WIDTH[width], 'flex min-w-0 flex-col gap-6'];
  if (className) cls.push(className);
  return <div data-ui="page-frame" data-width={width} className={cls.join(' ')} {...rest}>{children}</div>;
}

export interface PageHeadingProps {
  title: string;
  sub?: string;
  actions?: ReactNode;
  level?: 1 | 2;
}

/** 셸이 제목을 따로 그리지 않는 화면용 페이지 제목(22px/700). */
export function PageHeading({ title, sub, actions, level = 1 }: PageHeadingProps) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return (
    <div data-ui="page-heading" className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <Tag className="text-[22px] font-bold leading-[30px] text-[#1F1F1F] md:leading-[33px]">{title}</Tag>
        {sub && <p className="mt-0.5 text-[14px] leading-[21px] text-[#6F6F6F]">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}
