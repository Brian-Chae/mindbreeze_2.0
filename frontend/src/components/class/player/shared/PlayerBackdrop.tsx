// SDD-208 — 풀블리드 자연 배경 + 스크림. imageSrc 를 주면 정지 이미지(하니스·측정용), 없으면 교차 페이드 배경을 재사용한다.
import { FadingImageBackground } from '../../FadingImageBackground';
import './player-shared.css';

interface PlayerBackdropProps {
  imageSrc?: string;
}

export function PlayerBackdrop({ imageSrc }: PlayerBackdropProps) {
  return (
    <div className="pz-backdrop" data-pz="backdrop" aria-hidden="true">
      {imageSrc ? (
        <div className="pz-backdrop__still" style={{ backgroundImage: `url(${imageSrc})` }} />
      ) : (
        <FadingImageBackground />
      )}
      <div className="pz-backdrop__scrim" />
    </div>
  );
}
