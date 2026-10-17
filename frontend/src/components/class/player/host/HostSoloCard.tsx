// SDD-208 H3 — 1:1 상담(C05·C06): 그리드 대신 큰 회원 카드 1장(6지표 3×2) + 5분 추이 + 체크인 응답.
// 회원 영상은 기본 비공개다 — 회원이 카메라를 켜서 영상 트랙이 있을 때만 영상 자리가 생기고, 상담사 쪽에는 회원 카메라를 켜는 UI 가 없다(확정 결정 #1).
import { useEffect, useRef } from 'react';
import { HOST_BAND_DOT, HOST_BAND_TEXT, type HostParticipant } from '../../../../lib/class/host-player-case';
import type { PlayerMetric } from '../../../../lib/class/player-case';
import { HostMinis, HostQaCard, HostTrendCard } from './HostPersonParts';
import './host-player.css';

interface HostSoloCardProps {
  participant: HostParticipant;
  metric: PlayerMetric;
  trend: readonly number[];
  /** 회원이 켠 카메라 영상 — 없으면 영상 자리 자체를 만들지 않는다 */
  memberStream: MediaStream | null;
}

function MemberVideo({ stream, name }: { stream: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="hp-solo__video" data-pz="member-video">
      <video ref={ref} autoPlay playsInline muted aria-label={`${name} 영상`} />
    </div>
  );
}

export function HostSoloCard({ participant, metric, trend, memberStream }: HostSoloCardProps) {
  return (
    <div className="hp-solowrap">
      <div className="hp-solo" data-pz="solo">
        <section className="hp-card">
          <header className="hp-solo__h">
            <span className="hp-av" aria-hidden="true">{participant.name.slice(0, 1)}</span>
            <b>{participant.name}</b>
            <span className="hp-chip"><i className="hp-dot" data-state={HOST_BAND_DOT[participant.band]} />{HOST_BAND_TEXT[participant.band]}</span>
          </header>
          {memberStream ? <MemberVideo stream={memberStream} name={participant.name} /> : null}
          <HostMinis participant={participant} selected={metric.key} />
        </section>
        <section className="hp-solo__r">
          <HostTrendCard participant={participant} metric={metric} points={trend} />
          <HostQaCard participant={participant} card />
        </section>
      </div>
    </div>
  );
}
