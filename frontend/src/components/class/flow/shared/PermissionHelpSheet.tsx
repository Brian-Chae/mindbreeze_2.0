// SDD-209 T2b — 마이크·카메라 허용 방법 시트(회원 FM06d · 상담사 FH05 공용).
import { Lock, Mic, RefreshCw, Video } from 'lucide-react';
import { FlowButton, FlowNote, FlowSheet } from './flow-primitives';

interface PermissionHelpSheetProps {
  open: boolean;
  device: '마이크' | '카메라';
  onClose: () => void;
  /** "허용했어요, 다시 확인하기" — 호출한 뒤 시트를 닫는 것은 호출부 몫 */
  onRecheck: () => void;
}

export function PermissionHelpSheet({ open, device, onClose, onRecheck }: PermissionHelpSheetProps) {
  const DeviceIcon = device === '카메라' ? Video : Mic;
  return (
    <FlowSheet
      open={open}
      title={`${device} 허용 방법`}
      onClose={onClose}
      footer={<FlowButton kind="primary" onClick={onRecheck}>허용했어요, 다시 확인하기</FlowButton>}
    >
      <ul className="mav-howto">
        <li><Lock size={20} aria-hidden="true" /><span>주소창 왼쪽의 자물쇠 아이콘을 눌러요</span></li>
        <li><DeviceIcon size={20} aria-hidden="true" /><span>{device}를 허용으로 바꿔요</span></li>
        <li><RefreshCw size={20} aria-hidden="true" /><span>화면을 새로고침한 뒤 다시 확인해요</span></li>
      </ul>
      <FlowNote>스마트폰에서는 설정 앱의 브라우저 항목에서도 바꿀 수 있어요.</FlowNote>
    </FlowSheet>
  );
}
