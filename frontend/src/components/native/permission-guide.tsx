import { useState, type ReactNode } from 'react';
import { permissionGuideText, type PermissionGuideKind } from './permission-guide-text';
interface PermissionGuideProps {
  kind: PermissionGuideKind;
  /** SDD-303: 설명은 화면에 직접 두고 시트 없이 버튼 1탭으로 곧바로 계속한다(OS 권한은 이 탭의 제스처에서 요청) */
  inline?: boolean;
  onContinue: () => void;
  children: (request: () => void) => ReactNode;
}
/** 기능을 선택한 뒤 안내하고, 확인 전에는 OS 권한을 요청하지 않는다. inline 이면 설명을 호출부가 화면에 두고 시트를 거치지 않는다. */
export function PermissionGuide({ kind, inline = false, onContinue, children }: PermissionGuideProps) {
  const [open, setOpen] = useState(false);
  const text = permissionGuideText(kind);
  if (inline) return <>{children(onContinue)}</>;
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
