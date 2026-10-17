// SDD-209 T2b — "내 영상·소리" 합친 컴포넌트(회원 FM06d · 상담사 FH05 공용).
// 표시 전용: 상태는 useMediaCheck(또는 하니스 픽스처)가 props 로 넘긴다.
// 카메라 켜짐 = 영상 + 마이크 토글 둘레 5단계 링(아이콘 밝기), 카메라 꺼짐 = 마이크 가로 막대. 세로 미터 없음.
import type { ReactNode, RefObject } from 'react';
import { AlertTriangle, Check, Copy, Info, Mic, MicOff, Play, RefreshCw, User, Video, VideoOff, Volume2 } from 'lucide-react';
import { RING_SEGMENTS, mediaDeviceMessage, micChipLabel, type MediaDeviceUi } from '../../../../lib/class/class-media';
import { FlowButton, FlowChip } from './flow-primitives';
import './flow-shared.css';

export interface MyAvCheckProps {
  mic: MediaDeviceUi;
  cam: MediaDeviceUi;
  /** 현재 레벨 0~1 (가로 막대용) */
  level: number;
  /** 5단계 링 채움 0~5 */
  steps: number;
  quiet: boolean;
  /** 1:1 이면 카메라 안내 문구가 "상담사에게"로 바뀐다 */
  solo: boolean;
  speakerPlaying: boolean;
  /** 스피커 카드 표시(기본 true) */
  showSpeaker?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onRecheck: () => void;
  onPlayTone: () => void;
  /** 허용 방법 시트 열기 */
  onOpenHelp: (device: '마이크' | '카메라') => void;
  /** 미지원 브라우저에서 링크 복사 */
  onCopyLink?: () => void;
}

const BAR_COUNT = 10;
const MIC_FAILED: ReadonlySet<MediaDeviceUi> = new Set<MediaDeviceUi>(['denied', 'nodevice', 'inuse', 'unsupported']);

function Tag({ required }: { required?: boolean }) {
  return <span className="mav-tag" data-required={required ? 'true' : undefined}>{required ? '필수' : '선택'}</span>;
}

function MicChip({ mic, quiet }: { mic: MediaDeviceUi; quiet: boolean }) {
  const failed = MIC_FAILED.has(mic);
  const ok = mic === 'on' && !quiet;
  const icon = failed ? <AlertTriangle size={16} /> : ok ? <Check size={16} /> : <Mic size={16} />;
  return <FlowChip tone={failed ? 'warn' : ok ? 'ok' : 'neutral'} icon={icon}>{micChipLabel(mic, quiet)}</FlowChip>;
}

/** 5단계 링 + 마이크 아이콘 버튼 */
function MicRingButton({ steps, quiet, onClick }: { steps: number; quiet: boolean; onClick: () => void }) {
  const label = `마이크 끄기 · 입력 ${quiet ? '조용해요' : '정상'} (5단계 중 ${steps}단계)`;
  return (
    <button type="button" className="mav-tg mav-tg--ring" aria-pressed="true" aria-label={label} onClick={onClick} style={{ ['--io' as string]: quiet ? 0.55 : 1 }}>
      <svg className="mav-seg" viewBox="0 0 44 44" aria-hidden="true">
        {Array.from({ length: RING_SEGMENTS }, (_, i) => (
          <circle key={i} data-seg={i} data-on={i < steps ? '1' : '0'} cx="22" cy="22" r="19" pathLength="100" strokeDasharray="16 84" strokeDashoffset={-20 * i - 2} />
        ))}
      </svg>
      <Mic size={20} aria-hidden="true" />
    </button>
  );
}

function MicToggle({ mic, onClick }: { mic: MediaDeviceUi; onClick: () => void }) {
  const usable = mic === 'on' || mic === 'off' || mic === 'pending';
  const label = mic === 'on' ? '마이크 끄기' : usable ? '마이크 켜기' : '마이크를 사용할 수 없어요';
  return (
    <button type="button" className="mav-tg" aria-pressed={mic === 'on'} aria-label={label} disabled={!usable || mic === 'pending'} onClick={onClick}>
      {mic === 'on' ? <Mic size={20} aria-hidden="true" /> : <MicOff size={20} aria-hidden="true" />}
    </button>
  );
}

function CamToggle({ cam, onClick }: { cam: MediaDeviceUi; onClick: () => void }) {
  const usable = cam === 'on' || cam === 'off';
  const label = cam === 'on' ? '카메라 끄기' : cam === 'off' ? '카메라 켜기' : '카메라를 사용할 수 없어요';
  return (
    <button type="button" className="mav-tg" aria-pressed={cam === 'on'} aria-label={label} disabled={!usable} onClick={onClick}>
      {cam === 'on' ? <Video size={20} aria-hidden="true" /> : <VideoOff size={20} aria-hidden="true" />}
    </button>
  );
}

function LevelBar({ level }: { level: number }) {
  const on = Math.ceil(Math.max(0, Math.min(1, level)) * BAR_COUNT);
  return (
    <div className="mav-level" role="img" aria-label={`마이크 입력 크기 ${on}/${BAR_COUNT}`} data-pz="flow-level">
      {Array.from({ length: BAR_COUNT }, (_, i) => <i key={i} className={i < on ? 'on' : undefined} />)}
    </div>
  );
}

