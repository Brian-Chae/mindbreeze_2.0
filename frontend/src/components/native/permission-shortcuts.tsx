// SDD-330: 블루투스 권한 안내 아래에 두는 바로가기 버튼 묶음.
// "설정 메뉴로 가세요" 문구만으로는 메뉴를 찾지 못하는 사용자를 위해 앱 안에서 직접 허용하거나 설정 화면을 바로 연다.
// 앱이 아니거나 구버전 앱(플러그인 없음)에서는 아무것도 그리지 않아 기존 안내 문구가 그대로 보인다.
import { useEffect, useState, type ReactNode } from 'react';
import { getPlatform, isNativeApp } from '../../lib/native/platform';
import {
  isBatteryOptimizationIgnored,
  openAppSettings,
  requestBluetoothPermission,
  requestIgnoreBatteryOptimizations,
} from '../../lib/native/app-settings';

interface PermissionShortcutsProps {
  /** 버튼 한 개를 그리는 방식(화면별 버튼 스타일에 맞춘다) */
  renderButton?: (props: { label: string; onClick: () => void; testId: string }) => ReactNode;
  /** 권한 요청을 마친 뒤 호출(연결 재시도 등) */
  onRequested?: () => void;
}

function DefaultButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return <button type="button" data-testid={testId} className="mp-pill mp-pill--block" onClick={onClick}>{label}</button>;
}

export function PermissionShortcuts({ renderButton, onRequested }: PermissionShortcutsProps) {
  const native = isNativeApp();
  const android = getPlatform() === 'android';
  const [batteryOk, setBatteryOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!native || !android) return;
    let alive = true;
    void isBatteryOptimizationIgnored().then((ignored) => { if (alive) setBatteryOk(ignored); });
    return () => { alive = false; };
  }, [native, android]);

  if (!native) return null;
  const draw = renderButton ?? ((p) => <DefaultButton {...p} />);

  const allow = (): void => { void requestBluetoothPermission().then(() => onRequested?.()); };
  const openSettings = (): void => { void openAppSettings(); };
  const battery = (): void => { void requestIgnoreBatteryOptimizations().then(() => isBatteryOptimizationIgnored().then(setBatteryOk)); };

  return (
    <div className="mp-perm-shortcuts" data-testid="permission-shortcuts">
      {draw({ label: '권한 허용하기', onClick: allow, testId: 'perm-allow' })}
      {draw({ label: '설정 열기', onClick: openSettings, testId: 'perm-open-settings' })}
      {android && batteryOk !== true ? draw({ label: '배터리 제한 풀기', onClick: battery, testId: 'perm-battery' }) : null}
    </div>
  );
}
