// SDD-208 H4 — "미디어"(온라인) / "녹음"(오프라인) 시트와 카메라·마이크 허용 방법 시트.
// 오프라인은 카메라·마이크 토글 DOM 자체를 두지 않는다. 진행 중 BGM 무재생 정책(D3)에 따라 BGM 행도 없다.
// 소실되면 안 되는 기능(녹음 시작/일시정지/종료, 영상 녹화 제어, 전면/후면 전환, 마커)을 여기에 모은다.
import type { ReactNode } from 'react';
import { Mic, MicOff, Pause, Play, SwitchCamera, User, VideoOff } from 'lucide-react';
import type { RecorderState } from '../../../../hooks/useAudioRecorder';
import type { FacingMode, VideoRecorderState } from '../../../../hooks/useVideoRecorder';
import { formatClock } from '../../../../lib/class/host-player-case';
import type { CamUi, MicUi } from '../../../../lib/class/player-case';
import { RecordingControls } from '../../../session/RecordingControls';
import { HostRow, HostSection, HostSwitch } from './HostAtoms';
import './host-player.css';

export interface HostRecordingProps {
  state: RecorderState;
  elapsedSec: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export interface HostVideoProps {
  state: VideoRecorderState;
  facingMode: FacingMode;
  onSwitchCamera: () => void;
  /** 조합 C(카메라 ON + 마이크 OFF 로 시작한 수업): 무음 영상만 따로 녹화한다 */
  videoOnly: { available: boolean; onStart: () => void; onStop: () => void };
}

export interface HostMediaProps {
  recording: HostRecordingProps;
  /** 영상 녹화를 쓰지 않는 수업이면 null */
  video: HostVideoProps | null;
  /** 마커 입력(MarkerButton) — 하니스는 null */
  marker: ReactNode | null;
}

interface HostMediaSheetProps {
  online: boolean;
  cam: CamUi;
  mic: MicUi;
  media: HostMediaProps;
  onToggleCam: () => void;
  onToggleMic: () => void;
  onOpenPermission: (sheet: 'permcam' | 'permmic') => void;
}

function recordingSub(state: RecorderState, elapsedSec: number): string {
  if (state === 'recording') return `녹음 중 · ${formatClock(elapsedSec)}`;
  if (state === 'paused') return '기록 일시정지';
  if (state === 'error') return '녹음기를 쓸 수 없어요';
  return '녹음 전';
}

export function HostMediaSheet({ online, cam, mic, media, onToggleCam, onToggleMic, onOpenPermission }: HostMediaSheetProps) {
  const { recording, video, marker } = media;
  const recActive = recording.state === 'recording' || recording.state === 'paused';
  const camDenied = cam === 'denied' || cam === 'nodevice';

  return (
    <div className="hp-sheet">
      {online ? (
        <>
          {camDenied ? (
            <HostRow
              lead={<span className="hp-thumb"><VideoOff aria-hidden="true" strokeWidth={2} /></span>}
              title="내 카메라"
              sub={cam === 'nodevice' ? '카메라를 찾지 못했어요' : '권한이 필요해요'}
              subTone="coral"
              trailing={<button type="button" className="hp-btn" data-variant="ghost" onClick={() => onOpenPermission('permcam')}>설정 안내</button>}
            />
          ) : (
            <HostRow
              lead={<span className="hp-thumb"><User aria-hidden="true" strokeWidth={2} /></span>}
              title="내 카메라"
              sub={cam === 'on' ? '참가자에게 보이는 중' : '꺼짐'}
              trailing={<HostSwitch checked={cam === 'on'} label="카메라" onChange={onToggleCam} />}
            />
          )}
          {mic === 'denied' ? (
            <HostRow
              lead={<span className="hp-row__lead"><MicOff aria-hidden="true" strokeWidth={2} /></span>}
              title="마이크"
              sub="권한이 필요해요"
              subTone="coral"
              trailing={<button type="button" className="hp-btn" data-variant="ghost" onClick={() => onOpenPermission('permmic')}>허용 방법</button>}
            />
          ) : (
            <HostRow
              lead={<span className="hp-row__lead">{mic === 'on' ? <Mic aria-hidden="true" strokeWidth={2} /> : <MicOff aria-hidden="true" strokeWidth={2} />}</span>}
              title="마이크"
              sub={mic === 'on' ? '켜짐' : '꺼짐 · AI 기록 제외'}
              trailing={<HostSwitch checked={mic === 'on'} label="마이크" onChange={onToggleMic} />}
            />
          )}
        </>
      ) : (
        <HostRow
          lead={<span className="hp-row__lead"><Mic aria-hidden="true" strokeWidth={2} /></span>}
          title="녹음 마이크"
          sub={recordingSub(recording.state, recording.elapsedSec)}
        />
      )}

      <HostSection label="AI 기록">
        {online && mic === 'off' ? (
          <HostRow
            lead={<span className="hp-row__lead"><Pause aria-hidden="true" strokeWidth={2} /></span>}
            title="AI 기록"
            sub="마이크를 켜면 이어서 기록돼요"
            trailing={recActive ? <button type="button" className="hp-btn" data-variant="danger" data-rec-action="stop" onClick={recording.onStop}>녹음 종료</button> : undefined}
          />
        ) : (
          <div className="hp-legacy">
            <RecordingControls
              state={recording.state}
              elapsedSec={recording.elapsedSec}
              onStart={recording.onStart}
              onPause={recording.onPause}
              onResume={recording.onResume}
              onStop={recording.onStop}
            />
          </div>
        )}
        {!online ? <p className="hp-note">멈춘 구간은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요.</p> : null}
      </HostSection>

      {video && online && (video.state === 'recording' || video.state === 'paused') ? (
        <HostRow
          lead={<span className="hp-row__lead"><SwitchCamera aria-hidden="true" strokeWidth={2} /></span>}
          title={video.state === 'recording' ? '영상 녹화 중' : '영상 녹화 일시정지'}
          sub={video.facingMode === 'user' ? '전면 카메라' : '후면 카메라'}
          trailing={
            <button type="button" className="hp-btn" data-variant="ghost" onClick={video.onSwitchCamera}>
              {video.facingMode === 'user' ? '후면 카메라로 전환' : '전면 카메라로 전환'}
            </button>
          }
        />
      ) : null}
      {video && video.videoOnly.available ? (
        <HostRow
          lead={<span className="hp-row__lead"><Play aria-hidden="true" strokeWidth={2} /></span>}
          title="무음 영상 녹화"
          sub="음성 녹음·AI 분석 없이 영상만 기록해요"
          trailing={
            video.state === 'recording' || video.state === 'paused'
              ? <button type="button" className="hp-btn" data-variant="ghost" onClick={video.videoOnly.onStop}>영상 녹화 종료</button>
              : <button type="button" className="hp-btn" onClick={video.videoOnly.onStart}>영상 녹화 시작</button>
          }
        />
      ) : null}

      {marker ? (
        <HostSection label="마커">
          <div className="hp-legacy">{marker}</div>
        </HostSection>
      ) : null}
    </div>
  );
}

interface HostPermissionSheetProps {
  kind: 'camera' | 'microphone';
  onRecheck: () => void;
}

export function HostPermissionSheet({ kind, onRecheck }: HostPermissionSheetProps) {
  const camera = kind === 'camera';
  return (
    <div className="hp-sheet">
      <ol className="hp-steps">
        <li>브라우저 주소창 왼쪽의 자물쇠 아이콘을 눌러요</li>
        <li>{camera ? '카메라' : '마이크'}을 &quot;허용&quot;으로 바꿔요</li>
        <li>이 화면을 새로고침해요</li>
      </ol>
      <p className="hp-note" data-tone="coral">
        {camera ? '허용하지 않아도 수업은 계속 진행할 수 있어요.' : '허용하지 않으면 이 수업은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요.'}
      </p>
      <button type="button" className="hp-btn" onClick={onRecheck}>허용했어요 · 다시 확인</button>
    </div>
  );
}
