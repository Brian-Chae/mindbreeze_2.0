import { useState, type ReactNode } from 'react';
interface PermissionGuideProps {
  kind: 'bluetooth' | 'notifications' | 'media';
  onContinue: () => void;
  children: (request: () => void) => ReactNode;
}
/** 기능을 선택한 뒤 안내하고, 확인 전에는 OS 권한을 요청하지 않는다. */
export function PermissionGuide({ kind, onContinue, children }: PermissionGuideProps) {
  const [open, setOpen] = useState(false);
  const text = kind === 'bluetooth'
    ? 'LINK BAND 연결과 뇌파 수신에 Bluetooth 권한을 사용해요. 허용하지 않아도 밴드 없이 클래스와 리포트를 이용할 수 있어요. 거부했다면 기기 설정에서 Bluetooth 권한을 허용해 주세요.'
    : kind === 'notifications'
      ? '새 메시지와 클래스 초대를 알려드리려면 알림 권한이 필요해요. 허용하지 않아도 서비스를 이용할 수 있어요. 거부했다면 기기 설정에서 알림을 허용해 주세요.'
      : '화상 클래스와 동의한 녹음·녹화에 카메라와 마이크를 사용해요. 카메라와 마이크를 끈 채로도 참여할 수 있어요. 거부했다면 기기 설정에서 권한을 허용해 주세요.';
  return <>
    {children(() => setOpen(true))}
    {open && <div role="dialog" aria-modal="true" aria-label="권한 사용 안내" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-[#1F1F1F]">
        <h2 className="font-bold">권한 사용 안내</h2>
        <p className="my-4">{text}</p>
        <div className="flex flex-wrap justify-end gap-4">
          <button type="button" onClick={() => setOpen(false)}>나중에</button>
          <button type="button" onClick={() => { setOpen(false); onContinue(); }}>확인하고 계속</button>
        </div>
      </div>
    </div>}
  </>;
}