function Hint({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return (
    <p className="mav-hint" data-warn={warn ? 'true' : undefined}>
      {warn ? <AlertTriangle size={20} aria-hidden="true" /> : null}
      <span>{children}</span>
    </p>
  );
}

function MiniButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="mav-mini" onClick={onClick}>
      <span aria-hidden="true" style={{ display: 'inline-grid' }}>{icon}</span>
      {children}
    </button>
  );
}

export function MyAvCheck(props: MyAvCheckProps) {
  const { mic, cam, level, steps, quiet, solo, speakerPlaying, showSpeaker = true, videoRef, onToggleMic, onToggleCamera, onRecheck, onPlayTone, onOpenHelp, onCopyLink } = props;
  const micFailed = MIC_FAILED.has(mic);
  const unsupported = mic === 'unsupported';

  let card: ReactNode;
  if (cam === 'on') {
    // 카메라 켜짐: 영상 + 오버레이(칩·마이크 링·카메라 토글)
    card = (
      <section className="mav-card" data-pz="flow-avcheck" data-cam="on">
        <div className="mav-vid">
          <video ref={videoRef} className="mav-video" muted playsInline autoPlay aria-label="내 카메라 화면" />
          <div className="mav-silh" aria-hidden="true"><User size={96} strokeWidth={1.5} /></div>
          <div className="mav-ovt"><Tag required /><MicChip mic={mic} quiet={quiet} /></div>
          <div className="mav-ovb" data-center={mic === 'on' ? 'true' : undefined}>
            {mic === 'on' ? (
              <MicRingButton steps={steps} quiet={quiet} onClick={onToggleMic} />
            ) : (
              <>
                <span className="mav-owarn">{micFailed ? micChipLabelText(mic) : '마이크가 꺼져 있어요'}</span>
                {micFailed && !unsupported ? (
                  <button type="button" className="mav-tg" aria-label="마이크 허용 방법 보기" onClick={() => onOpenHelp('마이크')}><Info size={20} aria-hidden="true" /></button>
                ) : null}
                {!micFailed ? <MicToggle mic={mic} onClick={onToggleMic} /> : null}
              </>
            )}
            <CamToggle cam={cam} onClick={onToggleCamera} />
          </div>
        </div>
      </section>
    );
  } else {
    let body: ReactNode;
    if (unsupported) {
      body = (
        <>
          <Hint warn>{mediaDeviceMessage('마이크', 'unsupported')}</Hint>
          {onCopyLink ? <MiniButton icon={<Copy size={16} />} onClick={onCopyLink}>링크 복사하기</MiniButton> : null}
        </>
      );
    } else if (mic === 'denied') {
      body = (<><Hint warn>{mediaDeviceMessage('마이크', 'denied')}</Hint><MiniButton icon={<Info size={16} />} onClick={() => onOpenHelp('마이크')}>마이크 허용 방법 보기</MiniButton></>);
    } else if (mic === 'nodevice' || mic === 'inuse') {
      body = (<><Hint warn>{mediaDeviceMessage('마이크', mic)}</Hint><MiniButton icon={<RefreshCw size={16} />} onClick={onRecheck}>다시 확인하기</MiniButton></>);
    } else if (mic === 'on' && (cam === 'denied' || cam === 'nodevice' || cam === 'inuse')) {
      body = (<><LevelBar level={level} /><Hint warn>{mediaDeviceMessage('카메라', cam)}</Hint>{cam === 'denied' ? <MiniButton icon={<Info size={16} />} onClick={() => onOpenHelp('카메라')}>카메라 허용 방법 보기</MiniButton> : null}</>);
    } else if (mic === 'on') {
      body = (<><LevelBar level={level} /><Hint>말해 보세요. 막대가 움직이면 잘 들리는 거예요. {solo ? '카메라를 켜면 상담사에게 내 모습이 보여요.' : '카메라를 켜면 상담사와 다른 분들에게 내 모습이 보여요.'}</Hint></>);
    } else {
      body = <Hint>마이크를 켜면 입력 크기를 확인할 수 있어요.</Hint>;
    }
    card = (
      <section className="mav-card mav-card--low" data-pz="flow-avcheck" data-cam="off">
        <div className="mav-head">
          <div className="mav-head__l"><Tag required /><MicChip mic={mic} quiet={quiet} /></div>
          <div className="mav-head__r"><MicToggle mic={mic} onClick={onToggleMic} /><CamToggle cam={cam} onClick={onToggleCamera} /></div>
        </div>
        <div className="mav-body">{body}</div>
      </section>
    );
  }

  return (
    <>
      {card}
      {showSpeaker ? (
        <section className="mav-card mav-spk" data-pz="flow-card">
          <div className="mav-spk__l"><Volume2 size={20} aria-hidden="true" /><b>스피커</b><Tag /></div>
          <div className="mav-spk__btn">
            <FlowButton kind={speakerPlaying ? 'primary' : 'soft'} onClick={onPlayTone}>
              {speakerPlaying ? <Volume2 size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {speakerPlaying ? '재생 중' : '테스트음 듣기'}
            </FlowButton>
          </div>
        </section>
      ) : null}
    </>
  );
}

function micChipLabelText(mic: MediaDeviceUi): string {
  if (mic === 'denied') return '마이크 권한이 꺼져 있어요';
  if (mic === 'nodevice') return '마이크를 찾지 못했어요';
  return '마이크를 쓸 수 없어요';
}
