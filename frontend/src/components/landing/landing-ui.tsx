import type { ReactNode } from 'react';

export const primaryButton = 'inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-[#5F0080] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#460060] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5F0080]';
export const secondaryButton = 'inline-flex min-h-12 items-center justify-center gap-3 rounded-full border border-[#D9D0DC] bg-white px-6 py-3 text-sm font-bold text-[#5F0080] transition-colors hover:bg-[#F5EFF7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5F0080]';
export const sectionContainer = 'mx-auto max-w-[1240px] px-6 sm:px-10';
export const eyebrow = 'text-xs font-bold tracking-[0.16em] text-[#5F0080]';
export const sectionTitle = 'mt-5 text-3xl font-bold leading-[1.35] tracking-[-0.045em] text-[#27212B] sm:text-[42px]';

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? '↗' : '→'}</span>;
}

export function SectionHeading({ label, children }: { label: string; children: ReactNode }) {
  return <><p className={eyebrow}>{label}</p><h2 className={sectionTitle}>{children}</h2></>;
}
