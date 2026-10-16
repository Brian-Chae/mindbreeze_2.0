// SDD-208 M3 — 오프라인(대면) 회원의 현장 안내 카드. 영상·마이크·카메라 UI 가 없는 대신 "지금 수업 중" 한 장으로 자리를 채운다(MS1).
import { Check, MapPin } from 'lucide-react';
import type { MemberCheckin, MemberSoundModel } from './member-view-types';
import './member-player.css';

const CHECKINS: ReadonlyArray<{ value: MemberCheckin; label: string }> = [
  { value: 'comfortable', label: '편안해요' },
  { value: 'normal', label: '보통이에요' },
  { value: 'heavy', label: '무거워요' },
];

interface MemberSideCardProps {
  sound: MemberSoundModel;
  checkin: MemberCheckin | null | undefined;
  onOpenSound: () => void;
  /** 없으면 체크인 칩을 그리지 않는다(서버 저장 API 가 없는 동안) */
  onCheckin?: (value: MemberCheckin) => void;
}

export function MemberSideCard({ sound, checkin, onOpenSound, onCheckin }: MemberSideCardProps) {
  return (
    <aside className="mp-card mp-side" data-pz="side-card" aria-label="현장 수업">
      <div className="mp-side__row">
        <span className="mp-side__ic"><MapPin size={20} strokeWidth={2} aria-hidden="true" /></span>
        <div className="mp-side__tx">
          <b>현장 수업 중이에요</b>
          <p>{sound.onsiteLabel ? `${sound.onsiteLabel} 재생 중` : '같은 공간에서 함께하고 있어요'}</p>
        </div>
        <button type="button" className="mp-pill mp-pill--small" onClick={onOpenSound}>소리</button>
      </div>
      {onCheckin ? (
        <div>
          <p className="mp-side__label">지금 기분은 어떤가요?</p>
          <div className="mp-chips" role="group" aria-label="자가 체크인">
            {CHECKINS.map((item) => {
              const pressed = checkin === item.value;
              return (
                <button key={item.value} type="button" className="mp-chip-btn" aria-pressed={pressed} onClick={() => onCheckin(item.value)}>
                  {pressed ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : null}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
