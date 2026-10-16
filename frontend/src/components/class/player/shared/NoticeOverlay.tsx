// SDD-208 P11 — 상태 변화로 새로 생기는 배너를 레이아웃 흐름 밖에 띄운다(아래 요소를 밀지 않는다).
// 기준 요소(position: relative)의 위쪽 가장자리에 붙고, 배너가 하나도 없으면 아무것도 그리지 않는다.
import { Children, type ReactNode } from 'react';
import './player-shared.css';

export function NoticeOverlay({ children }: { children?: ReactNode }) {
  if (Children.toArray(children).length === 0) return null;
  return <div className="pz-overlay" data-pz="overlay">{children}</div>;
}
