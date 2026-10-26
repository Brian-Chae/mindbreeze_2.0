// SDD-209 M6 — FM07 시작 대기. 상담사가 시작하면 자동으로 진행 화면으로 들어가므로 이 화면에는 시작 후 시트가 없다.
// 준비 인원 `N명 중 M명`은 대기실 presence 가 전달될 때만 보이고, 아니면 내 준비 문구를 쓴다(숫자를 지어내지 않는다).
import { Music, MapPin, Pause, Play, RefreshCw, UserCheck, Users, Volume2, VolumeX } from 'lucide-react';
import { IconCircleButton } from '../../player/shared/IconCircleButton';
import type { FlowBandMode, FlowPlace, FlowSize } from '../../../../lib/class/flow/types';
import { FlowButton, FlowCard } from '../shared/flow-primitives';
import { MemberFlowFrame } from './MemberFlowFrame';
import { MethodChips } from './MethodChips';

export interface WaitBgm {
  title: string;
  playing: boolean;
  /** 0~1 */
  volume: number;
  /** 브라우저 자동재생 차단 — 소리 켜기가 필요 */
  blocked: boolean;
}

export interface WaitStartViewProps {
  place: FlowPlace;
  size: FlowSize;
  bandMode: FlowBandMode;
  title: string;
  hostName: string | null;
  /** `오늘 오후 3:00` */
  whenLabel: string | null;
  /** `약 5분 뒤에 시작해요` */
  startsIn: string | null;
  readyCount: { ready: number; total: number } | null;
  /** 오프라인 장소 */
  address: string | null;
  /** 온라인에서만. 오프라인은 null */
  bgm: WaitBgm | null;
  backdropSrc?: string;
  onRecheck: () => void;
  onExit: () => void;
  onBgmToggle: () => void;
  onBgmVolume: (volume: number) => void;
}

export function WaitStartView({
  place, size, bandMode, title, hostName, whenLabel, startsIn, readyCount, address, bgm, backdropSrc, onRecheck, onExit, onBgmToggle, onBgmVolume,
}: WaitStartViewProps) {
  const solo = size === 'solo';
  const ratio = readyCount && readyCount.total > 0 ? Math.min(100, Math.round((readyCount.ready / readyCount.total) * 1000) / 10) : 100;
  const readyText = readyCount ? `${readyCount.total}명 중 ${readyCount.ready}명이 준비를 마쳤어요` : '내 준비를 마쳤어요';
  const place_ = bgm ? (
    <FlowCard size="sm">
      <section aria-label="대기실 BGM">
        <div className="fm-bgmh">
          <Music size={24} aria-hidden="true" />
          <div className="tx">
            <b>{bgm.title}</b>
            <span>대기실 BGM · {bgm.playing ? '재생 중' : '꺼짐'}</span>
          </div>
          <IconCircleButton label={bgm.playing ? '일시정지' : '재생'} icon={bgm.playing ? <Pause size={24} /> : <Play size={24} />} onClick={onBgmToggle} />
        </div>
        <div className="fm-bgmr">
          {bgm.playing ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
          <input
            className="fm-range" type="range" min={0} max={100} aria-label="볼륨"
            value={Math.round(bgm.volume * 100)} onChange={(e) => onBgmVolume(Number(e.target.value) / 100)}
          />
        </div>
      </section>
    </FlowCard>
  ) : (
    <FlowCard size="sm">
      <section className="fm-place" aria-label="장소 안내">
        <MapPin size={24} aria-hidden="true" />
        <div className="tx">
          <b>{address ?? '현장'}</b>
          <span className="d">
            {bandMode === 'none' ? '자리에 앉아 기다려 주세요. 휴대폰은 무음으로 해 주세요.' : '이마에 LINK BAND를 착용하고 자리에 앉아 기다려 주세요.'}
          </span>
        </div>
      </section>
    </FlowCard>
  );
  return (
    <MemberFlowFrame
      place={place}
      backdropSrc={backdropSrc}
      title={title}
      onExit={onExit}
      foot={
        <>
          <FlowButton kind="soft" onClick={onRecheck}><RefreshCw size={20} aria-hidden="true" />준비 다시 확인하기</FlowButton>
          <p className="fl-note fm-slot">상담사가 시작하면 자동으로 입장해요.</p>
        </>
      }
    >
      <MethodChips place={place} size={size} bandMode={bandMode} />
      <div className="fm-time">
        <span className="fl-label">시작 예정</span>
        <span className="fl-num">{whenLabel ?? '시각 미정'}</span>
        {startsIn ? <span className="fl-sub">{startsIn}</span> : null}
      </div>
      <FlowCard size="sm">
        <section className="fm-ready" aria-label="준비 상태">
          <div className="fm-rrow">{solo ? <UserCheck size={20} aria-hidden="true" /> : <Users size={20} aria-hidden="true" />}<span>{readyText}</span></div>
          <div className="fm-bar" aria-hidden="true"><i style={{ width: `${ratio}%` }} /></div>
          {solo && hostName ? <p className="fm-hint2">{hostName} 상담사가 곧 시작해요.</p> : null}
        </section>
      </FlowCard>
      {place_}
    </MemberFlowFrame>
  );
}
