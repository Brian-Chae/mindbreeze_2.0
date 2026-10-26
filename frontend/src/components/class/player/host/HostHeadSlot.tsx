// SDD-208 H1 — 헤드 행 오른쪽 슬롯. 온라인 = 내 화면(셀프뷰), 오프라인 = 셀프뷰 없이 수업 요약 패널(CS3).
// 오프라인에서는 셀프뷰·카메라 토글 DOM 자체를 만들지 않는다(H3).
import { useEffect, useRef } from 'react';
import type { LocalVideoTrack } from 'livekit-client';
import { Maximize2, Mic, MicOff, Minimize2, VideoOff } from 'lucide-react';
import type { HostSummary } from '../../../../lib/class/host-player-case';
import type { CamUi, MicUi } from '../../../../lib/class/player-case';
import './host-player.css';

interface HostSelfViewProps {
  cam: CamUi;
  mic: MicUi;
  big: boolean;
  /** 내 카메라 영상. null 이면 자리표시 실루엣 */
  stream: MediaStream | null;
  /** 온라인 셀프뷰는 SDK가 원본 교체를 관리하도록 트랙에 연결한다. */
  track?: LocalVideoTrack | null;
  netBad: boolean;
  /** denied 면 설정 안내 시트를, 아니면 크기 전환을 연다 */
  onPress: () => void;
}

function SelfVideo({ stream, track }: { stream: MediaStream | null; track?: LocalVideoTrack | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  // SDK 트랙이 있으면 폴백 스트림 변경은 연결 수명에 영향을 주지 않는다.
  const fallbackStream = track ? null : stream;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (track) {
      track.attach(element);
      return () => { track.detach(element); };
    }
    element.srcObject = fallbackStream;
    return () => { element.srcObject = null; };
  }, [track, fallbackStream]);
  return <video ref={ref} autoPlay playsInline muted aria-hidden="true" />;
}

function Silhouette() {
  return (
    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="hp-sv-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#46306a" />
          <stop offset="1" stopColor="#1d4a48" />
        </linearGradient>
      </defs>
      <rect width="200" height="120" fill="url(#hp-sv-bg)" />
      <circle cx="100" cy="52" r="15" fill="rgba(255,255,255,.3)" />
      <path d="M62 120c0-24 17-40 38-40s38 16 38 40z" fill="rgba(255,255,255,.22)" />
    </svg>
  );
}

export function HostSelfView({ cam, mic, big, stream, track, netBad, onPress }: HostSelfViewProps) {
  const denied = cam === 'denied' || cam === 'nodevice';
  const micOff = mic === 'off' || mic === 'denied';
  const camText = denied ? '카메라 사용 불가' : cam === 'on' ? '카메라 켜짐' : '카메라 꺼짐';
  const dot = denied ? 'lost' : cam === 'on' ? 'on' : 'off';
  return (
    <button
      type="button"
      className="hp-selfview"
      data-pz="selfview"
      data-denied={denied ? 'true' : undefined}
      data-net-bad={netBad ? 'true' : undefined}
      aria-label={`내 화면 ${camText}, 마이크 ${micOff ? '꺼짐' : '켜짐'}. ${denied ? '탭하면 설정 안내' : '탭하면 크기 전환'}`}
      onClick={onPress}
    >
      {denied ? (
        <span className="hp-selfview__off" data-deny="true">
          <VideoOff aria-hidden="true" strokeWidth={2} />
          <span>카메라를 쓸 수 없어요</span>
          <small>설정 안내</small>
        </span>
      ) : cam === 'on' ? (
        <span className="hp-selfview__vid">{track || stream ? <SelfVideo stream={stream} track={track} /> : <Silhouette />}</span>
      ) : (
        <span className="hp-selfview__off">
          <VideoOff aria-hidden="true" strokeWidth={2} />
          카메라 꺼짐
        </span>
      )}
      {denied ? null : (
        <span className="hp-selfview__ic hp-selfview__sz" aria-hidden="true">
          {big ? <Minimize2 strokeWidth={2} /> : <Maximize2 strokeWidth={2} />}
        </span>
      )}
      <span className="hp-selfview__ic hp-selfview__mic" data-off={micOff ? 'true' : undefined} aria-hidden="true">
        {micOff ? <MicOff strokeWidth={2} /> : <Mic strokeWidth={2} />}
      </span>
      <span className="hp-selfview__lb">
        <i className="hp-dot" data-state={dot} />
        내 화면
      </span>
    </button>
  );
}

export function HostSummaryPanel({ summary }: { summary: HostSummary }) {
  return (
    <div className="hp-sumpanel" data-pz="sumpanel" role="group" aria-label="수업 요약">
      <div className="hp-sumpanel__r">
        <span>녹음</span>
        <b>{summary.recPaused ? null : <i className="hp-rdot" aria-hidden="true" />}{summary.recLabel}</b>
      </div>
      <div className="hp-sumpanel__r">
        <span>체크인</span>
        <b>{summary.checkinDone}/{summary.checkinTotal}</b>
      </div>
      <div className="hp-sumpanel__r">
        <span>밴드</span>
        <b>{summary.bandOn}/{summary.bandTotal}</b>
      </div>
    </div>
  );
}
