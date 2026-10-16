// SDD-208 H2 — "채팅" 시트: 클래스 채팅 켜기/끄기(상담사 전용) + 채팅창. 채팅창 자체는 컨테이너가 ClassChatPanel(embedded)로 넘겨 준다.
import type { ReactNode } from 'react';
import { HostRow, HostSwitch } from '../HostAtoms';
import '../host-player.css';

interface ChatSheetProps {
  enabled: boolean;
  busy: boolean;
  onToggleEnabled: () => void;
  /** 열려 있는 채팅창(ClassChatPanel embedded collapsed=false) */
  room: ReactNode;
}

export function ChatSheet({ enabled, busy, onToggleEnabled, room }: ChatSheetProps) {
  return (
    <div className="hp-chat">
      <HostRow
        title="채팅 받기"
        sub={enabled ? '참가자가 메시지를 보낼 수 있어요' : '꺼져 있어요 · 켜면 참가자와 대화할 수 있어요'}
        trailing={<HostSwitch checked={enabled} label="채팅 받기" disabled={busy} onChange={onToggleEnabled} />}
      />
      {enabled ? <div className="hp-chat__room">{room}</div> : null}
    </div>
  );
}
