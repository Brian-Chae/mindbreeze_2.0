// SDD-289 — 상담사 라이브 '설정' 시트: 미디어(녹음) 설정 + 정원 설정 두 구역을 세로로 배치한다.
import { HostMediaSheet, type HostMediaProps } from './HostMediaSheet';
import { CapacityIncreaseForm } from './CapacityIncreaseForm';
import { HostRow, HostSection } from './HostAtoms';
import type { CamUi, MicUi } from '../../../../lib/class/player-case';
import './host-player.css';

export interface HostCapacityProps {
  classId: string;
  capacity: number;
  revision: number | undefined;
  admin: boolean;
  onChanged: (newCapacity: number) => void;
}

interface HostSettingsSheetProps {
  online: boolean;
  cam: CamUi;
  mic: MicUi;
  media: HostMediaProps;
  onToggleCam: () => void;
  onToggleMic: () => void;
  onOpenPermission: (sheet: 'permcam' | 'permmic') => void;
  /** 정원 정보를 알 수 없으면(클래스 소속이 아닌 회차 등) null — 정원 구역을 그리지 않는다 */
  capacity: HostCapacityProps | null;
  joined: number;
  waiting: number;
}

export function HostSettingsSheet({ online, cam, mic, media, onToggleCam, onToggleMic, onOpenPermission, capacity, joined, waiting }: HostSettingsSheetProps) {
  return (
    <div className="hp-sheet">
      <HostSection label={online ? '미디어 설정' : '녹음 설정'}>
        <HostMediaSheet online={online} cam={cam} mic={mic} media={media} onToggleCam={onToggleCam} onToggleMic={onToggleMic} onOpenPermission={onOpenPermission} />
      </HostSection>
      {capacity ? (
        <HostSection label="정원 설정">
          <HostRow title="현재 정원" trailing={<b>{capacity.capacity}명</b>} />
          <HostRow title="현재 입장" trailing={<b>{joined}명</b>} />
          <HostRow title="입장 대기" trailing={<b>{waiting}명</b>} />
          <CapacityIncreaseForm
            classId={capacity.classId} current={capacity.capacity} occupied={joined} waiting={waiting}
            online={online} revision={capacity.revision} admin={capacity.admin} onChanged={capacity.onChanged}
          />
        </HostSection>
      ) : null}
    </div>
  );
}
