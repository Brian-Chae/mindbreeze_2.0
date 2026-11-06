// SDD-289 → SDD-299 — 정원 늘리기 구역. 설정 시트(구 도구)의 첫 구역으로 쓰며 로직은 CapacityIncreaseForm 그대로, 위치만 이동했다.
import { CapacityIncreaseForm } from './CapacityIncreaseForm';
import { HostRow, HostSection } from './HostAtoms';
import { capacityMax } from '../../../../lib/class/capacity-increase';
import './host-player.css';

export interface HostCapacityProps {
  classId: string;
  capacity: number;
  revision: number | undefined;
  admin: boolean;
  onChanged: (newCapacity: number) => void;
}

interface HostCapacitySectionProps {
  online: boolean;
  capacity: HostCapacityProps;
  joined: number;
  waiting: number;
}

export function HostCapacitySection({ online, capacity, joined, waiting }: HostCapacitySectionProps) {
  return (
    <HostSection label="정원 늘리기" title aside={`최대 ${capacityMax(online)}명`}>
      <HostRow title="현재 정원" trailing={<b>{capacity.capacity}명</b>} />
      <HostRow title="현재 입장" trailing={<b>{joined}명</b>} />
      <HostRow title="입장 대기" trailing={<b>{waiting}명</b>} />
      <CapacityIncreaseForm
        classId={capacity.classId} current={capacity.capacity} occupied={joined} waiting={waiting}
        online={online} revision={capacity.revision} admin={capacity.admin} onChanged={capacity.onChanged}
      />
    </HostSection>
  );
}
