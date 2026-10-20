import { useEffect, useRef, useState } from 'react';
import type { ClassReadModel } from '../../../lib/class-structure/adapters';
import { MemberClassCard } from '../../class/structure/member-class-views';

export function MemberClassStrip({ classes }: { classes: ClassReadModel[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  function update() {
    const node = track.current;
    if (node) setEdges({ start: node.scrollLeft < 2, end: node.scrollLeft >= node.scrollWidth - node.clientWidth - 2 });
  }
  useEffect(() => {
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (track.current) observer?.observe(track.current);
    update();
    return () => observer?.disconnect();
  }, [classes]);
  return <>
    <div className="mh-scroll-wrap">
      <div className="mh-edge mh-edge-left" hidden={edges.start} aria-hidden="true" />
      <div ref={track} className="mc-grid mh-track" aria-label="내 클래스 가로 스크롤" onScroll={update}
        onFocus={(event) => {
          if (window.matchMedia('(min-width:1024px)').matches) event.target.closest('article')?.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'instant' });
        }}>
        {classes.map((item) => <MemberClassCard key={item.id} model={item} />)}
      </div>
      <div className="mh-edge mh-edge-right" hidden={edges.end} aria-hidden="true" />
    </div>
    <div className="mh-scroll-tools">
      <small>{edges.start && edges.end ? '모든 클래스 표시' : '좌우로 넘겨 모든 클래스 보기'}</small>
      <button type="button" aria-label="이전 클래스" disabled={edges.start} onClick={() => track.current?.scrollBy({ left: -296, behavior: 'smooth' })}>←</button>
      <button type="button" aria-label="다음 클래스" disabled={edges.end} onClick={() => track.current?.scrollBy({ left: 296, behavior: 'smooth' })}>→</button>
    </div>
  </>;
}
