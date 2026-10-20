// SDD-221 — 링크형 요약 타일. 타일 전체가 하나의 Link 이며 aria-label 로 "라벨 값 이동문구" 를 읽어준다.

import { Link } from 'react-router-dom';

interface StatTileProps {
  label: string;
  value: string | number;
  to: string;
  hint: string;
  valueClassName?: string;
}

export function StatTile({ label, value, to, hint, valueClassName = 'text-[#1F1F1F]' }: StatTileProps) {
  return (
    <Link
      to={to}
      aria-label={`${label} ${value}, ${hint.replace(/\s*→$/, '')}`}
      className="block rounded-2xl border border-[#E8E3EC] bg-white p-4 transition-colors hover:border-[#C9B0E8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080]"
    >
      <div className="text-[12px] font-semibold text-[#6F6F6F]">{label}</div>
      <div className={`mt-2 text-[30px] font-extrabold tracking-tight ${valueClassName}`}>{value}</div>
      <div className="mt-1 text-[12px] font-bold text-[#5F0080]">{hint}</div>
    </Link>
  );
}
